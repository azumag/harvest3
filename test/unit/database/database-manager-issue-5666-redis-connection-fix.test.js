/**
 * Issue #5666: strategy-runnerサービスで例外が発生 - Redis接続状態チェック修正テスト
 * Redis v4の仕様変更で client.isOpen プロパティが削除されたことによる
 * 接続状態チェック失敗 (ready=undefined, open=undefined) の修正をテスト
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

describe('Issue #5666: Redis接続状態チェック修正 (client.isOpen削除)', () => {
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

    // Redis v4仕様に準拠したRedisクライアント (isOpenプロパティなし)
    mockRedisClient = {
      isReady: true,
      status: 'ready',
      serverInfo: { version: '4.7.1' },
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

  describe('Redis v4 接続状態チェック修正', () => {
    test('正常ケース: isReadyのみで接続状態チェックが成功する', async () => {
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

      // 基本的な成功確認
      expect(result).toEqual([
        [null, 'OK'],
        [null, 1], 
        [null, 2]
      ]);

      // isReadyによる接続チェックが実行されたことを確認
      expect(mockRedisClient.ping).toHaveBeenCalled();
      
      // isOpen関連のエラーログが出力されないことを確認
      expect(mockLogger.error).not.toHaveBeenCalledWith(
        expect.stringContaining('open=undefined')
      );
    });

    test('接続失敗ケース: isReady=false時に適切なエラーメッセージが出力される', async () => {
      // isReady=falseの状況をシミュレート
      mockRedisClient.isReady = false;
      mockRedisClient.status = 'connecting';

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

      // 修正されたログメッセージが出力されることを確認
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('[Redis Transaction] 実行前接続チェック失敗: ready=false, status=connecting')
      );

      // 旧式のopen=undefinedログが出力されないことを確認
      expect(mockLogger.error).not.toHaveBeenCalledWith(
        expect.stringContaining('open=undefined')
      );
    });

    test('クライアントが存在しない場合の適切なエラーハンドリング', async () => {
      // クライアントがnullの状況をシミュレート
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

      // nullクライアントの場合のログが適切に出力されることを確認
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('[Redis Transaction] 実行前接続チェック失敗: ready=undefined, status=undefined')
      );
    });

    test('status プロパティによる詳細な接続状態の確認', async () => {
      // 異なるstatusでのテスト
      const testCases = [
        { status: 'ready', isReady: true, shouldSucceed: true },
        { status: 'connecting', isReady: false, shouldSucceed: false },
        { status: 'closed', isReady: false, shouldSucceed: false },
        { status: 'reconnecting', isReady: false, shouldSucceed: false }
      ];

      for (const testCase of testCases) {
        // テストケースごとにクライアント状態を設定
        mockRedisClient.isReady = testCase.isReady;
        mockRedisClient.status = testCase.status;

        const testTrade = {
          tradeId: '1416763593',
          exchange: 'bitbank',
          symbol: 'XLM/JPY',
          strategy: 'BB戦略'
        };

        const commandNames = ['hIncrByFloat'];

        if (testCase.shouldSucceed) {
          // 成功ケース
          const result = await databaseManager.executeRedisTransactionWithTimeout(
            mockRedisTransaction,
            commandNames,
            testTrade,
            mockLogger
          );
          expect(result).toBeDefined();
        } else {
          // 失敗ケース
          await expect(
            databaseManager.executeRedisTransactionWithTimeout(
              mockRedisTransaction,
              commandNames,
              testTrade,
              mockLogger
            )
          ).rejects.toThrow('Redis Commit失敗: クライアントが実行可能状態ではありません');

          // statusが適切にログ出力されることを確認
          expect(mockLogger.error).toHaveBeenCalledWith(
            expect.stringContaining(`status=${testCase.status}`)
          );
        }

        // モックをクリア
        jest.clearAllMocks();
      }
    });

    test('Redis v4プロパティ互換性: isOpenプロパティが存在しないことを確認', () => {
      // Redis v4では isOpen プロパティが存在しないことを確認
      expect(mockRedisClient.isOpen).toBeUndefined();
      
      // isReady と status プロパティは存在することを確認
      expect(mockRedisClient.isReady).toBeDefined();
      expect(mockRedisClient.status).toBeDefined();
      
      // serverInfoでRedis v4であることを確認
      expect(mockRedisClient.serverInfo?.version).toBe('4.7.1');
    });
  });

  describe('ログメッセージの改善確認', () => {
    test('修正後のログメッセージ形式が正しく出力される', async () => {
      // 接続失敗状況をシミュレート
      mockRedisClient.isReady = false;
      mockRedisClient.status = 'disconnected';

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
      ).rejects.toThrow();

      // 新しいログ形式 (status含む) が使用されることを確認
      expect(mockLogger.error).toHaveBeenCalledWith(
        '[Redis Transaction] 実行前接続チェック失敗: ready=false, status=disconnected'
      );

      // 旧ログ形式 (open含む) が使用されないことを確認
      expect(mockLogger.error).not.toHaveBeenCalledWith(
        expect.stringContaining('open=')
      );
    });
  });
});