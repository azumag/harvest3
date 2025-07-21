/**
 * Issue #4963 修正のテスト
 * strategy-runnerサービスでの Redis distributed lock release error の修正を検証
 * 
 * 修正内容：
 * - Redis eval() 実行時に validatedされた finalLockKey, finalLockId を使用するよう修正
 * - 以前は stringLockKey, stringLockId が使用されていたが、これが原因で型エラーが発生していた
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

describe('Issue #4963: Redis分散ロック解放エラー修正テスト', () => {
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

  describe('releaseDistributedLock - 正しいvalidatedパラメータ使用確認', () => {
    it('validateされたfinalLockKey, finalLockIdがRedis evalに正しく渡されることを確認', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      const result = await balanceChecker.releaseDistributedLock('balance_checker_lock:test', 'valid-lock-id-123');
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'balance_checker_lock:test',
        'valid-lock-id-123'
      );
    });

    it('制御文字を含む引数がサニタイズされてvalidatedパラメータが使用されることを確認', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      // 制御文字を含む引数を渡す
      const result = await balanceChecker.releaseDistributedLock('test\x00key', 'lock\x01id');
      
      expect(result).toBe(true);
      // サニタイズされた値が渡されることを確認
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'testkey', // \x00 が除去されたvalidatedパラメータ
        'lockid'   // \x01 が除去されたvalidatedパラメータ
      );
    });

    it('数値引数が文字列化されてvalidatedパラメータが使用されることを確認', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      const result = await balanceChecker.releaseDistributedLock(12345, 67890);
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        '12345', // 数値が文字列化されたvalidatedパラメータ
        '67890'  // 数値が文字列化されたvalidatedパラメータ
      );
    });

    it('Redis eval引数の最終検証でエラーが発生した場合は適切にハンドリングされる', async () => {
      // validateLockParametersを失敗させる
      mockUtils.validateLockParameters.mockReturnValue({ 
        valid: false, 
        error: 'Invalid characters' 
      });
      
      const result = await balanceChecker.releaseDistributedLock('invalid@key', 'valid-id');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('文字列変換後の検証で不正な値が検出された場合はエラーハンドリングされる', async () => {
      // 正規表現チェックで失敗するようなケース
      const result = await balanceChecker.releaseDistributedLock('key-with-invalid-chars!', 'valid-id');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });
  });
});