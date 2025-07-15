/**
 * Tests for Issue #2033: BalanceChecker tolerance improvements
 * 残高チェッカーの許容誤差改善のテスト
 */

const {
  getValidatedConfig
} = require('../../../src/common/balanceCheckerConfig');

// Mock dependencies
jest.mock('../../../src/config', () => ({
  config: {
    exchanges: {
      bitbank: {
        symbols: ['BTC/JPY', 'ETH/JPY', 'MANA/JPY'],
        instance: {
          id: 'bitbank',
          fetchBalance: jest.fn()
        }
      }
    }
  }
}));

jest.mock('../../../src/common/notifications', () => ({
  postErrorToDiscord: jest.fn(),
  postOrderToDiscord: jest.fn()
}));

jest.mock('../../../src/database/redisDatabase', () => ({
  getClient: jest.fn(() => ({
    set: jest.fn(),
    get: jest.fn(),
    eval: jest.fn(),
    isReady: true
  })),
  getAllPositionsRedis: jest.fn()
}));

jest.mock('../../../src/database/redisClient', () => ({
  initRedisClient: jest.fn(() => ({
    isReady: true,
    set: jest.fn(),
    get: jest.fn(),
    eval: jest.fn()
  }))
}));

jest.mock('../../../src/common/bitbankErrorHandler', () => ({
  withBitbankErrorHandling: jest.fn((fn) => fn())
}));

// Logger のモック
const mockLoggerInstance = {
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
};

jest.mock('../../../src/hft/utils/Logger', () => {
  return jest.fn().mockImplementation(() => mockLoggerInstance);
});

const { config } = require('../../../src/config');
const { postOrderToDiscord } = require('../../../src/common/notifications');
const { getAllPositionsRedis } = require('../../../src/database/redisDatabase');
const { compareBalances } = require('../../../src/common/balanceChecker');

