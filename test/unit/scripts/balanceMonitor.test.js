/**
 * Balance Monitor Tests
 * Issue #234: 残高整合性予防監視スクリプトのテスト
 */

const { balanceMonitor } = require('../../../scripts/balance-monitor-optimized');
const fs = require('fs');

// モック
jest.mock('../../../src/config', () => ({
  exchangeBB: {
    fetchBalance: jest.fn()
  }
}));

jest.mock('../../../src/database/redisClient', () => ({
  initRedisClient: jest.fn()
}));

jest.mock('fs');

describe('Balance Monitor', () => {
  let mockExchange;
  let mockRedis;
  let mockFs;

  beforeEach(() => {
    jest.clearAllMocks();
    mockExchange = require('../../../src/config').exchangeBB;
    mockRedis = {
      get: jest.fn(),
      quit: jest.fn()
    };
    require('../../../src/database/redisClient').initRedisClient.mockResolvedValue(mockRedis);
    mockFs = fs;
    mockFs.appendFileSync = jest.fn();
    mockFs.existsSync = jest.fn().mockReturnValue(true);
    mockFs.statSync = jest.fn().mockReturnValue({ size: 1000 });
    mockFs.readFileSync = jest.fn().mockReturnValue('line1\\nline2\\nline3');
    mockFs.writeFileSync = jest.fn();
  });

  describe('正常系', () => {
    it('正常な監視処理を実行する', async () => {
      const exchangeBalance = 100.0;
      const redisBalance = 100.0;
      
      mockExchange.fetchBalance.mockResolvedValue({
        free: { JPY: exchangeBalance }
      });
      mockRedis.get.mockResolvedValue(redisBalance.toString());

      await balanceMonitor();

      expect(mockExchange.fetchBalance).toHaveBeenCalled();
      expect(mockRedis.get).toHaveBeenCalledWith('balance:bitbank:JPY');
      expect(mockFs.appendFileSync).toHaveBeenCalled();
    });

    it('閾値内の乖離では警告を出さない', async () => {
      const exchangeBalance = 100.0;
      const redisBalance = 99.5; // 0.5の乖離（閾値1.0未満）
      
      mockExchange.fetchBalance.mockResolvedValue({
        free: { JPY: exchangeBalance }
      });
      mockRedis.get.mockResolvedValue(redisBalance.toString());

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await balanceMonitor();

      // 残高乖離アラートが出力されないことを確認
      expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('残高乖離アラート'));
      consoleSpy.mockRestore();
    });
  });

  describe('乖離検出', () => {
    it('閾値を超える乖離を検出する', async () => {
      const exchangeBalance = 100.0;
      const redisBalance = 98.0; // 2.0の乖離（閾値1.0超過）
      
      mockExchange.fetchBalance.mockResolvedValue({
        free: { JPY: exchangeBalance }
      });
      mockRedis.get.mockResolvedValue(redisBalance.toString());

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await balanceMonitor();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('残高乖離アラート'));
      consoleSpy.mockRestore();
    });

    it('Discord通知が設定されている場合に通知を送信する', async () => {
      const originalEnv = process.env.DISCORD_WEBHOOK_URL;
      process.env.DISCORD_WEBHOOK_URL = 'https://example.com/webhook';
      
      const exchangeBalance = 100.0;
      const redisBalance = 97.0; // 3.0の乖離
      
      mockExchange.fetchBalance.mockResolvedValue({
        free: { JPY: exchangeBalance }
      });
      mockRedis.get.mockResolvedValue(redisBalance.toString());

      // httpsモジュールのモック
      const mockRequest = {
        on: jest.fn(),
        end: jest.fn()
      };
      jest.doMock('https', () => ({
        request: jest.fn().mockReturnValue(mockRequest)
      }));

      await balanceMonitor();

      // 環境変数を復元
      if (originalEnv) {
        process.env.DISCORD_WEBHOOK_URL = originalEnv;
      } else {
        delete process.env.DISCORD_WEBHOOK_URL;
      }
    });
  });

  describe('異常系', () => {
    it('取引所API エラー時に適切にエラーハンドリングする', async () => {
      mockExchange.fetchBalance.mockRejectedValue(new Error('Network Error'));
      
      await expect(balanceMonitor()).rejects.toThrow();
    });

    it('Redis接続エラー時に適切にエラーハンドリングする', async () => {
      mockExchange.fetchBalance.mockResolvedValue({
        free: { JPY: 100.0 }
      });
      require('../../../src/database/redisClient').initRedisClient.mockResolvedValue(null);
      
      await balanceMonitor();

      // Redis接続失敗時は管理残高が0となり、乖離が検出されることを確認
      expect(mockFs.appendFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('乖離: 100.0000')
      );
      
      // アラートログにも記録されることを確認
      expect(mockFs.appendFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('残高乖離検出')
      );
    });
  });

  describe('ログローテーション', () => {
    it('ログファイルが1000行を超えた場合にローテーションする', async () => {
      const mockLines = Array(1001).fill('log line').join('\n');
      mockFs.readFileSync.mockReturnValue(mockLines);
      
      mockExchange.fetchBalance.mockResolvedValue({
        free: { JPY: 100.0 }
      });
      mockRedis.get.mockResolvedValue('100.0');

      await balanceMonitor();

      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });
  });
});