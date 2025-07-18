/**
 * Database Manager Issue #2689 テスト
 * Redis分散ロック解放時のeval引数の明示的文字列変換修正のテスト
 */

// Mock dependencies
jest.mock('../../../src/database/redisDatabase', () => ({
  getClient: jest.fn()
}));

jest.mock('../../../src/common/utils', () => ({
  validateLockParameters: jest.fn()
}));

jest.mock('../../../src/hft/utils/Logger', () => {
  return jest.fn().mockImplementation(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
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

describe('Database Manager Issue #2689: Redis eval引数の明示的文字列変換修正', () => {
  let manager;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisDatabase.getClient.mockReturnValue(mockRedisClient);
    mockUtils.validateLockParameters.mockReturnValue({ valid: true });
    manager = require('../../../src/database/manager');
  });

  describe('releaseDistributedLock - Redis eval引数の文字列変換', () => {
    it('Redis eval呼び出し時に引数がString()で明示的に文字列変換される', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      const lockInfo = {
        lockKey: 'lock:trade:bitbank:BTC/JPY:test123',
        lockValue: '1642678800000_abc123def'
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String), // Luaスクリプト
        1, // キー数
        'lock:trade:bitbank:BTC/JPY:test123', // 第1引数（lockKey）
        '1642678800000_abc123def' // 第2引数（lockValue）
      );
    });

    it('数値型のlockKeyやlockValueも文字列として渡される', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      const lockInfo = {
        lockKey: 12345,
        lockValue: 67890
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        '12345', // 数値が文字列に変換される
        '67890' // 数値が文字列に変換される
      );
    });

    it('boolean型の値も文字列として渡される', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      const lockInfo = {
        lockKey: true,
        lockValue: false
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'true', // booleanが文字列に変換される
        'false' // booleanが文字列に変換される
      );
    });

    it('lockInfoがnull/undefinedの場合は早期リターンしてRedis呼び出しが行われない', async () => {
      const resultNull = await manager.releaseDistributedLock(null);
      const resultUndefined = await manager.releaseDistributedLock(undefined);
      
      expect(resultNull).toBe(false);
      expect(resultUndefined).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('validateLockParametersが無効を返す場合は早期リターンしてRedis呼び出しが行われない', async () => {
      mockUtils.validateLockParameters.mockReturnValue({ 
        valid: false, 
        error: 'Invalid lock parameters' 
      });
      
      const lockInfo = {
        lockKey: 'test-key',
        lockValue: 'test-value'
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });

    it('Redis eval引数型エラーが発生した場合はfalseを返す', async () => {
      mockRedisClient.eval.mockRejectedValue(
        new Error('ERR Lua redis lib command arguments must be strings or integers script: b24323b7762549a5bd9e3ab035fdbcf4f153e748, on @user_script:2.')
      );
      
      const lockInfo = {
        lockKey: 'lock:trade:bitbank:BTC/JPY:test123',
        lockValue: '1642678800000_abc123def'
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(false);
    });

    it('Redis evalが0を返す場合（ロック解放失敗）はfalseを返す', async () => {
      mockRedisClient.eval.mockResolvedValue(0);
      
      const lockInfo = {
        lockKey: 'lock:trade:bitbank:BTC/JPY:test123',
        lockValue: '1642678800000_abc123def'
      };
      
      const result = await manager.releaseDistributedLock(lockInfo);
      
      expect(result).toBe(false);
    });
  });

  describe('acquireDistributedLock - lockInfo構造の一貫性', () => {
    it('取得されるlockInfoのlockKeyとlockValueが文字列であることを確認', async () => {
      mockRedisClient.set.mockResolvedValue('OK');
      
      const lockInfo = await manager.acquireDistributedLock('bitbank', 'BTC/JPY', 'test123');
      
      expect(lockInfo.acquired).toBe(true);
      expect(typeof lockInfo.lockKey).toBe('string');
      expect(typeof lockInfo.lockValue).toBe('string');
      expect(lockInfo.lockKey).toMatch(/^lock:trade:bitbank:BTC\/JPY:test123$/);
      expect(lockInfo.lockValue).toMatch(/^\d+_[\d.]+$/);
    });
  });
});