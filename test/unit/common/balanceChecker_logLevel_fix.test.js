/**
 * Issue #1108: 残高不整合ログレベル修正のテスト
 * 不整合の程度に応じてログレベルを適切に調整する機能のテスト
 */

// Mock dependencies
jest.mock('../../../src/config', () => ({
  config: {
    exchanges: {
      bitbank: {
        symbols: ['BTC/JPY', 'ETH/JPY', 'SAND/JPY'],
        instance: {
          id: 'bitbank',
          fetchBalance: jest.fn()
        }
      }
    },
    strategies: {
      MA: { enabled: true, type: 'trend_following' },
      BOLLINGER_BANDS: { enabled: true, type: 'mean_reversion' }
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
  getAllPositionsRedis: jest.fn(),
  getAllTradeSummaries: jest.fn()
}));

jest.mock('../../../src/database/manager', () => ({
  getTradeCurrentPosition: jest.fn()
}));

jest.mock('../../../src/database/redisClient', () => ({
  initRedisClient: jest.fn(() => ({
    isReady: true,
    set: jest.fn(),
    get: jest.fn(),
    eval: jest.fn()
  }))
}));

jest.mock('../../../src/common/balanceCheckerConfig', () => ({
  getValidatedConfig: jest.fn(() => ({
    thresholds: {
      significantBalance: 0.0001,
      highDiscrepancyPercent: 10  // 10%を高度不整合の閾値として設定
    },
    intervals: {
      exchangeCheckDelay: 1000
    },
    distributedLock: {
      stateKey: 'balance_checker_state',
      lockKeyPrefix: 'balance_checker_lock',
      defaultTtl: 300000
    },
    notifications: {
      maxCurrenciesToShow: 5,
      maxInconsistenciesToShow: 3
    }
  }))
}));

jest.mock('../../../src/common/bitbankErrorHandler', () => ({
  withBitbankErrorHandling: jest.fn((fn) => fn())
}));

jest.mock('../../../src/common/strategyUtils', () => ({
  getBalanceCheckEligibleStrategies: jest.fn(() => ['MA', 'BOLLINGER_BANDS'])
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

const { compareBalances } = require('../../../src/common/balanceChecker');
const { config } = require('../../../src/config');
const { getAllPositionsRedis } = require('../../../src/database/redisDatabase');
const { postOrderToDiscord } = require('../../../src/common/notifications');

describe('Issue #1108: 残高不整合ログレベル修正のテスト', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    postOrderToDiscord.mockResolvedValue();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('軽微な不整合（10%未満）', () => {
    it('軽微な不整合は WARN レベルで出力される', async () => {
      // 軽微な不整合（5%の差異）を設定
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: { BTC: 1.0, ETH: 10.0 }
      });

      getAllPositionsRedis.mockResolvedValue([
        {
          exchange: 'bitbank',
          symbol: 'BTC/JPY',
          side: 'buy',
          amount: 0.95, // 5%の差異
          status: 'open'
        },
        {
          exchange: 'bitbank',
          symbol: 'ETH/JPY',
          side: 'buy',
          amount: 9.2, // 8%の差異
          status: 'open'
        }
      ]);

      const result = await compareBalances('bitbank');

      // 2件の不整合が検出されることを確認
      expect(result.discrepancies).toHaveLength(2);
      
      // 軽微な不整合として WARN レベルで出力されることを確認
      expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
        expect.stringContaining('軽微な残高不整合検出: bitbank (2件の軽微な不整合)')
      );
      
      // 各不整合が WARN レベルで出力されることを確認
      expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
        expect.stringMatching(/BTC: 取引所=1, Bot=0\.95, 差異=0\.05\d* \(5%\)/)
      );
      expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
        expect.stringMatching(/ETH: 取引所=10, Bot=9\.2, 差異=0\.8\d* \(8%\)/)
      );
      
      // ERROR レベルでは出力されていないことを確認
      expect(mockLoggerInstance.error).not.toHaveBeenCalledWith(
        expect.stringContaining('残高不整合検出: bitbank')
      );
    });
  });

  describe('高度不整合（10%以上）', () => {
    it('高度不整合は ERROR レベルで出力される', async () => {
      // 高度不整合（99.98%の差異）を設定 - Issue #1108の実際のケース
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: { SAND: 16.288, BTC: 1.0 }
      });

      getAllPositionsRedis.mockResolvedValue([
        {
          exchange: 'bitbank',
          symbol: 'SAND/JPY',
          side: 'buy',
          amount: 0.0032, // 99.98%の差異
          status: 'open'
        },
        {
          exchange: 'bitbank',
          symbol: 'BTC/JPY',
          side: 'buy',
          amount: 0.5, // 50%の差異
          status: 'open'
        }
      ]);

      const result = await compareBalances('bitbank');

      // 2件の不整合が検出されることを確認
      expect(result.discrepancies).toHaveLength(2);
      
      // 高度不整合として ERROR レベルで出力されることを確認
      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        expect.stringContaining('残高不整合検出: bitbank (2件の不整合、うち2件が高度不整合)')
      );
      
      // 各高度不整合が ERROR レベルで出力されることを確認
      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        expect.stringContaining('SAND: 取引所=16.288, Bot=0.0032, 差異=16.2848 (99.98%)')
      );
      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        expect.stringContaining('BTC: 取引所=1, Bot=0.5, 差異=0.5 (50%)')
      );
    });
  });

  describe('混合ケース（軽微と高度両方）', () => {
    it('軽微と高度の不整合が混在する場合、適切にログレベルが分離される', async () => {
      // 軽微な不整合と高度不整合の混在
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: { BTC: 1.0, ETH: 10.0, SAND: 16.288 }
      });

      getAllPositionsRedis.mockResolvedValue([
        {
          exchange: 'bitbank',
          symbol: 'BTC/JPY',
          side: 'buy',
          amount: 0.95, // 5%の差異（軽微）
          status: 'open'
        },
        {
          exchange: 'bitbank',
          symbol: 'ETH/JPY',
          side: 'buy',
          amount: 6.0, // 40%の差異（高度）
          status: 'open'
        },
        {
          exchange: 'bitbank',
          symbol: 'SAND/JPY',
          side: 'buy',
          amount: 0.0032, // 99.98%の差異（高度）
          status: 'open'
        }
      ]);

      const result = await compareBalances('bitbank');

      // 3件の不整合が検出されることを確認
      expect(result.discrepancies).toHaveLength(3);
      
      // 高度不整合として ERROR レベルで出力されることを確認
      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        expect.stringContaining('残高不整合検出: bitbank (3件の不整合、うち2件が高度不整合)')
      );
      
      // 高度不整合が ERROR レベルで出力されることを確認
      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        expect.stringContaining('ETH: 取引所=10, Bot=6, 差異=4 (40%)')
      );
      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        expect.stringContaining('SAND: 取引所=16.288, Bot=0.0032, 差異=16.2848 (99.98%)')
      );
      
      // 軽微な不整合が WARN レベルで出力されることを確認
      expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
        expect.stringContaining('軽微な不整合 (10%未満):')
      );
      expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
        expect.stringMatching(/BTC: 取引所=1, Bot=0\.95, 差異=0\.05\d* \(5%\)/)
      );
    });
  });

  describe('境界値テスト', () => {
    it('ちょうど10%の不整合は高度不整合として扱われる', async () => {
      // ちょうど10%の不整合
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: { BTC: 1.0 }
      });

      getAllPositionsRedis.mockResolvedValue([
        {
          exchange: 'bitbank',
          symbol: 'BTC/JPY',
          side: 'buy',
          amount: 0.9, // 10%の差異
          status: 'open'
        }
      ]);

      const result = await compareBalances('bitbank');

      // 1件の不整合が検出されることを確認
      expect(result.discrepancies).toHaveLength(1);
      
      // 高度不整合として ERROR レベルで出力されることを確認
      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        expect.stringContaining('残高不整合検出: bitbank (1件の不整合、うち1件が高度不整合)')
      );
      
      // WARN レベルでは出力されていないことを確認
      expect(mockLoggerInstance.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('軽微な残高不整合検出')
      );
    });

    it('9.9%の不整合は軽微として扱われる', async () => {
      // 9.9%の不整合
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: { BTC: 1.0 }
      });

      getAllPositionsRedis.mockResolvedValue([
        {
          exchange: 'bitbank',
          symbol: 'BTC/JPY',
          side: 'buy',
          amount: 0.901, // 9.9%の差異
          status: 'open'
        }
      ]);

      const result = await compareBalances('bitbank');

      // 1件の不整合が検出されることを確認
      expect(result.discrepancies).toHaveLength(1);
      
      // 軽微な不整合として WARN レベルで出力されることを確認
      expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
        expect.stringContaining('軽微な残高不整合検出: bitbank (1件の軽微な不整合)')
      );
      
      // ERROR レベルでは出力されていないことを確認
      expect(mockLoggerInstance.error).not.toHaveBeenCalledWith(
        expect.stringContaining('残高不整合検出: bitbank')
      );
    });
  });

  describe('既存機能との互換性確認', () => {
    it('残高一致時は従来通り INFO レベルで出力される', async () => {
      // 一致する残高
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: { BTC: 1.0 }
      });

      getAllPositionsRedis.mockResolvedValue([
        {
          exchange: 'bitbank',
          symbol: 'BTC/JPY',
          side: 'buy',
          amount: 1.0, // 完全一致
          status: 'open'
        }
      ]);

      const result = await compareBalances('bitbank');

      // 不整合が検出されないことを確認
      expect(result.discrepancies).toHaveLength(0);
      expect(result.isHealthy).toBe(true);
      
      // INFO レベルで正常メッセージが出力されることを確認
      expect(mockLoggerInstance.info).toHaveBeenCalledWith('残高チェック正常: bitbank');
      
      // ERROR や WARN レベルでは出力されていないことを確認
      expect(mockLoggerInstance.error).not.toHaveBeenCalledWith(
        expect.stringContaining('残高不整合検出')
      );
      expect(mockLoggerInstance.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('軽微な残高不整合検出')
      );
    });

    it('Discord通知は従来通り実行される', async () => {
      // 軽微な不整合
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: { BTC: 1.0 }
      });

      getAllPositionsRedis.mockResolvedValue([
        {
          exchange: 'bitbank',
          symbol: 'BTC/JPY',
          side: 'buy',
          amount: 0.95, // 5%の差異
          status: 'open'
        }
      ]);

      await compareBalances('bitbank');

      // Discord通知が実行されることを確認
      expect(postOrderToDiscord).toHaveBeenCalledWith(
        expect.stringContaining('🚨 **残高不整合検出** (bitbank)')
      );
    });
  });
});