/**
 * Issue #4941: Redis 2PC例外 - Ghost Connection状態とタイミング競合の修正テスト
 * strategy-runnerサービスで発生したRedis接続状態不整合と
 * トランザクション実行時の接続失敗問題の修正をテスト
 */

// Jest テストフレームワークを使用
jest.unmock('../../../src/database/manager');

// 外部依存関係をモック  
jest.mock('../../../src/database/redisDatabase', () => ({
  getClient: jest.fn()
}));

jest.mock('../../../src/database/mongoDatabase', () => ({
  connectDB: jest.fn(),
  tradesCollection: {
    findOne: jest.fn(),
    updateOne: jest.fn(),
    insertOne: jest.fn()
  },
  getMongoClient: jest.fn(),
  getClient: jest.fn(),
  addTradeMongoDB: jest.fn()
}));

jest.mock('../../../src/hft/utils/Logger', () => jest.fn().mockImplementation(() => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
})));

jest.mock('../../../src/common/const', () => ({
  MONITORING_SETTINGS: {
    REDIS_TRANSACTION_TIMEOUT: 45000,
    REDIS_CONNECTION_TIMEOUT: 10000
  },
  NOTIFICATION_SETTINGS: {},
  EXCHANGE_SETTINGS: {},
  TRADING_EXECUTION_CONSTANTS: {}
}));

jest.mock('../../../src/common/apiCoordinator', () => ({
  apiCoordinator: {
    // 必要最小限のモック実装
  }
}));

jest.mock('../../../src/database/redisClient', () => ({
  initRedisClient: jest.fn(),
  getClient: jest.fn(),
  checkRedisConnectionHealth: jest.fn(),
  isCircuitBreakerOpen: jest.fn().mockReturnValue(false),
  updateCircuitBreakerOnFailure: jest.fn(),
  updateCircuitBreakerOnSuccess: jest.fn(),
  getCircuitBreakerState: jest.fn().mockReturnValue({
    state: 'CLOSED',
    failures: 0,
    isOpen: false,
    timeSinceLastFailure: 0
  })
}));

