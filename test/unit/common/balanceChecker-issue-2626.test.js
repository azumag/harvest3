/**
 * BalanceChecker Issue #2626: Redis分散ロック解放エラー修正
 * 
 * 概要: lockKeyやlockIdがnull/undefinedの場合にString()でnull/undefinedが
 * 文字列化されてRedis Luaスクリプトエラーが発生する問題を修正
 */

const { jest } = require('@jest/globals');

describe('BalanceChecker Issue #2626: Redis分散ロック解放エラー修正', () => {
  let balanceChecker;
  let mockRedisClient;
  let mockGetRedisClient;
  
  beforeEach(() => {
    // モック設定
    mockRedisClient = {
      isReady: true,
      eval: jest.fn()
    };
    
    mockGetRedisClient = jest.fn(() => mockRedisClient);
    
    jest.clearAllMocks();
    jest.resetModules();
    
    // モジュールのモック設定
    jest.doMock('../../../src/database/redisClient', () => ({
      getRedisClient: mockGetRedisClient,
      ensureRedisConnection: jest.fn()
    }));
    
    jest.doMock('../../../src/common/balanceCheckerConfig', () => ({
      getValidatedConfig: jest.fn(() => ({
        distributedLock: {
          lockKeyPrefix: 'test_lock',
          defaultTtl: 300000
        }
      }))
    }));
    
    // loggerのモック
    jest.doMock('../../../src/common/logger', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    }));
    
    balanceChecker = require('../../../src/common/balanceChecker');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('releaseDistributedLock - lockKeyバリデーション', () => {
    it('正常なlockKeyとlockIdの場合は正常に処理される', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      const result = await balanceChecker.releaseDistributedLock('valid_lock_key', 'valid_lock_id');
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('redis.call(\'GET\', KEYS[1])'),
        1,
        'valid_lock_key',
        'valid_lock_id'
      );
    });

    it('lockKeyがnullの場合はRedis呼び出しを避けてfalseを返す', async () => {
      const result = await balanceChecker.releaseDistributedLock(null, 'valid_lock_id');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('lockKeyがundefinedの場合はRedis呼び出しを避けてfalseを返す', async () => {
      const result = await balanceChecker.releaseDistributedLock(undefined, 'valid_lock_id');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('lockKeyが空文字の場合はRedis呼び出しを避けてfalseを返す', async () => {
      const result = await balanceChecker.releaseDistributedLock('', 'valid_lock_id');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('lockKeyが空白文字のみの場合はRedis呼び出しを避けてfalseを返す', async () => {
      const result = await balanceChecker.releaseDistributedLock('   ', 'valid_lock_id');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('lockKeyが非文字列の場合はRedis呼び出しを避けてfalseを返す', async () => {
      const result = await balanceChecker.releaseDistributedLock(123, 'valid_lock_id');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });
  });

  describe('releaseDistributedLock - lockIdバリデーション', () => {
    it('lockIdがnullの場合はRedis呼び出しを避けてfalseを返す', async () => {
      const result = await balanceChecker.releaseDistributedLock('valid_lock_key', null);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('lockIdがundefinedの場合はRedis呼び出しを避けてfalseを返す', async () => {
      const result = await balanceChecker.releaseDistributedLock('valid_lock_key', undefined);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('lockIdが空文字の場合はRedis呼び出しを避けてfalseを返す', async () => {
      const result = await balanceChecker.releaseDistributedLock('valid_lock_key', '');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('lockIdが空白文字のみの場合はRedis呼び出しを避けてfalseを返す', async () => {
      const result = await balanceChecker.releaseDistributedLock('valid_lock_key', '   ');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('lockIdが非文字列の場合はRedis呼び出しを避けてfalseを返す', async () => {
      const result = await balanceChecker.releaseDistributedLock('valid_lock_key', 123);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });
  });

  describe('releaseDistributedLock - 複合バリデーション', () => {
    it('lockKeyとlockIdの両方が無効な場合はRedis呼び出しを避けてfalseを返す', async () => {
      const result = await balanceChecker.releaseDistributedLock(null, null);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('lockKeyが無効でlockIdが有効な場合はRedis呼び出しを避けてfalseを返す', async () => {
      const result = await balanceChecker.releaseDistributedLock(null, 'valid_lock_id');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('lockKeyが有効でlockIdが無効な場合はRedis呼び出しを避けてfalseを返す', async () => {
      const result = await balanceChecker.releaseDistributedLock('valid_lock_key', null);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });
  });

  describe('releaseDistributedLock - Redis接続エラー', () => {
    it('Redisが利用できない場合はエラーを処理してfalseを返す', async () => {
      mockGetRedisClient.mockReturnValue(null);
      
      const result = await balanceChecker.releaseDistributedLock('valid_lock_key', 'valid_lock_id');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('Redisが準備できていない場合はエラーを処理してfalseを返す', async () => {
      mockRedisClient.isReady = false;
      
      const result = await balanceChecker.releaseDistributedLock('valid_lock_key', 'valid_lock_id');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });
  });

  describe('releaseDistributedLock - Redis eval 結果処理', () => {
    it('Redis evalが1を返す場合はtrueを返す', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      const result = await balanceChecker.releaseDistributedLock('valid_lock_key', 'valid_lock_id');
      
      expect(result).toBe(true);
    });

    it('Redis evalが0を返す場合はfalseを返す', async () => {
      mockRedisClient.eval.mockResolvedValue(0);
      
      const result = await balanceChecker.releaseDistributedLock('valid_lock_key', 'valid_lock_id');
      
      expect(result).toBe(false);
    });

    it('Redis evalがエラーを発生させた場合はfalseを返す', async () => {
      mockRedisClient.eval.mockRejectedValue(new Error('Redis eval error'));
      
      const result = await balanceChecker.releaseDistributedLock('valid_lock_key', 'valid_lock_id');
      
      expect(result).toBe(false);
    });
  });

  describe('releaseDistributedLock - String変換問題の修正確認', () => {
    it('String(null)やString(undefined)ではなく、直接文字列を渡すことを確認', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      await balanceChecker.releaseDistributedLock('test_key', 'test_id');
      
      const callArgs = mockRedisClient.eval.mock.calls[0];
      expect(callArgs[2]).toBe('test_key');  // String(null) -> 'null' ではない
      expect(callArgs[3]).toBe('test_id');   // String(undefined) -> 'undefined' ではない
    });
  });
});