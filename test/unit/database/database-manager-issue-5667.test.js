/**
 * Issue #5667: Redis接続状態チェックでundefined値の処理修正テスト
 * strategy-runnerサービスで発生したRedis接続状態チェック不整合
 * (ready=undefined, open=undefined)問題の修正をテスト
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

describe('Issue #5667: Redis接続状態チェックでのundefined値処理修正', () => {
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

    // 基本的なRedisクライアント（undefined状態を含む）
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

  describe('Redis接続状態チェックのundefined値対応', () => {
    test('isReady=undefined, isOpen=undefined でも正しく接続失敗として検出される', async () => {
      // Issue #5667: undefined状態をシミュレート
      mockRedisClient.isReady = undefined;
      mockRedisClient.isOpen = undefined;
      
      // Issue #5704対応: undefined値の場合はPINGテストを失敗させる
      mockRedisClient.ping.mockRejectedValue(new Error('Connection lost'));

      const testTrade = {
        tradeId: '1416763593',
        exchange: 'bitbank',
        symbol: 'XLM/JPY',
        strategy: 'BB戦略'
      };

      const commandNames = ['hIncrByFloat', 'hSet', 'hDel'];

      await expect(
        databaseManager.executeRedisTransactionWithTimeout(
          mockRedisTransaction,
          commandNames,
          testTrade,
          mockLogger
        )
      ).rejects.toThrow('Redis Commit失敗: クライアントが実行可能状態ではありません');

      // エラーログに適切な値が記録されることを確認
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('[Redis Transaction] 接続状態チェックエラー:')
      );
    });

    test('isReady=false, isOpen=undefined の混在状態でも正しく処理される', async () => {
      mockRedisClient.isReady = false;
      mockRedisClient.isOpen = undefined;
      
      // Issue #5704対応: undefined値の場合はPINGテストを失敗させる
      mockRedisClient.ping.mockRejectedValue(new Error('Connection lost'));

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

    test('isReady=true, isOpen=true で正常に動作する', async () => {
      mockRedisClient.isReady = true;
      mockRedisClient.isOpen = true;

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

      // 接続チェック失敗のエラーログが出力されないことを確認
      expect(mockLogger.error).not.toHaveBeenCalledWith(
        expect.stringContaining('実行前接続チェック失敗')
      );
    });

    test('exec()実行中に接続状態が変化してもundefined値が正しく処理される', async () => {
      // 初期状態は正常にしてexec()実行後で状態を変更
      mockRedisClient.isReady = true;
      mockRedisClient.isOpen = true;

      const originalExec = mockRedisTransaction.exec;
      mockRedisTransaction.exec = jest.fn().mockImplementation(async () => {
        const result = await originalExec();
        // exec()完了後に接続状態をundefinedに変更
        mockRedisClient.isReady = undefined;
        mockRedisClient.isOpen = undefined;
        // Issue #5704対応: undefined値の場合はPINGテストを失敗させる
        mockRedisClient.ping.mockRejectedValue(new Error('Connection lost'));
        return result;
      });

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
      ).rejects.toThrow('Redis Commit失敗: exec()後に接続が失われました');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('exec()後に接続状態異常を検出')
      );
    });


    test('Boolean変換により0, "", null, false も適切に処理される', async () => {
      // 様々なfalsy値をテスト
      const falsyValues = [0, "", null, false, undefined];
      
      for (const falsyValue of falsyValues) {
        jest.clearAllMocks();
        
        mockRedisClient.isReady = falsyValue;
        mockRedisClient.isOpen = true;
        
        // Issue #5704対応: undefined値の場合はPINGテストを失敗させる
        if (falsyValue === undefined) {
          mockRedisClient.ping.mockRejectedValue(new Error('Connection lost'));
        } else {
          mockRedisClient.ping.mockResolvedValue('PONG');
        }

        const testTrade = {
          tradeId: `test_${typeof falsyValue}_${falsyValue}`,
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

        // Issue #5653 修正後の新しい出力形式に対応
        const expectedMessage = falsyValue === undefined 
          ? 'ready=(undefined value)'
          : `ready=${falsyValue}`;
        
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining(`実行前接続チェック失敗: ${expectedMessage}`)
        );
      }
    });
  });
});