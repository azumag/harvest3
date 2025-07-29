/**
 * Issue #5722: strategy-runnerサービスでのRedis接続例外修正テスト
 * ready=undefined, open=undefined でのRedis接続状態チェック修正
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

describe('Issue #5722: strategy-runnerサービスでのRedis接続例外修正', () => {
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

    // Issue #5722に対応したRedisクライアント
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
      // Issue #5722: 初期状態ではプロパティが存在して正常値を持つ
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

  describe('プロダクション環境で確認されたundefined値エラーの再現と修正', () => {
    test('ready=undefined, open=undefined で適切なエラーメッセージとともに失敗する', async () => {
      // Issue #5722: プロダクションログで確認された状態を再現
      mockRedisClient.isReady = undefined;
      mockRedisClient.isOpen = undefined;

      const testTrade = {
        tradeId: '1416742199', // プロダクションログと同じID
        exchange: 'bitbank',
        symbol: 'GALA/JPY', // プロダクションログと同じペア
        strategy: 'OSCILLATOR'
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

      // Issue #5722: エラーログにundefined値が適切に記録されることを確認
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('実行前接続チェック失敗: ready=undefined, open=undefined')
      );

      // Issue #5722: 警告ログでundefined値検出が記録されることを確認
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('プロパティ未定義またはundefined値検出')
      );
    });

    test('プロパティが存在せず、statusも不正な場合の従来の動作を保持', async () => {
      // isReadyとisOpenプロパティを完全に削除
      delete mockRedisClient.isReady;
      delete mockRedisClient.isOpen;
      // statusも不正な値に設定
      mockRedisClient.status = 'disconnected';

      const testTrade = {
        tradeId: '1416742200',
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

      // プロパティが存在しない場合のエラーメッセージを確認
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('実行前接続チェック失敗: ready=(undefined property), open=(undefined property)')
      );
    });

    test('プロパティが存在せず、statusが正常な場合の従来の動作を保持', async () => {
      // isReadyとisOpenプロパティを完全に削除
      delete mockRedisClient.isReady;
      delete mockRedisClient.isOpen;
      // statusは正常な値を保持
      mockRedisClient.status = 'ready';

      const testTrade = {
        tradeId: '1416742201',
        exchange: 'bitbank',
        symbol: 'BTC/JPY',
        strategy: 'BB戦略'
      };

      const commandNames = ['hIncrByFloat'];

      // この場合は成功するはず（従来の動作）
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

      // status基準で接続OK のログが出力されることを確認
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('status基準で接続OK (status=ready)')
      );
    });

    test('一方がundefined、もう一方が正常値の混在状態でも正しく処理される', async () => {
      // Issue #5722: 混在状態のテスト
      mockRedisClient.isReady = true;
      mockRedisClient.isOpen = undefined;

      const testTrade = {
        tradeId: '1416742202',
        exchange: 'bitbank',
        symbol: 'ETH/JPY',
        strategy: 'OSCILLATOR'
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

      // 混在状態のエラーメッセージを確認
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('実行前接続チェック失敗: ready=true, open=undefined')
      );
    });
  });
});