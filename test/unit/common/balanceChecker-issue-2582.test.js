/**
 * BalanceChecker Issue #2582 テスト
 * Redis分散ロック解放時の引数型エラー修正のテスト
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

jest.mock('../../../src/common/utils', () => ({
  validateLockParameters: jest.fn()
}));

const mockRedisClient = {
  isReady: true,
  eval: jest.fn(),
  set: jest.fn(),
  get: jest.fn()
};

const mockRedisDatabase = require('../../../src/database/redisDatabase');
mockRedisDatabase.getClient.mockReturnValue(mockRedisClient);
mockRedisDatabase.isConnected.mockReturnValue(true);

describe('BalanceChecker Issue #2582: Redis分散ロック解放エラー修正', () => {
  let balanceChecker;

  beforeEach(() => {
    jest.clearAllMocks();
    
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
    
    balanceChecker = require('../../../src/common/balanceChecker');
  });

  describe('releaseDistributedLock - 引数型エラー修正', () => {
    it('正常なlockIdの場合は正常に処理される', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      const result = await balanceChecker.releaseDistributedLock('test-key', 'valid-lock-id');
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'test-key',
        'valid-lock-id'
      );
    });

    it('lockIdがnullの場合はRedis呼び出しを避けてfalseを返す', async () => {
      const result = await balanceChecker.releaseDistributedLock('test-key', null);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('lockIdがundefinedの場合はRedis呼び出しを避けてfalseを返す', async () => {
      const result = await balanceChecker.releaseDistributedLock('test-key', undefined);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('lockIdが空文字列の場合はRedis呼び出しを避けてfalseを返す', async () => {
      const result = await balanceChecker.releaseDistributedLock('test-key', '');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('lockIdが数値の場合は文字列に変換されて処理される', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      const result = await balanceChecker.releaseDistributedLock('test-key', 123);
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'test-key',
        '123'  // 数値123が文字列'123'に変換される
      );
    });

    it('lockIdがオブジェクトの場合はRedis呼び出しを避けてfalseを返す', async () => {
      const result = await balanceChecker.releaseDistributedLock('test-key', {});
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('lockIdが配列の場合はRedis呼び出しを避けてfalseを返す', async () => {
      const result = await balanceChecker.releaseDistributedLock('test-key', []);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('引数が文字列として明示的にRedisに渡される', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      const result = await balanceChecker.releaseDistributedLock('test-key', 'test-lock-id');
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'test-key',  // String(lockKey)
        'test-lock-id'  // String(lockId)
      );
    });
  });

  describe('withDistributedLock - lockId null時の安全性', () => {
    it('ロック取得失敗時にnullのlockIdで解放を試行してもエラーにならない', async () => {
      // ロック取得が失敗してnullを返すシナリオ
      mockRedisClient.set.mockResolvedValue(null);
      
      const testFunction = jest.fn().mockResolvedValue('test-result');
      
      await expect(balanceChecker.withDistributedLock('test-key', testFunction))
        .rejects.toThrow('分散ロック取得失敗');
      
      // ロック解放が呼ばれないことを確認
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });
  });
});