/**
 * Issue #5722: strategy-runnerサービスでのRedis接続例外修正テスト (改善版)
 * Issue #5755: モック最小化とより実際の動作に近いテストケース
 * ready=undefined, open=undefined でのRedis接続状態チェック修正
 */

// 必要最小限のモックのみ使用
jest.mock('../../../src/database/redisDatabase', () => ({
  getClient: jest.fn()
}));

// Logger のモック - テスト用の軽量実装
jest.mock('../../../src/hft/utils/Logger', () => {
  return jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }));
});

// 定数のモック - 必要最小限
jest.mock('../../../src/common/const', () => ({
  MONITORING_SETTINGS: {
    REDIS_TRANSACTION_TIMEOUT: 45000,
    REDIS_CONNECTION_TIMEOUT: 10000
  },
  NOTIFICATION_SETTINGS: {
    RATE_LIMIT_WINDOW_MS: 30000
  },
  EXCHANGE_SETTINGS: {},
  TRADING_EXECUTION_CONSTANTS: {}
}));

// apiCoordinator のモック
jest.mock('../../../src/common/apiCoordinator', () => ({
  apiCoordinator: {}
}));

// Circuit Breaker 関連のモック - 必要最小限
jest.mock('../../../src/database/redisClient', () => ({
  isCircuitBreakerOpen: jest.fn().mockReturnValue(false),
  updateCircuitBreakerOnFailure: jest.fn(),
  updateCircuitBreakerOnSuccess: jest.fn(),
  getCircuitBreakerStatus: jest.fn().mockReturnValue({
    isOpen: false,
    timeSinceLastFailure: 0
  })
}));

