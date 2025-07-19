/**
 * Issue #4090: strategy-runnerサービスでRedis接続状態不整合の修正テスト
 * Redis接続の包括的なヘルスチェックと自動回復機能のテスト
 */

// ohlcvCache をモック (node-cache依存関係を回避)
jest.mock('../../../src/database/ohlcvCache', () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  has: jest.fn(),
  keys: jest.fn().mockReturnValue([]),
  close: jest.fn()
}));

// Jest テストフレームワークを使用
jest.unmock('../../../src/database/manager');

describe('Issue #4090: Redis接続状態不整合の修正', () => {
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

    // redisClient の initRedisClient をモック
    jest.doMock('../../../src/database/redisClient', () => ({
      initRedisClient: jest.fn().mockResolvedValue(true)
    }));


    // DatabaseManagerをインポート
    const DatabaseManager = require('../../../src/database/manager');
    databaseManager = DatabaseManager;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Redis接続ヘルスチェック機能', () => {
    test('正常な接続状態で健全性チェックが成功する', async () => {
      // 正常な接続状態のモック
      mockRedisClient.isReady = true;
      mockRedisClient.isOpen = true;
      mockRedisClient.status = 'ready';
      mockRedisClient.ping.mockResolvedValue('PONG');

      // addTradeRecordを呼び出し
      const testTrade = {
        tradeId: 'test-trade-123',
        exchange: 'bitbank',
        symbol: 'LTC/JPY',
        strategy: 'MULTI_INDICATOR',
        side: 'sell',
        amount: 0.0861,
        value: 1335.41961,
        orderId: 'test-order-123'
      };

      const result = await databaseManager.addTradeRecord(testTrade);
      expect(result).toBe(true);
    });

    test('Redis接続不良時に詳細なエラー情報を記録する', async () => {
      // 接続不良状態のモック
      mockRedisClient.isReady = true;
      mockRedisClient.isOpen = true;
      mockRedisClient.status = 'connecting'; // ready以外の状態
      mockRedisClient.ping.mockRejectedValue(new Error('Connection timeout'));

      // redisTransactionのモック
      const mockRedisTransaction = {
        exec: jest.fn().mockResolvedValue([
          [new Error('Connection failed'), null],
          [null, 'OK']
        ]),
        hIncrByFloat: jest.fn(),
        hDel: jest.fn(),
        hSet: jest.fn()
      };
      mockRedisClient.multi.mockReturnValue(mockRedisTransaction);

      
      const testTrade = {
        tradeId: 'test-trade-456',
        exchange: 'bitbank',
        symbol: 'LTC/JPY',
        strategy: 'MULTI_INDICATOR',
        side: 'sell',
        amount: 0.0861,
        value: 1335.41961,
        orderId: 'test-order-456'
      };

      try {
        await databaseManager.addTradeRecord(testTrade);
      } catch (error) {
        // エラーが発生することを確認
        expect(error.message).toContain('Redis Commit失敗');
      }

      // 接続不良検出のログが記録されることを確認
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[2PC] Redis接続不良を検出')
      );
    });

    test('Redis接続回復機能が正常に動作する', async () => {
      // 接続回復のシミュレーション - 最初の健全性チェックで失敗、回復後に成功
      let callCount = 0;
      
      mockRedisDatabase.getClient = jest.fn().mockImplementation(() => {
        callCount++;
        
        if (callCount <= 2) {
          // 最初の健全性チェック時と recovery の最初の試行時は接続不良なクライアントを返す
          const badClient = {
            ...mockRedisClient,
            isReady: true,
            isOpen: true,
            status: 'connecting', // 不良状態
            ping: jest.fn().mockRejectedValue(new Error('Connection timeout')),
            multi: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue([
                [new Error('Connection failed'), null],
                [null, 'OK']
              ]),
              hIncrByFloat: jest.fn(),
              hDel: jest.fn(),
              hSet: jest.fn()
            }),
            quit: jest.fn().mockResolvedValue('OK'),
            disconnect: jest.fn().mockResolvedValue('OK')
          };
          return badClient;
        } else {
          // 3回目以降（回復後）は正常なクライアントを返す
          const goodClient = {
            ...mockRedisClient,
            isReady: true,
            isOpen: true,
            status: 'ready', // 正常状態
            ping: jest.fn().mockResolvedValue('PONG'),
            // 操作テスト用のメソッドを追加
            set: jest.fn().mockResolvedValue('OK'),
            get: jest.fn().mockImplementation((key) => {
              if (key.includes('health_check')) {
                return 'health_check_test';
              }
              return 'mocked_value';
            }),
            del: jest.fn().mockResolvedValue(1),
            multi: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue([
                [null, 'OK'],
                [null, 'OK']
              ]),
              hIncrByFloat: jest.fn(),
              hDel: jest.fn(),
              hSet: jest.fn()
            })
          };
          return goodClient;
        }
      });
      
      const testTrade = {
        tradeId: 'test-trade-789',
        exchange: 'bitbank',
        symbol: 'LTC/JPY',
        strategy: 'MULTI_INDICATOR',
        side: 'sell',
        amount: 0.0861,
        value: 1335.41961,
        orderId: 'test-order-789'
      };

      const result = await databaseManager.addTradeRecord(testTrade);
      expect(result).toBe(true);

      // 接続回復のログが記録されることを確認
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('[Redis Recovery] 接続回復成功')
      );
    });

    test('Redis接続回復が失敗した場合にエラーを発生させる', async () => {
      // 常に接続不良状態を返すモック
      mockRedisDatabase.getClient = jest.fn().mockReturnValue({
        ...mockRedisClient,
        isReady: true,
        isOpen: true,
        status: 'connecting',
        ping: jest.fn().mockRejectedValue(new Error('Connection timeout'))
      });

      
      const testTrade = {
        tradeId: 'test-trade-fail',
        exchange: 'bitbank',
        symbol: 'LTC/JPY',
        strategy: 'MULTI_INDICATOR',
        side: 'sell',
        amount: 0.0861,
        value: 1335.41961,
        orderId: 'test-order-fail'
      };

      await expect(databaseManager.addTradeRecord(testTrade)).rejects.toThrow(
        'Redis Commit失敗: 接続回復に失敗しました'
      );

      // 接続回復失敗のログが記録されることを確認
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('[Redis Recovery] 最大試行回数')
      );
    });

    test('Redis client が null の場合の処理', async () => {
      // Redis client が null の場合
      mockRedisDatabase.getClient = jest.fn().mockReturnValue(null);

      
      const testTrade = {
        tradeId: 'test-trade-null',
        exchange: 'bitbank',
        symbol: 'LTC/JPY',
        strategy: 'MULTI_INDICATOR',
        side: 'sell',
        amount: 0.0861,
        value: 1335.41961,
        orderId: 'test-order-null'
      };

      await expect(databaseManager.addTradeRecord(testTrade)).rejects.toThrow(
        'Redis Commit失敗: 接続回復に失敗しました'
      );
    });
  });

  describe('接続状態不整合の修正', () => {
    test('isReady=true、status!=ready の不整合状態を検出する', async () => {
      // 不整合状態のモック (isReady=true だが status != 'ready')
      mockRedisClient.isReady = true;
      mockRedisClient.isOpen = true;
      mockRedisClient.status = 'connecting';
      mockRedisClient.ping.mockRejectedValue(new Error('Ping failed'));

      
      const testTrade = {
        tradeId: 'test-inconsistent',
        exchange: 'bitbank',
        symbol: 'LTC/JPY',
        strategy: 'MULTI_INDICATOR',
        side: 'sell',
        amount: 0.0861,
        value: 1335.41961,
        orderId: 'test-order-inconsistent'
      };

      try {
        await databaseManager.addTradeRecord(testTrade);
      } catch (error) {
        // エラーが発生することを確認
        expect(error.message).toContain('Redis Commit失敗');
      }

      // 不整合状態の検出ログが記録されることを確認
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[2PC] Redis接続不良を検出')
      );
    });
  });
});