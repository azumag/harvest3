/**
 * Issue #4949: Redis接続状態の整合性バグ修正テスト
 * 2PC トランザクションでの "null/undefined error" 原因となった
 * 変数スコープの不整合（currentRedisClient vs redisClient）の修正テスト
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
  getMongoClient: jest.fn()
}));

jest.mock('../../../src/hft/utils/Logger', () => jest.fn());

jest.mock('../../../src/common/const', () => ({
  MONITORING_SETTINGS: {},
  NOTIFICATION_SETTINGS: {},
  EXCHANGE_SETTINGS: {},
  TRADING_EXECUTION_CONSTANTS: {}
}));

jest.mock('../../../src/database/redisClient', () => ({
  initRedisClient: jest.fn(),
  getClient: jest.fn(),
  checkRedisConnectionHealth: jest.fn(),
  isCircuitBreakerOpen: jest.fn(),
  updateCircuitBreakerOnFailure: jest.fn(),
  updateCircuitBreakerOnSuccess: jest.fn()
}));

describe('Issue #4949: Redis接続状態の整合性バグ修正', () => {
  let mockRedisClient;
  let mockCurrentRedisClient;
  let mockRedisDatabase;
  let mockLogger;
  let databaseManager;

  beforeEach(() => {
    // Jest のモックキャッシュをクリア
    jest.resetModules();
    
    // オリジナルのredisClient（接続失敗状態）
    mockRedisClient = {
      multi: jest.fn(),
      isReady: false,
      isOpen: false,
      status: 'disconnected',
      serverInfo: null,
      ping: jest.fn().mockRejectedValue(new Error('Connection failed'))
    };

    // リカバリ後のcurrentRedisClient（接続成功状態）
    mockCurrentRedisClient = {
      multi: jest.fn(),
      isReady: true,
      isOpen: true,
      status: 'ready',
      serverInfo: { version: '6.2.0' },
      ping: jest.fn().mockResolvedValue('PONG')
    };

    mockRedisDatabase = {
      getClient: jest.fn().mockReturnValue(mockCurrentRedisClient)
    };

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    };

    // Setup mock implementations
    const Logger = require('../../../src/hft/utils/Logger');
    Logger.mockImplementation(() => mockLogger);

    const redisDatabase = require('../../../src/database/redisDatabase');
    redisDatabase.getClient.mockReturnValue(mockCurrentRedisClient);

    const mongoDatabase = require('../../../src/database/mongoDatabase');
    mongoDatabase.connectDB.mockResolvedValue();
    mongoDatabase.tradesCollection.findOne.mockResolvedValue(null);
    mongoDatabase.tradesCollection.updateOne.mockResolvedValue({ acknowledged: true });
    mongoDatabase.tradesCollection.insertOne.mockResolvedValue({ acknowledged: true });
    mongoDatabase.getMongoClient.mockReturnValue({
      db: jest.fn().mockReturnValue({
        collection: jest.fn().mockReturnValue({
          findOne: jest.fn().mockResolvedValue(null),
          updateOne: jest.fn().mockResolvedValue({ acknowledged: true })
        })
      }),
      startSession: jest.fn().mockReturnValue({
        startTransaction: jest.fn(),
        commitTransaction: jest.fn().mockResolvedValue(),
        abortTransaction: jest.fn().mockResolvedValue(),
        endSession: jest.fn().mockResolvedValue()
      })
    });

    const constModule = require('../../../src/common/const');
    constModule.MONITORING_SETTINGS.REDIS_TRANSACTION_TIMEOUT = 30000;
    constModule.NOTIFICATION_SETTINGS.RATE_LIMIT_WINDOW_MS = 60000;
    constModule.EXCHANGE_SETTINGS.THROTTLE_QUEUE_MONITORING = { enabled: true, maxQueueSize: 100 };
    constModule.TRADING_EXECUTION_CONSTANTS.MAX_TRADE_VALUE = 1e15;

    const redisClient = require('../../../src/database/redisClient');
    redisClient.initRedisClient.mockResolvedValue(true);
    redisClient.getClient.mockReturnValue(mockCurrentRedisClient);
    redisClient.checkRedisConnectionHealth.mockResolvedValue({
      isHealthy: true,
      connectionStatus: 'ready',
      ping: 'PONG'
    });
    redisClient.isCircuitBreakerOpen.mockReturnValue(false);
    redisClient.updateCircuitBreakerOnFailure.mockImplementation(() => {});
    redisClient.updateCircuitBreakerOnSuccess.mockImplementation(() => {});

    // database manager をインポート
    databaseManager = require('../../../src/database/manager');
    
    // 分散ロック機能をモック（spyOnを使用してモジュール内部の関数をモック）
    jest.spyOn(databaseManager, 'acquireDistributedLock').mockResolvedValue({
      acquired: true,
      lockKey: 'test-lock-key',
      lockValue: 'test-lock-value'
    });
    
    jest.spyOn(databaseManager, 'releaseDistributedLock').mockResolvedValue(true);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('Redis接続状態ログでcurrentRedisClientを正しく使用する', async () => {
    // トランザクション失敗をシミュレート
    const mockRedisTransaction = {
      client: mockCurrentRedisClient,
      exec: jest.fn().mockResolvedValue([
        [null, 'OK'],
        [new Error('Redis command failed'), null]
      ])
    };

    mockCurrentRedisClient.multi.mockReturnValue(mockRedisTransaction);

    const mockTrade = {
      tradeId: 'test-trade-4949',
      exchange: 'bitbank',
      symbol: 'BTC/JPY',
      strategy: 'test-strategy',
      side: 'buy',
      amount: 0.001,
      value: 1000,
      price: 10000000
    };

    try {
      // execute2PCTransactionを実行（失敗することを期待）
      await databaseManager.execute2PCTransaction(mockTrade);
    } catch (error) {
      // エラーは期待される（トランザクション失敗のため）
    }

    // Issue #4949の修正を検証: エラーログがcurrentRedisClientの状態を使用している
    const errorCalls = mockLogger.error.mock.calls;
    
    // Redis接続状態のログを検索
    const connectionStateLog = errorCalls.find(call => 
      call[0] && call[0].includes('[2PC] Redis接続状態:')
    );

    expect(connectionStateLog).toBeDefined();

    // ログメッセージから接続状態情報を抽出
    const logMessage = connectionStateLog[0];
    const connectionInfoMatch = logMessage.match(/Redis接続状態: ({.*})/);
    expect(connectionInfoMatch).toBeDefined();

    const connectionInfo = JSON.parse(connectionInfoMatch[1]);

    // currentRedisClient（リカバリ後）の状態が正しくログされていることを確認
    expect(connectionInfo.clientReady).toBe(true);  // mockCurrentRedisClient.isReady
    expect(connectionInfo.clientOpen).toBe(true);   // mockCurrentRedisClient.isOpen
    expect(connectionInfo.clientConnected).toBe(true); // ready && open
    expect(connectionInfo.clientStatus).toBe('ready'); // mockCurrentRedisClient.status
    expect(connectionInfo.serverInfo).toBe('available'); // serverInfo存在
    expect(connectionInfo.clientRecovered).toBe(true); // currentRedisClient !== redisClient

    // タイムスタンプが含まれていることを確認
    expect(connectionInfo.capturedAt).toBeDefined();
    expect(new Date(connectionInfo.capturedAt)).toBeInstanceOf(Date);
  });

  test('接続リカバリが発生していない場合のclientRecoveredフラグ', async () => {
    // リカバリが発生していない状況をシミュレート（同じクライアント参照）
    const sameClient = mockCurrentRedisClient;
    
    const mockRedisTransaction = {
      client: sameClient,
      exec: jest.fn().mockResolvedValue([
        [null, 'OK'],
        [new Error('Redis command failed'), null]
      ])
    };

    sameClient.multi.mockReturnValue(mockRedisTransaction);

    const mockTrade = {
      tradeId: 'test-trade-4949-no-recovery',
      exchange: 'bitbank',
      symbol: 'BTC/JPY',
      strategy: 'test-strategy',
      side: 'buy',
      amount: 0.001,
      value: 1000,
      price: 10000000
    };

    try {
      await databaseManager.execute2PCTransaction(mockTrade);
    } catch (error) {
      // エラーは期待される
    }

    // clientRecoveredがfalseになることを確認
    const errorCalls = mockLogger.error.mock.calls;
    const connectionStateLog = errorCalls.find(call => 
      call[0] && call[0].includes('[2PC] Redis接続状態:')
    );

    expect(connectionStateLog).toBeDefined();
    
    const logMessage = connectionStateLog[0];
    const connectionInfoMatch = logMessage.match(/Redis接続状態: ({.*})/);
    const connectionInfo = JSON.parse(connectionInfoMatch[1]);

    // この場合clientRecoveredはfalseになる（同じクライアント参照のため）
    expect(connectionInfo.clientRecovered).toBe(false);
  });

  test('トランザクション実行前の接続状態チェック', async () => {
    // 接続が無効なクライアントをシミュレート
    const invalidClient = {
      isReady: false,
      isOpen: false,
      status: 'disconnected'
    };

    const mockRedisTransaction = {
      client: invalidClient
    };

    mockCurrentRedisClient.multi.mockReturnValue(mockRedisTransaction);

    const mockTrade = {
      tradeId: 'test-trade-4949-precheck',
      exchange: 'bitbank',
      symbol: 'BTC/JPY',
      strategy: 'test-strategy',
      side: 'buy',
      amount: 0.001,
      value: 1000,
      price: 10000000
    };

    // 接続前チェックでエラーが発生することを期待
    await expect(databaseManager.execute2PCTransaction(mockTrade))
      .rejects.toThrow('Redis Commit失敗: クライアントが実行可能状態ではありません');

    // 実行前接続チェック失敗のログが出力されることを確認
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('[Redis Transaction] 実行前接続チェック失敗')
    );
  });
});