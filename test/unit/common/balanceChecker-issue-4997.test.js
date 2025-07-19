/**
 * Issue #4997 修正のテスト
 * strategy-runnerサービスでの Redis Lua script 引数検証エラーの修正を検証
 * 
 * 修正内容：
 * - Redis eval() 実行前の最終的な引数検証強化
 * - 不正な文字列値の詳細チェック
 * - 制御文字や特殊文字の検証
 * - エラーログの詳細化
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

describe('Issue #4997: Redis Lua script 引数検証エラー修正テスト', () => {
  let balanceChecker;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock validateLockParameters to match implementation validation logic
    mockUtils.validateLockParameters.mockImplementation((lockKey, lockValue, context) => {
      if (typeof lockKey !== 'string' || typeof lockValue !== 'string' || 
          lockKey.trim() === '' || lockValue.trim() === '') {
        return { valid: false, error: 'Invalid parameters' };
      }
      
      // Match the regex validation from the real implementation: /^[a-zA-Z0-9_:\-\.]+$/
      const validCharRegex = /^[a-zA-Z0-9_:\-\.]+$/;
      if (!validCharRegex.test(lockKey) || !validCharRegex.test(lockValue)) {
        return { valid: false, error: 'Invalid characters in parameters' };
      }
      
      return { valid: true };
    });
    
    balanceChecker = require('../../../src/common/balanceChecker');
  });

  describe('releaseDistributedLock - Redis eval引数検証強化', () => {
    it('正常なlockKeyとlockIdの場合は正常に処理される', async () => {
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

    it('lockKeyに特殊文字が含まれる場合はエラーになる', async () => {
      const result = await balanceChecker.releaseDistributedLock('invalid\x00key', 'valid-lock-id');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('lockIdに特殊文字が含まれる場合はエラーになる', async () => {
      const result = await balanceChecker.releaseDistributedLock('valid-key', 'invalid\x01id');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('lockKeyが"null"文字列の場合はエラーになる', async () => {
      const result = await balanceChecker.releaseDistributedLock('null', 'valid-lock-id');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('lockIdが"undefined"文字列の場合はエラーになる', async () => {
      const result = await balanceChecker.releaseDistributedLock('valid-key', 'undefined');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('lockKeyに日本語文字が含まれる場合はエラーになる', async () => {
      const result = await balanceChecker.releaseDistributedLock('テストキー', 'valid-lock-id');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('lockIdにスペースが含まれる場合はエラーになる', async () => {
      const result = await balanceChecker.releaseDistributedLock('valid-key', 'lock id with spaces');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('有効な文字セット（英数字、アンダースコア、ハイフン、ドット、コロン）は許可される', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      const result = await balanceChecker.releaseDistributedLock(
        'balance_checker_lock:test-123.key', 
        'lock-id_123.456'
      );
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalled();
    });

    it('Redis evalが例外を投げた場合は適切にハンドリングされる', async () => {
      mockRedisClient.eval.mockRejectedValue(new Error('Redis connection lost'));
      
      const result = await balanceChecker.releaseDistributedLock('valid-key', 'valid-lock-id');
      
      expect(result).toBe(false);
    });

    it('不正な文字が含まれる場合は適切にエラーハンドリングされる', async () => {
      // @ character should be rejected by the regex validation
      const result = await balanceChecker.releaseDistributedLock('invalid@key', 'valid-lock-id');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('空文字列のlockKeyは早期にチェックされる', async () => {
      const result = await balanceChecker.releaseDistributedLock('', 'valid-lock-id');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('空文字列のlockIdは早期にチェックされる', async () => {
      const result = await balanceChecker.releaseDistributedLock('valid-key', '');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('Redis evalが0を返した場合（ロック解放失敗）は false を返す', async () => {
      mockRedisClient.eval.mockResolvedValue(0);
      
      const result = await balanceChecker.releaseDistributedLock('valid-key', 'valid-lock-id');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).toHaveBeenCalled();
    });

    it('数値のlockIdは文字列に変換されて処理される', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      const result = await balanceChecker.releaseDistributedLock('valid-key', 12345);
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'valid-key',
        '12345'
      );
    });
  });

  describe('エラーケースの網羅的テスト', () => {
    const invalidCases = [
      { lockKey: 'key with spaces', lockId: 'valid-id', description: 'lockKeyにスペース' },
      { lockKey: 'valid-key', lockId: 'id with spaces', description: 'lockIdにスペース' },
      { lockKey: 'key\twithtab', lockId: 'valid-id', description: 'lockKeyにタブ' },
      { lockKey: 'valid-key', lockId: 'id\nwithnewline', description: 'lockIdに改行' },
      { lockKey: 'key@invalid', lockId: 'valid-id', description: 'lockKeyに@記号' },
      { lockKey: 'valid-key', lockId: 'id#invalid', description: 'lockIdに#記号' },
      { lockKey: 'key$invalid', lockId: 'valid-id', description: 'lockKeyに$記号' },
      { lockKey: 'valid-key', lockId: 'id%invalid', description: 'lockIdに%記号' }
    ];

    invalidCases.forEach(({ lockKey, lockId, description }) => {
      it(`${description}の場合はエラーになる`, async () => {
        const result = await balanceChecker.releaseDistributedLock(lockKey, lockId);
        
        expect(result).toBe(false);
        expect(mockRedisClient.eval).not.toHaveBeenCalled();
      });
    });
  });
});