/**
 * Issue #5704: strategy-runnerサービスでのRedis接続例外修正テスト
 * ready=undefined, open=undefined でのRedis接続状態チェック改善版
 * PINGテスト優先アプローチとフォールバッククライアント活用
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
  isCircuitBreakerOpen: jest.fn().mockReturnValue(false),
  updateCircuitBreakerOnFailure: jest.fn(),
  updateCircuitBreakerOnSuccess: jest.fn(),
  getCircuitBreakerStatus: jest.fn().mockReturnValue({
    isOpen: false,
    timeSinceLastFailure: 0
  })
}));

describe('Issue #5704: strategy-runnerサービスでのRedis接続例外修正（改善版）', () => {
  let mockRedisClient;
  let mockFallbackClient;
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

    // Issue #5704: プロパティがundefinedでもPINGが成功するクライアント
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
      // Issue #5704: プロパティをundefinedに設定
      isReady: undefined,
      isOpen: undefined,
      constructor: { name: 'RedisClient' }
    };

    // フォールバッククライアント（正常な状態）
    mockFallbackClient = {
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
      isReady: true,
      isOpen: true
    };

    // モックトランザクション
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
    mockFallbackClient.multi.mockReturnValue(mockRedisTransaction);

    mockRedisDatabase = {
      getClient: jest.fn().mockReturnValue(mockFallbackClient)
    };

    // databaseManagerをrequire
    jest.doMock('../../../src/database/redisDatabase', () => mockRedisDatabase);
    databaseManager = require('../../../src/database/manager');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('改善されたundefined値処理', () => {
    test('ready=undefined, open=undefined でもPINGテスト成功なら処理を継続', async () => {
      // Issue #5704: プロダクションログで確認された状態を再現
      mockRedisClient.isReady = undefined;
      mockRedisClient.isOpen = undefined;
      // ただし、PINGテストは成功させる
      mockRedisClient.ping.mockResolvedValue('PONG');
      
      // redisTransactionのclientプロパティを明示的に設定
      mockRedisTransaction.client = mockRedisClient;

      const testTrade = {
        tradeId: '1416742199', // プロダクションログと同じID
        exchange: 'bitbank',
        symbol: 'GALA/JPY',
        strategy: 'OSCILLATOR',
        side: 'buy',
        amount: 100,
        value: 1000
      };

      const commandNames = ['hIncrByFloat', 'hSet', 'hDel'];

      // Issue #5704: PINGテスト成功により、処理が正常に完了するはず
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

      // PINGテストが呼ばれたことを確認
      expect(mockRedisClient.ping).toHaveBeenCalled();

      // 警告ログが出力されることを確認
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('プロパティがundefined - PINGテストで実際の接続状態を確認')
      );

      // 成功ログが出力されることを確認
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('PINGテスト成功 - undefinedプロパティでも接続は有効')
      );
    });

    test('PINGテスト失敗時にフォールバッククライアントに切り替え', async () => {
      // メインクライアントのPINGテストを失敗させる
      mockRedisClient.isReady = undefined;
      mockRedisClient.isOpen = undefined;
      mockRedisClient.ping.mockRejectedValue(new Error('Connection lost'));
      
      // redisTransactionのclientプロパティを明示的に設定
      mockRedisTransaction.client = mockRedisClient;

      // フォールバッククライアントのPINGテストは成功させる
      mockFallbackClient.ping.mockResolvedValue('PONG');

      const testTrade = {
        tradeId: '1416742200',
        exchange: 'bitbank',
        symbol: 'XLM/JPY',
        strategy: 'BB戦略',
        side: 'sell',
        amount: 50,
        value: 500
      };

      const commandNames = ['hIncrByFloat'];

      // フォールバッククライアントで処理が成功するはず
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

      // メインクライアントのPINGテストが呼ばれたことを確認
      expect(mockRedisClient.ping).toHaveBeenCalled();

      // フォールバッククライアントのPINGテストが呼ばれたことを確認
      expect(mockFallbackClient.ping).toHaveBeenCalled();

      // フォールバッククライアントの取得が呼ばれたことを確認
      expect(mockRedisDatabase.getClient).toHaveBeenCalled();

      // 適切なログが出力されることを確認
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('PINGテスト失敗')
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('フォールバッククライアントに切り替え')
      );
    });

    test('メインクライアントとフォールバッククライアント両方でPINGテスト失敗時はエラー', async () => {
      // 両方のクライアントでPINGテストを失敗させる
      mockRedisClient.isReady = undefined;
      mockRedisClient.isOpen = undefined;
      mockRedisClient.ping.mockRejectedValue(new Error('Main client connection lost'));
      
      // redisTransactionのclientプロパティを明示的に設定
      mockRedisTransaction.client = mockRedisClient;

      mockFallbackClient.ping.mockRejectedValue(new Error('Fallback client connection lost'));

      const testTrade = {
        tradeId: '1416742201',
        exchange: 'bitbank',
        symbol: 'BTC/JPY',
        strategy: 'BB戦略',
        side: 'buy',
        amount: 0.01,
        value: 100
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

      // 両方のPINGテストが呼ばれたことを確認
      expect(mockRedisClient.ping).toHaveBeenCalled();
      expect(mockFallbackClient.ping).toHaveBeenCalled();

      // エラーログが適切に出力されることを確認
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('接続状態チェックエラー:')
      );
    });

    test('フォールバッククライアントが取得できない場合のエラーハンドリング', async () => {
      // メインクライアントのPINGテストを失敗させる
      mockRedisClient.isReady = undefined;
      mockRedisClient.isOpen = undefined;
      mockRedisClient.ping.mockRejectedValue(new Error('Connection lost'));
      
      // redisTransactionのclientプロパティを明示的に設定
      mockRedisTransaction.client = mockRedisClient;

      // フォールバッククライアントが取得できない状態にする
      mockRedisDatabase.getClient.mockReturnValue(null);

      const testTrade = {
        tradeId: '1416742202',
        exchange: 'bitbank',
        symbol: 'ETH/JPY',
        strategy: 'OSCILLATOR',
        side: 'buy',
        amount: 1,
        value: 100
      };

      const commandNames = ['hSet'];

      await expect(
        databaseManager.executeRedisTransactionWithTimeout(
          mockRedisTransaction,
          commandNames,
          testTrade,
          mockLogger
        )
      ).rejects.toThrow('Redis Commit失敗: クライアントが実行可能状態ではありません');

      // メインクライアントのPINGテストが呼ばれたことを確認
      expect(mockRedisClient.ping).toHaveBeenCalled();

      // フォールバッククライアントの取得が試行されたことを確認
      expect(mockRedisDatabase.getClient).toHaveBeenCalled();

      // 適切なログが出力されることを確認
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('PINGテスト失敗')
      );
    });
  });
});