describe('Issue #2033: BalanceChecker許容誤差改善のテスト', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    postOrderToDiscord.mockResolvedValue();
  });

  describe('許容誤差設定のテスト', () => {
    it('1%の許容誤差内では不整合として報告されない', async () => {
      // 1%未満の差異（許容誤差内）
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: { BTC: 1.0 }
      });
      getAllPositionsRedis.mockResolvedValue([
        {
          exchange: 'bitbank',
          symbol: 'BTC/JPY',
          side: 'buy',
          amount: 0.995, // 0.5%の差異
          status: 'open'
        }
      ]);

      const result = await compareBalances('bitbank');

      expect(result.isHealthy).toBe(true);
      expect(result.discrepancies).toHaveLength(0);
      expect(mockLoggerInstance.info).toHaveBeenCalledWith(
        expect.stringContaining('残高チェック正常: bitbank')
      );
    });

    it('許容誤差を超えた場合は不整合として報告される', async () => {
      // 2%の差異（許容誤差1%を超える）
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: { BTC: 1.0 }
      });
      getAllPositionsRedis.mockResolvedValue([
        {
          exchange: 'bitbank',
          symbol: 'BTC/JPY',
          side: 'buy',
          amount: 0.98, // 2%の差異
          status: 'open'
        }
      ]);

      const result = await compareBalances('bitbank');

      expect(result.isHealthy).toBe(false);
      expect(result.discrepancies).toHaveLength(1);
      expect(result.discrepancies[0].discrepancyPercent).toBe(2);
      expect(result.discrepancies[0].tolerancePercent).toBe(1);
    });
  });

  describe('外部取引検出のテスト', () => {
    it('50%以上の差異は外部取引の可能性として報告される', async () => {
      // MANAの実際のケースを再現（99.8%の差異）
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: { MANA: 4.4588 }
      });
      getAllPositionsRedis.mockResolvedValue([
        {
          exchange: 'bitbank',
          symbol: 'MANA/JPY',
          side: 'buy',
          amount: 0.009, // 99.8%の差異
          status: 'open'
        }
      ]);

      const result = await compareBalances('bitbank');

      expect(result.isHealthy).toBe(false);
      expect(result.discrepancies).toHaveLength(1);
      
      const manaDiscrepancy = result.discrepancies[0];
      expect(manaDiscrepancy.currency).toBe('MANA');
      expect(manaDiscrepancy.isExternalTradeSuspected).toBe(true);
      expect(Math.round(manaDiscrepancy.discrepancyPercent)).toBe(100);

      // ログに外部取引の可能性が含まれることを確認
      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        expect.stringMatching(/高度不整合（外部取引の可能性含む）/)
      );
      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        expect.stringMatching(/⚠️外部取引の可能性/)
      );
    });

    it('50%未満の差異は外部取引として報告されない', async () => {
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: { ETH: 1.0 }
      });
      getAllPositionsRedis.mockResolvedValue([
        {
          exchange: 'bitbank',
          symbol: 'ETH/JPY',
          side: 'buy',
          amount: 0.7, // 30%の差異
          status: 'open'
        }
      ]);

      const result = await compareBalances('bitbank');

      expect(result.isHealthy).toBe(false);
      expect(result.discrepancies).toHaveLength(1);
      
      const ethDiscrepancy = result.discrepancies[0];
      expect(ethDiscrepancy.isExternalTradeSuspected).toBe(false);
    });
  });

  describe('ログレベル判定のテスト', () => {
    it('外部取引の可能性がある場合、適切なメッセージが表示される', async () => {
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: { BTC: 1.0, ETH: 1.0 }
      });
      getAllPositionsRedis.mockResolvedValue([
        {
          exchange: 'bitbank',
          symbol: 'BTC/JPY',
          side: 'buy',
          amount: 0.05, // 95%の差異（外部取引の可能性）
          status: 'open'
        },
        {
          exchange: 'bitbank',
          symbol: 'ETH/JPY',
          side: 'buy',
          amount: 0.85, // 15%の差異（高度不整合だが外部取引ではない）
          status: 'open'
        }
      ]);

      const result = await compareBalances('bitbank');

      expect(result.discrepancies).toHaveLength(2);
      expect(result.discrepancies[0].isExternalTradeSuspected).toBe(true);
      expect(result.discrepancies[1].isExternalTradeSuspected).toBe(false);

      // 外部取引の可能性を含む高度不整合として報告されることを確認
      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        expect.stringMatching(/高度不整合（外部取引の可能性含む）/)
      );
    });

    it('軽微な不整合で外部取引の可能性がある場合、適切なメッセージが表示される', async () => {
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: { BTC: 1.0 }
      });
      getAllPositionsRedis.mockResolvedValue([
        {
          exchange: 'bitbank',
          symbol: 'BTC/JPY',
          side: 'buy',
          amount: 0.94, // 6%の差異（軽微で外部取引の可能性は低い）
          status: 'open'
        }
      ]);

      const result = await compareBalances('bitbank');

      expect(result.discrepancies).toHaveLength(1);
      expect(result.discrepancies[0].isExternalTradeSuspected).toBe(false); // 6%なので外部取引の可能性は低い
      expect(result.discrepancies[0].discrepancyPercent).toBe(6);

      // 軽微な不整合として報告されることを確認
      expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
        expect.stringMatching(/軽微な不整合/)
      );
    });
  });

  describe('許容誤差情報の表示テスト', () => {
    it('ログに許容誤差情報が含まれることを確認', async () => {
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: { BTC: 1.0 }
      });
      getAllPositionsRedis.mockResolvedValue([
        {
          exchange: 'bitbank',
          symbol: 'BTC/JPY',
          side: 'buy',
          amount: 0.97, // 3%の差異（許容誤差1%を超える）
          status: 'open'
        }
      ]);

      const result = await compareBalances('bitbank');

      expect(result.discrepancies).toHaveLength(1);
      expect(result.discrepancies[0].tolerancePercent).toBe(1);

      // ログに許容誤差情報が含まれることを確認
      expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
        expect.stringMatching(/\[許容誤差: 1%\]/)
      );
    });
  });

  describe('Discord通知メッセージのテスト', () => {
    it('外部取引の可能性がある場合、適切なDiscordメッセージが生成される', async () => {
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: { MANA: 4.4588 }
      });
      getAllPositionsRedis.mockResolvedValue([
        {
          exchange: 'bitbank',
          symbol: 'MANA/JPY',
          side: 'buy',
          amount: 0.009,
          status: 'open'
        }
      ]);

      await compareBalances('bitbank');

      // Discord通知が呼ばれていることを確認
      expect(postOrderToDiscord).toHaveBeenCalledWith(
        expect.stringMatching(/外部取引が原因の可能性があります/)
      );
      expect(postOrderToDiscord).toHaveBeenCalledWith(
        expect.stringMatching(/⚠️/)
      );
    });
  });
});