describe('Issue #5722: strategy-runnerサービスでのRedis接続例外修正 (改善版)', () => {
  let mockRedisClient;
  let mockRedisTransaction;
  let mockRedisDatabase;
  let mockLogger;
  let databaseManager;

  beforeEach(() => {
    // 軽量なログ実装
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };

    // より実際のRedisクライアントに近い実装
    mockRedisClient = {
      status: 'ready',
      serverInfo: { version: '6.2.0' },
      ping: jest.fn().mockResolvedValue('PONG'),
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn().mockResolvedValue('test-value'),
      del: jest.fn().mockResolvedValue(1),
      multi: jest.fn(),
      // Issue #5722: 正常な初期状態
      isReady: true,
      isOpen: true
    };

    // より実際のRedisトランザクションに近い実装
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

    // redisDatabase のモックを更新
    require('../../../src/database/redisDatabase').getClient = mockRedisDatabase.getClient;
  });

  beforeAll(() => {
    // モジュールのrequireはここで一度だけ行う
    databaseManager = require('../../../src/database/manager');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Issue #5722 核心バグの再現と修正検証', () => {
    test('ready=undefined, open=undefined の問題状況を正確に再現', async () => {
      // デバッグ: databaseManager に含まれる関数を確認
      console.log('databaseManager keys:', Object.keys(databaseManager));
      console.log('executeRedisTransactionWithTimeout type:', typeof databaseManager.executeRedisTransactionWithTimeout);
      
      // Issue #5722: プロダクション環境で実際に発生した状態を再現
      mockRedisClient.isReady = undefined;
      mockRedisClient.isOpen = undefined;
      mockRedisClient.status = 'ready'; // statusは正常だがプロパティがundefined
      
      // undefinedプロパティの場合、PINGテストが実行される
      mockRedisClient.ping.mockRejectedValue(new Error('Connection lost'));

      const testTrade = {
        tradeId: '1416742199', // 実際のプロダクションログからのID
        exchange: 'bitbank',
        symbol: 'GALA/JPY',
        strategy: 'OSCILLATOR'
      };

      const commandNames = ['hIncrByFloat', 'hSet', 'hDel'];

      if (typeof databaseManager.executeRedisTransactionWithTimeout === 'function') {
        await expect(
          databaseManager.executeRedisTransactionWithTimeout(
            mockRedisTransaction,
            commandNames,
            testTrade,
            mockLogger
          )
        ).rejects.toThrow('Redis Commit失敗: クライアントが実行可能状態ではありません');
      } else {
        throw new Error('executeRedisTransactionWithTimeout is not a function');
      }

      // Issue #5722: 特定のログメッセージを確認
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('プロパティ未定義またはundefined値検出')
      );
      
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('PINGテストで実際の接続状態を確認')
      );
    });

    test('プロパティ未定義とプロパティundefinedの違いを正しく識別', async () => {
      // プロパティが完全に存在しない場合
      delete mockRedisClient.isReady;
      delete mockRedisClient.isOpen;
      mockRedisClient.status = 'ready';

      const testTrade = {
        tradeId: 'PROPERTY_MISSING_TEST',
        exchange: 'bitbank',
        symbol: 'BTC/JPY',
        strategy: 'TEST'
      };

      // この場合は status基準でフォールバック（成功）
      const result = await databaseManager.executeRedisTransactionWithTimeout(
        mockRedisTransaction,
        ['hSet'],
        testTrade,
        mockLogger
      );

      expect(result).toEqual([
        [null, 'OK'],
        [null, 1],
        [null, 2]
      ]);

      // status基準での成功ログを確認
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('status基準で接続OK (status=ready)')
      );
    });

    test('一方がundefined、もう一方が正常値の混在パターン', async () => {
      // 混在状態：一方は正常、一方はundefined
      mockRedisClient.isReady = true;
      mockRedisClient.isOpen = undefined;
      mockRedisClient.ping.mockRejectedValue(new Error('Mixed state error'));

      await expect(
        databaseManager.executeRedisTransactionWithTimeout(
          mockRedisTransaction,
          ['hIncrByFloat'],
          { tradeId: 'MIXED_STATE_TEST', exchange: 'test', symbol: 'ETH/JPY', strategy: 'TEST' },
          mockLogger
        )
      ).rejects.toThrow();

      // 混在状態の詳細診断ログを確認
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('プロパティ未定義またはundefined値検出')
      );
    });
  });

  describe('従来機能の回帰テスト (最小モック)', () => {
    test('正常な接続状態での基本動作', async () => {
      // 正常状態のテスト - モックは最小限
      mockRedisClient.isReady = true;
      mockRedisClient.isOpen = true;
      mockRedisClient.status = 'ready';

      const result = await databaseManager.executeRedisTransactionWithTimeout(
        mockRedisTransaction,
        ['hSet', 'hIncrByFloat', 'hDel'],
        { tradeId: 'NORMAL_TEST', exchange: 'test', symbol: 'BTC/JPY', strategy: 'TEST' },
        mockLogger
      );

      expect(result).toEqual([
        [null, 'OK'],
        [null, 1],
        [null, 2]
      ]);

      // エラーログが出力されていないことを確認
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    test('接続失敗時のエラーハンドリング', async () => {
      // 接続失敗状態
      mockRedisClient.isReady = false;
      mockRedisClient.isOpen = false;
      mockRedisClient.status = 'disconnected';

      await expect(
        databaseManager.executeRedisTransactionWithTimeout(
          mockRedisTransaction,
          ['hSet'],
          { tradeId: 'DISCONNECT_TEST', exchange: 'test', symbol: 'BTC/JPY', strategy: 'TEST' },
          mockLogger
        )
      ).rejects.toThrow('Redis Commit失敗: クライアントが実行可能状態ではありません');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('接続状態チェックエラー')
      );
    });
  });

  describe('エッジケースと例外処理 (最小モック)', () => {
    test('nullクライアントでの適切なエラー処理', async () => {
      mockRedisDatabase.getClient.mockReturnValue(null);

      await expect(
        databaseManager.executeRedisTransactionWithTimeout(
          { client: null },
          ['test'],
          { tradeId: 'NULL_CLIENT_TEST' },
          mockLogger
        )
      ).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('クライアントオブジェクトがnull/undefined')
      );
    });

    test('PINGテスト成功時のundefinedプロパティフォールバック', async () => {
      // undefinedプロパティだがPINGは成功
      mockRedisClient.isReady = undefined;
      mockRedisClient.isOpen = undefined;
      mockRedisClient.ping.mockResolvedValue('PONG');

      const result = await databaseManager.executeRedisTransactionWithTimeout(
        mockRedisTransaction,
        ['hSet'],
        { tradeId: 'PING_SUCCESS_TEST', exchange: 'test', symbol: 'BTC/JPY', strategy: 'TEST' },
        mockLogger
      );

      expect(result).toEqual([
        [null, 'OK'],
        [null, 1],
        [null, 2]
      ]);

      // PINGテスト成功ログを確認
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('PINGテスト成功 - undefinedプロパティでも接続は有効')
      );
    });
  });

  describe('パフォーマンスと実用性', () => {
    test('大量コマンドでのトランザクション処理', async () => {
      // 大量のコマンドを含むトランザクション
      const commands = Array.from({ length: 100 }, (_, i) => `command${i}`);
      const results = Array.from({ length: 100 }, (_, i) => [null, `result${i}`]);
      
      mockRedisTransaction.exec.mockResolvedValue(results);

      const result = await databaseManager.executeRedisTransactionWithTimeout(
        mockRedisTransaction,
        commands,
        { tradeId: 'LARGE_TRANSACTION_TEST', exchange: 'test', symbol: 'BTC/JPY', strategy: 'TEST' },
        mockLogger
      );

      expect(result).toHaveLength(100);
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    test('タイムアウト設定の動作確認', async () => {
      // 長時間実行のシミュレーション
      mockRedisTransaction.exec.mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve([[null, 'OK']]), 100))
      );

      const result = await databaseManager.executeRedisTransactionWithTimeout(
        mockRedisTransaction,
        ['slowCommand'],
        { tradeId: 'TIMEOUT_TEST', exchange: 'test', symbol: 'BTC/JPY', strategy: 'TEST' },
        mockLogger
      );

      expect(result).toEqual([[null, 'OK']]);
    });
  });
});