/**
 * Issue #5701: strategy-runnerサービスで例外が発生 - Redis v4.x undefined プロパティ対応テスト
 * Redis接続状態チェックでプロパティが未定義の場合の堅牢な処理をテスト
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

describe('Issue #5701: Redis v4.x undefined プロパティ対応', () => {
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

    // 基本的なRedisクライアント
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

  describe('Redis v4.x プロパティ未定義状態の処理', () => {
    test('isReady, isOpenプロパティ自体が存在しない場合はstatusで判定される', async () => {
      // Issue #5701: プロパティ自体が存在しないクライアントをシミュレート
      const clientWithoutProperties = {
        status: 'ready',
        ping: jest.fn().mockResolvedValue('PONG'),
        set: jest.fn().mockResolvedValue('OK'),
        get: jest.fn().mockImplementation((key) => {
          if (key && key.includes('__tx_health_')) {
            return Promise.resolve('tx_test');
          }
          return Promise.resolve('test-value');
        }),
        del: jest.fn().mockResolvedValue(1),
        multi: jest.fn().mockReturnValue(mockRedisTransaction)
      };
      
      mockRedisTransaction.client = clientWithoutProperties;

      const testTrade = {
        tradeId: '1416763593',
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

      expect(result).toEqual([
        [null, 'OK'],
        [null, 1],
        [null, 2]
      ]);

      // プロパティ未定義の警告ログが出力されることを確認
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('プロパティ未定義またはundefined値検出')
      );
      
      // status基準で接続OKのログが出力されることを確認
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('status基準で接続OK (status=ready)')
      );
    });

    test('statusがreadyでない場合はエラーになる', async () => {
      // Issue #5701: プロパティ未定義 + status異常の場合
      const clientWithBadStatus = {
        status: 'disconnected',
        ping: jest.fn().mockResolvedValue('PONG'),
        set: jest.fn().mockResolvedValue('OK'),
        get: jest.fn().mockResolvedValue('test'),
        del: jest.fn().mockResolvedValue(1),
        multi: jest.fn().mockReturnValue(mockRedisTransaction)
      };
      
      mockRedisTransaction.client = clientWithBadStatus;

      const testTrade = {
        tradeId: '1416763593',
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
      ).rejects.toThrow('Redis Commit失敗: クライアントが実行可能状態ではありません');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('[Redis Transaction] 接続状態チェックエラー:')
      );
    });

    test('statusがconnectedの場合も正常動作する', async () => {
      // Issue #5701: status = 'connected' の場合のテスト
      const clientWithConnectedStatus = {
        status: 'connected',
        ping: jest.fn().mockResolvedValue('PONG'),
        set: jest.fn().mockResolvedValue('OK'),
        get: jest.fn().mockImplementation((key) => {
          if (key && key.includes('__tx_health_')) {
            return Promise.resolve('tx_test');
          }
          return Promise.resolve('test-value');
        }),
        del: jest.fn().mockResolvedValue(1),
        multi: jest.fn().mockReturnValue(mockRedisTransaction)
      };
      
      mockRedisTransaction.client = clientWithConnectedStatus;

      const testTrade = {
        tradeId: '1416763593',
        exchange: 'bitbank',
        symbol: 'XLM/JPY',
        strategy: 'BB戦略'
      };

      const commandNames = ['hIncrByFloat'];

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

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('status基準で接続OK (status=connected)')
      );
    });

    test('クライアントオブジェクト自体がnullの場合の処理', async () => {
      // Issue #5701: クライアント自体がnullの場合
      mockRedisTransaction.client = null;

      const testTrade = {
        tradeId: '1416763593',
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
      ).rejects.toThrow('Redis Commit失敗: クライアントが実行可能状態ではありません');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('[Redis Transaction] 実行前接続チェック失敗: clientがnull/undefined')
      );
    });

    test('プロパティが一部だけ存在しない場合の診断情報', async () => {
      // Issue #5701: isReadyのみ存在しない場合
      const clientWithPartialProperties = {
        isOpen: true,
        status: 'ready',
        ping: jest.fn().mockResolvedValue('PONG'),
        set: jest.fn().mockResolvedValue('OK'),
        get: jest.fn().mockImplementation((key) => {
          if (key && key.includes('__tx_health_')) {
            return Promise.resolve('tx_test');
          }
          return Promise.resolve('test-value');
        }),
        del: jest.fn().mockResolvedValue(1),
        multi: jest.fn().mockReturnValue(mockRedisTransaction)
      };
      
      mockRedisTransaction.client = clientWithPartialProperties;

      const testTrade = {
        tradeId: '1416763593',
        exchange: 'bitbank',
        symbol: 'XLM/JPY',
        strategy: 'BB戦略'
      };

      const commandNames = ['hIncrByFloat'];

      const result = await databaseManager.executeRedisTransactionWithTimeout(
        mockRedisTransaction,
        commandNames,
        testTrade,
        mockLogger
      );

      expect(result).toBeDefined();

      // 診断情報に詳細なプロパティ状態が記録されることを確認
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/hasReadyProperty.*false.*hasOpenProperty.*true/)
      );
    });

    test('従来のisReady=true, isOpen=trueでの正常動作は維持される', async () => {
      // Issue #5701: 既存の正常ケースが影響を受けないことを確認
      mockRedisClient.isReady = true;
      mockRedisClient.isOpen = true;

      const testTrade = {
        tradeId: '1416763593',
        exchange: 'bitbank',
        symbol: 'XLM/JPY',
        strategy: 'BB戦略'
      };

      const commandNames = ['hIncrByFloat', 'hSet'];

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

      // プロパティ未定義の警告が出力されないことを確認
      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('プロパティ未定義またはundefined値検出')
      );
    });
  });
});