/**
 * Issue #2670 修正のテスト
 * strategy-runnerサービスでの分散ロック解放エラーの修正を検証
 * 
 * 修正内容：
 * - releaseDistributedLock の型チェック強化
 * - 無効な型値の適切な処理
 * - Redis Lua スクリプトへの引数型安全性の確保
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
mockRedisDatabase.getClient.mockReturnValue(mockRedisClient);
mockRedisDatabase.isConnected.mockReturnValue(true);

describe('Issue #2670: 分散ロック解放エラー修正テスト', () => {
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
    
    // バランスチェッカーを動的に読み込み
    balanceChecker = require('../../../src/common/balanceChecker');
  });

  describe('releaseDistributedLock - 型安全性の強化', () => {
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

    it('lockIdがnullの場合は早期リターンしてfalseを返す', async () => {
      const result = await balanceChecker.releaseDistributedLock('test-key', null);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('lockIdがundefinedの場合は早期リターンしてfalseを返す', async () => {
      const result = await balanceChecker.releaseDistributedLock('test-key', undefined);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('lockIdが空文字列の場合は早期リターンしてfalseを返す', async () => {
      const result = await balanceChecker.releaseDistributedLock('test-key', '');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('lockIdが配列の場合は早期リターンしてfalseを返す', async () => {
      const result = await balanceChecker.releaseDistributedLock('test-key', []);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('lockIdがオブジェクトの場合は早期リターンしてfalseを返す', async () => {
      const result = await balanceChecker.releaseDistributedLock('test-key', {});
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('lockIdが関数の場合は早期リターンしてfalseを返す', async () => {
      const result = await balanceChecker.releaseDistributedLock('test-key', function() {});
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('lockIdが数値の場合は文字列変換されて処理される', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      const result = await balanceChecker.releaseDistributedLock('test-key', 123);
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'test-key',
        '123'
      );
    });

    it('文字列化されたlockIdが"null"の場合は早期リターンしてfalseを返す', async () => {
      // String(null) => "null" となるケース
      const result = await balanceChecker.releaseDistributedLock('test-key', null);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('文字列化されたlockIdが"undefined"の場合は早期リターンしてfalseを返す', async () => {
      // String(undefined) => "undefined" となるケース
      const result = await balanceChecker.releaseDistributedLock('test-key', undefined);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('文字列化されたlockIdが"[object Object]"の場合は早期リターンしてfalseを返す', async () => {
      // String({}) => "[object Object]" となるケース
      const result = await balanceChecker.releaseDistributedLock('test-key', {});
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('validateLockParametersが無効を返す場合は早期リターンしてfalseを返す', async () => {
      validateLockParameters.mockReturnValue({ 
        valid: false, 
        error: 'Invalid lock parameters' 
      });
      
      const result = await balanceChecker.releaseDistributedLock('test-key', 'test-lock-id');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('Redis接続エラーの場合は例外をキャッチしてfalseを返す', async () => {
      mockRedisClient.eval.mockRejectedValue(new Error('Redis connection failed'));
      
      const result = await balanceChecker.releaseDistributedLock('test-key', 'test-lock-id');
      
      expect(result).toBe(false);
    });

    it('Redis Lua スクリプトエラーの場合は例外をキャッチしてfalseを返す', async () => {
      mockRedisClient.eval.mockRejectedValue(new Error('ERR Lua redis lib command arguments must be strings or integers'));
      
      const result = await balanceChecker.releaseDistributedLock('test-key', 'test-lock-id');
      
      expect(result).toBe(false);
    });
  });

  describe('withDistributedLock - 統合テスト', () => {
    it('acquireDistributedLockがnullを返す場合でも適切に処理される', async () => {
      // acquireDistributedLock をモック
      jest.spyOn(balanceChecker, 'acquireDistributedLock').mockResolvedValue(null);
      
      const mockFunc = jest.fn();
      
      await expect(balanceChecker.withDistributedLock('test-key', mockFunc))
        .rejects.toThrow('分散ロック取得失敗');
      
      expect(mockFunc).not.toHaveBeenCalled();
      // releaseDistributedLockが呼ばれるが、nullの場合は早期リターンして安全に処理される
    });

    it('acquireDistributedLockが有効なlockIdを返す場合は正常に処理される', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      mockRedisClient.set.mockResolvedValue('OK');
      
      const mockFunc = jest.fn().mockResolvedValue('test-result');
      
      const result = await balanceChecker.withDistributedLock('test-key', mockFunc);
      
      expect(result).toBe('test-result');
      expect(mockFunc).toHaveBeenCalledTimes(1);
    });
  });
});