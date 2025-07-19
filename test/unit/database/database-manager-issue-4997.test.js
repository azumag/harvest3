/**
 * Issue #4997 修正のテスト - Database Manager
 * strategy-runnerサービスでの Redis Lua script 引数検証エラーの修正を検証
 * 
 * 修正内容：
 * - executeRedisLockRelease 関数での Redis eval() 実行前の最終的な引数検証強化
 * - 不正な文字列値の詳細チェック
 * - 制御文字や特殊文字の検証
 * - エラーログの詳細化
 */

// Explicitly unmock the manager module
jest.unmock('../../../src/database/manager');

describe('Issue #4997: Database Manager Redis Lua script 引数検証エラー修正テスト', () => {
  let manager;
  let mockRedisClient;
  let mockRedisDatabase;
  let mockLogger;

  beforeEach(() => {
    // Clear Jest module cache to ensure fresh imports
    jest.resetModules();
    
    // Initialize mocks
    mockRedisClient = {
      isReady: true,
      eval: jest.fn(),
      set: jest.fn(),
      get: jest.fn()
    };

    mockRedisDatabase = {
      getClient: jest.fn().mockReturnValue(mockRedisClient),
      isConnected: jest.fn().mockReturnValue(true)
    };

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    // Setup dynamic mocks
    jest.doMock('../../../src/hft/utils/Logger', () => {
      return jest.fn(() => mockLogger);
    });

    jest.doMock('../../../src/database/redisDatabase', () => mockRedisDatabase);

    jest.doMock('../../../src/database/mongoDatabase', () => ({
      connectDB: jest.fn(),
      getClient: jest.fn()
    }));

    jest.doMock('../../../src/common/utils', () => ({
      sleep: jest.fn(),
      timeframeToMs: jest.fn(),
      isBacktestMode: jest.fn().mockReturnValue(false),
      validateLockParameters: jest.fn().mockReturnValue({ valid: true })
    }));

    jest.doMock('../../../src/common/notifications', () => ({
      postErrorToDiscord: jest.fn()
    }));

    jest.doMock('../../../src/data/marketDataProvider', () => ({}));

    jest.doMock('../../../src/common/const', () => ({
      TRADING_EXECUTION_CONSTANTS: {},
      EXCHANGE_SETTINGS: {}
    }));

    jest.doMock('../../../src/common/throttleMonitor', () => ({
      throttleMonitor: {
        getStats: jest.fn().mockReturnValue({})
      }
    }));

    jest.doMock('../../../src/common/apiCoordinator', () => ({
      apiCoordinator: {
        getStats: jest.fn().mockReturnValue({})
      }
    }));

    // Import manager after all mocks are set up
    manager = require('../../../src/database/manager');
  });

  describe('executeRedisLockRelease - Redis eval引数検証強化', () => {
    it('正常なlockKeyとlockValueの場合は正常に処理される', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      // executeRedisLockRelease関数は直接呼び出せないので、releaseDistributedLockを通してテスト
      const lockInfo = {
        lockKey: 'database_lock:test',
        lockValue: JSON.stringify({ lockId: 'valid-lock-123', timestamp: Date.now() })
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalled();
    });

    it('lockKeyに不正な文字が含まれる場合はエラーになる', async () => {
      const lockInfo = {
        lockKey: 'invalid\x00key',
        lockValue: JSON.stringify({ lockId: 'valid-lock-123', timestamp: Date.now() })
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('lockValueに不正な文字が含まれる場合はエラーになる', async () => {
      const lockInfo = {
        lockKey: 'valid-key',
        lockValue: 'invalid\x01value'
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('lockKeyが"null"文字列の場合はエラーになる', async () => {
      const lockInfo = {
        lockKey: 'null',
        lockValue: JSON.stringify({ lockId: 'valid-lock-123', timestamp: Date.now() })
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('lockValueが"undefined"文字列の場合はエラーになる', async () => {
      const lockInfo = {
        lockKey: 'valid-key',
        lockValue: 'undefined'
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('有効な文字セットは許可される', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      const lockInfo = {
        lockKey: 'database_lock:test-123.key',
        lockValue: JSON.stringify({ lockId: 'lock-id_123.456', timestamp: Date.now() })
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalled();
    });

    it('JSONを含むlockValueは正常に処理される', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      const lockInfo = {
        lockKey: 'database_lock:test',
        lockValue: JSON.stringify({ 
          lockId: 'test-123', 
          timestamp: Date.now(), 
          processId: 1234 
        })
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalled();
    });

    it('Redis evalが例外を投げた場合は適切にハンドリングされる', async () => {
      mockRedisClient.eval.mockRejectedValue(new Error('Redis connection lost'));
      
      const lockInfo = {
        lockKey: 'valid-key',
        lockValue: JSON.stringify({ lockId: 'valid-lock-123', timestamp: Date.now() })
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(false);
    });

    it('引数検証でエラーが発生した場合は詳細なログが出力される', async () => {
      const Logger = require('../../../src/hft/utils/Logger');
      const mockLogger = new Logger();
      
      const lockInfo = {
        lockKey: 'invalid@key',
        lockValue: 'valid-value'
      };
      
      await manager.releaseDistributedLock(lockInfo);
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Database Manager Redis eval引数検証エラー')
      );
    });

    it('空文字列のlockKeyは早期にチェックされる', async () => {
      const lockInfo = {
        lockKey: '',
        lockValue: 'valid-value'
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('空文字列のlockValueは早期にチェックされる', async () => {
      const lockInfo = {
        lockKey: 'valid-key',
        lockValue: ''
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('Redis evalが0を返した場合（ロック解放失敗）は false を返す', async () => {
      mockRedisClient.eval.mockResolvedValue(0);
      
      const lockInfo = {
        lockKey: 'valid-key',
        lockValue: JSON.stringify({ lockId: 'valid-lock-123', timestamp: Date.now() })
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).toHaveBeenCalled();
    });
  });

  describe('エラーケースの網羅的テスト', () => {
    const invalidCases = [
      { 
        lockKey: 'key with spaces', 
        lockValue: 'valid-value', 
        description: 'lockKeyにスペース' 
      },
      { 
        lockKey: 'valid-key', 
        lockValue: 'value with spaces', 
        description: 'lockValueにスペース' 
      },
      { 
        lockKey: 'key\twithtab', 
        lockValue: 'valid-value', 
        description: 'lockKeyにタブ' 
      },
      { 
        lockKey: 'valid-key', 
        lockValue: 'value\nwithnewline', 
        description: 'lockValueに改行' 
      },
      { 
        lockKey: 'key@invalid', 
        lockValue: 'valid-value', 
        description: 'lockKeyに@記号' 
      },
      { 
        lockKey: 'valid-key', 
        lockValue: 'value#invalid', 
        description: 'lockValueに#記号' 
      }
    ];

    invalidCases.forEach(({ lockKey, lockValue, description }) => {
      it(`${description}の場合はエラーになる`, async () => {
        const lockInfo = { lockKey, lockValue };
        const result = await manager.releaseDistributedLock(lockInfo);
        
        expect(result).toBe(false);
        expect(mockRedisClient.eval).not.toHaveBeenCalled();
      });
    });
  });
});