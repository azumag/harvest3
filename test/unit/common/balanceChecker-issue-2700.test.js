/**
 * @fileoverview Issue #2700 の修正のテスト
 * 分散ロック解放エラー: Redis Lua script引数の型チェック強化
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
    },
    thresholds: {
      significantBalance: 0.00001,
      balanceComparisonTolerance: 2.0,
      externalTradeThreshold: 50.0,
      veryHighExternalTradeThreshold: 90.0,
      highDiscrepancyPercent: 20.0,
      currencySpecificTolerance: {}
    },
    intervals: {
      exchangeCheckDelay: 1000
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
  isConnected: jest.fn(),
  getAllPositionsRedis: jest.fn()
}));

jest.mock('../../../src/database/redisClient', () => ({
  initRedisClient: jest.fn(() => Promise.resolve(mockRedisClient))
}));

jest.mock('../../../src/common/notifications', () => ({
  postErrorToDiscord: jest.fn(),
  postOrderToDiscord: jest.fn()
}));

jest.mock('../../../src/hft/utils/Logger', () => {
  return jest.fn().mockImplementation(() => ({
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    info: jest.fn()
  }));
});

jest.mock('../../../src/common/bitbankErrorHandler', () => ({
  withBitbankErrorHandling: jest.fn()
}));

jest.mock('../../../src/common/utils', () => ({
  validateLockParameters: jest.fn(() => ({ valid: true }))
}));

describe('BalanceChecker - Issue #2700: Redis Lua script引数の型チェック強化', function() {
  let balanceChecker;

  beforeEach(function() {
    // Clear all mocks
    jest.clearAllMocks();
    
    // Reset mock return values
    mockRedisClient.eval.mockResolvedValue(1);
    mockRedisClient.isReady = true;
    
    // Mock validateLockParameters to return valid for normal strings/numbers
    const mockUtils = require('../../../src/common/utils');
    mockUtils.validateLockParameters.mockImplementation((lockKey, lockValue, context) => {
      // Return valid for normal string/number inputs
      if (typeof lockKey === 'string' && typeof lockValue === 'string' && 
          lockKey.trim() !== '' && lockValue.trim() !== '') {
        return { valid: true };
      }
      return { valid: false, error: 'Invalid parameters' };
    });
    
    // Import balanceChecker after mocks are set
    balanceChecker = require('../../../src/common/balanceChecker');
  });

  afterEach(function() {
    jest.clearAllMocks();
  });

  describe('releaseDistributedLock - 引数の型チェック強化', function() {
    
    it('正常なlockKeyとlockIdでロック解放が成功する', async function() {
      // 正常なケース
      const lockKey = 'balance_checker:all_exchanges';
      const lockId = '1642123456789-abc123def';
      
      const result = await balanceChecker.releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledTimes(1);
      
      // Verify the arguments passed to eval
      const evalCall = mockRedisClient.eval.mock.calls[0];
      expect(evalCall[1]).toBe(1); // numkeys
      expect(evalCall[2]).toBe(lockKey); // KEYS[1]
      expect(evalCall[3]).toBe(lockId); // ARGV[1]
    });

    it('無効なlockKey（オブジェクト）でスキップされる', async function() {
      // lockKey が オブジェクトの場合
      const lockKey = { key: 'test' }; // String(lockKey) = '[object Object]'
      const lockId = '1642123456789-abc123def';
      
      const result = await balanceChecker.releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('無効なlockKey（配列）でスキップされる', async function() {
      // lockKey が 配列の場合
      const lockKey = ['test1', 'test2']; // String(lockKey) = 'test1,test2'
      const lockId = '1642123456789-abc123def';
      
      const result = await balanceChecker.releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('無効なlockKey（null）でスキップされる', async function() {
      // lockKey が null の場合
      const lockKey = null; // String(lockKey) = 'null'
      const lockId = '1642123456789-abc123def';
      
      const result = await balanceChecker.releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('無効なlockKey（undefined）でスキップされる', async function() {
      // lockKey が undefined の場合
      const lockKey = undefined; // String(lockKey) = 'undefined'
      const lockId = '1642123456789-abc123def';
      
      const result = await balanceChecker.releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('無効なlockId（オブジェクト）でスキップされる', async function() {
      // lockId が オブジェクトの場合
      const lockKey = 'balance_checker:all_exchanges';
      const lockId = { id: 'test' }; // String(lockId) = '[object Object]'
      
      const result = await balanceChecker.releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('無効なlockId（配列）でスキップされる', async function() {
      // lockId が 配列の場合
      const lockKey = 'balance_checker:all_exchanges';
      const lockId = ['id1', 'id2']; // String(lockId) = 'id1,id2'
      
      const result = await balanceChecker.releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('無効なlockId（null）でスキップされる', async function() {
      // lockId が null の場合
      const lockKey = 'balance_checker:all_exchanges';
      const lockId = null; // String(lockId) = 'null'
      
      const result = await balanceChecker.releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('無効なlockId（undefined）でスキップされる', async function() {
      // lockId が undefined の場合
      const lockKey = 'balance_checker:all_exchanges';
      const lockId = undefined; // String(lockId) = 'undefined'
      
      const result = await balanceChecker.releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('Redis evalエラーが適切にキャッチされる', async function() {
      // Redis eval エラーの場合
      const lockKey = 'balance_checker:all_exchanges';
      const lockId = '1642123456789-abc123def';
      
      mockRedisClient.eval.mockRejectedValue(new Error('ERR Lua redis lib command arguments must be strings or integers'));
      
      const result = await balanceChecker.releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).toHaveBeenCalledTimes(1);
    });

    it('複数の無効な引数の組み合わせが適切にハンドリングされる', async function() {
      // 両方とも無効な場合
      const lockKey = { key: 'test' }; // '[object Object]'
      const lockId = ['id1', 'id2']; // 'id1,id2'
      
      const result = await balanceChecker.releaseDistributedLock(lockKey, lockId);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

  });

  describe('Issue #2700 回帰テスト', function() {
    
    it('修正前に発生していたエラーケースが解決される', async function() {
      // 修正前に問題となっていた可能性のあるケース
      const problematicCases = [
        { lockKey: { toString: () => '[object Object]' }, lockId: '123' },
        { lockKey: 'valid_key', lockId: { toString: () => '[object Object]' } },
        { lockKey: null, lockId: '123' },
        { lockKey: 'valid_key', lockId: null },
        { lockKey: undefined, lockId: '123' },
        { lockKey: 'valid_key', lockId: undefined },
        { lockKey: ['array', 'key'], lockId: '123' },
        { lockKey: 'valid_key', lockId: ['array', 'id'] }
      ];

      for (const testCase of problematicCases) {
        const result = await balanceChecker.releaseDistributedLock(testCase.lockKey, testCase.lockId);
        
        expect(result).toBe(false);
        expect(mockRedisClient.eval).not.toHaveBeenCalled();
        
        // Reset mock for next iteration
        mockRedisClient.eval.mockClear();
      }
    });

    it('修正により、有効な引数のみがRedisに渡される', async function() {
      // 有効なケース
      const validCases = [
        { lockKey: 'balance_checker:all_exchanges', lockId: '1642123456789-abc123def' },
        { lockKey: 'test_lock', lockId: '1234567890-xyz789abc' },
        { lockKey: 'another:lock:key', lockId: 'id-123' }
      ];

      for (const testCase of validCases) {
        mockRedisClient.eval.mockResolvedValue(1);
        
        const result = await balanceChecker.releaseDistributedLock(testCase.lockKey, testCase.lockId);
        
        expect(result).toBe(true);
        expect(mockRedisClient.eval).toHaveBeenCalledTimes(1);
        
        // Verify the arguments passed to eval are strings
        const evalCall = mockRedisClient.eval.mock.calls[0];
        expect(typeof evalCall[2]).toBe('string'); // KEYS[1]
        expect(typeof evalCall[3]).toBe('string'); // ARGV[1]
        expect(evalCall[2]).toBe(testCase.lockKey);
        expect(evalCall[3]).toBe(testCase.lockId);
        
        // Reset mock for next iteration
        mockRedisClient.eval.mockClear();
      }
    });

  });
});