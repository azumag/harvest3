/**
 * Emergency Balance Check Tests
 * Issue #234: 残高整合性緊急解決スクリプトのテスト
 */

const { emergencyBalanceCheck } = require('../../../scripts/emergency-balance-check-optimized');

// モック
jest.mock('../../../src/config', () => ({
  exchangeBB: {
    fetchBalance: jest.fn()
  }
}));

jest.mock('../../../src/database/redisClient', () => ({
  initRedisClient: jest.fn()
}));

describe('Emergency Balance Check', () => {
  let mockExchange;
  let mockRedis;

  beforeEach(() => {
    jest.clearAllMocks();
    mockExchange = require('../../../src/config').exchangeBB;
    mockRedis = {
      get: jest.fn(),
      keys: jest.fn(),
      quit: jest.fn()
    };
    require('../../../src/database/redisClient').initRedisClient.mockResolvedValue(mockRedis);
  });

  describe('正常系', () => {
    it('取引所残高とRedis残高を正常に取得できる', async () => {
      mockExchange.fetchBalance.mockResolvedValue({
        free: { JPY: 100.0 },
        total: { JPY: 100.0 }
      });
      mockRedis.get.mockResolvedValue('100.0');
      mockRedis.keys.mockResolvedValue(['position:test:JPY']);

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await emergencyBalanceCheck();

      expect(mockExchange.fetchBalance).toHaveBeenCalled();
      expect(mockRedis.get).toHaveBeenCalledWith('balance:bitbank:JPY');
      expect(consoleSpy).toHaveBeenCalledWith('=== 残高整合性緊急チェック ===');
      consoleSpy.mockRestore();
    });
  });

  describe('異常系', () => {
    it('取引所API エラー時に適切にエラーハンドリングする', async () => {
      mockExchange.fetchBalance.mockRejectedValue(new Error('API Error'));
      
      await expect(emergencyBalanceCheck()).rejects.toThrow();
    });

    it('Redis接続エラー時に適切にエラーハンドリングする', async () => {
      // 取引所は正常に設定
      mockExchange.fetchBalance.mockResolvedValue({
        free: { JPY: 100.0 },
        total: { JPY: 100.0 }
      });
      
      // Redis接続は失敗
      require('../../../src/database/redisClient').initRedisClient.mockResolvedValue(null);
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await emergencyBalanceCheck();

      expect(consoleSpy).toHaveBeenCalledWith('Redis接続失敗');
      consoleSpy.mockRestore();
    });
  });

  describe('エッジケース', () => {
    it('残高がundefinedの場合にデフォルト値を使用する', async () => {
      mockExchange.fetchBalance.mockResolvedValue({
        free: { JPY: undefined },
        total: { JPY: undefined }
      });
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await emergencyBalanceCheck();

      expect(consoleSpy).toHaveBeenCalledWith('bitbank JPY free:', 0);
      expect(consoleSpy).toHaveBeenCalledWith('bitbank JPY total:', 0);
      consoleSpy.mockRestore();
    });
  });
});