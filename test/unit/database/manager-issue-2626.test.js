/**
 * Database Manager Issue #2626: Redis分散ロック解放エラー修正
 * 
 * 概要: lockInfoのlockKeyやlockValueがnull/undefinedの場合に
 * Redis Luaスクリプトエラーが発生する問題を修正
 */

describe('Database Manager Issue #2626: Redis分散ロック解放エラー修正', () => {
  let manager;
  let mockRedisClient;
  let mockRedisDatabase;
  let mockLogger;
  
  beforeEach(() => {
    // モック設定
    mockRedisClient = {
      eval: jest.fn()
    };
    
    mockRedisDatabase = {
      getClient: jest.fn(() => mockRedisClient)
    };
    
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };
    
    jest.clearAllMocks();
    jest.resetModules();
    
    // モジュールのモック設定
    jest.doMock('../../../src/database/redisDatabase', () => mockRedisDatabase);
    
    jest.doMock('../../../src/hft/utils/Logger', () => {
      return jest.fn().mockImplementation(() => mockLogger);
    });
    
    manager = require('../../../src/database/manager');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('releaseDistributedLock - lockInfoバリデーション', () => {
    it('正常なlockInfoの場合は正常に処理される', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      const lockInfo = {
        lockKey: 'valid_lock_key',
        lockValue: 'valid_lock_value'
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('redis.call("get", KEYS[1])'),
        1,
        'valid_lock_key',
        'valid_lock_value'
      );
    });

    it('lockInfoがnullの場合はRedis呼び出しを避けてfalseを返す', async () => {
      const result = await manager.releaseDistributedLock(null);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('無効なlockInfo (null)')
      );
    });

    it('lockInfoがundefinedの場合はRedis呼び出しを避けてfalseを返す', async () => {
      const result = await manager.releaseDistributedLock(undefined);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('無効なlockInfo (undefined)')
      );
    });

    it('lockInfoが非オブジェクトの場合はRedis呼び出しを避けてfalseを返す', async () => {
      const result = await manager.releaseDistributedLock('invalid_type');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('無効なlockInfo (invalid_type)')
      );
    });
  });

  describe('releaseDistributedLock - lockKeyバリデーション', () => {
    it('lockKeyがnullの場合はRedis呼び出しを避けてfalseを返す', async () => {
      const lockInfo = {
        lockKey: null,
        lockValue: 'valid_lock_value'
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('無効なlockKey (null)')
      );
    });

    it('lockKeyがundefinedの場合はRedis呼び出しを避けてfalseを返す', async () => {
      const lockInfo = {
        lockKey: undefined,
        lockValue: 'valid_lock_value'
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('無効なlockKey (undefined)')
      );
    });

    it('lockKeyが空文字の場合はRedis呼び出しを避けてfalseを返す', async () => {
      const lockInfo = {
        lockKey: '',
        lockValue: 'valid_lock_value'
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('無効なlockKey ()')
      );
    });

    it('lockKeyが空白文字のみの場合はRedis呼び出しを避けてfalseを返す', async () => {
      const lockInfo = {
        lockKey: '   ',
        lockValue: 'valid_lock_value'
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('無効なlockKey (   )')
      );
    });

    it('lockKeyが非文字列の場合はRedis呼び出しを避けてfalseを返す', async () => {
      const lockInfo = {
        lockKey: 123,
        lockValue: 'valid_lock_value'
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('無効なlockKey (123)')
      );
    });
  });

  describe('releaseDistributedLock - lockValueバリデーション', () => {
    it('lockValueがnullの場合はRedis呼び出しを避けてfalseを返す', async () => {
      const lockInfo = {
        lockKey: 'valid_lock_key',
        lockValue: null
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('無効なlockValue (null)')
      );
    });

    it('lockValueがundefinedの場合はRedis呼び出しを避けてfalseを返す', async () => {
      const lockInfo = {
        lockKey: 'valid_lock_key',
        lockValue: undefined
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('無効なlockValue (undefined)')
      );
    });

    it('lockValueが空文字の場合はRedis呼び出しを避けてfalseを返す', async () => {
      const lockInfo = {
        lockKey: 'valid_lock_key',
        lockValue: ''
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('無効なlockValue ()')
      );
    });

    it('lockValueが空白文字のみの場合はRedis呼び出しを避けてfalseを返す', async () => {
      const lockInfo = {
        lockKey: 'valid_lock_key',
        lockValue: '   '
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('無効なlockValue (   )')
      );
    });

    it('lockValueが非文字列の場合はRedis呼び出しを避けてfalseを返す', async () => {
      const lockInfo = {
        lockKey: 'valid_lock_key',
        lockValue: 123
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('無効なlockValue (123)')
      );
    });
  });

  describe('releaseDistributedLock - 複合バリデーション', () => {
    it('lockKeyとlockValueの両方が無効な場合はRedis呼び出しを避けてfalseを返す', async () => {
      const lockInfo = {
        lockKey: null,
        lockValue: null
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('無効なlockKey (null)')
      );
    });

    it('lockKeyが無効でlockValueが有効な場合はRedis呼び出しを避けてfalseを返す', async () => {
      const lockInfo = {
        lockKey: null,
        lockValue: 'valid_lock_value'
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('無効なlockKey (null)')
      );
    });

    it('lockKeyが有効でlockValueが無効な場合はRedis呼び出しを避けてfalseを返す', async () => {
      const lockInfo = {
        lockKey: 'valid_lock_key',
        lockValue: null
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('無効なlockValue (null)')
      );
    });
  });

  describe('releaseDistributedLock - Redis eval 結果処理', () => {
    it('Redis evalが1を返す場合はtrueを返す', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      const lockInfo = {
        lockKey: 'valid_lock_key',
        lockValue: 'valid_lock_value'
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(true);
    });

    it('Redis evalが0を返す場合はfalseを返す', async () => {
      mockRedisClient.eval.mockResolvedValue(0);
      
      const lockInfo = {
        lockKey: 'valid_lock_key',
        lockValue: 'valid_lock_value'
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(false);
    });

    it('Redis evalがエラーを発生させた場合はfalseを返す', async () => {
      mockRedisClient.eval.mockRejectedValue(new Error('Redis eval error'));
      
      const lockInfo = {
        lockKey: 'valid_lock_key',
        lockValue: 'valid_lock_value'
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('分散ロック解放エラー: Redis eval error')
      );
    });
  });

  describe('releaseDistributedLock - 引数処理問題の修正確認', () => {
    it('無効な引数を文字列化せずに、早期にバリデーションで除外することを確認', async () => {
      const lockInfo = {
        lockKey: null,
        lockValue: undefined
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
      // String(null) -> 'null' や String(undefined) -> 'undefined' が
      // Redis Luaスクリプトに渡されることを避けている
    });
  });
});