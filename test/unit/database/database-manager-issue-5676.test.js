/**
 * Issue #5676: Redis Multi transaction clientの接続状態チェック対応テスト
 * strategy-runnerサービスで発生したRedis接続エラー
 * (ready=undefined, open=undefined)のtransaction client対応修正をテスト
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

describe('Issue #5676: Redis Multi transaction client接続状態チェック対応', () => {
  let mockMainRedisClient;
  let mockTransactionClient;
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

    // メインRedisクライアント（正常な状態）
    mockMainRedisClient = {
      isReady: true,
      isOpen: true,
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

    // Issue #5676: Multi transaction clientをシミュレート（問題のあるclient）
    mockTransactionClient = {
      // Redis Multi transaction clientの場合、isReadyとisOpenがundefinedになる場合がある
      isReady: undefined,
      isOpen: undefined,
      status: 'ready',
      // transaction特有のプロパティ
      _queue: [],
      _client: mockMainRedisClient
    };

    // モックトランザクション
    mockRedisTransaction = {
      client: mockTransactionClient, // 問題のあるtransaction client
      exec: jest.fn().mockResolvedValue([
        [null, 'OK'],
        [null, 1],
        [null, 2]
      ])
    };

    mockMainRedisClient.multi.mockReturnValue(mockRedisTransaction);

    mockRedisDatabase = {
      getClient: jest.fn().mockReturnValue(mockMainRedisClient)
    };

    // databaseManagerをrequire
    jest.doMock('../../../src/database/redisDatabase', () => mockRedisDatabase);
    databaseManager = require('../../../src/database/manager');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Redis Multi transaction clientのフォールバック機能', () => {
    test('transaction clientのisReady/isOpenがundefinedの場合、main clientにフォールバックする', async () => {
      // Issue #5676: transaction clientのプロパティがundefined
      expect(mockTransactionClient.isReady).toBeUndefined();
      expect(mockTransactionClient.isOpen).toBeUndefined();
      
      // メインクライアントは正常
      expect(mockMainRedisClient.isReady).toBe(true);
      expect(mockMainRedisClient.isOpen).toBe(true);

      const testTrade = {
        tradeId: '1416627210',
        exchange: 'bitbank',
        symbol: 'XLM/JPY',
        strategy: 'BB戦略'
      };

      const commandNames = ['hIncrByFloat', 'hSet', 'hDel'];

      // フォールバック機能により正常に実行される
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

      // フォールバックのデバッグログが出力されることを確認
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('transaction clientからmain clientにフォールバック')
      );

      // 接続チェック失敗のエラーログが出力されないことを確認
      expect(mockLogger.error).not.toHaveBeenCalledWith(
        expect.stringContaining('実行前接続チェック失敗')
      );
    });

    test('transaction clientとmain client両方が異常な場合、適切にエラーになる', async () => {
      // transaction clientは問題のある状態（undefined）
      mockTransactionClient.isReady = undefined;
      mockTransactionClient.isOpen = undefined;
      
      // main clientも異常な状態
      mockMainRedisClient.isReady = false;
      mockMainRedisClient.isOpen = false;

      const testTrade = {
        tradeId: '1416627210',
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

      // フォールバックが試行されることを確認
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('transaction clientからmain clientにフォールバック')
      );

      // 最終的にエラーログが出力されることを確認
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('実行前接続チェック失敗: ready=false, open=false')
      );
    });

    test('main clientの取得に失敗した場合、transaction clientのままエラー処理する', async () => {
      // transaction clientは問題のある状態
      mockTransactionClient.isReady = undefined;
      mockTransactionClient.isOpen = undefined;

      // main clientの取得が失敗するようにモック
      mockRedisDatabase.getClient.mockImplementation(() => {
        throw new Error('Redis database module error');
      });

      const testTrade = {
        tradeId: '1416627210',
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

      // フォールバック失敗の警告ログが出力されることを確認
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('main clientフォールバック失敗')
      );

      // 元のtransaction clientでのエラーログが出力されることを確認
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('実行前接続チェック失敗: ready=undefined, open=undefined')
      );
    });

    test('transaction clientが正常な場合、フォールバックは実行されない', async () => {
      // transaction clientを正常な状態に設定
      mockTransactionClient.isReady = true;
      mockTransactionClient.isOpen = true;

      const testTrade = {
        tradeId: '1416627210',
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

      // フォールバックのデバッグログが出力されないことを確認
      expect(mockLogger.debug).not.toHaveBeenCalledWith(
        expect.stringContaining('transaction clientからmain clientにフォールバック')
      );

      // エラーログが出力されないことを確認
      expect(mockLogger.error).not.toHaveBeenCalledWith(
        expect.stringContaining('実行前接続チェック失敗')
      );
    });

    test('exec()直前チェックでもフォールバック機能が動作する', async () => {
      // 初期チェックは通るがexec()直前で問題が発生するシナリオ
      mockTransactionClient.isReady = true;
      mockTransactionClient.isOpen = true;

      const originalExec = mockRedisTransaction.exec;
      mockRedisTransaction.exec = jest.fn().mockImplementation(async () => {
        // exec()実行直前にtransaction clientの状態がundefinedになる
        mockTransactionClient.isReady = undefined;
        mockTransactionClient.isOpen = undefined;
        
        // 実際のexec()を遅延実行
        await new Promise(resolve => setImmediate(resolve));
        return await originalExec();
      });

      const testTrade = {
        tradeId: '1416627210',
        exchange: 'bitbank',
        symbol: 'XLM/JPY',
        strategy: 'BB戦略'
      };

      const commandNames = ['hIncrByFloat'];

      // フォールバック機能により正常に実行される
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

      // exec()直前チェックでフォールバックが実行されることを確認
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('transaction clientからmain clientにフォールバック')
      );
    });
  });

  describe('本番環境とテスト環境の動作差異', () => {    
    test('本番環境では詳細な接続情報が制限される', async () => {
      // 本番環境をシミュレート
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      try {
        // transaction clientとmain client両方が異常
        mockTransactionClient.isReady = undefined;
        mockTransactionClient.isOpen = undefined;
        mockMainRedisClient.isReady = false;
        mockMainRedisClient.isOpen = false;

        const testTrade = {
          tradeId: '1416627210',
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

        // 本番環境では warn レベルで詳細情報を制限したログが出力される
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining('実行前接続チェック失敗: 接続状態異常')
        );

        // 詳細な接続情報（ready=false, open=false）は含まれない
        expect(mockLogger.warn).not.toHaveBeenCalledWith(
          expect.stringContaining('ready=false, open=false')
        );

      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });

    test('テスト環境では詳細な接続情報が出力される', async () => {
      // テスト環境を明示的に設定
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';

      try {
        // transaction clientとmain client両方が異常
        mockTransactionClient.isReady = undefined;
        mockTransactionClient.isOpen = undefined;
        mockMainRedisClient.isReady = false;
        mockMainRedisClient.isOpen = false;

        const testTrade = {
          tradeId: '1416627210',
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

        // テスト環境では error レベルで詳細な接続情報が出力される
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('実行前接続チェック失敗: ready=false, open=false')
        );

      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });
  });
});