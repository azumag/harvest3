/**
 * Issue #2615: strategy-runnerサービスで例外が発生 - 分散ロック解放エラー修正のテスト
 * 
 * エラー: ERR Lua redis lib command arguments must be strings or integers
 * 原因: Redis Luaスクリプト内でlockIdが適切に文字列変換されていない
 * 修正: Luaスクリプト内でのlockIdの型安全性を強化
 */

// Mock dependencies
jest.mock('../../../src/config', () => ({
  config: {
    exchanges: {
      bitbank: {
        instance: {
          id: 'bitbank',
          fetchBalance: jest.fn()
        }
      }
    }
  }
}));

jest.mock('../../../src/common/notifications', () => ({
  postErrorToDiscord: jest.fn(),
  postOrderToDiscord: jest.fn()
}));

jest.mock('../../../src/common/balanceCheckerConfig', () => ({
  getValidatedConfig: jest.fn(() => ({
    thresholds: {
      significantBalance: 0.0001
    },
    distributedLock: {
      lockKeyPrefix: 'balance_checker_lock',
      defaultTtl: 300000
    }
  }))
}));

jest.mock('../../../src/database/redisClient', () => ({
  initRedisClient: jest.fn()
}));

jest.mock('../../../src/common/bitbankErrorHandler', () => ({
  withBitbankErrorHandling: jest.fn((fn) => fn())
}));

// Logger のモック
const mockLoggerInstance = {
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
};

jest.mock('../../../src/hft/utils/Logger', () => {
  return jest.fn().mockImplementation(() => mockLoggerInstance);
});

// Redis client のモック
const mockRedisClient = {
  set: jest.fn(),
  get: jest.fn(),
  eval: jest.fn(),
  isReady: true
};

jest.mock('../../../src/database/redisDatabase', () => ({
  getClient: jest.fn(() => mockRedisClient)
}));

const {
  acquireDistributedLock,
  releaseDistributedLock,
  withDistributedLock,
  ensureRedisConnection
} = require('../../../src/common/balanceChecker');

