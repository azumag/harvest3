/**
 * Issue #5755: Redis接続チェックテストの統合テスト追加と改善
 * モック最小化とより実際の動作に近いテストケース
 */

// Jest テストフレームワークを使用
jest.unmock('../../../src/database/manager');

// 最小限の外部依存関係をモック  
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
  NOTIFICATION_SETTINGS: {
    RATE_LIMIT_WINDOW_MS: 30000
  },
  EXCHANGE_SETTINGS: {},
  TRADING_EXECUTION_CONSTANTS: {}
}));

jest.mock('../../../src/common/apiCoordinator', () => ({
  apiCoordinator: {}
}));

jest.mock('../../../src/database/redisClient', () => ({
  isCircuitBreakerOpen: jest.fn().mockReturnValue(false),
  updateCircuitBreakerOnFailure: jest.fn(),
  updateCircuitBreakerOnSuccess: jest.fn(),
  getCircuitBreakerStatus: jest.fn().mockReturnValue({
    isOpen: false,
    timeSinceLastFailure: 0
  })
}));

describe('Issue #5755: Redis接続チェックテスト改善版', () => {
  let mockRedisClient;
  let mockRedisTransaction;
  let mockRedisDatabase;
  let mockLogger;
  let databaseManager;

  beforeEach(() => {
    // 軽量なログ実装
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };

    // より実際のRedisクライアントに近い実装
    mockRedisClient = {
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
      multi: jest.fn(),
      // 正常な初期状態
      isReady: true,
      isOpen: true
    };

    // より実際のRedisトランザクションに近い実装
    mockRedisTransaction = {
      client: mockRedisClient,
      hIncrByFloat: jest.fn().mockReturnThis(),
      hSet: jest.fn().mockReturnThis(),
      hDel: jest.fn().mockReturnThis(),
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

  describe('モック最小化による改善テスト', () => {
    test('最小限のモックで正常ケースが動作する', async () => {
      // 正常状態のRedisクライアント
      mockRedisClient.isReady = true;
      mockRedisClient.isOpen = true;
      mockRedisClient.status = 'ready';

      const testTrade = {
        tradeId: 'MINIMAL_MOCK_001',
        exchange: 'bitbank',
        symbol: 'BTC/JPY',
        strategy: 'TEST'
      };

      const commandNames = ['hSet', 'hIncrByFloat'];

      const result = await databaseManager.executeRedisTransactionWithTimeout(
        mockRedisTransaction,
        commandNames,
        testTrade,
        mockLogger
      );

      expect(result).toEqual([
        [null, 'OK'],
        [null, 1],
        [null, 2]
      ]);

      // 最小限のエラーログのみ確認
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    test('Issue #5722: undefined プロパティでPINGテストが機能する', async () => {
      // Issue #5722の核心問題を再現
      mockRedisClient.isReady = undefined;
      mockRedisClient.isOpen = undefined;
      mockRedisClient.status = 'ready';
      
      // PINGテストは成功させる（フォールバック動作のテスト）
      mockRedisClient.ping.mockResolvedValue('PONG');

      const testTrade = {
        tradeId: 'UNDEFINED_PROPERTY_001',
        exchange: 'bitbank',
        symbol: 'BTC/JPY',
        strategy: 'TEST'
      };

      const result = await databaseManager.executeRedisTransactionWithTimeout(
        mockRedisTransaction,
        ['hSet'],
        testTrade,
        mockLogger
      );

      expect(result).toEqual([
        [null, 'OK'],
        [null, 1],
        [null, 2]
      ]);

      // PINGテストが実行されることを確認
      expect(mockRedisClient.ping).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('PINGテスト成功 - undefinedプロパティでも接続は有効')
      );
    });

    test('Issue #5722: undefined プロパティでPINGテストも失敗する場合', async () => {
      // Issue #5722の問題状況
      mockRedisClient.isReady = undefined;
      mockRedisClient.isOpen = undefined;
      mockRedisClient.status = 'ready';
      
      // PINGテストも失敗
      mockRedisClient.ping.mockRejectedValue(new Error('Connection lost'));

      const testTrade = {
        tradeId: 'UNDEFINED_PING_FAIL_001',
        exchange: 'bitbank',
        symbol: 'BTC/JPY',
        strategy: 'TEST'
      };

      await expect(
        databaseManager.executeRedisTransactionWithTimeout(
          mockRedisTransaction,
          ['hSet'],
          testTrade,
          mockLogger
        )
      ).rejects.toThrow('Redis Commit失敗: クライアントが実行可能状態ではありません');

      // 特定の警告ログを確認
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('プロパティ未定義またはundefined値検出')
      );
    });

    test('プロパティ未定義（削除）でstatusベースフォールバック', async () => {
      // プロパティを完全に削除
      delete mockRedisClient.isReady;
      delete mockRedisClient.isOpen;
      mockRedisClient.status = 'ready';

      const testTrade = {
        tradeId: 'PROPERTY_DELETED_001',
        exchange: 'bitbank',
        symbol: 'BTC/JPY',
        strategy: 'TEST'
      };

      const result = await databaseManager.executeRedisTransactionWithTimeout(
        mockRedisTransaction,
        ['hSet'],
        testTrade,
        mockLogger
      );

      expect(result).toEqual([
        [null, 'OK'],
        [null, 1],
        [null, 2]
      ]);

      // status基準での成功ログ
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('status基準で接続OK (status=ready)')
      );
    });

    test('接続失敗時の基本エラーハンドリング', async () => {
      // 接続失敗状態
      mockRedisClient.isReady = false;
      mockRedisClient.isOpen = false;
      mockRedisClient.status = 'disconnected';

      await expect(
        databaseManager.executeRedisTransactionWithTimeout(
          mockRedisTransaction,
          ['hSet'],
          { tradeId: 'DISCONNECT_TEST', exchange: 'test', symbol: 'BTC/JPY', strategy: 'TEST' },
          mockLogger
        )
      ).rejects.toThrow('Redis Commit失敗: クライアントが実行可能状態ではありません');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('接続状態チェックエラー')
      );
    });
  });

  describe('エラー処理とエッジケース', () => {
    test('nullクライアントの適切な処理', async () => {
      // nullクライアントをテスト
      mockRedisDatabase.getClient.mockReturnValue(null);
      
      await expect(
        databaseManager.executeRedisTransactionWithTimeout(
          { client: null, exec: jest.fn() },
          ['test'],
          { tradeId: 'NULL_CLIENT_TEST' },
          mockLogger
        )
      ).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('クライアントオブジェクトがnull/undefined')
      );
    });

    test('トランザクション実行エラーの処理', async () => {
      // exec実行時のエラー
      mockRedisTransaction.exec.mockRejectedValue(new Error('Transaction failed'));

      await expect(
        databaseManager.executeRedisTransactionWithTimeout(
          mockRedisTransaction,
          ['hSet'],
          { tradeId: 'EXEC_ERROR_TEST', exchange: 'test', symbol: 'BTC/JPY', strategy: 'TEST' },
          mockLogger
        )
      ).rejects.toThrow();
    });
  });

  describe('パフォーマンスと実用性テスト', () => {
    test('複数コマンドでの正常動作', async () => {
      const commands = ['hSet', 'hIncrByFloat', 'hDel', 'hGet'];
      const results = commands.map((_, i) => [null, `result${i}`]);
      
      mockRedisTransaction.exec.mockResolvedValue(results);

      const result = await databaseManager.executeRedisTransactionWithTimeout(
        mockRedisTransaction,
        commands,
        { tradeId: 'MULTI_COMMAND_TEST', exchange: 'test', symbol: 'BTC/JPY', strategy: 'TEST' },
        mockLogger
      );

      expect(result).toHaveLength(4);
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    test('タイムアウト処理の基本動作', async () => {
      // 正常な応答時間内での完了
      mockRedisTransaction.exec.mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve([[null, 'OK']]), 50))
      );

      const result = await databaseManager.executeRedisTransactionWithTimeout(
        mockRedisTransaction,
        ['fastCommand'],
        { tradeId: 'TIMEOUT_TEST', exchange: 'test', symbol: 'BTC/JPY', strategy: 'TEST' },
        mockLogger
      );

      expect(result).toEqual([[null, 'OK']]);
    });
  });
});