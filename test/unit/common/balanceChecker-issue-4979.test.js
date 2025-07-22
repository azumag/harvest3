/**
 * Issue #4979 修正のテスト
 * strategy-runnerサービスでのRedis distributed lock release errorの修正を検証
 * 
 * 修正内容：
 * - Luaスクリプトに引数の存在チェック (not KEYS[1] or not ARGV[1]) を追加
 * - JavaScript側でRedis eval実行直前の最終安全チェックを追加
 * - 両方のLuaスクリプト (balanceChecker.js, database/manager.js) を修正
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

describe('Issue #4979: Redis分散ロック解放エラー修正テスト', () => {
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

  describe('releaseDistributedLock - Issue #4979 修正確認', () => {
    it('Luaスクリプトに引数存在チェックが含まれることを確認', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      const result = await balanceChecker.releaseDistributedLock('balance_checker_lock:test', 'valid-lock-id-123');
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledTimes(1);
      
      // Lua スクリプトが修正されていることを確認
      const luaScript = mockRedisClient.eval.mock.calls[0][0];
      expect(luaScript).toContain('-- Issue #4979対応: 引数の存在と型の厳密チェック');
      expect(luaScript).toContain('if not KEYS[1] or not ARGV[1] then');
      expect(luaScript).toContain('return 0');
      expect(luaScript).toContain('-- 空文字列チェック');
      expect(luaScript).toContain("if lockKey == '' or lockIdToCheck == '' then");
    });

    it('Redis eval実行直前の最終安全チェックが機能することを確認', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      const result = await balanceChecker.releaseDistributedLock('valid-key', 'valid-id');
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'valid-key',
        'valid-id'
      );
    });

    it('最終安全チェックで空文字列を検出した場合はエラーで終了', async () => {
      // 空文字列を渡す
      const result = await balanceChecker.releaseDistributedLock('', 'valid-id');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('最終安全チェックでnull文字列を検出した場合はエラーで終了', async () => {
      // String('null')になるような値を渡す（実際にはvalidationで弾かれるが念のため）
      const result = await balanceChecker.releaseDistributedLock('null', 'valid-id');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('最終安全チェックでundefined文字列を検出した場合はエラーで終了', async () => {
      // String('undefined')になるような値を渡す（実際にはvalidationで弾かれるが念のため）  
      const result = await balanceChecker.releaseDistributedLock('undefined', 'valid-id');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('不正な型の引数に対してRedis evalが実行されないことを確認', async () => {
      const result = await balanceChecker.releaseDistributedLock(null, undefined);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('Luaスクリプトエラー発生時は適切にハンドリングされる', async () => {
      mockRedisClient.eval.mockRejectedValue(new Error('ERR Lua redis lib command arguments must be strings or integers script: ba43bb099050899e49700b23b99e0565dccc929d, on @user_script:2.'));
      
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

  describe('releaseDistributedLock - エッジケースでの安全性確認', () => {
    it('文字列化された数値は正常処理される', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      const result = await balanceChecker.releaseDistributedLock(12345, 67890);
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        '12345',
        '67890'
      );
    });

    it('Booleanは文字列化されて処理される', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      const result = await balanceChecker.releaseDistributedLock(true, false);
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'true',
        'false'
      );
    });

    it('配列・オブジェクトは文字列化後にバリデーションで弾かれる', async () => {
      const result1 = await balanceChecker.releaseDistributedLock(['array'], 'valid-id');
      const result2 = await balanceChecker.releaseDistributedLock({key: 'value'}, 'valid-id');
      
      expect(result1).toBe(false);
      expect(result2).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('Redisクライアントが準備できていない場合はエラー', async () => {
      mockRedisClient.isReady = false;
      
      const result = await balanceChecker.releaseDistributedLock('valid-key', 'valid-id');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
      
      // 元に戻す
      mockRedisClient.isReady = true;
    });
  });
});