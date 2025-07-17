/**
 * Issue #2649 テスト - 分散ロック解放エラーの修正
 * Redis Lua スクリプトエラー: ERR Lua redis lib command arguments must be strings or integers
 */

// モックの設定
const mockRedisClient = {
  isReady: true,
  eval: jest.fn(),
  set: jest.fn(),
  get: jest.fn()
};

const mockGetRedisClient = jest.fn(() => mockRedisClient);
const mockInitRedisClient = jest.fn(() => Promise.resolve(mockRedisClient));
const mockValidateLockParameters = jest.fn();
const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};

// モジュールのモック
jest.mock('../src/database/redisDatabase', () => ({
  getClient: mockGetRedisClient,
  getAllPositionsRedis: jest.fn(() => Promise.resolve([]))
}));

jest.mock('../src/database/redisClient', () => ({
  initRedisClient: mockInitRedisClient
}));

jest.mock('../src/common/utils', () => ({
  validateLockParameters: mockValidateLockParameters
}));

jest.mock('../src/hft/utils/Logger', () => {
  return jest.fn().mockImplementation(() => mockLogger);
});

// その他のモック
jest.mock('../src/config', () => ({
  config: { exchanges: {} }
}));

jest.mock('../src/common/balanceCheckerConfig', () => ({
  getValidatedConfig: () => ({
    distributedLock: { defaultTtl: 30000 },
    thresholds: { significantBalance: 0.00001 }
  })
}));

jest.mock('../src/common/notifications', () => ({
  postErrorToDiscord: jest.fn(),
  postOrderToDiscord: jest.fn()
}));

const { releaseDistributedLock } = require('../src/common/balanceChecker');

