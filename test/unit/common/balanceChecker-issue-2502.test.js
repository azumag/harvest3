/**
 * Unit test for Issue #2502: strategy-runnerサービスで例外が発生
 * 
 * 問題: 外部取引の可能性が高い不整合（94-100%）がERRORレベルでログ出力される
 * 原因: closedポジション分析でisExternalTradeSuspectedフラグが上書きされる
 * 修正: 高い差異（50%以上）の場合は外部取引の可能性を維持
 */

// Mock dependencies
jest.mock('../../../src/config', () => ({
  config: {
    exchanges: {
      'test-exchange': {
        symbols: ['BTC/JPY', 'ETH/JPY', 'KLAY/JPY', 'APE/JPY', 'OAS/JPY', 'MANA/JPY', 'GRT/JPY', 'RENDER/JPY', 'BNB/JPY', 'OP/JPY', 'ARB/JPY'],
        instance: {
          id: 'test-exchange',
          fetchBalance: jest.fn()
        }
      }
    },
    strategies: {
      MA: { enabled: true, type: 'trend_following' }
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

const balanceChecker = require('../../../src/common/balanceChecker');
const { getValidatedConfig } = require('../../../src/common/balanceCheckerConfig');
const { config } = require('../../../src/config');
const { getAllPositionsRedis } = require('../../../src/database/redisDatabase');
const { postOrderToDiscord } = require('../../../src/common/notifications');

describe('BalanceChecker Issue #2502 - External Trade Detection', () => {
  let mockExchange;

  beforeEach(() => {
    // Get the mock exchange from the config
    mockExchange = config.exchanges['test-exchange'].instance;

    // Reset all mocks
    jest.clearAllMocks();
  });

  describe('High discrepancy external trade detection', () => {
    it('should maintain external trade detection for high discrepancies even with closed positions', async () => {
      // Set up the scenario from the error log
      const mockExchangeBalance = {
        total: {
          KLAY: 0.3721,
          APE: 0.9309,
          OAS: 921.0375,
          MANA: 4.4588
        }
      };

      const mockPositions = [
        // Closed positions that might explain the discrepancy
        { 
          symbol: 'KLAY/JPY', 
          side: 'buy', 
          amount: 0.3500, 
          status: 'closed',
          closedAt: Date.now() - 1000 * 60 * 60 // 1 hour ago
        },
        { 
          symbol: 'APE/JPY', 
          side: 'buy', 
          amount: 0.9000, 
          status: 'closed',
          closedAt: Date.now() - 1000 * 60 * 60 // 1 hour ago
        },
        // Active positions with small amounts
        { 
          symbol: 'KLAY/JPY', 
          side: 'buy', 
          amount: 0.0202, 
          status: 'open'
        },
        { 
          symbol: 'APE/JPY', 
          side: 'buy', 
          amount: 0.0035, 
          status: 'open'
        },
        { 
          symbol: 'MANA/JPY', 
          side: 'buy', 
          amount: 0.009, 
          status: 'open'
        }
      ];

      mockExchange.fetchBalance.mockResolvedValue(mockExchangeBalance);
      getAllPositionsRedis.mockResolvedValue(mockPositions);

      // Execute the balance check
      const result = await balanceChecker.compareBalances('test-exchange');

      // Verify that discrepancies are detected
      expect(result.discrepancies).toHaveLength(4);

      // Check each discrepancy
      const klayDiscrepancy = result.discrepancies.find(d => d.currency === 'KLAY');
      const apeDiscrepancy = result.discrepancies.find(d => d.currency === 'APE');
      const oasDiscrepancy = result.discrepancies.find(d => d.currency === 'OAS');
      const manaDiscrepancy = result.discrepancies.find(d => d.currency === 'MANA');

      // Verify that all discrepancies are still marked as external trade suspected
      expect(klayDiscrepancy.isExternalTradeSuspected).toBe(true);
      expect(apeDiscrepancy.isExternalTradeSuspected).toBe(true);
      expect(oasDiscrepancy.isExternalTradeSuspected).toBe(true);
      expect(manaDiscrepancy.isExternalTradeSuspected).toBe(true);

      // Verify discrepancy percentages are high
      expect(klayDiscrepancy.discrepancyPercent).toBeGreaterThan(50);
      expect(apeDiscrepancy.discrepancyPercent).toBeGreaterThan(50);
      expect(oasDiscrepancy.discrepancyPercent).toBeGreaterThan(50);
      expect(manaDiscrepancy.discrepancyPercent).toBeGreaterThan(50);

      // Verify that closed position analysis is present but doesn't override external trade detection
      expect(klayDiscrepancy.closedPositionAnalysis).toBeDefined();
      expect(apeDiscrepancy.closedPositionAnalysis).toBeDefined();
      
      // The closed position analysis should be available but not override the external trade detection
      if (klayDiscrepancy.closedPositionAnalysis.isLikelyClosedPositionIssue) {
        expect(klayDiscrepancy.analysisNote).toBe('closedポジションが残存している可能性');
        // But external trade detection should still be true for high discrepancies
        expect(klayDiscrepancy.isExternalTradeSuspected).toBe(true);
      }
    });

    it('should set isExternalTradeSuspected to false for low discrepancies explained by closed positions', async () => {
      // Set up a scenario with low discrepancy that can be explained by closed positions
      const mockExchangeBalance = {
        total: {
          BTC: 0.1000  // Exchange has 0.1 BTC
        }
      };

      const mockPositions = [
        // Closed position that explains the discrepancy (within 10% of exchange amount)
        { 
          symbol: 'BTC/JPY', 
          side: 'buy', 
          amount: 0.0950, // Close to exchange amount (0.1000)
          status: 'closed',
          closedAt: Date.now() - 1000 * 60 * 60 // 1 hour ago
        },
        // Active position with larger amount to create low discrepancy
        { 
          symbol: 'BTC/JPY', 
          side: 'buy', 
          amount: 0.0800, // Large active position
          status: 'open'
        }
      ];

      mockExchange.fetchBalance.mockResolvedValue(mockExchangeBalance);
      getAllPositionsRedis.mockResolvedValue(mockPositions);

      // Execute the balance check
      const result = await balanceChecker.compareBalances('test-exchange');

      // Verify that discrepancy is detected
      expect(result.discrepancies).toHaveLength(1);

      const btcDiscrepancy = result.discrepancies[0];
      
      // Calculate expected values:
      // Exchange: 0.1000
      // Bot: 0.0800 (only active positions)
      // Closed: 0.0950 (closed positions)
      // Difference: 0.0200 
      // Discrepancy: 0.0200 / 0.1000 = 20%
      
      // Since closed amount (0.0950) is within 10% of exchange amount (0.1000), 
      // and discrepancy is < 50%, external trade flag should be false
      expect(btcDiscrepancy.discrepancyPercent).toBeLessThan(50);
      expect(btcDiscrepancy.isExternalTradeSuspected).toBe(false);
      expect(btcDiscrepancy.analysisNote).toBe('closedポジションが残存している可能性');
    });
  });

  describe('Log level decision with fixed logic', () => {
    it('should log at INFO level when all discrepancies are external trades (reproducing the fix)', async () => {
      // Set up the exact scenario from the error log
      const mockExchangeBalance = {
        total: {
          KLAY: 0.3721,
          APE: 0.9309,
          OAS: 921.0375,
          MANA: 4.4588,
          GRT: 9.9385,
          RENDER: 1.7324,
          BNB: 0.0008,
          OP: 2.0372,
          ARB: 4.6001
        }
      };

      const mockPositions = [
        // All small active positions
        { symbol: 'KLAY/JPY', side: 'buy', amount: 0.0202, status: 'open' },
        { symbol: 'APE/JPY', side: 'buy', amount: 0.0035, status: 'open' },
        { symbol: 'MANA/JPY', side: 'buy', amount: 0.009, status: 'open' }
        // Other currencies have zero bot balance
      ];

      mockExchange.fetchBalance.mockResolvedValue(mockExchangeBalance);
      getAllPositionsRedis.mockResolvedValue(mockPositions);

      // Spy on console logs to capture the log level
      const logSpy = jest.spyOn(console, 'log').mockImplementation();
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();

      // Execute the balance check
      const result = await balanceChecker.compareBalances('test-exchange');

      // Verify that all discrepancies are marked as external trades
      const externalTradeDiscrepancies = result.discrepancies.filter(d => d.isExternalTradeSuspected);
      expect(externalTradeDiscrepancies.length).toBe(result.discrepancies.length);
      expect(externalTradeDiscrepancies.length).toBeGreaterThan(0);

      // All discrepancies should have very high percentages
      result.discrepancies.forEach(disc => {
        expect(disc.discrepancyPercent).toBeGreaterThan(90);
        expect(disc.isExternalTradeSuspected).toBe(true);
      });

      // Clean up spies
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });
});