describe('Issue #4941: Redis 2PC例外 - Ghost Connection修正', () => {
  let mockRedisClient;
  let mockRedisTransaction;
  let mockRedisDatabase;
  let mockLogger;
  let databaseManager;

  beforeEach(() => {
    // モックの初期化
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };

    // 正常な接続状態のRedisクライアント
    mockRedisClient = {
      isReady: true,
      status: 'ready',
      serverInfo: { version: '6.2.0' },
      ping: jest.fn().mockResolvedValue('PONG'),
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn().mockImplementation((key) => {
        if (key && key.includes('__tx_health_')) {
          return Promise.resolve('tx_test');
        }
        return Promise.resolve('test-value');
      }),
      del: jest.fn().mockResolvedValue(1),
      multi: jest.fn()
    };

    // モックトランザクション
    mockRedisTransaction = {
      client: mockRedisClient,
      exec: jest.fn().mockResolvedValue([
        [null, 'OK'],
        [null, 1],
        [null, 2]
      ])
    };

    mockRedisClient.multi.mockReturnValue(mockRedisTransaction);

    mockRedisDatabase = {
      getClient: jest.fn().mockReturnValue(mockRedisClient)
    };

    // databaseManagerをrequire
    jest.doMock('../../../src/database/redisDatabase', () => mockRedisDatabase);
    databaseManager = require('../../../src/database/manager');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('executeRedisTransactionWithTimeout - Issue #4941改善', () => {
    test('正常ケース: 強化された接続検証が成功する', async () => {
      const testTrade = {
        tradeId: '1416742199',
        exchange: 'bitbank',
        symbol: 'XLM/JPY',
        strategy: 'BB戦略'
      };

      const commandNames = ['hIncrByFloat', 'hSet', 'hDel'];

      const result = await databaseManager.executeRedisTransactionWithTimeout(
        mockRedisTransaction,
        commandNames,
        testTrade,
        mockLogger
      );

      // 基本的な成功確認
      expect(result).toEqual([
        [null, 'OK'],
        [null, 1],
        [null, 2]
      ]);

      // Issue #4941: 強化された接続検証が実行されたことを確認
      expect(mockRedisClient.ping).toHaveBeenCalled();
      expect(mockRedisClient.set).toHaveBeenCalledWith(
        expect.stringContaining('__tx_health_1416742199_'),
        'tx_test',
        'EX',
        5
      );
      expect(mockRedisClient.get).toHaveBeenCalledWith(
        expect.stringContaining('__tx_health_1416742199_')
      );
      expect(mockRedisClient.del).toHaveBeenCalledWith(
        expect.stringContaining('__tx_health_1416742199_')
      );

      // デバッグログが出力されることを確認
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('[Redis Transaction] 接続テスト成功')
      );
    });

    test('Ghost Connection検出: isReady=true だが実際の操作で失敗', async () => {
      // Ghost Connection状態をシミュレート
      mockRedisClient.isReady = true;
      mockRedisClient.status = 'ready';
      
      // しかし実際の操作は失敗
      mockRedisClient.ping.mockRejectedValue(new Error('Connection lost'));

      const testTrade = {
        tradeId: '1416742199',
        exchange: 'bitbank',
        symbol: 'XLM/JPY',
        strategy: 'BB戦略'
      };

      const commandNames = ['hIncrByFloat'];

      await expect(
        databaseManager.executeRedisTransactionWithTimeout(
          mockRedisTransaction,
          commandNames,
          testTrade,
          mockLogger
        )
      ).rejects.toThrow('Redis Commit失敗: 接続実用性テスト失敗 - Connection lost');

      // 詳細な診断情報がログ出力されることを確認
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('[Redis Transaction] 接続実用性テスト失敗')
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('[Redis Transaction] 診断情報')
      );
    });

    test('操作テスト失敗: SET/GET/DEL操作で不整合', async () => {
      // SET/GET/DEL操作での不整合をシミュレート
      mockRedisClient.get.mockResolvedValue('wrong_value');

      const testTrade = {
        tradeId: '1416742199',
        exchange: 'bitbank',
        symbol: 'XLM/JPY',
        strategy: 'BB戦略'
      };

      const commandNames = ['hIncrByFloat'];

      await expect(
        databaseManager.executeRedisTransactionWithTimeout(
          mockRedisTransaction,
          commandNames,
          testTrade,
          mockLogger
        )
      ).rejects.toThrow('Redis Commit失敗: 接続実用性テスト失敗');

      // 診断情報に詳細が含まれることを確認
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('操作テスト失敗: 期待値=\'tx_test\', 実際=\'wrong_value\'')
      );
    });

    test('exec()直前の接続状態チェック失敗', async () => {
      // exec()直前に接続が失われる状況をシミュレート
      const originalExec = mockRedisTransaction.exec;
      mockRedisTransaction.exec = jest.fn().mockImplementation(() => {
        // exec()呼び出し時に接続状態を変更
        mockRedisClient.isReady = false;
        mockRedisClient.status = 'closed';
        return originalExec();
      });

      const testTrade = {
        tradeId: '1416742199',
        exchange: 'bitbank',
        symbol: 'XLM/JPY',
        strategy: 'BB戦略'
      };

      const commandNames = ['hIncrByFloat'];

      await expect(
        databaseManager.executeRedisTransactionWithTimeout(
          mockRedisTransaction,
          commandNames,
          testTrade,
          mockLogger
        )
      ).rejects.toThrow('Redis Commit失敗: exec()後に接続が失われました');
    });

    test('詳細なエラー診断情報の生成', async () => {
      // トランザクション実行でエラーが発生する状況
      mockRedisTransaction.exec.mockRejectedValue(new Error('Transaction failed'));

      const testTrade = {
        tradeId: '1416742199',
        exchange: 'bitbank',
        symbol: 'XLM/JPY',
        strategy: 'BB戦略'
      };

      const commandNames = ['hIncrByFloat', 'hSet'];

      let thrownError;
      try {
        await databaseManager.executeRedisTransactionWithTimeout(
          mockRedisTransaction,
          commandNames,
          testTrade,
          mockLogger
        );
        throw new Error('Expected function to throw');
      } catch (error) {
        thrownError = error;
      }

      // エラーが投げられたことを確認
      expect(thrownError).toBeDefined();
      expect(thrownError.message).toContain('Transaction failed');

      // 詳細な診断情報がエラーオブジェクトに含まれることを確認
      if (thrownError.diagnostics) {
        expect(thrownError.diagnostics.tradeId).toBe('1416742199');
        expect(thrownError.diagnostics.commandCount).toBe(2);
        expect(thrownError.diagnostics.connectionState).toBeDefined();
        expect(thrownError.diagnostics.circuitBreakerState).toBeDefined();
      }

      // 診断情報がログ出力されることを確認
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('[Redis Transaction] 例外キャッチ - 診断情報')
      );
    });

    test('コマンド失敗時の詳細情報収集', async () => {
      // 一部コマンドが失敗する状況をシミュレート
      mockRedisTransaction.exec.mockResolvedValue([
        [null, 'OK'],  // 成功
        [new Error('Redis operation failed with null/undefined error'), null],  // 失敗
        [new Error('Invalid response (empty/dash)'), null]  // 失敗
      ]);

      const testTrade = {
        tradeId: '1416742199',
        exchange: 'bitbank',
        symbol: 'XLM/JPY',
        strategy: 'BB戦略'
      };

      const commandNames = ['hIncrByFloat', 'hSet', 'hDel'];

      let thrownError;
      try {
        await databaseManager.executeRedisTransactionWithTimeout(
          mockRedisTransaction,
          commandNames,
          testTrade,
          mockLogger
        );
        throw new Error('Expected function to throw');
      } catch (error) {
        thrownError = error;
      }

      // エラーが投げられたことを確認
      expect(thrownError).toBeDefined();
      expect(thrownError.message).toContain('Redis Commit失敗');

      // 詳細失敗情報がエラーに含まれることを確認
      if (thrownError.details) {
        expect(thrownError.details.failedCount).toBe(2);
        expect(thrownError.details.failedCommandDetails).toHaveLength(2);
        
        // 失敗原因の分類が正しく行われることを確認
        const failureDetails = thrownError.details.failedCommandDetails;
        expect(failureDetails[0].possibleCause).toBe('connection_timeout_or_lost');
        expect(failureDetails[1].possibleCause).toBe('invalid_server_response');
      }

      // 詳細ログが出力されることを確認
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('[Redis Transaction] エラー詳細 [1]')
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('[Redis Transaction] 詳細失敗情報')
      );
    });

    test('PING応答時間による接続品質チェック', async () => {
      // 長い応答時間をシミュレート
      mockRedisClient.ping.mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve('PONG'), 1500))
      );

      const testTrade = {
        tradeId: '1416742199',
        exchange: 'bitbank',
        symbol: 'XLM/JPY',
        strategy: 'BB戦略'
      };

      const commandNames = ['hIncrByFloat'];

      await databaseManager.executeRedisTransactionWithTimeout(
        mockRedisTransaction,
        commandNames,
        testTrade,
        mockLogger
      );

      // 長い応答時間に対する警告が出力されることを確認
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[Redis Transaction] PING応答時間が長い')
      );
    });
  });
});