describe('Issue #2649: 分散ロック解放エラーの修正', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockValidateLockParameters.mockReturnValue({ valid: true });
    mockRedisClient.eval.mockResolvedValue(1);
    // Redis接続は正常として設定
    mockGetRedisClient.mockReturnValue(mockRedisClient);
  });

  describe('null/undefined パラメータのテスト', () => {
    test('lockKey が null の場合は早期リターン', async () => {
      const result = await releaseDistributedLock(null, 'valid-lock-id');
      
      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('分散ロック解放スキップ: パラメータがnull/undefined')
      );
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    test('lockId が null の場合は早期リターン', async () => {
      const result = await releaseDistributedLock('valid-lock-key', null);
      
      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('分散ロック解放スキップ: パラメータがnull/undefined')
      );
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    test('lockKey が undefined の場合は早期リターン', async () => {
      const result = await releaseDistributedLock(undefined, 'valid-lock-id');
      
      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('分散ロック解放スキップ: パラメータがnull/undefined')
      );
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    test('lockId が undefined の場合は早期リターン', async () => {
      const result = await releaseDistributedLock('valid-lock-key', undefined);
      
      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('分散ロック解放スキップ: パラメータがnull/undefined')
      );
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });
  });

  describe('無効な型のテスト', () => {
    test('lockKey が配列の場合は早期リターン', async () => {
      const result = await releaseDistributedLock(['invalid'], 'valid-lock-id');
      
      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('分散ロック解放スキップ: 無効な型のlockKey')
      );
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    test('lockId が配列の場合は早期リターン', async () => {
      const result = await releaseDistributedLock('valid-lock-key', ['invalid']);
      
      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('分散ロック解放スキップ: 無効な型のlockId')
      );
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    test('lockKey がオブジェクトの場合は早期リターン', async () => {
      const result = await releaseDistributedLock({ invalid: true }, 'valid-lock-id');
      
      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('分散ロック解放スキップ: 無効な型のlockKey')
      );
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    test('lockId がオブジェクトの場合は早期リターン', async () => {
      const result = await releaseDistributedLock('valid-lock-key', { invalid: true });
      
      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('分散ロック解放スキップ: 無効な型のlockId')
      );
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    test('lockKey が関数の場合は早期リターン', async () => {
      const result = await releaseDistributedLock(() => {}, 'valid-lock-id');
      
      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('分散ロック解放スキップ: 無効な型のlockKey')
      );
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    test('lockId が関数の場合は早期リターン', async () => {
      const result = await releaseDistributedLock('valid-lock-key', () => {});
      
      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('分散ロック解放スキップ: 無効な型のlockId')
      );
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });
  });

  describe('文字列化後の無効値のテスト', () => {
    test('文字列化後に "null" になる場合は早期リターン', async () => {
      // String(null) は "null" になるが、これは無効な値として扱う
      const result = await releaseDistributedLock('valid-lock-key', 'null');
      
      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('分散ロック解放スキップ: 文字列化後に無効な値')
      );
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    test('文字列化後に "undefined" になる場合は早期リターン', async () => {
      // String(undefined) は "undefined" になるが、これは無効な値として扱う
      const result = await releaseDistributedLock('valid-lock-key', 'undefined');
      
      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('分散ロック解放スキップ: 文字列化後に無効な値')
      );
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    test('空文字列の場合は早期リターン', async () => {
      const result = await releaseDistributedLock('valid-lock-key', '');
      
      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('分散ロック解放スキップ: 文字列化後に無効な値')
      );
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });
  });

  describe('バリデーション失敗のテスト', () => {
    test('validateLockParameters が失敗した場合は早期リターン', async () => {
      mockValidateLockParameters.mockReturnValue({
        valid: false,
        error: 'テストエラー'
      });

      const result = await releaseDistributedLock('valid-lock-key', 'valid-lock-id');
      
      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('分散ロック解放スキップ: テストエラー')
      );
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });
  });

  describe('Redis接続エラーのテスト', () => {
    test('Redis接続が利用できない場合はエラーを投げる', async () => {
      mockGetRedisClient.mockReturnValue(null);

      const result = await releaseDistributedLock('valid-lock-key', 'valid-lock-id');
      
      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('分散ロック解放エラー: Redis接続が利用できません')
      );
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    test('Redis接続が準備できていない場合はエラーを投げる', async () => {
      mockGetRedisClient.mockReturnValue({ isReady: false });

      const result = await releaseDistributedLock('valid-lock-key', 'valid-lock-id');
      
      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('分散ロック解放エラー: Redis接続が利用できません')
      );
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });
  });

  describe('正常なロック解放のテスト', () => {
    test('有効なパラメータでロック解放が成功する', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      // Redis接続は正常として設定
      mockGetRedisClient.mockReturnValue(mockRedisClient);

      const result = await releaseDistributedLock('valid-lock-key', 'valid-lock-id');
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('local lockValue = redis.call'),
        1,
        'valid-lock-key',
        'valid-lock-id'
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('分散ロック解放成功')
      );
    });

    test('数値型パラメータが文字列に変換されて正常に処理される', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      // Redis接続は正常として設定
      mockGetRedisClient.mockReturnValue(mockRedisClient);

      const result = await releaseDistributedLock(123, 456);
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('local lockValue = redis.call'),
        1,
        '123',
        '456'
      );
    });

    test('ロックが存在しない場合は false を返す', async () => {
      mockRedisClient.eval.mockResolvedValue(0);
      // Redis接続は正常として設定
      mockGetRedisClient.mockReturnValue(mockRedisClient);

      const result = await releaseDistributedLock('valid-lock-key', 'valid-lock-id');
      
      expect(result).toBe(false);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('分散ロック解放失敗: valid-lock-key (ID: valid-lock-id) - ロックが存在しないか、IDが一致しません')
      );
    });
  });

  describe('Redisエラーのテスト', () => {
    test('Redis evalエラーが発生した場合は詳細ログを出力する', async () => {
      const redisError = new Error('Redis eval error');
      mockRedisClient.eval.mockRejectedValue(redisError);
      // Redis接続は正常として設定
      mockGetRedisClient.mockReturnValue(mockRedisClient);

      const result = await releaseDistributedLock('valid-lock-key', 'valid-lock-id');
      
      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('分散ロック解放エラー: Redis eval error')
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('分散ロック解放エラー詳細: lockKey type=string, lockId type=string')
      );
    });
  });

  describe('デバッグログのテスト', () => {
    test('デバッグログが適切に出力される', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      // Redis接続は正常として設定
      mockGetRedisClient.mockReturnValue(mockRedisClient);

      await releaseDistributedLock('test-key', 'test-id');
      
      expect(mockLogger.debug).toHaveBeenCalledWith(
        '分散ロック解放実行: key="test-key", id="test-id"'
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('分散ロック解放成功: test-key (ID: test-id)')
      );
    });
  });
});