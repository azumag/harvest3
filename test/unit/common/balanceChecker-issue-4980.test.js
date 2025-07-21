/**
 * Issue #4980 修正のテスト
 * strategy-runnerサービスでの Redis distributed lock release error の修正を検証
 * 
 * 修正内容：
 * - Redis eval() 実行時に validatedされた finalLockKey, finalLockId を使用するよう修正
 * - 以前は stringLockKey, stringLockId が使用されていたが、検証済みの値を使用するよう統一
 */

// Mock dependencies
jest.mock('../../../src/config', () => ({
  config: {
    exchanges: {
      bitbank: {
        symbols: ['BTC/JPY', 'ETH/JPY'],
        instance: {
          id: 'bitbank',
          fetchBalance: jest.fn()
        }
      }
    }
  }
}));

jest.mock('../../../src/common/balanceCheckerConfig', () => ({
  getValidatedConfig: jest.fn(() => ({
    distributedLock: {
      lockKeyPrefix: 'balance_checker_lock',
      stateKey: 'balance_checker_state',
      defaultTtl: 300000,
      maxRetryAttempts: 3,
      retryDelay: 1000
    }
  }))
}));

jest.mock('../../../src/database/redisDatabase', () => ({
  getClient: jest.fn(),
  isConnected: jest.fn()
}));

jest.mock('../../../src/database/redisClient', () => ({
  initRedisClient: jest.fn()
}));

jest.mock('../../../src/common/notifications', () => ({
  postErrorToDiscord: jest.fn(),
  postOrderToDiscord: jest.fn()
}));

jest.mock('../../../src/common/utils', () => ({
  validateLockParameters: jest.fn()
}));

jest.mock('../../../src/hft/utils/Logger', () => {
  return jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }));
});

const mockRedisClient = {
  isReady: true,
  eval: jest.fn(),
  set: jest.fn(),
  get: jest.fn()
};

const mockRedisDatabase = require('../../../src/database/redisDatabase');
const mockUtils = require('../../../src/common/utils');
mockRedisDatabase.getClient.mockReturnValue(mockRedisClient);
mockRedisDatabase.isConnected.mockReturnValue(true);

describe('Issue #4980: Redis分散ロック解放エラー修正テスト', () => {
  let balanceChecker;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock validateLockParameters to return valid for most cases
    mockUtils.validateLockParameters.mockImplementation((lockKey, lockValue, context) => {
      if (typeof lockKey !== 'string' || typeof lockValue !== 'string' || 
          lockKey.trim() === '' || lockValue.trim() === '') {
        return { valid: false, error: 'Invalid parameters' };
      }
      
      const validCharRegex = /^[a-zA-Z0-9_:\-\.]+$/;
      
      if (!validCharRegex.test(lockKey) || !validCharRegex.test(lockValue)) {
        return { valid: false, error: 'Invalid characters' };
      }
      
      return { valid: true };
    });
    
    balanceChecker = require('../../../src/common/balanceChecker');
  });

  describe('releaseDistributedLock - Issue #4980 修正確認', () => {
    it('検証済みのfinalLockKey, finalLockIdがRedis evalに正しく渡されることを確認', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      const result = await balanceChecker.releaseDistributedLock('balance_checker_lock:test', 'valid-lock-id-123');
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'balance_checker_lock:test',
        'valid-lock-id-123'
      );
      
      // Lua スクリプトが正しく渡されていることを確認
      const luaScript = mockRedisClient.eval.mock.calls[0][0];
      expect(luaScript).toContain('local lockKey = KEYS[1]');
      expect(luaScript).toContain('local lockIdToCheck = ARGV[1]');
      expect(luaScript).toContain('redis.call(\'GET\', KEYS[1])');
    });

    it('数値引数が文字列化されて検証済みパラメータが使用されることを確認', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      const result = await balanceChecker.releaseDistributedLock(12345, 67890);
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        '12345', // 数値が文字列化された検証済みパラメータ
        '67890'  // 数値が文字列化された検証済みパラメータ
      );
    });

    it('制御文字を含む引数がサニタイズされて検証済みパラメータが使用されることを確認', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      // 制御文字を含む引数を渡す（サニタイズ後に有効になる）
      const result = await balanceChecker.releaseDistributedLock('test\x00key', 'lock\x01id');
      
      expect(result).toBe(true);
      // サニタイズされた検証済み値が渡されることを確認
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'testkey', // \x00 が除去された検証済みパラメータ
        'lockid'   // \x01 が除去された検証済みパラメータ
      );
    });

    it('検証で無効と判定された引数はRedis evalが実行されないことを確認', async () => {
      // validateLockParametersを失敗させる
      mockUtils.validateLockParameters.mockReturnValue({ 
        valid: false, 
        error: 'Invalid characters' 
      });
      
      const result = await balanceChecker.releaseDistributedLock('invalid@key', 'valid-id');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('最終検証で不正な文字が検出された場合はエラーハンドリングされる', async () => {
      // 正規表現チェックで失敗するようなケース
      const result = await balanceChecker.releaseDistributedLock('key-with-invalid-chars!', 'valid-id');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('Redis evalエラー発生時は適切にハンドリングされる', async () => {
      mockRedisClient.eval.mockRejectedValue(new Error('ERR Lua redis lib command arguments must be strings or integers'));
      
      const result = await balanceChecker.releaseDistributedLock('valid-key', 'valid-id');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'valid-key',
        'valid-id'
      );
    });
  });

  describe('releaseDistributedLock - エッジケース', () => {
    it('空文字列引数は早期リターンされる', async () => {
      const result = await balanceChecker.releaseDistributedLock('', 'valid-id');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('null/undefined引数は早期リターンされる', async () => {
      const result1 = await balanceChecker.releaseDistributedLock(null, 'valid-id');
      const result2 = await balanceChecker.releaseDistributedLock('valid-key', undefined);
      
      expect(result1).toBe(false);
      expect(result2).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('配列引数は早期リターンされる', async () => {
      const result = await balanceChecker.releaseDistributedLock(['array'], 'valid-id');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('オブジェクト引数は早期リターンされる', async () => {
      const result = await balanceChecker.releaseDistributedLock({key: 'value'}, 'valid-id');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });
  });
});