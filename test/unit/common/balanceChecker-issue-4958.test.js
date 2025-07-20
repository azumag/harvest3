/**
 * Issue #4958 修正のテスト
 * strategy-runnerサービスでの Redis Lua script の DEL コマンド引数エラーの修正を検証
 * 
 * 修正内容：
 * - Lua script 内で redis.call('DEL', lockKey) → redis.call('DEL', KEYS[1]) に修正
 * - Redis の KEYS と ARGV 配列を正しく使用するように変更
 * - 分散ロック解放処理での引数型エラーを解決
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

describe('Issue #4958: Redis Lua script DEL コマンド引数修正テスト', () => {
  let balanceChecker;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock validateLockParameters to return valid for normal cases
    mockUtils.validateLockParameters.mockReturnValue({ valid: true });
    
    balanceChecker = require('../../../src/common/balanceChecker');
  });

  describe('releaseDistributedLock - Lua script DEL コマンド修正検証', () => {
    it('Lua script が KEYS[1] を使用してロックを削除する', async () => {
      // Redis の lock value を模擬（JSON形式）
      const mockLockValue = JSON.stringify({
        lockId: 'test-lock-id-123',
        acquiredAt: Date.now(),
        ttl: 300000,
        processId: 12345
      });

      // Lua script が正常に実行されてロックが削除されることを模擬
      mockRedisClient.eval.mockResolvedValue(1);
      
      const result = await balanceChecker.releaseDistributedLock(
        'balance_checker_lock:test', 
        'test-lock-id-123'
      );
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.stringContaining("redis.call('DEL', KEYS[1])"),
        1,
        'balance_checker_lock:test',
        'test-lock-id-123'
      );
      
      // Lua script に正しい構文が含まれていることを確認
      const luaScript = mockRedisClient.eval.mock.calls[0][0];
      expect(luaScript).toContain("redis.call('DEL', KEYS[1])");
      expect(luaScript).not.toContain("redis.call('DEL', lockKey)");
    });

    it('Lua script が正しい KEYS と ARGV の使用パターンに従っている', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      await balanceChecker.releaseDistributedLock(
        'test-lock-key', 
        'test-lock-id'
      );
      
      const luaScript = mockRedisClient.eval.mock.calls[0][0];
      
      // KEYS[1] を使用していることを確認
      expect(luaScript).toContain('KEYS[1]');
      
      // ARGV[1] を使用していることを確認  
      expect(luaScript).toContain('ARGV[1]');
      
      // ローカル変数 lockKey ではなく KEYS[1] を redis.call で使用していることを確認
      expect(luaScript).toContain("redis.call('GET', KEYS[1])");
      expect(luaScript).toContain("redis.call('DEL', KEYS[1])");
      
      // 修正前の誤ったパターンが含まれていないことを確認
      expect(luaScript).not.toContain("redis.call('DEL', lockKey)");
    });

    it('Redis eval が引数型エラーを投げない', async () => {
      // Issue #4958 で発生していたエラーのシミュレーション
      // "ERR Lua redis lib command arguments must be strings or integers"
      // このエラーは修正後は発生しないはず
      
      mockRedisClient.eval.mockResolvedValue(1);
      
      const result = await balanceChecker.releaseDistributedLock(
        'balance_checker_lock:strategy_runner',
        '1674123456789-abc123def'
      );
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,  // キーの数
        'balance_checker_lock:strategy_runner',  // KEYS[1]
        '1674123456789-abc123def'  // ARGV[1]
      );
    });

    it('ロックが存在しない場合は 0 を返し false になる', async () => {
      mockRedisClient.eval.mockResolvedValue(0);
      
      const result = await balanceChecker.releaseDistributedLock(
        'nonexistent-lock',
        'some-lock-id'
      );
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).toHaveBeenCalled();
    });

    it('lockId が一致しない場合は 0 を返し false になる', async () => {
      mockRedisClient.eval.mockResolvedValue(0);
      
      const result = await balanceChecker.releaseDistributedLock(
        'valid-lock-key',
        'wrong-lock-id'
      );
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).toHaveBeenCalled();
    });

    it('Redis の接続エラー時は適切にハンドリングされる', async () => {
      mockRedisClient.eval.mockRejectedValue(new Error('Redis connection error'));
      
      const result = await balanceChecker.releaseDistributedLock(
        'test-lock-key',
        'test-lock-id'
      );
      
      expect(result).toBe(false);
    });

    it('複数の分散ロック解放操作が正常に動作する', async () => {
      // 複数のロック解放を順次実行
      mockRedisClient.eval
        .mockResolvedValueOnce(1)  // 1回目成功
        .mockResolvedValueOnce(0)  // 2回目失敗（ロックなし）
        .mockResolvedValueOnce(1); // 3回目成功
      
      const results = await Promise.all([
        balanceChecker.releaseDistributedLock('lock1', 'id1'),
        balanceChecker.releaseDistributedLock('lock2', 'id2'),
        balanceChecker.releaseDistributedLock('lock3', 'id3')
      ]);
      
      expect(results).toEqual([true, false, true]);
      expect(mockRedisClient.eval).toHaveBeenCalledTimes(3);
    });
  });

  describe('Lua script 引数型安全性の検証', () => {
    it('数値の lockId も文字列として処理される', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      const result = await balanceChecker.releaseDistributedLock(
        'test-lock',
        12345  // 数値のlockId
      );
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'test-lock',
        '12345'  // 文字列に変換される
      );
    });

    it('boolean の lockId は文字列として処理される', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      const result = await balanceChecker.releaseDistributedLock(
        'test-lock',
        true  // boolean のlockId
      );
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'test-lock',
        'true'  // 文字列に変換される
      );
    });

    it('null や undefined は早期にチェックされエラーになる', async () => {
      const nullResult = await balanceChecker.releaseDistributedLock('test-lock', null);
      const undefinedResult = await balanceChecker.releaseDistributedLock('test-lock', undefined);
      
      expect(nullResult).toBe(false);
      expect(undefinedResult).toBe(false);
      expect(mockRedisClient.eval).not.toHaveBeenCalled();
    });
  });
});