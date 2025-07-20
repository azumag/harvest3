/**
 * Issue #4927: strategy-runnerサービスで例外が発生 - Redis分散ロック解放エラー修正のテスト
 * 
 * エラー: ERR Lua redis lib command arguments must be strings or integers
 * 原因: Redis Luaスクリプト内で引数の型安全性が不十分
 * 修正: Luaスクリプト内での引数の型チェックを強化
 */

// Jest テストフレームワークを使用
jest.unmock('../../../src/database/manager');

describe('Issue #4927: Redis分散ロック解放エラー修正', () => {
  let mockRedisClient;
  let mockRedisDatabase;
  let mockLogger;
  let databaseManager;

  beforeEach(() => {
    // Jest のモックキャッシュをクリア
    jest.resetModules();
    
    // モックの初期化
    mockRedisClient = {
      multi: jest.fn(),
      isReady: true,
      isOpen: true,
      status: 'ready',
      serverInfo: { version: '6.2.0' },
      ping: jest.fn().mockResolvedValue('PONG'),
      eval: jest.fn()
    };

    mockRedisDatabase = {
      getClient: jest.fn().mockReturnValue(mockRedisClient)
    };

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    };

    // Logger クラスをモック
    jest.doMock('../../../src/hft/utils/Logger', () => {
      return jest.fn(() => mockLogger);
    });

    // redisDatabase をモック
    jest.doMock('../../../src/database/redisDatabase', () => mockRedisDatabase);

    // MongoDB client をモック
    const mockMongoClient = {
      close: jest.fn(),
      db: jest.fn(() => ({
        collection: jest.fn(() => ({
          createIndex: jest.fn(),
          findOne: jest.fn(),
          insertOne: jest.fn(),
          updateOne: jest.fn(),
          deleteOne: jest.fn()
        }))
      }))
    };

    jest.doMock('../../../src/database/mongoDatabase', () => ({
      connectDB: jest.fn(),
      mongoClient: mockMongoClient,
      tradesCollection: {
        findOne: jest.fn(),
        insertOne: jest.fn(),
        updateOne: jest.fn(),
        deleteOne: jest.fn()
      }
    }));

    // utils.js の validateLockParameters をモック
    jest.doMock('../../../src/common/utils', () => ({
      validateLockParameters: jest.fn().mockReturnValue({ valid: true }),
      sanitizeString: jest.fn(str => str),
      isValidStringValue: jest.fn(() => true)
    }));

    // モックの後でdatabaseManagerを読み込み
    databaseManager = require('../../../src/database/manager');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('releaseDistributedLock', () => {
    it('正常なlockKeyとlockValueで分散ロックを解放する', async () => {
      const lockInfo = {
        lockKey: 'test_lock_key',
        lockValue: 'test_lock_value'
      };

      mockRedisClient.eval.mockResolvedValue(1);

      const result = await databaseManager.releaseDistributedLock(lockInfo);

      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('-- 引数の型チェック'),
        1,
        'test_lock_key',
        'test_lock_value'
      );
    });

    it('Issue #4927: Luaスクリプトに型安全性チェックが含まれることを確認', async () => {
      const lockInfo = {
        lockKey: 'test_lock_key',
        lockValue: 'test_lock_value'
      };

      mockRedisClient.eval.mockResolvedValue(1);

      await databaseManager.releaseDistributedLock(lockInfo);

      expect(mockRedisClient.eval).toHaveBeenCalled();
      const luaScript = mockRedisClient.eval.mock.calls[0][0];

      // Issue #4927: 型安全性チェックが含まれていることを確認
      expect(luaScript).toContain('-- 引数の型チェック');
      expect(luaScript).toContain("if type(KEYS[1]) ~= 'string' or type(ARGV[1]) ~= 'string' then");
      expect(luaScript).toContain('return 0');
      expect(luaScript).toContain('-- 空文字列チェック');
      expect(luaScript).toContain("if KEYS[1] == '' or ARGV[1] == '' then");
    });

    it('Issue #4927: null/undefinedのlockKeyを適切に拒否する', async () => {
      const testCases = [
        { lockKey: null, lockValue: 'test_value' },
        { lockKey: undefined, lockValue: 'test_value' },
        { lockKey: '', lockValue: 'test_value' }
      ];

      for (const lockInfo of testCases) {
        const result = await databaseManager.releaseDistributedLock(lockInfo);
        
        expect(result).toBe(false);
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining('分散ロック解放スキップ')
        );
      }

      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('Issue #4927: null/undefinedのlockValueを適切に拒否する', async () => {
      const testCases = [
        { lockKey: 'test_key', lockValue: null },
        { lockKey: 'test_key', lockValue: undefined },
        { lockKey: 'test_key', lockValue: '' }
      ];

      for (const lockInfo of testCases) {
        jest.clearAllMocks();
        
        const result = await databaseManager.releaseDistributedLock(lockInfo);
        
        expect(result).toBe(false);
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining('分散ロック解放スキップ')
        );
      }

      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('Issue #4927: 数値型の引数を文字列に変換して処理する', async () => {
      const lockInfo = {
        lockKey: 12345,
        lockValue: 67890
      };

      mockRedisClient.eval.mockResolvedValue(1);

      const result = await databaseManager.releaseDistributedLock(lockInfo);

      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        '12345',
        '67890'
      );
    });

    it('Issue #4927: 配列型やオブジェクト型の引数は適切に拒否される', async () => {
      const testCases = [
        { lockKey: ['array', 'key'], lockValue: 'test_value' },
        { lockKey: 'test_key', lockValue: ['array', 'value'] },
        { lockKey: { obj: 'key' }, lockValue: 'test_value' },
        { lockKey: 'test_key', lockValue: { obj: 'value' } }
      ];

      for (const lockInfo of testCases) {
        jest.clearAllMocks();
        
        const result = await databaseManager.releaseDistributedLock(lockInfo);
        
        expect(result).toBe(false);
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining('分散ロック解放スキップ')
        );
      }

      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('Issue #4927: Redis接続エラー時は適切にfalseを返す', async () => {
      const lockInfo = {
        lockKey: 'test_lock_key',
        lockValue: 'test_lock_value'
      };

      mockRedisClient.isReady = false;
      mockRedisClient.isOpen = false;

      const result = await databaseManager.releaseDistributedLock(lockInfo);

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Redis接続が無効')
      );
    });

    it('Issue #4927: Luaスクリプト実行エラー時は適切にエラーハンドリングする', async () => {
      const lockInfo = {
        lockKey: 'test_lock_key',
        lockValue: 'test_lock_value'
      };

      const luaError = new Error('ERR Lua redis lib command arguments must be strings or integers');
      mockRedisClient.eval.mockRejectedValue(luaError);

      const result = await databaseManager.releaseDistributedLock(lockInfo);

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('分散ロック解放エラー:')
      );
    });

    it('Issue #4927: 修正前のエラーが発生しないことを確認', async () => {
      const lockInfo = {
        lockKey: 'test_lock_key',
        lockValue: 'test_lock_value'
      };

      mockRedisClient.eval.mockResolvedValue(1);

      const result = await databaseManager.releaseDistributedLock(lockInfo);

      expect(result).toBe(true);
      
      // 修正前のエラーメッセージが出力されていないことを確認
      expect(mockLogger.error).not.toHaveBeenCalledWith(
        expect.stringContaining('ERR Lua redis lib command arguments must be strings or integers')
      );
    });
  });

  describe('統合テスト', () => {
    it('Issue #4927: 2PC環境での分散ロック動作確認', async () => {
      const lockInfo = {
        lockKey: 'strategy_runner_lock:1416411783',
        lockValue: 'unique_lock_value_123'
      };

      mockRedisClient.eval.mockResolvedValue(1);

      const result = await databaseManager.releaseDistributedLock(lockInfo);

      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('-- 引数の型チェック'),
        1,
        'strategy_runner_lock:1416411783',
        'unique_lock_value_123'
      );

      const luaScript = mockRedisClient.eval.mock.calls[0][0];
      
      // 修正されたLuaスクリプトの構造を確認
      expect(luaScript).toContain('-- 引数の型チェック');
      expect(luaScript).toContain('-- 空文字列チェック');
      expect(luaScript).toContain('-- 通常の比較処理');
    });
  });
});