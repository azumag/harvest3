/**
 * Database Manager Issue #2625 テスト
 * Redis分散ロック解放時の引数型エラー修正のテスト
 */

// Mock dependencies
jest.mock('../../../src/database/redisDatabase', () => ({
  getClient: jest.fn(),
  isConnected: jest.fn()
}));

jest.mock('../../../src/database/mongoDatabase', () => ({
  connectDB: jest.fn().mockResolvedValue(undefined),
  addTradeMongoDB: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../src/common/utils', () => ({
  timeframeToMs: jest.fn().mockImplementation((timeframe) => {
    const value = parseInt(timeframe);
    const unit = timeframe.slice(value.toString().length);

    switch (unit) {
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    case 'w': return value * 7 * 24 * 60 * 60 * 1000;
    default: throw new Error(`Unknown timeframe unit: ${unit}`);
    }
  })
}));

// Mock logger
jest.mock('../../../src/hft/utils/Logger', () => {
  return function Logger(context) {
    return {
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      context: context
    };
  };
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

describe('Database Manager Issue #2625: Redis分散ロック解放エラー修正', () => {
  let manager;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    manager = require('../../../src/database/manager');
  });

  describe('releaseDistributedLock - 引数型エラー修正', () => {
    it('releaseDistributedLock関数が存在する', () => {
      expect(manager.releaseDistributedLock).toBeDefined();
      expect(typeof manager.releaseDistributedLock).toBe('function');
    });

    it('正常なlockInfoの場合は正常に処理される', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      const lockInfo = {
        lockKey: 'test-lock-key',
        lockValue: 'test-lock-value'
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      console.log('Result:', result);
      console.log('Type:', typeof result);
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'test-lock-key',
        'test-lock-value'
      );
    });

    it('lockInfoがnullの場合はRedis呼び出しを避けてfalseを返す', async () => {
      const result = await manager.releaseDistributedLock(null);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('lockInfoがundefinedの場合はRedis呼び出しを避けてfalseを返す', async () => {
      const result = await manager.releaseDistributedLock(undefined);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('lockInfoが文字列の場合はRedis呼び出しを避けてfalseを返す', async () => {
      const result = await manager.releaseDistributedLock('invalid-lock-info');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('lockInfoが空のオブジェクトの場合はRedis呼び出しを避けてfalseを返す', async () => {
      const result = await manager.releaseDistributedLock({});
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('lockKeyがnullの場合はRedis呼び出しを避けてfalseを返す', async () => {
      const lockInfo = {
        lockKey: null,
        lockValue: 'test-lock-value'
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('lockValueがnullの場合はRedis呼び出しを避けてfalseを返す', async () => {
      const lockInfo = {
        lockKey: 'test-lock-key',
        lockValue: null
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('lockKeyがundefinedの場合はRedis呼び出しを避けてfalseを返す', async () => {
      const lockInfo = {
        lockKey: undefined,
        lockValue: 'test-lock-value'
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('lockValueがundefinedの場合はRedis呼び出しを避けてfalseを返す', async () => {
      const lockInfo = {
        lockKey: 'test-lock-key',
        lockValue: undefined
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('lockKeyが空文字列の場合はRedis呼び出しを避けてfalseを返す', async () => {
      const lockInfo = {
        lockKey: '',
        lockValue: 'test-lock-value'
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('lockValueが空文字列の場合はRedis呼び出しを避けてfalseを返す', async () => {
      const lockInfo = {
        lockKey: 'test-lock-key',
        lockValue: ''
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('引数が文字列として明示的にRedisに渡される', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      const lockInfo = {
        lockKey: 123,  // 数値
        lockValue: true  // ブール値
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        '123',  // String(lockInfo.lockKey)
        'true'  // String(lockInfo.lockValue)
      );
    });

    it('Redis エラーが発生した場合はfalseを返す', async () => {
      mockRedisClient.eval.mockRejectedValue(new Error('Redis connection error'));
      
      const lockInfo = {
        lockKey: 'test-lock-key',
        lockValue: 'test-lock-value'
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(false);
    });

    it('Lua スクリプトが0を返した場合はfalseを返す', async () => {
      mockRedisClient.eval.mockResolvedValue(0);
      
      const lockInfo = {
        lockKey: 'test-lock-key',
        lockValue: 'test-lock-value'
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(false);
    });
  });
});