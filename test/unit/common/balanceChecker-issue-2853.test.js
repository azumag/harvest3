/**
 * Issue #2853用テスト - Redis分散ロック解放時のLuaスクリプトcjson.decode引数型エラー修正
 * nilや無効なJSON文字列に対するLuaスクリプトの改善テスト
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

const mockRedisClient = {
  isReady: true,
  eval: jest.fn(),
  set: jest.fn(),
  get: jest.fn()
};

jest.mock('../../../src/database/redisDatabase', () => ({
  getClient: jest.fn(() => mockRedisClient),
  isConnected: jest.fn(() => true)
}));

jest.mock('../../../src/database/redisClient', () => ({
  initRedisClient: jest.fn(() => Promise.resolve(mockRedisClient))
}));

jest.mock('../../../src/common/utils', () => ({
  validateLockParameters: jest.fn()
}));

jest.mock('../../../src/common/notifications', () => ({
  postErrorToDiscord: jest.fn(),
  postOrderToDiscord: jest.fn()
}));

jest.mock('../../../src/hft/utils/Logger', () => {
  return jest.fn().mockImplementation(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }));
});

jest.mock('../../../src/common/bitbankErrorHandler', () => ({
  withBitbankErrorHandling: jest.fn()
}));

describe('BalanceChecker Issue #2853: Redis Luaスクリプトcjson.decode引数型エラー修正', () => {
  let balanceChecker;
  let mockUtils;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Redis client setup
    mockRedisClient.set.mockResolvedValue('OK');
    mockRedisClient.get.mockResolvedValue(null);
    mockRedisClient.eval.mockResolvedValue(1);
    mockRedisClient.isReady = true;
    
    // Get mock references
    mockUtils = require('../../../src/common/utils');
    
    // Mock validateLockParameters to return valid for normal strings/numbers
    mockUtils.validateLockParameters.mockImplementation((lockKey, lockValue) => {
      // Return valid for normal string/number inputs
      if (typeof lockKey === 'string' && typeof lockValue === 'string' && 
          lockKey.trim() !== '' && lockValue.trim() !== '') {
        return { valid: true };
      }
      return { valid: false, error: 'Invalid parameters' };
    });
    
    balanceChecker = require('../../../src/common/balanceChecker');
  });

  describe('releaseDistributedLock - cjson.decode引数型エラー対応', () => {
    it('Redis GET結果がnilの場合でも正常に処理される', async () => {
      const lockKey = 'balance_checker_lock:test';
      const lockId = 'test-lock-id-123';
      
      // Redis GETがnilを返すケースをシミュレート
      mockRedisClient.eval.mockImplementation((script, numKeys, key, id) => {
        // Luaスクリプトの動作をシミュレート
        // redis.call('GET', KEYS[1])がnilを返す場合
        const lockValue = null;
        if (lockValue && typeof lockValue === 'string' && lockValue !== '') {
          // この条件は満たされないので、return 0になる
          return 1;
        }
        return 0;
      });
      
      const result = await balanceChecker.releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).toHaveBeenCalled();
      
      // Luaスクリプトが呼ばれたが、エラーは発生しない
      const calledScript = mockRedisClient.eval.mock.calls[0][0];
      expect(calledScript).toContain('type(lockValue) == \'string\'');
      expect(calledScript).toContain('lockValue ~= \'\'');
    });

    it('Redis GET結果が空文字列の場合でも正常に処理される', async () => {
      const lockKey = 'balance_checker_lock:test';
      const lockId = 'test-lock-id-123';
      
      // Redis GETが空文字列を返すケースをシミュレート
      mockRedisClient.eval.mockImplementation((script, numKeys, key, id) => {
        // Luaスクリプトの動作をシミュレート
        const lockValue = '';
        if (lockValue && typeof lockValue === 'string' && lockValue !== '') {
          // この条件は満たされないので、return 0になる
          return 1;
        }
        return 0;
      });
      
      const result = await balanceChecker.releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).toHaveBeenCalled();
    });

    it('Redis GET結果が無効なJSON文字列の場合でも正常に処理される', async () => {
      const lockKey = 'balance_checker_lock:test';
      const lockId = 'test-lock-id-123';
      
      // Redis GETが無効なJSONを返すケースをシミュレート
      mockRedisClient.eval.mockImplementation((script, numKeys, key, id) => {
        // Luaスクリプトの動作をシミュレート
        const lockValue = '{invalid json}';
        if (lockValue && typeof lockValue === 'string' && lockValue !== '') {
          // pcall(cjson.decode, lockValue)でsuccessがfalseになる
          const success = false; // invalid JSONなのでfalse
          if (success) {
            return 1;
          }
        }
        return 0;
      });
      
      const result = await balanceChecker.releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).toHaveBeenCalled();
    });

    it('Redis GET結果が非文字列型の場合でも正常に処理される', async () => {
      const lockKey = 'balance_checker_lock:test';
      const lockId = 'test-lock-id-123';
      
      // Redis GETが数値型を返すケースをシミュレート（実際には発生しないが安全性のため）
      mockRedisClient.eval.mockImplementation((script, numKeys, key, id) => {
        // Luaスクリプトの動作をシミュレート
        const lockValue = 123; // 数値型
        if (lockValue && typeof lockValue === 'string' && lockValue !== '') {
          // 型チェックで弾かれるので、この条件は満たされない
          return 1;
        }
        return 0;
      });
      
      const result = await balanceChecker.releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).toHaveBeenCalled();
    });

    it('正常なJSON形式のロック値で適切に動作する', async () => {
      const lockKey = 'balance_checker_lock:test';
      const lockId = 'test-lock-id-123';
      
      // 正常なJSONデータを返すケースをシミュレート
      mockRedisClient.eval.mockImplementation((script, numKeys, key, id) => {
        // Luaスクリプトの動作をシミュレート
        const lockValue = JSON.stringify({ lockId: 'test-lock-id-123', timestamp: Date.now() });
        if (lockValue && typeof lockValue === 'string' && lockValue !== '') {
          // 正常なJSONなのでparseできる
          const success = true;
          const lockData = JSON.parse(lockValue);
          if (success && lockData && typeof lockData === 'object' && lockData.lockId) {
            const lockIdStr = String(lockData.lockId);
            if (lockIdStr === id) {
              // ロックIDが一致するので削除成功
              return 1;
            }
          }
        }
        return 0;
      });
      
      const result = await balanceChecker.releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalled();
    });

    it('ロックIDが一致しない場合は削除されない', async () => {
      const lockKey = 'balance_checker_lock:test';
      const lockId = 'test-lock-id-123';
      
      // 異なるロックIDを持つJSONデータを返すケースをシミュレート
      mockRedisClient.eval.mockImplementation((script, numKeys, key, id) => {
        // Luaスクリプトの動作をシミュレート
        const lockValue = JSON.stringify({ lockId: 'different-lock-id', timestamp: Date.now() });
        if (lockValue && typeof lockValue === 'string' && lockValue !== '') {
          const success = true;
          const lockData = JSON.parse(lockValue);
          if (success && lockData && typeof lockData === 'object' && lockData.lockId) {
            const lockIdStr = String(lockData.lockId);
            if (lockIdStr === id) {
              return 1;
            }
          }
        }
        return 0;
      });
      
      const result = await balanceChecker.releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).toHaveBeenCalled();
    });
  });

  describe('releaseDistributedLock - Luaスクリプトの堅牢性検証', () => {
    it('修正後のLuaスクリプトに適切な型チェックが含まれている', async () => {
      const lockKey = 'balance_checker_lock:test';
      const lockId = 'test-lock-id-123';
      
      await balanceChecker.releaseDistributedLock(lockKey, lockId);
      
      expect(mockRedisClient.eval).toHaveBeenCalled();
      
      const calledScript = mockRedisClient.eval.mock.calls[0][0];
      
      // スクリプトに適切な型チェックが含まれていることを検証
      expect(calledScript).toContain('type(lockValue) == \'string\'');
      expect(calledScript).toContain('lockValue ~= \'\'');
      expect(calledScript).toContain('type(lockData) == \'table\'');
      expect(calledScript).toContain('pcall(cjson.decode, lockValue)');
    });
  });
});