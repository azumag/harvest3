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
    test('isReady=undefined, isOpen=undefined でもstatus=readyの場合は正常に実行される', async () => {
      // Issue #5667: undefined状態をシミュレート（status=readyでフォールバック成功）
      mockRedisClient.isReady = undefined;
      mockRedisClient.isOpen = undefined;
      mockRedisClient.status = 'ready'; // フォールバック用

      const testTrade = {
        tradeId: '1416763593',
        exchange: 'bitbank',
        symbol: 'XLM/JPY',
        strategy: 'BB戦略'
      };

      const commandNames = ['hIncrByFloat', 'hSet', 'hDel'];

      // 成功することを期待（status基準でフォールバック）
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

      // 警告ログとinfoログが出力されることを確認
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('プロパティ未定義検出')
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('status基準で接続OK (status=ready)')
      );
    });

    test('isReady=false, isOpen=undefined でもstatus=readyの場合はフォールバック成功', async () => {
      mockRedisClient.isReady = false;
      mockRedisClient.isOpen = undefined;
      mockRedisClient.status = 'ready'; // フォールバック用

      const testTrade = {
        tradeId: '1416763593',
        exchange: 'bitbank',
        symbol: 'XLM/JPY',
        strategy: 'BB戦略'
      };

      const commandNames = ['hIncrByFloat'];

      // status基準で成功することを期待
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

      // フォールバック処理のログが出力されることを確認
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('プロパティ未定義検出')
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('status基準で接続OK (status=ready)')
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

    test('exec()実行中に接続状態が変化してもstatus基準でフォールバック成功', async () => {
      // 初期状態は正常にしてexec()実行後で状態を変更
      mockRedisClient.isReady = true;
      mockRedisClient.isOpen = true;

      const originalExec = mockRedisTransaction.exec;
      mockRedisTransaction.exec = jest.fn().mockImplementation(async () => {
        const result = await originalExec();
        // exec()完了後に接続状態をundefinedに変更
        mockRedisClient.isReady = undefined;
        mockRedisClient.isOpen = undefined;
        mockRedisClient.status = 'ready'; // フォールバック用
        return result;
      });

      const testTrade = {
        tradeId: '1416763593',
        exchange: 'bitbank',
        symbol: 'XLM/JPY',
        strategy: 'BB戦略'
      };

      const commandNames = ['hIncrByFloat'];

      // status基準でフォールバック成功することを期待
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

      // exec()後の接続チェックでフォールバック処理のログが出力されることを確認
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('プロパティ未定義検出')
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('status基準で接続OK (status=ready)')
      );
    });


    test('Boolean変換により0, "", null, false も適切に処理される（status=disconnectedで失敗）', async () => {
      // 様々なfalsy値をテストし、status=disconnectedで失敗させる
      const falsyValues = [0, "", null, false, undefined];
      
      for (const falsyValue of falsyValues) {
        jest.clearAllMocks();
        
        mockRedisClient.isReady = falsyValue;
        mockRedisClient.isOpen = true;
        mockRedisClient.status = 'disconnected'; // フォールバックも失敗させる

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

        // エラーが正しく投げられることを確認（ログは内部関数で処理される）
      }
    });
  });
});