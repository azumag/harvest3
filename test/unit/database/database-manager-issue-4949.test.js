/**
 * Issue #4949: Redis接続状態の整合性バグ修正テスト
 * 2PC トランザクションでの "null/undefined error" 原因となった
 * 変数スコープの不整合（currentRedisClient vs redisClient）の修正テスト
 */

// Jest テストフレームワークを使用
jest.unmock('../../../src/database/manager');

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
      ping: jest.fn().mockResolvedValue('PONG'),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
      get: jest.fn().mockResolvedValue(null),
      eval: jest.fn().mockResolvedValue(1)
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

    // Logger クラスをモック
    jest.doMock('../../../src/hft/utils/Logger', () => {
      return jest.fn(() => mockLogger);
    });

    // redisDatabase をモック
    jest.doMock('../../../src/database/redisDatabase', () => mockRedisDatabase);

    // redisClient の機能をモック
    jest.doMock('../../../src/database/redisClient', () => ({
      initRedisClient: jest.fn().mockResolvedValue(true),
      getClient: jest.fn().mockReturnValue(mockCurrentRedisClient),
      checkRedisConnectionHealth: jest.fn().mockResolvedValue({
        isHealthy: true,
        connectionStatus: 'ready',
        ping: 'PONG'
      }),
      isCircuitBreakerOpen: jest.fn().mockReturnValue(false),
      getCircuitBreakerState: jest.fn().mockReturnValue({
        state: 'closed',
        failures: 0
      }),
      updateCircuitBreakerOnFailure: jest.fn(),
      updateCircuitBreakerOnSuccess: jest.fn()
    }));

    // mongoDatabase をモック
    jest.doMock('../../../src/database/mongoDatabase', () => ({
      getMongoClient: jest.fn().mockReturnValue({
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
      }),
      connectDB: jest.fn().mockResolvedValue(true),
      tradesCollection: {
        findOne: jest.fn().mockResolvedValue(null),
        updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
        insertOne: jest.fn().mockResolvedValue({ acknowledged: true })
      }
    }));

    // database manager をインポート
    databaseManager = require('../../../src/database/manager');
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
      // executeDistributedTransactionを実行（失敗することを期待）
      await databaseManager.executeDistributedTransaction(mockTrade, false);
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
      await databaseManager.executeDistributedTransaction(mockTrade, false);
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
    await expect(databaseManager.executeDistributedTransaction(mockTrade, false))
      .rejects.toThrow('Redis Commit失敗: クライアントが実行可能状態ではありません');

    // 実行前接続チェック失敗のログが出力されることを確認
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('[Redis Transaction] 実行前接続チェック失敗')
    );
  });
});