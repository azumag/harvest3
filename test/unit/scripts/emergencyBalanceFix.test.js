/**
 * Emergency Balance Fix Tests
 * Issue #234: 残高整合性緊急修正スクリプトのテスト
 */

const { emergencyBalanceFix } = require('../../../scripts/emergency-balance-fix-optimized');

// モック
jest.mock('../../../src/config', () => ({
  exchangeBB: {
    fetchBalance: jest.fn()
  }
}));

jest.mock('../../../src/database/redisClient', () => ({
  initRedisClient: jest.fn()
}));

describe('Emergency Balance Fix', () => {
  let mockExchange;
  let mockRedis;

  beforeEach(() => {
    jest.clearAllMocks();
    mockExchange = require('../../../src/config').exchangeBB;
    mockRedis = {
      set: jest.fn(),
      get: jest.fn(),
      quit: jest.fn()
    };
    require('../../../src/database/redisClient').initRedisClient.mockResolvedValue(mockRedis);
  });

  describe('正常系', () => {
    it('残高修正が正常に完了する', async () => {
      const exchangeBalance = 100.0;
      const redisBalance = 100.0;
      
      mockExchange.fetchBalance.mockResolvedValue({
        free: { JPY: exchangeBalance }
      });
      mockRedis.get.mockResolvedValue(redisBalance.toString());
      mockRedis.set.mockResolvedValue('OK');

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await emergencyBalanceFix();

      expect(mockExchange.fetchBalance).toHaveBeenCalled();
      expect(mockRedis.set).toHaveBeenCalledWith('balance:bitbank:JPY', '100');
      expect(consoleSpy).toHaveBeenCalledWith('✅ 残高整合性が正常に修正されました');
      consoleSpy.mockRestore();
    });

    it('乖離がない場合は正常と判定する', async () => {
      const exchangeBalance = 100.0;
      const redisBalance = 100.0;
      
      mockExchange.fetchBalance.mockResolvedValue({
        free: { JPY: exchangeBalance }
      });
      mockRedis.get.mockResolvedValue(redisBalance.toString());
      mockRedis.set.mockResolvedValue('OK');

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await emergencyBalanceFix();

      expect(consoleSpy).toHaveBeenCalledWith('✅ 残高整合性が正常に修正されました');
      consoleSpy.mockRestore();
    });
  });

  describe('異常系', () => {
    it('取引所API エラー時に適切にエラーハンドリングする', async () => {
      mockExchange.fetchBalance.mockRejectedValue(new Error('API Connection Failed'));
      
      await expect(emergencyBalanceFix()).rejects.toThrow();
    });

    it('Redis更新エラー時に適切にエラーハンドリングする', async () => {
      mockExchange.fetchBalance.mockResolvedValue({
        free: { JPY: 100.0 }
      });
      require('../../../src/database/redisClient').initRedisClient.mockResolvedValue(null);
      
      await expect(emergencyBalanceFix()).rejects.toThrow('Redis接続失敗');
    });
  });

  describe('乖離検出', () => {
    it('乖離が存在する場合は警告を表示する', async () => {
      const exchangeBalance = 100.0;
      const redisBalance = 50.0; // 50円の乖離
      
      mockExchange.fetchBalance.mockResolvedValue({
        free: { JPY: exchangeBalance }
      });
      mockRedis.get.mockResolvedValue(redisBalance.toString());
      mockRedis.set.mockResolvedValue('OK');

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await emergencyBalanceFix();

      expect(consoleSpy).toHaveBeenCalledWith('⚠️ 残高乖離が残っています。追加確認が必要です。');
      consoleSpy.mockRestore();
    });
  });
});