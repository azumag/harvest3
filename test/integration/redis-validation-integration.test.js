/**
 * Issue #5755: Redis接続チェック軽量統合テスト
 * 実際のRedis接続なしでvalidation機能の統合テスト
 */

const { __getValidateRedisClientConnectionForTesting } = require('../../src/database/manager');

// モック最小化：必要最小限のモックのみ
jest.mock('../../src/database/redisDatabase', () => ({
  getClient: jest.fn()
}));

jest.mock('../../src/hft/utils/Logger', () => jest.fn().mockImplementation(() => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
})));

jest.mock('../../src/common/const', () => ({
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

jest.mock('../../src/common/apiCoordinator', () => ({
  apiCoordinator: {}
}));

jest.mock('../../src/database/redisClient', () => ({
  isCircuitBreakerOpen: jest.fn().mockReturnValue(false),
  updateCircuitBreakerOnFailure: jest.fn(),
  updateCircuitBreakerOnSuccess: jest.fn(),
  getCircuitBreakerStatus: jest.fn().mockReturnValue({
    isOpen: false,
    timeSinceLastFailure: 0
  })
}));

describe('Issue #5755: Redis接続バリデーション統合テスト', () => {
  let validateRedisClientConnection;
  let mockLogger;

  beforeAll(() => {
    // 内部関数を取得
    validateRedisClientConnection = __getValidateRedisClientConnectionForTesting();
  });

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };
  });

  describe('実際のRedisクライアント互換性シミュレーション', () => {
    test('Redis v4.x互換クライアントオブジェクトでの正常動作', async () => {
      // Redis v4.x に近いクライアント構造をシミュレート
      const mockRedisClient = {
        isReady: true,
        isOpen: true,
        status: 'ready',
        serverInfo: { version: '6.2.0' },
        ping: jest.fn().mockResolvedValue('PONG'),
        constructor: { name: 'RedisClient' }
      };

      const result = await validateRedisClientConnection(mockRedisClient, '互換性テスト', mockLogger);

      expect(result).toEqual({
        clientReady: true,
        clientOpen: true
      });

      // エラーログが出力されていないことを確認
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    test('Issue #5722: プロダクションで発生したundefinedプロパティの処理', async () => {
      // 実際のプロダクション環境で発生した問題を再現
      const mockRedisClient = {
        isReady: undefined, // 実際に発生した問題
        isOpen: undefined,  // 実際に発生した問題
        status: 'ready',
        ping: jest.fn().mockResolvedValue('PONG'),
        constructor: { name: 'RedisClient' }
      };

      const result = await validateRedisClientConnection(mockRedisClient, 'undefined問題再現', mockLogger);

      expect(result).toEqual({
        clientReady: true,
        clientOpen: true
      });

      // undefinedプロパティ検出の警告ログ確認
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('プロパティ未定義またはundefined値検出')
      );

      // PINGテスト成功ログ確認
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('PINGテスト成功 - undefinedプロパティでも接続は有効')
      );
    });

    test('Issue #5722: undefinedプロパティでPINGテストも失敗する場合', async () => {
      const mockRedisClient = {
        isReady: undefined,
        isOpen: undefined,
        status: 'ready',
        ping: jest.fn().mockRejectedValue(new Error('Connection lost')),
        constructor: { name: 'RedisClient' }
      };

      // フォールバッククライアントのモック
      const mockRedisDatabase = require('../../src/database/redisDatabase');
      mockRedisDatabase.getClient.mockReturnValue(null); // フォールバックも失敗

      await expect(
        validateRedisClientConnection(mockRedisClient, 'PING失敗テスト', mockLogger)
      ).rejects.toThrow(/Redis Commit失敗/);

      // 適切なエラー処理が行われることを確認
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('PINGテスト失敗')
      );
    });

    test('プロパティが完全に存在しない場合のstatus基準フォールバック', async () => {
      const mockRedisClient = {
        // isReady, isOpenプロパティが存在しない
        status: 'ready',
        constructor: { name: 'RedisClient' }
      };

      const result = await validateRedisClientConnection(mockRedisClient, 'プロパティ未定義テスト', mockLogger);

      expect(result).toEqual({
        clientReady: true,
        clientOpen: true
      });

      // status基準での成功ログ確認
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('status基準で接続OK (status=ready)')
      );
    });

    test('混在状態（一方undefined、一方正常）の適切な処理', async () => {
      const mockRedisClient = {
        isReady: true,
        isOpen: undefined, // 混在状態
        status: 'ready',
        ping: jest.fn().mockRejectedValue(new Error('Mixed state error')),
        constructor: { name: 'RedisClient' }
      };

      const mockRedisDatabase = require('../../src/database/redisDatabase');
      mockRedisDatabase.getClient.mockReturnValue(null);

      await expect(
        validateRedisClientConnection(mockRedisClient, '混在状態テスト', mockLogger)
      ).rejects.toThrow(/Redis Commit失敗/);

      // 混在状態の診断情報が出力されることを確認
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('プロパティ未定義またはundefined値検出')
      );
    });
  });

  describe('エラーハンドリング統合テスト', () => {
    test('nullクライアントでの適切なエラー処理', async () => {
      await expect(
        validateRedisClientConnection(null, 'nullテスト', mockLogger)
      ).rejects.toThrow('Redis Commit失敗: nullテスト時にクライアントが存在しません');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('nullテスト失敗: クライアントオブジェクトがnull/undefined')
      );
    });

    test('接続失敗時の詳細ログ出力', async () => {
      const mockRedisClient = {
        isReady: false,
        isOpen: false,
        status: 'disconnected',
        constructor: { name: 'RedisClient' }
      };

      await expect(
        validateRedisClientConnection(mockRedisClient, '接続失敗テスト', mockLogger)
      ).rejects.toThrow(/Redis Commit失敗/);

      // 本番環境での詳細ログ制限のテスト
      const isProduction = process.env.NODE_ENV === 'production';
      if (isProduction) {
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining('接続失敗テスト失敗: 接続状態異常')
        );
      } else {
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('ready=false, open=false')
        );
      }
    });
  });

  describe('パフォーマンスと安定性', () => {
    test('大量の連続バリデーション処理', async () => {
      const mockRedisClient = {
        isReady: true,
        isOpen: true,
        status: 'ready',
        constructor: { name: 'RedisClient' }
      };

      // 100回連続実行
      const promises = Array.from({ length: 100 }, (_, i) =>
        validateRedisClientConnection(mockRedisClient, `連続テスト${i}`, mockLogger)
      );

      const results = await Promise.all(promises);

      // すべて成功することを確認
      results.forEach(result => {
        expect(result).toEqual({
          clientReady: true,
          clientOpen: true
        });
      });

      // エラーログが出力されていないことを確認
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    test('異なるクライアント状態での処理の一貫性', async () => {
      const testCases = [
        { isReady: true, isOpen: true, status: 'ready', shouldSuccess: true },
        { isReady: false, isOpen: false, status: 'disconnected', shouldSuccess: false },
        { isReady: undefined, isOpen: undefined, status: 'ready', ping: 'PONG', shouldSuccess: true },
        { status: 'ready', shouldSuccess: true }, // プロパティなし
      ];

      for (const testCase of testCases) {
        const mockRedisClient = {
          constructor: { name: 'RedisClient' },
          ...testCase
        };

        if (testCase.ping) {
          mockRedisClient.ping = jest.fn().mockResolvedValue(testCase.ping);
        }

        if (testCase.shouldSuccess) {
          const result = await validateRedisClientConnection(mockRedisClient, 'consistency test', mockLogger);
          expect(result.clientReady).toBe(true);
          expect(result.clientOpen).toBe(true);
        } else {
          await expect(
            validateRedisClientConnection(mockRedisClient, 'consistency test', mockLogger)
          ).rejects.toThrow(/Redis Commit失敗/);
        }

        // ログをクリア
        mockLogger.info.mockClear();
        mockLogger.warn.mockClear();
        mockLogger.error.mockClear();
      }
    });
  });
});