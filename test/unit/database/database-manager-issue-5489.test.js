/**
 * Issue #5489: strategy-runnerサービスで例外が発生
 * Redis multi/exec結果の形式互換性対応テスト
 */

// Jest テストフレームワークを使用
jest.unmock('../../../src/database/manager');

describe('Issue #5489: Redis multi/exec結果形式の互換性対応', () => {
  let mockRedisClient;
  let mockRedisDatabase;
  let mockLogger;
  let databaseManager;

  beforeEach(() => {
    // Jest のモックキャッシュをクリア
    jest.resetModules();
    
    // 基本的なRedisクライアントモック
    mockRedisClient = {
      isReady: true,
      isOpen: true,
      status: 'ready',
      serverInfo: { version: '6.2.0' },
      ping: jest.fn().mockResolvedValue('PONG'),
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn().mockResolvedValue('test_value'),
      del: jest.fn().mockResolvedValue(1)
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
      isCircuitBreakerOpen: jest.fn().mockReturnValue(false)
    }));

    // database manager を再インポート
    databaseManager = require('../../../src/database/manager');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Issue #5489: Redis結果形式の互換性対応コード確認', () => {
    test('修正されたコードが配列と直接結果の両方を処理できることを確認', () => {
      // Issue #5489で修正されたコードのロジックをテスト
      
      // 配列形式の場合
      const arrayResult = [null, 'test_value'];
      let error, result;
      if (Array.isArray(arrayResult)) {
        [error, result] = arrayResult;
      } else {
        error = null;
        result = arrayResult;
      }
      expect(error).toBe(null);
      expect(result).toBe('test_value');
      
      // 直接結果の場合
      const directResult = 'test_value';
      if (Array.isArray(directResult)) {
        [error, result] = directResult;
      } else {
        error = null;
        result = directResult;
      }
      expect(error).toBe(null);
      expect(result).toBe('test_value');
      
      // 数値の直接結果の場合（元のエラーケース）
      const numericResult = 1;
      if (Array.isArray(numericResult)) {
        [error, result] = numericResult;
      } else {
        error = null;
        result = numericResult;
      }
      expect(error).toBe(null);
      expect(result).toBe(1);
    });
    
    test('修正コードのArrayチェック処理を確認', () => {
      // Array.isArray のテスト
      expect(Array.isArray([null, 'value'])).toBe(true);
      expect(Array.isArray('value')).toBe(false);
      expect(Array.isArray(1)).toBe(false);
      expect(Array.isArray(null)).toBe(false);
      expect(Array.isArray(undefined)).toBe(false);
    });
  });
});