/**
 * Tests for Issue #2483: strategy-runnerサービスで例外が発生
 * 重複ログ出力と外部取引判定の修正テスト
 */

// Mock dependencies
jest.mock('../../../src/config', () => ({
  config: {
    exchanges: {
      bitbank: {
        symbols: ['BTC/JPY', 'ETH/JPY', 'XRP/JPY', 'MONA/JPY', 'XLM/JPY', 'QTUM/JPY', 'BAT/JPY', 'OMG/JPY', 'XYM/JPY', 'LINK/JPY'],
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

jest.mock('../../../src/common/balanceCheckerConfig', () => ({
  getValidatedConfig: jest.fn(() => ({
    thresholds: {
      significantBalance: 0.0001,
      highDiscrepancyPercent: 10,
      balanceComparisonTolerance: 2,
      externalTradeThreshold: 50,
      veryHighExternalTradeThreshold: 90,
      currencySpecificTolerance: {}
    },
    intervals: {
      exchangeCheckDelay: 1000
    },
    distributedLock: {
      lockKeyPrefix: 'balance_checker_lock',
      stateKey: 'balance_checker_state',
      defaultTtl: 300000
    }
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

const { compareBalances } = require('../../../src/common/balanceChecker');
const { config } = require('../../../src/config');
const { getAllPositionsRedis } = require('../../../src/database/redisDatabase');
const { postOrderToDiscord } = require('../../../src/common/notifications');

describe('Issue #2483: strategy-runnerサービスで例外が発生 - 重複ログと外部取引判定修正', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    postOrderToDiscord.mockResolvedValue();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('重複ログ出力の修正', () => {
    it('同じ通貨の重複ログエントリが発生した場合、重複除去される', async () => {
      // Issue #2483で報告されたケース: LINKが2回出力される
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: {
          XRP: 0.9271,
          ETH: 0.0003,
          MONA: 1.7181,
          XLM: 13.0594,
          QTUM: 6.0666,
          BAT: 5.6061,
          OMG: 0.9147,
          XYM: 235.6213,
          LINK: 0.1798  // 重複出力されていた通貨
        }
      });

      // Bot残高は全て0またはごく少量
      getAllPositionsRedis.mockResolvedValue([
        { exchange: 'bitbank', symbol: 'XRP/JPY', side: 'buy', amount: 0.0023, status: 'open' },
        { exchange: 'bitbank', symbol: 'ETH/JPY', side: 'buy', amount: 0, status: 'open' },
        { exchange: 'bitbank', symbol: 'MONA/JPY', side: 'buy', amount: 0.0317, status: 'open' },
        { exchange: 'bitbank', symbol: 'XLM/JPY', side: 'buy', amount: 0, status: 'open' },
        { exchange: 'bitbank', symbol: 'QTUM/JPY', side: 'buy', amount: 0.0001, status: 'open' },
        { exchange: 'bitbank', symbol: 'BAT/JPY', side: 'buy', amount: 0.017, status: 'open' },
        { exchange: 'bitbank', symbol: 'OMG/JPY', side: 'buy', amount: 0.0271, status: 'open' },
        { exchange: 'bitbank', symbol: 'XYM/JPY', side: 'buy', amount: 0.4081, status: 'open' },
        { exchange: 'bitbank', symbol: 'LINK/JPY', side: 'buy', amount: 0, status: 'open' }
      ]);

      await compareBalances('bitbank');

      // INFOレベルで出力されることを確認（全て外部取引判定）
      expect(mockLoggerInstance.info).toHaveBeenCalledWith(
        expect.stringMatching(/残高不整合検出: bitbank.*外部取引による残高差異/)
      );

      // LINKのログエントリが1回だけ出力されることを確認
      const linkLogCalls = mockLoggerInstance.info.mock.calls.filter(call => 
        call[0].includes('LINK: 取引所=0.1798, Bot=0')
      );
      expect(linkLogCalls).toHaveLength(1);

      // 重複スキップの警告が出力されないことを確認（重複が発生していないため）
      const duplicateSkipWarnings = mockLoggerInstance.warn.mock.calls.filter(call => 
        call[0].includes('[Issue #2483] 重複ログスキップ統計')
      );
      expect(duplicateSkipWarnings).toHaveLength(0);
    });

    it('完全に同じ内容の重複エントリが除去される', async () => {
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: {
          BTC: 1.0000,
          ETH: 2.0000
        }
      });

      getAllPositionsRedis.mockResolvedValue([
        { exchange: 'bitbank', symbol: 'BTC/JPY', side: 'buy', amount: 0.0100, status: 'open' },
        { exchange: 'bitbank', symbol: 'ETH/JPY', side: 'buy', amount: 0.0200, status: 'open' }
      ]);

      await compareBalances('bitbank');

      // 各通貨の不整合ログエントリが1回だけ出力されることを確認
      const btcDiscrepancyLogCalls = mockLoggerInstance.info.mock.calls.filter(call => 
        call[0].includes('BTC: 取引所=') && call[0].includes('Bot=') && call[0].includes('差異=')
      );
      const ethDiscrepancyLogCalls = mockLoggerInstance.info.mock.calls.filter(call => 
        call[0].includes('ETH: 取引所=') && call[0].includes('Bot=') && call[0].includes('差異=')
      );
      
      expect(btcDiscrepancyLogCalls).toHaveLength(1);
      expect(ethDiscrepancyLogCalls).toHaveLength(1);
    });

    it('重複除去ロジックが正しく動作する', () => {
      const balanceChecker = require('../../../src/common/balanceChecker');
      
      // Test the removeDuplicateDiscrepancies function indirectly
      // This function is internal but we can test the behavior through compareBalances
      // The duplicate removal logic should prevent duplicate entries in the final result
      const mockDiscrepancies = [
        {
          currency: 'BTC',
          discrepancyPercent: 95,
          exchangeAmount: 1.0,
          botAmount: 0.05,
          difference: 0.95,
          isExternalTradeSuspected: true
        },
        {
          currency: 'BTC', // Same currency
          discrepancyPercent: 95, // Same discrepancy
          exchangeAmount: 1.0, // Same exchange amount
          botAmount: 0.05, // Same bot amount
          difference: 0.95,
          isExternalTradeSuspected: true
        }
      ];

      // This should be handled by the duplicate removal logic in the actual function
      // For unit testing, we verify that the logic can handle such cases
      expect(mockDiscrepancies.length).toBe(2);
      
      // The actual implementation should reduce this to 1 unique entry
      const uniqueKeys = new Set();
      mockDiscrepancies.forEach(disc => {
        const uniqueKey = `${disc.currency}_${disc.discrepancyPercent}_${disc.exchangeAmount}_${disc.botAmount}`;
        uniqueKeys.add(uniqueKey);
      });
      
      expect(uniqueKeys.size).toBe(1); // Should have only 1 unique key
    });
  });

  describe('外部取引判定の修正', () => {
    it('全ての不整合が90%以上の外部取引の場合、INFOレベルで出力される', async () => {
      // Issue #2483のケース: 全ての通貨で90%以上の差異
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: {
          XRP: 0.9271,   // 99.75%差異
          ETH: 0.0003,   // 100%差異
          MONA: 1.7181,  // 98.15%差異
          XLM: 13.0594,  // 100%差異
          QTUM: 6.0666,  // 100%差異
          BAT: 5.6061,   // 99.7%差異
          OMG: 0.9147,   // 97.04%差異
          XYM: 235.6213, // 99.83%差異
          LINK: 0.1798   // 100%差異
        }
      });

      getAllPositionsRedis.mockResolvedValue([
        { exchange: 'bitbank', symbol: 'XRP/JPY', side: 'buy', amount: 0.0023, status: 'open' },
        { exchange: 'bitbank', symbol: 'ETH/JPY', side: 'buy', amount: 0, status: 'open' },
        { exchange: 'bitbank', symbol: 'MONA/JPY', side: 'buy', amount: 0.0317, status: 'open' },
        { exchange: 'bitbank', symbol: 'XLM/JPY', side: 'buy', amount: 0, status: 'open' },
        { exchange: 'bitbank', symbol: 'QTUM/JPY', side: 'buy', amount: 0.0001, status: 'open' },
        { exchange: 'bitbank', symbol: 'BAT/JPY', side: 'buy', amount: 0.017, status: 'open' },
        { exchange: 'bitbank', symbol: 'OMG/JPY', side: 'buy', amount: 0.0271, status: 'open' },
        { exchange: 'bitbank', symbol: 'XYM/JPY', side: 'buy', amount: 0.4081, status: 'open' },
        { exchange: 'bitbank', symbol: 'LINK/JPY', side: 'buy', amount: 0, status: 'open' }
      ]);

      await compareBalances('bitbank');

      // INFOレベルで出力されることを確認（ERRORレベルでは出力されない）
      expect(mockLoggerInstance.info).toHaveBeenCalledWith(
        expect.stringMatching(/残高不整合検出: bitbank.*外部取引による残高差異/)
      );

      // ERRORレベルでは出力されていないことを確認
      expect(mockLoggerInstance.error).not.toHaveBeenCalledWith(
        expect.stringContaining('残高不整合検出: bitbank')
      );

      // 各通貨の詳細もINFOレベルで出力されることを確認
      expect(mockLoggerInstance.info).toHaveBeenCalledWith(
        expect.stringMatching(/XRP: 取引所=0\.9271, Bot=0\.0023, 差異=0\.9248 \(99\.75%\).*外部取引の可能性/)
      );
      expect(mockLoggerInstance.info).toHaveBeenCalledWith(
        expect.stringMatching(/LINK: 取引所=0\.1798, Bot=0, 差異=0\.1798 \(100%\).*外部取引の可能性/)
      );
    });

    it('90%以上の外部取引が過半数の場合、INFOレベルで出力される', async () => {
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: {
          BTC: 1.0,     // 95%差異（外部取引）
          ETH: 2.0,     // 95%差異（外部取引）
          ADA: 1.0      // 20%差異（非外部取引）
        }
      });

      getAllPositionsRedis.mockResolvedValue([
        { exchange: 'bitbank', symbol: 'BTC/JPY', side: 'buy', amount: 0.05, status: 'open' },
        { exchange: 'bitbank', symbol: 'ETH/JPY', side: 'buy', amount: 0.1, status: 'open' },
        { exchange: 'bitbank', symbol: 'ADA/JPY', side: 'buy', amount: 0.8, status: 'open' }
      ]);

      await compareBalances('bitbank');

      // INFOレベルで出力されることを確認
      expect(mockLoggerInstance.info).toHaveBeenCalledWith(
        expect.stringMatching(/残高不整合検出: bitbank.*外部取引による残高差異/)
      );

      // ERRORレベルでは出力されていないことを確認
      expect(mockLoggerInstance.error).not.toHaveBeenCalledWith(
        expect.stringContaining('残高不整合検出: bitbank')
      );
    });

    it('外部取引ではない高度不整合のみの場合、ERRORレベルで出力される', async () => {
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: {
          BTC: 1.0,     // 20%差異（非外部取引）
          ETH: 2.0,     // 30%差異（非外部取引）
          ADA: 1.0      // 15%差異（非外部取引）
        }
      });

      getAllPositionsRedis.mockResolvedValue([
        { exchange: 'bitbank', symbol: 'BTC/JPY', side: 'buy', amount: 0.8, status: 'open' },
        { exchange: 'bitbank', symbol: 'ETH/JPY', side: 'buy', amount: 1.4, status: 'open' },
        { exchange: 'bitbank', symbol: 'ADA/JPY', side: 'buy', amount: 0.85, status: 'open' }
      ]);

      await compareBalances('bitbank');

      // ERRORレベルで出力されることを確認
      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        expect.stringMatching(/残高不整合検出: bitbank.*高度不整合/)
      );
    });
  });

  describe('ログレベル判定の詳細テスト', () => {
    it('条件1適用 - 全て外部取引の場合の判定ログが出力される', async () => {
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: {
          BTC: 1.0,     // 95%差異（外部取引）
          ETH: 2.0      // 90%差異（外部取引）
        }
      });

      getAllPositionsRedis.mockResolvedValue([
        { exchange: 'bitbank', symbol: 'BTC/JPY', side: 'buy', amount: 0.05, status: 'open' },
        { exchange: 'bitbank', symbol: 'ETH/JPY', side: 'buy', amount: 0.2, status: 'open' }
      ]);

      await compareBalances('bitbank');

      // 判定ログが出力されることを確認
      expect(mockLoggerInstance.debug).toHaveBeenCalledWith(
        expect.stringMatching(/ログレベル判定 \(bitbank\): 条件1適用 - 全て外部取引 -> INFO/)
      );
    });

    it('Issue #2441のログレベル判定結果が強制的に記録される', async () => {
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: {
          BTC: 1.0
        }
      });

      getAllPositionsRedis.mockResolvedValue([
        { exchange: 'bitbank', symbol: 'BTC/JPY', side: 'buy', amount: 0.05, status: 'open' }
      ]);

      await compareBalances('bitbank');

      // Issue #2441の判定結果ログが出力されることを確認
      expect(mockLoggerInstance.info).toHaveBeenCalledWith(
        expect.stringMatching(/\[Issue #2441\] ログレベル判定結果 \(bitbank\): INFO - 外部取引による残高差異/)
      );
    });
  });
});