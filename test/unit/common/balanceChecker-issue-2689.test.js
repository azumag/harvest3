/**
 * BalanceChecker Issue #2689 テスト
 * Redis分散ロック解放時のeval引数の明示的文字列変換修正のテスト
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

describe('BalanceChecker Issue #2689: Redis eval引数の明示的文字列変換修正', () => {
  let balanceChecker;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUtils.validateLockParameters.mockReturnValue({ valid: true });
    balanceChecker = require('../../../src/common/balanceChecker');
  });

  describe('releaseDistributedLock - Redis eval引数の文字列変換', () => {
    it('Redis eval呼び出し時に引数がString()で明示的に文字列変換される', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      const result = await balanceChecker.releaseDistributedLock('balance_checker_lock:test', 'lock-id-123');
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String), // Luaスクリプト
        1, // キー数
        'balance_checker_lock:test', // 第1引数（lockKey）
        'lock-id-123' // 第2引数（lockId）
      );
    });

    it('数値型のlockIdも文字列として渡される', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      const result = await balanceChecker.releaseDistributedLock('balance_checker_lock:test', 12345);
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'balance_checker_lock:test',
        '12345' // 数値が文字列に変換される
      );
    });

    it('boolean型のlockIdも文字列として渡される', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      const result = await balanceChecker.releaseDistributedLock('balance_checker_lock:test', true);
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'balance_checker_lock:test',
        'true' // booleanが文字列に変換される
      );
    });

    it('undefined/nullは事前のバリデーションで弾かれてRedis呼び出しが行われない', async () => {
      const resultUndefined = await balanceChecker.releaseDistributedLock('balance_checker_lock:test', undefined);
      const resultNull = await balanceChecker.releaseDistributedLock('balance_checker_lock:test', null);
      
      expect(resultUndefined).toBe(false);
      expect(resultNull).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('Redis eval引数型エラーが発生した場合はfalseを返す', async () => {
      mockRedisClient.eval.mockRejectedValue(
        new Error('ERR Lua redis lib command arguments must be strings or integers script: b24323b7762549a5bd9e3ab035fdbcf4f153e748, on @user_script:2.')
      );
      
      const result = await balanceChecker.releaseDistributedLock('balance_checker_lock:test', 'lock-id');
      
      expect(result).toBe(false);
    });

    it('複雑なオブジェクト型は事前のバリデーションで弾かれる', async () => {
      const complexObject = { nested: { value: 'test' } };
      const arrayValue = ['item1', 'item2'];
      const functionValue = () => 'test';
      
      const resultObject = await balanceChecker.releaseDistributedLock('balance_checker_lock:test', complexObject);
      const resultArray = await balanceChecker.releaseDistributedLock('balance_checker_lock:test', arrayValue);
      const resultFunction = await balanceChecker.releaseDistributedLock('balance_checker_lock:test', functionValue);
      
      expect(resultObject).toBe(false);
      expect(resultArray).toBe(false);
      expect(resultFunction).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });
  });

  describe('acquireDistributedLock - lockId生成の一貫性', () => {
    it('生成されるlockIdが常に文字列であることを確認', async () => {
      mockRedisClient.set.mockResolvedValue('OK');
      
      const lockId = await balanceChecker.acquireDistributedLock('balance_checker_lock:test');
      
      expect(lockId).toBeTruthy();
      expect(typeof lockId).toBe('string');
      // タイムスタンプ-ランダム文字列の形式
      expect(lockId).toMatch(/^\d+-[a-z0-9]+$/);
    });
  });
});