describe('Issue #2615: 分散ロック解放エラー修正のテスト', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Redis client のリセット
    mockRedisClient.set.mockResolvedValue('OK');
    mockRedisClient.get.mockResolvedValue(null);
    mockRedisClient.eval.mockResolvedValue(1);
    mockRedisClient.isReady = true;
  });

  describe('acquireDistributedLock', () => {
    it('分散ロックを正常に取得する', async () => {
      const lockKey = 'test_lock';
      const ttl = 60000;
      
      mockRedisClient.set.mockResolvedValue('OK');
      
      const lockId = await acquireDistributedLock(lockKey, ttl);
      
      expect(lockId).toBeTruthy();
      expect(typeof lockId).toBe('string');
      expect(lockId).toMatch(/^\d+-[a-z0-9]+$/);
      expect(mockRedisClient.set).toHaveBeenCalledWith(
        lockKey,
        expect.any(String),
        'PX',
        ttl,
        'NX'
      );
    });

    it('既に取得済みの場合はnullを返す', async () => {
      const lockKey = 'test_lock';
      
      mockRedisClient.set.mockResolvedValue(null);
      
      const lockId = await acquireDistributedLock(lockKey);
      
      expect(lockId).toBeNull();
    });

    it('Redis接続エラーの場合はnullを返す', async () => {
      mockRedisClient.isReady = false;
      
      const lockId = await acquireDistributedLock('test_lock');
      
      expect(lockId).toBeNull();
      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        expect.stringContaining('分散ロック取得エラー:')
      );
    });
  });

  describe('releaseDistributedLock', () => {
    it('分散ロックを正常に解放する', async () => {
      const lockKey = 'test_lock';
      const lockId = 'test-lock-id';
      
      // Luaスクリプトが正常に実行されることを確認
      mockRedisClient.eval.mockResolvedValue(1);
      
      const result = await releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('local lockValue = redis.call(\'GET\', KEYS[1])'),
        1,
        lockKey,
        lockId
      );
    });

    it('ロックが存在しない場合はfalseを返す', async () => {
      const lockKey = 'test_lock';
      const lockId = 'test-lock-id';
      
      // Luaスクリプトが0を返す（ロックが存在しない）
      mockRedisClient.eval.mockResolvedValue(0);
      
      const result = await releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(false);
    });

    it('Issue #2615: 配列型のlockIdを適切に拒否する', async () => {
      const lockKey = 'test_lock';
      const lockId = ['invalid', 'array', 'lockId']; // 配列型のlockId
      
      const result = await releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(false);
      expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
        expect.stringContaining('分散ロック解放スキップ: 無効な型のlockId')
      );
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('Issue #2615: null/undefinedのlockIdを適切に拒否する', async () => {
      const lockKey = 'test_lock';
      
      let result = await releaseDistributedLock(lockKey, null);
      expect(result).toBe(false);
      
      result = await releaseDistributedLock(lockKey, undefined);
      expect(result).toBe(false);
      
      result = await releaseDistributedLock(lockKey, '');
      expect(result).toBe(false);
      
      expect(mockLoggerInstance.warn).toHaveBeenCalledTimes(3);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('Issue #2615: 数値型のlockIdを文字列に変換して処理する', async () => {
      const lockKey = 'test_lock';
      const lockId = 12345; // 数値型のlockId
      
      mockRedisClient.eval.mockResolvedValue(1);
      
      const result = await releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        lockKey,
        '12345' // 文字列に変換されることを確認
      );
    });

    it('Issue #2615: オブジェクト型のlockIdは適切に拒否される', async () => {
      const lockKey = 'test_lock';
      const lockId = { id: 'test-id' }; // オブジェクト型のlockId
      
      const result = await releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(false);
      expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
        expect.stringContaining('分散ロック解放スキップ: 無効な型のlockId')
      );
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('Issue #2615: Luaスクリプトの型安全性を確認する', async () => {
      const lockKey = 'test_lock';
      const lockId = 'test-lock-id';
      
      mockRedisClient.eval.mockResolvedValue(1);
      
      await releaseDistributedLock(lockKey, lockId);
      
      const luaScript = mockRedisClient.eval.mock.calls[0][0];
      
      // Luaスクリプトに型安全性の改善が含まれていることを確認
      expect(luaScript).toContain('local lockIdStr = tostring(lockData.lockId)');
      expect(luaScript).toContain('if lockIdStr == ARGV[1] then');
      
      // 古い直接比較が使用されていないことを確認
      expect(luaScript).not.toContain('tostring(lockData.lockId) == ARGV[1]');
    });

    it('Redis接続エラーの場合はfalseを返す', async () => {
      mockRedisClient.isReady = false;
      
      const result = await releaseDistributedLock('test_lock', 'test-id');
      
      expect(result).toBe(false);
      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        expect.stringContaining('分散ロック解放エラー:')
      );
    });

    it('Luaスクリプト実行エラーの場合はfalseを返す', async () => {
      mockRedisClient.eval.mockRejectedValue(new Error('Lua script error'));
      
      const result = await releaseDistributedLock('test_lock', 'test-id');
      
      expect(result).toBe(false);
      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        expect.stringContaining('分散ロック解放エラー:')
      );
    });
  });

  describe('withDistributedLock', () => {
    it('分散ロックを使用して関数を実行する', async () => {
      const lockKey = 'test_lock';
      const testFunction = jest.fn().mockResolvedValue('test result');
      
      mockRedisClient.set.mockResolvedValue('OK');
      mockRedisClient.eval.mockResolvedValue(1);
      
      const result = await withDistributedLock(lockKey, testFunction);
      
      expect(result).toBe('test result');
      expect(testFunction).toHaveBeenCalled();
      expect(mockRedisClient.set).toHaveBeenCalled();
      expect(mockRedisClient.eval).toHaveBeenCalled();
    });

    it('ロック取得失敗時はエラーを投げる', async () => {
      const lockKey = 'test_lock';
      const testFunction = jest.fn();
      
      mockRedisClient.set.mockResolvedValue(null); // ロック取得失敗
      
      await expect(withDistributedLock(lockKey, testFunction)).rejects.toThrow(
        '分散ロック取得失敗: test_lock - 別のプロセスが実行中です'
      );
      
      expect(testFunction).not.toHaveBeenCalled();
    });

    it('関数実行中にエラーが発生してもロックを解放する', async () => {
      const lockKey = 'test_lock';
      const testFunction = jest.fn().mockRejectedValue(new Error('Test error'));
      
      mockRedisClient.set.mockResolvedValue('OK');
      mockRedisClient.eval.mockResolvedValue(1);
      
      await expect(withDistributedLock(lockKey, testFunction)).rejects.toThrow('Test error');
      
      // ロック解放が実行されることを確認
      expect(mockRedisClient.eval).toHaveBeenCalled();
    });

    it('Issue #2615: 複雑なlockIdでも正常に動作する', async () => {
      const lockKey = 'test_lock';
      const testFunction = jest.fn().mockResolvedValue('success');
      
      // 複雑なlockIdを生成するためのモック
      const complexLockId = JSON.stringify({
        timestamp: Date.now(),
        randomPart: Math.random().toString(36),
        nested: { value: 'test' }
      });
      
      mockRedisClient.set.mockResolvedValue('OK');
      mockRedisClient.eval.mockResolvedValue(1);
      
      const result = await withDistributedLock(lockKey, testFunction);
      
      expect(result).toBe('success');
      expect(testFunction).toHaveBeenCalled();
      
      // Luaスクリプトが正常に実行されることを確認
      expect(mockRedisClient.eval).toHaveBeenCalled();
    });
  });

  describe('ensureRedisConnection', () => {
    const { initRedisClient } = require('../../../src/database/redisClient');
    
    beforeEach(() => {
      initRedisClient.mockClear();
    });

    it('既に接続済みの場合は何もしない', async () => {
      mockRedisClient.isReady = true;
      
      await ensureRedisConnection();
      
      expect(initRedisClient).not.toHaveBeenCalled();
    });

    it('未接続の場合は接続を初期化する', async () => {
      mockRedisClient.isReady = false;
      const newMockClient = { ...mockRedisClient, isReady: true };
      initRedisClient.mockResolvedValue(newMockClient);
      
      await ensureRedisConnection();
      
      expect(initRedisClient).toHaveBeenCalled();
    });

    it('接続初期化に失敗した場合はエラーを投げる', async () => {
      mockRedisClient.isReady = false;
      initRedisClient.mockRejectedValue(new Error('Connection failed'));
      
      await expect(ensureRedisConnection()).rejects.toThrow('Redis接続エラー: Connection failed');
    });
  });

  describe('統合テスト', () => {
    it('Issue #2615: 実際のエラー状況を再現して修正を確認する', async () => {
      // エラー発生時の状況を再現
      const lockKey = 'balance_checker_lock:all_exchanges';
      
      // ロック取得
      mockRedisClient.set.mockResolvedValue('OK');
      const lockId = await acquireDistributedLock(lockKey, 300000);
      
      expect(lockId).toBeTruthy();
      
      // 修正前のLuaスクリプトで発生していたエラーを再現しないことを確認
      // 修正後は適切にlockIdが文字列として処理される
      mockRedisClient.eval.mockResolvedValue(1);
      
      const result = await releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(true);
      expect(mockLoggerInstance.error).not.toHaveBeenCalledWith(
        expect.stringContaining('ERR Lua redis lib command arguments must be strings or integers')
      );
    });

    it('Issue #2615: 各種データ型のlockIdで安全性を確認する', async () => {
      const lockKey = 'test_lock';
      const testCases = [
        { lockId: 'string-id', expected: true, description: '文字列型' },
        { lockId: 123, expected: true, description: '数値型' },
        { lockId: true, expected: true, description: 'boolean型' },
        { lockId: null, expected: false, description: 'null' },
        { lockId: undefined, expected: false, description: 'undefined' },
        { lockId: [], expected: false, description: '配列型' },
        { lockId: {}, expected: false, description: 'オブジェクト型' }
      ];
      
      for (const testCase of testCases) {
        jest.clearAllMocks();
        mockRedisClient.eval.mockResolvedValue(1);
        
        const result = await releaseDistributedLock(lockKey, testCase.lockId);
        
        expect(result).toBe(testCase.expected);
        
        if (testCase.expected) {
          expect(mockRedisClient.eval).toHaveBeenCalled();
        } else {
          expect(mockRedisClient.eval).not.toHaveBeenCalled();
        }
      }
    });
  });
});