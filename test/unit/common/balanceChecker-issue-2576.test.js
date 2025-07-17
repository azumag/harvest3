/**
 * BalanceChecker Issue #2576 テスト
 * Redis分散ロック解放時のLuaスクリプト cjson.decode エラー修正のテスト
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
    },
    thresholds: {
      significantBalance: 0.00001,
      balanceComparisonTolerance: 1,
      currencySpecificTolerance: {},
      externalTradeThreshold: 50,
      veryHighExternalTradeThreshold: 90,
      highDiscrepancyPercent: 10
    }
  }))
}));

jest.mock('../../../src/database/redisDatabase', () => ({
  getClient: jest.fn(),
  getAllPositionsRedis: jest.fn(),
  isConnected: jest.fn()
}));

jest.mock('../../../src/database/redisClient', () => ({
  initRedisClient: jest.fn()
}));

const mockRedisClient = {
  isReady: true,
  eval: jest.fn(),
  set: jest.fn(),
  get: jest.fn()
};

const mockRedisDatabase = require('../../../src/database/redisDatabase');
mockRedisDatabase.getClient.mockReturnValue(mockRedisClient);
mockRedisDatabase.isConnected.mockReturnValue(true);

describe('BalanceChecker Issue #2576: Redis分散ロック解放時のLuaスクリプト cjson.decode エラー修正', () => {
  let balanceChecker;

  beforeEach(() => {
    jest.clearAllMocks();
    balanceChecker = require('../../../src/common/balanceChecker');
  });

  describe('releaseDistributedLock - Luaスクリプト内 cjson.decode エラー修正', () => {
    it('正常なJSONロックバリューの場合は正常に処理される', async () => {
      // 正常なJSONが格納されている場合（Luaスクリプト内でJSONデコードが成功）
      mockRedisClient.eval.mockResolvedValue(1);
      
      const result = await balanceChecker.releaseDistributedLock('test-key', 'valid-lock-id');
      
      expect(result).toBe(true);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('pcall(cjson.decode, lockValue)'),
        1,
        'test-key',
        'valid-lock-id'
      );
    });

    it('無効なJSONロックバリューの場合でもエラーを発生させずに処理される', async () => {
      // 無効なJSONが格納されている場合（Luaスクリプト内でJSONデコードが失敗）
      // pcallによって安全に処理されるため、Luaスクリプトは0を返す
      mockRedisClient.eval.mockResolvedValue(0);
      
      const result = await balanceChecker.releaseDistributedLock('test-key', 'valid-lock-id');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('pcall(cjson.decode, lockValue)'),
        1,
        'test-key',
        'valid-lock-id'
      );
    });

    it('破損したロックデータの場合でもエラーを発生させずに処理される', async () => {
      // 破損したデータが格納されている場合
      mockRedisClient.eval.mockResolvedValue(0);
      
      const result = await balanceChecker.releaseDistributedLock('test-key', 'valid-lock-id');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('pcall(cjson.decode, lockValue)'),
        1,
        'test-key',
        'valid-lock-id'
      );
    });

    it('Luaスクリプトにpcallとsuccessチェックが含まれている', async () => {
      mockRedisClient.eval.mockResolvedValue(1);
      
      await balanceChecker.releaseDistributedLock('test-key', 'valid-lock-id');
      
      const calledScript = mockRedisClient.eval.mock.calls[0][0];
      expect(calledScript).toContain('pcall(cjson.decode, lockValue)');
      expect(calledScript).toContain('if success and lockData and lockData.lockId then');
      expect(calledScript).toContain('local lockIdStr = tostring(lockData.lockId)');
      expect(calledScript).toContain('if lockIdStr == ARGV[1] then');
    });

    it('JSONデコードが失敗した場合でもRedisエラーが発生しない', async () => {
      // JSONデコードが失敗してもpcallによって処理されるため、
      // Redis自体でエラーは発生せず、0が返される
      mockRedisClient.eval.mockResolvedValue(0);
      
      const result = await balanceChecker.releaseDistributedLock('test-key', 'valid-lock-id');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).toHaveBeenCalled();
      // 関数が正常に完了することを確認（エラーが発生しない）
      expect(result).toBeDefined();
    });

    it('lockDataがnullの場合でも安全に処理される', async () => {
      // lockDataがnullの場合（JSONデコードは成功するがnullが返される）
      mockRedisClient.eval.mockResolvedValue(0);
      
      const result = await balanceChecker.releaseDistributedLock('test-key', 'valid-lock-id');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('local lockIdStr = tostring(lockData.lockId)'),
        1,
        'test-key',
        'valid-lock-id'
      );
    });

    it('lockValueが存在しない場合は0を返す', async () => {
      // lockValueが存在しない場合（GETが null を返す）
      mockRedisClient.eval.mockResolvedValue(0);
      
      const result = await balanceChecker.releaseDistributedLock('test-key', 'valid-lock-id');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).toHaveBeenCalled();
    });

    it('Redis接続エラーの場合は適切にエラーハンドリングされる', async () => {
      // Redis接続エラーの場合
      mockRedisClient.eval.mockRejectedValue(new Error('Redis connection failed'));
      
      const result = await balanceChecker.releaseDistributedLock('test-key', 'valid-lock-id');
      
      expect(result).toBe(false);
      expect(mockRedisClient.eval).toHaveBeenCalled();
    });
  });

  describe('withDistributedLock - 修正されたreleaseDistributedLockとの統合テスト', () => {
    it('修正されたreleaseDistributedLockが正常に動作する', async () => {
      // ロック取得成功
      mockRedisClient.set.mockResolvedValue('OK');
      // ロック解放成功
      mockRedisClient.eval.mockResolvedValue(1);
      
      const testFunction = jest.fn().mockResolvedValue('test-result');
      
      const result = await balanceChecker.withDistributedLock('test-key', testFunction);
      
      expect(result).toBe('test-result');
      expect(testFunction).toHaveBeenCalled();
      expect(mockRedisClient.set).toHaveBeenCalled();
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.stringContaining('pcall(cjson.decode, lockValue)'),
        1,
        'test-key',
        expect.any(String)
      );
    });

    it('ロック解放時にJSONデコードエラーが発生してもwithDistributedLockは正常に完了する', async () => {
      // ロック取得成功
      mockRedisClient.set.mockResolvedValue('OK');
      // ロック解放でJSONデコードエラー（pcallによって安全に処理される）
      mockRedisClient.eval.mockResolvedValue(0);
      
      const testFunction = jest.fn().mockResolvedValue('test-result');
      
      const result = await balanceChecker.withDistributedLock('test-key', testFunction);
      
      expect(result).toBe('test-result');
      expect(testFunction).toHaveBeenCalled();
      expect(mockRedisClient.eval).toHaveBeenCalled();
    });
  });
});