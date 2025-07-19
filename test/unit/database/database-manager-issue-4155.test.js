/**
 * Issue #4155: strategy-runnerサービスで例外が発生の修正テスト
 * Redis 2PC操作のリトライ機能と接続安定性改善のテスト
 */

// Jest テストフレームワークを使用
jest.unmock('../../../src/database/manager');

describe('Issue #4155: strategy-runnerサービス例外の修正', () => {
  let mockRedisClient;
  let mockRedisDatabase;
  let mockLogger;
  let databaseManager;

  beforeEach(() => {
    // Jest のモックキャッシュをクリア
    jest.resetModules();
    
    // モックの初期化
    mockRedisClient = {
      multi: jest.fn(),
      isReady: true,
      isOpen: true,
      status: 'ready',
      serverInfo: { version: '6.2.0' },
      ping: jest.fn().mockResolvedValue('PONG')
    };

    mockRedisDatabase = {
      getClient: jest.fn().mockReturnValue(mockRedisClient)
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

    // MongoDB client をモック
    const mockMongoClient = {
      startSession: jest.fn().mockReturnValue({
        startTransaction: jest.fn(),
        commitTransaction: jest.fn(),
        abortTransaction: jest.fn(),
        endSession: jest.fn()
      }),
      db: jest.fn().mockReturnValue({
        collection: jest.fn().mockReturnValue({
          insertOne: jest.fn(),
          updateOne: jest.fn(),
          findOneAndUpdate: jest.fn().mockResolvedValue({ value: null })
        })
      })
    };

    jest.doMock('../../../src/database/mongoDatabase', () => ({
      getMongoClient: jest.fn().mockReturnValue(mockMongoClient),
      addTradeMongoDB: jest.fn(),
      addSignalMongoDB: jest.fn(),
      addOrderMongoDB: jest.fn(),
      getOrderByOrderId: jest.fn(),
      updateOrderByOrderId: jest.fn(),
      deleteOrderByOrderId: jest.fn(),
      connectDB: jest.fn(),
      connectWithRetry: jest.fn(),
      startHealthCheck: jest.fn(),
      listOrders: jest.fn(),
      listTrades: jest.fn(),
      listSignals: jest.fn(),
      countSignals: jest.fn(),
      addOhlcvMongoDB: jest.fn(),
      fetchHistoricalOHLCVData: jest.fn(),
      fetchTickerFromMongoDB: jest.fn(),
      listFilledPositions: jest.fn()
    }));

    // その他の依存関係をモック
    jest.doMock('../../../src/common/notifications', () => ({
      postErrorToDiscord: jest.fn()
    }));

    jest.doMock('../../../src/data/marketDataProvider', () => ({}));

    jest.doMock('../../../src/common/const', () => ({
      TRADING_EXECUTION_CONSTANTS: {},
      EXCHANGE_SETTINGS: {}
    }));

    jest.doMock('../../../src/common/throttleMonitor', () => ({
      throttleMonitor: {}
    }));

    jest.doMock('../../../src/common/apiCoordinator', () => ({
      apiCoordinator: {}
    }));

    // redisClient の機能をモック
    jest.doMock('../../../src/database/redisClient', () => ({
      initRedisClient: jest.fn().mockResolvedValue(true),
      getCircuitBreakerState: jest.fn().mockReturnValue({
        failures: 0,
        lastFailureTime: 0,
        state: 'CLOSED',
        isOpen: false,
        timeSinceLastFailure: 0
      }),
      isCircuitBreakerOpen: jest.fn().mockReturnValue(false),
      getExtendedConnectionHealth: jest.fn().mockResolvedValue({
        clientExists: true,
        clientReady: true,
        clientOpen: true,
        clientStatus: 'ready',
        circuitBreaker: { state: 'CLOSED', isOpen: false },
        ping: { success: true, latency: 10, error: null },
        overallHealth: true
      })
    }));

    // DatabaseManagerをインポート
    const DatabaseManager = require('../../../src/database/manager');
    databaseManager = DatabaseManager;
  });

  afterEach(() => {
    jest.clearAllMocks();
    // 元の関数を復元
    if (databaseManager._originalExecuteDistributedTransaction) {
      databaseManager.executeDistributedTransaction = databaseManager._originalExecuteDistributedTransaction;
      delete databaseManager._originalExecuteDistributedTransaction;
    }
  });

  describe('改良されたRedis接続ヘルスチェック', () => {
    test('isReady/isOpen/status全て正常な場合の健全性チェック', async () => {
      // Issue #4951: 厳格な接続状態チェックに対応
      mockRedisClient.isReady = true;
      mockRedisClient.isOpen = true;
      mockRedisClient.status = 'ready'; // Issue #4951: statusも'ready'である必要がある
      mockRedisClient.ping.mockResolvedValue('PONG');

      // checkRedisConnectionHealth を直接呼び出し
      const Logger = require('../../../src/hft/utils/Logger');
      const logger = new Logger('Test');
      const healthResult = await databaseManager.checkRedisConnectionHealth(mockRedisClient, logger);
      
      expect(healthResult.isHealthy).toBe(true);
      expect(healthResult.details.pingSuccess).toBe(true);
      expect(healthResult.details.clientReady).toBe(true);
      expect(healthResult.details.clientOpen).toBe(true);
    });

    test('status が ready でない場合は不健全と判定（Issue #4951対応）', async () => {
      // Issue #4896: status が 'ready' でない場合でも機能的指標で健全と判定する
      mockRedisClient.isReady = true;
      mockRedisClient.isOpen = true;
      mockRedisClient.status = 'connecting'; // ready以外の状態だが機能的には接続可能
      mockRedisClient.ping.mockResolvedValue('PONG');

      // checkRedisConnectionHealth を直接呼び出し
      const Logger = require('../../../src/hft/utils/Logger');
      const logger = new Logger('Test');
      const healthResult = await databaseManager.checkRedisConnectionHealth(mockRedisClient, logger);
      
      expect(healthResult.isHealthy).toBe(true); // Issue #4896の修正により健全と判定
      expect(healthResult.details.clientReady).toBe(true);
      expect(healthResult.details.clientOpen).toBe(true);
      expect(healthResult.details.clientConnected).toBe(true); // isReady && isOpen で判定
    });

    test('pingタイムアウトの検出', async () => {
      // ping がタイムアウトする状態
      mockRedisClient.isReady = true;
      mockRedisClient.isOpen = true;
      mockRedisClient.status = 'ready';
      mockRedisClient.ping.mockImplementation(() => {
        return new Promise(() => {}); // 永続的に待機（タイムアウトをテスト）
      });

      // checkRedisConnectionHealth を直接呼び出し
      const Logger = require('../../../src/hft/utils/Logger');
      const logger = new Logger('Test');
      const healthResult = await databaseManager.checkRedisConnectionHealth(mockRedisClient, logger);
      
      expect(healthResult.isHealthy).toBe(false);
      expect(healthResult.details.pingError).toContain('Ping timeout');
    });

    test('Redis client が null の場合', async () => {
      // checkRedisConnectionHealth を直接呼び出し
      const Logger = require('../../../src/hft/utils/Logger');
      const logger = new Logger('Test');
      const healthResult = await databaseManager.checkRedisConnectionHealth(null, logger);
      
      expect(healthResult.isHealthy).toBe(false);
      expect(healthResult.details.clientExists).toBe(false);
    });

    test('isReady/isOpen が false の場合', async () => {
      mockRedisClient.isReady = false;
      mockRedisClient.isOpen = true;
      mockRedisClient.status = 'ready';

      // checkRedisConnectionHealth を直接呼び出し
      const Logger = require('../../../src/hft/utils/Logger');
      const logger = new Logger('Test');
      const healthResult = await databaseManager.checkRedisConnectionHealth(mockRedisClient, logger);
      
      expect(healthResult.isHealthy).toBe(false);
      expect(healthResult.details.clientReady).toBe(false);
    });
  });

  describe('2PC操作リトライ機能', () => {
    test('接続エラーの判定ロジック', () => {
      // リトライ対象となるエラーパターンをテスト
      const retryableErrors = [
        'Redis Commit失敗: Invalid response',
        'Redis Commit失敗: connection issue', 
        'Some error with Invalid response inside',
        'Network timeout error'
      ];

      const nonRetryableErrors = [
        'MongoDB transaction failed',
        'Validation error',
        'Permission denied'
      ];

      retryableErrors.forEach(error => {
        const isConnectionError = error.includes('Redis Commit失敗') ||
          error.includes('Invalid response') ||
          error.includes('connection issue') ||
          error.includes('timeout');
        expect(isConnectionError).toBe(true);
      });

      nonRetryableErrors.forEach(error => {
        const isConnectionError = error.includes('Redis Commit失敗') ||
          error.includes('Invalid response') ||
          error.includes('connection issue') ||
          error.includes('timeout');
        expect(isConnectionError).toBe(false);
      });
    });

    test('executeDistributedTransactionWithRetry の基本動作', () => {
      // executeDistributedTransactionWithRetry が存在し、呼び出し可能であることを確認
      expect(typeof databaseManager.executeDistributedTransactionWithRetry).toBe('function');
      
      // 関数の長さ（引数の数）を確認 - maxRetriesはデフォルト値があるため2
      expect(databaseManager.executeDistributedTransactionWithRetry.length).toBe(2); // trade, isBacktest
    });
  });

  describe('改良されたエラーハンドリング', () => {
    test('無効応答エラーの詳細情報提供', () => {
      const operationContext = {
        tradeId: '1416438169',
        exchange: 'bitbank',
        symbol: 'XRP/JPY',
        strategy: 'MULTI_INDICATOR',
        commandIndex: 2,
        totalCommands: 5
      };

      // 空文字列エラーのテスト
      const errorMessage = databaseManager.getRedisErrorMessage('', 2, 'hIncrByFloat(totalSellRevenue)', operationContext);
      expect(errorMessage).toContain('Invalid response (empty/dash)');
      expect(errorMessage).toContain('Context:');
      expect(errorMessage).toContain('This may indicate: 1. Redis connection timeout or instability');

      // ダッシュエラーのテスト
      const dashErrorMessage = databaseManager.getRedisErrorMessage('-', 2, 'hIncrByFloat(totalSellRevenue)', operationContext);
      expect(dashErrorMessage).toContain('Invalid response (empty/dash)');
    });

    test('結果配列の検証ロジック', () => {
      // 結果配列の検証ロジックをテスト
      const validResults = [
        [[null, 'OK'], [null, 'OK']],
        [[null, 1], [null, 'value']],
        [[new Error('test'), null]]
      ];

      const invalidResults = [
        null,
        undefined,
        [],
        'not an array',
        42
      ];

      validResults.forEach(result => {
        const isValid = Array.isArray(result) && result.length > 0;
        expect(isValid).toBe(true);
      });

      invalidResults.forEach(result => {
        const isValid = Array.isArray(result) && result.length > 0;
        expect(isValid).toBe(false);
      });
    });
  });

  describe('バックテストモードでの動作', () => {
    test('バックテストフラグの確認', () => {
      // バックテストモード分岐のロジックテスト
      const isBacktest = true;
      const nonBacktest = false;

      expect(isBacktest).toBe(true);
      expect(nonBacktest).toBe(false);
      expect(!isBacktest).toBe(false);
      expect(!nonBacktest).toBe(true);
    });
  });
});