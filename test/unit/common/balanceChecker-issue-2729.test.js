/**
 * Issue #2729用テスト - Redis分散ロック解放時のLua引数型エラー修正
 * Symbol、BigInt、NaN、Infinity などの特殊な型に対する修正のテスト
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

describe('BalanceChecker Issue #2729: 特殊型に対するRedis Lua引数型エラー修正', () => {
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

  describe('releaseDistributedLock - 特殊型のlockKey拒否', () => {
    it('Symbol型のlockKeyは適切に拒否される', async () => {
      const lockKey = Symbol('test-lock-key');
      const lockId = 'normal-lock-id-123';
      
      const result = await balanceChecker.releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('BigInt型のlockKeyは適切に拒否される', async () => {
      const lockKey = BigInt(123456789);
      const lockId = 'normal-lock-id-123';
      
      const result = await balanceChecker.releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('関数型のlockKeyは適切に拒否される', async () => {
      const lockKey = () => 'test-function';
      const lockId = 'normal-lock-id-123';
      
      const result = await balanceChecker.releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('NaN型のlockKeyは適切に拒否される', async () => {
      const lockKey = NaN;
      const lockId = 'normal-lock-id-123';
      
      const result = await balanceChecker.releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('Infinity型のlockKeyは適切に拒否される', async () => {
      const lockKey = Infinity;
      const lockId = 'normal-lock-id-123';
      
      const result = await balanceChecker.releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('-Infinity型のlockKeyは適切に拒否される', async () => {
      const lockKey = -Infinity;
      const lockId = 'normal-lock-id-123';
      
      const result = await balanceChecker.releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });
  });

  describe('releaseDistributedLock - 特殊型のlockId拒否', () => {
    it('Symbol型のlockIdは適切に拒否される', async () => {
      const lockKey = 'balance_checker_lock:test';
      const lockId = Symbol('test-lock-id');
      
      const result = await balanceChecker.releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('BigInt型のlockIdは適切に拒否される', async () => {
      const lockKey = 'balance_checker_lock:test';
      const lockId = BigInt(123456789);
      
      const result = await balanceChecker.releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('関数型のlockIdは適切に拒否される', async () => {
      const lockKey = 'balance_checker_lock:test';
      const lockId = () => 'test-function';
      
      const result = await balanceChecker.releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('NaN型のlockIdは適切に拒否される', async () => {
      const lockKey = 'balance_checker_lock:test';
      const lockId = NaN;
      
      const result = await balanceChecker.releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('Infinity型のlockIdは適切に拒否される', async () => {
      const lockKey = 'balance_checker_lock:test';
      const lockId = Infinity;
      
      const result = await balanceChecker.releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('-Infinity型のlockIdは適切に拒否される', async () => {
      const lockKey = 'balance_checker_lock:test';
      const lockId = -Infinity;
      
      const result = await balanceChecker.releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });
  });

  describe('releaseDistributedLock - 文字列化後の検証', () => {
    it('カスタムtoString()メソッドを持つオブジェクトで不正な文字列になる場合は拒否される', async () => {
      const lockKey = 'balance_checker_lock:test';
      const lockId = {
        toString: () => 'Symbol(test)'
      };
      
      const result = await balanceChecker.releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('文字列化後にNaNになる値は拒否される', async () => {
      const lockKey = 'balance_checker_lock:test';
      const lockId = {
        toString: () => 'NaN'
      };
      
      const result = await balanceChecker.releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('文字列化後にInfinityになる値は拒否される', async () => {
      const lockKey = 'balance_checker_lock:test';
      const lockId = {
        toString: () => 'Infinity'
      };
      
      const result = await balanceChecker.releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('文字列化後に[object Symbol]になる値は拒否される', async () => {
      const lockKey = 'balance_checker_lock:test';
      const lockId = {
        toString: () => '[object Symbol]'
      };
      
      const result = await balanceChecker.releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('文字列化後に[object BigInt]になる値は拒否される', async () => {
      const lockKey = 'balance_checker_lock:test';
      const lockId = {
        toString: () => '[object BigInt]'
      };
      
      const result = await balanceChecker.releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });
  });

  describe('releaseDistributedLock - 正常ケース', () => {
    it('正常な文字列の場合は処理される', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      const lockKey = 'balance_checker_lock:test';
      const lockId = 'normal-lock-id-123';
      
      const result = await balanceChecker.releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        lockKey,
        lockId
      );
    });

    it('正常な数値は文字列に変換されて処理される', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      const lockKey = 'balance_checker_lock:test';
      const lockId = 12345;
      
      const result = await balanceChecker.releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        lockKey,
        '12345'
      );
    });

    it('booleanは文字列に変換されて処理される', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      const lockKey = 'balance_checker_lock:test';
      const lockId = true;
      
      const result = await balanceChecker.releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        lockKey,
        'true'
      );
    });
  });

  describe('エラーケースの包括テスト', () => {
    it('Issue #2729で発生した可能性のある全てのケースが適切に処理される', async () => {
      const problematicCases = [
        { lockKey: 'test', lockId: Symbol('symbol'), description: 'Symbol lockId' },
        { lockKey: Symbol('key'), lockId: 'test', description: 'Symbol lockKey' },
        { lockKey: 'test', lockId: BigInt(123), description: 'BigInt lockId' },
        { lockKey: BigInt(456), lockId: 'test', description: 'BigInt lockKey' },
        { lockKey: 'test', lockId: NaN, description: 'NaN lockId' },
        { lockKey: NaN, lockId: 'test', description: 'NaN lockKey' },
        { lockKey: 'test', lockId: Infinity, description: 'Infinity lockId' },
        { lockKey: Infinity, lockId: 'test', description: 'Infinity lockKey' },
        { lockKey: 'test', lockId: -Infinity, description: '-Infinity lockId' },
        { lockKey: -Infinity, lockId: 'test', description: '-Infinity lockKey' },
        { lockKey: () => 'func', lockId: 'test', description: 'Function lockKey' },
        { lockKey: 'test', lockId: () => 'func', description: 'Function lockId' }
      ];

      for (const testCase of problematicCases) {
        const result = await balanceChecker.releaseDistributedLock(testCase.lockKey, testCase.lockId);
        
        expect(result).toBe(false);
        expect(mockRedisClient.eval).not.toHaveBeenCalled();
        
        // Reset mock for next iteration
        mockRedisClient.eval.mockClear();
      }
    });
  });
});