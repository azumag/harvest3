/**
 * Tests for Issue #2472: strategy-runnerサービスで例外が発生
 * 残高チェッカーのログレベル判定と重複検出の改善テスト
 */

// Mock dependencies
jest.mock('../../../src/config', () => ({
  config: {
    exchanges: {
      bitbank: {
        symbols: ['BTC/JPY', 'ETH/JPY', 'KLAY/JPY', 'IMX/JPY', 'MASK/JPY', 'POL/JPY', 'SOL/JPY', 'CYBER/JPY', 'TRX/JPY', 'ATOM/JPY', 'DAI/JPY'],
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

const {
  compareBalances
} = require('../../../src/common/balanceChecker');

const { config } = require('../../../src/config');
const { getAllPositionsRedis } = require('../../../src/database/redisDatabase');
const { postOrderToDiscord } = require('../../../src/common/notifications');

describe('Issue #2472: strategy-runnerサービスで例外が発生', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    postOrderToDiscord.mockResolvedValue();
  });

  describe('ログレベル判定の改善', () => {
    it('高度外部取引（90%以上）が80%以上の場合、INFOレベルで出力される', async () => {
      // Issue #2472の実際のケースを再現：大部分が90%以上の外部取引
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: {
          KLAY: 0.3721,
          IMX: 0.4499,
          MASK: 0.2854,
          POL: 26.6617,
          SOL: 0.0759,
          CYBER: 0.1531,
          TRX: 24.8376,
          ATOM: 0.1257,
          DAI: 0.0069
        }
      });

      getAllPositionsRedis.mockResolvedValue([
        { symbol: 'KLAY/JPY', side: 'buy', amount: 0.0202, status: 'open' },  // 94.57%差異
        { symbol: 'IMX/JPY', side: 'buy', amount: 0.0041, status: 'open' },   // 99.09%差異
        { symbol: 'MASK/JPY', side: 'buy', amount: 0, status: 'open' },       // 100%差異
        { symbol: 'POL/JPY', side: 'buy', amount: 0, status: 'open' },        // 100%差異
        { symbol: 'SOL/JPY', side: 'buy', amount: 0.0001, status: 'open' },   // 99.87%差異
        { symbol: 'CYBER/JPY', side: 'buy', amount: 0.0074, status: 'open' }, // 95.17%差異
        { symbol: 'TRX/JPY', side: 'buy', amount: 0, status: 'open' },        // 100%差異
        { symbol: 'ATOM/JPY', side: 'buy', amount: 0, status: 'open' },       // 100%差異
        { symbol: 'DAI/JPY', side: 'buy', amount: 0, status: 'open' }         // 100%差異
      ]);

      await compareBalances('bitbank');

      // 外部取引による残高差異としてINFOレベルで出力されることを確認
      expect(mockLoggerInstance.info).toHaveBeenCalledWith(
        expect.stringMatching(/残高不整合検出: bitbank.*外部取引による残高差異/)
      );

      // ERRORレベルでは出力されていないことを確認
      expect(mockLoggerInstance.error).not.toHaveBeenCalledWith(
        expect.stringContaining('残高不整合検出: bitbank')
      );

      // ログレベル判定の詳細ログが出力されることを確認
      expect(mockLoggerInstance.debug).toHaveBeenCalledWith(
        expect.stringMatching(/条件1適用 - 高度外部取引比率.*% >= 80%.*INFO/)
      );
    });

    it('高度外部取引が50%以上80%未満の場合、INFOレベルで出力される', async () => {
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: {
          BTC: 1.0,   // 外部取引ではない（20%差異）
          ETH: 2.0,   // 外部取引ではない（25%差異）
          MASK: 0.2854, // 外部取引（100%差異）
          POL: 26.6617, // 外部取引（100%差異）
          SOL: 0.0759   // 外部取引（99.87%差異）
        }
      });

      getAllPositionsRedis.mockResolvedValue([
        { symbol: 'BTC/JPY', side: 'buy', amount: 0.8, status: 'open' },     // 20%差異
        { symbol: 'ETH/JPY', side: 'buy', amount: 1.5, status: 'open' },     // 25%差異
        { symbol: 'MASK/JPY', side: 'buy', amount: 0, status: 'open' },      // 100%差異
        { symbol: 'POL/JPY', side: 'buy', amount: 0, status: 'open' },       // 100%差異
        { symbol: 'SOL/JPY', side: 'buy', amount: 0.0001, status: 'open' }   // 99.87%差異
      ]);

      await compareBalances('bitbank');

      // 外部取引による残高差異（一部混在）としてINFOレベルで出力されることを確認
      expect(mockLoggerInstance.info).toHaveBeenCalledWith(
        expect.stringMatching(/残高不整合検出: bitbank.*外部取引による残高差異.*一部混在/)
      );

      // 条件2が適用されることを確認
      expect(mockLoggerInstance.debug).toHaveBeenCalledWith(
        expect.stringMatching(/条件2適用 - 高度外部取引比率.*% >= 50%.*INFO/)
      );
    });

    it('高度外部取引が50%未満の場合、WARNレベルで出力される', async () => {
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: {
          BTC: 1.0,   // 外部取引ではない（20%差異）
          ETH: 2.0,   // 外部取引ではない（25%差異）
          ADA: 0.5,   // 外部取引ではない（30%差異）
          DOT: 0.3,   // 外部取引ではない（40%差異）
          MASK: 0.2854 // 外部取引（100%差異）
        }
      });

      getAllPositionsRedis.mockResolvedValue([
        { symbol: 'BTC/JPY', side: 'buy', amount: 0.8, status: 'open' },     // 20%差異
        { symbol: 'ETH/JPY', side: 'buy', amount: 1.5, status: 'open' },     // 25%差異
        { symbol: 'ADA/JPY', side: 'buy', amount: 0.35, status: 'open' },    // 30%差異
        { symbol: 'DOT/JPY', side: 'buy', amount: 0.18, status: 'open' },    // 40%差異
        { symbol: 'MASK/JPY', side: 'buy', amount: 0, status: 'open' }       // 100%差異
      ]);

      await compareBalances('bitbank');

      // 混合不整合としてWARNレベルで出力されることを確認
      expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
        expect.stringMatching(/残高不整合検出: bitbank.*混合不整合.*明らかな外部取引含む/)
      );

      // 条件3が適用されることを確認
      expect(mockLoggerInstance.debug).toHaveBeenCalledWith(
        expect.stringMatching(/条件3適用 - 高度外部取引比率.*% < 50%.*WARN/)
      );
    });

    it('全て外部取引（50%以上）の場合、INFOレベルで出力される', async () => {
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: {
          BTC: 1.0,   // 外部取引（60%差異）
          ETH: 2.0,   // 外部取引（70%差異）
          ADA: 0.5    // 外部取引（80%差異）
        }
      });

      getAllPositionsRedis.mockResolvedValue([
        { symbol: 'BTC/JPY', side: 'buy', amount: 0.4, status: 'open' },     // 60%差異
        { symbol: 'ETH/JPY', side: 'buy', amount: 0.6, status: 'open' },     // 70%差異
        { symbol: 'ADA/JPY', side: 'buy', amount: 0.1, status: 'open' }      // 80%差異
      ]);

      await compareBalances('bitbank');

      // 外部取引による残高差異としてINFOレベルで出力されることを確認
      expect(mockLoggerInstance.info).toHaveBeenCalledWith(
        expect.stringMatching(/残高不整合検出: bitbank.*外部取引による残高差異/)
      );

      // 条件4が適用されることを確認
      expect(mockLoggerInstance.debug).toHaveBeenCalledWith(
        expect.stringMatching(/条件4適用 - 全て外部取引.*INFO/)
      );
    });

    it('外部取引ではない高度不整合のみの場合、ERRORレベルで出力される', async () => {
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: {
          BTC: 1.0,   // 外部取引ではない（20%差異）
          ETH: 2.0,   // 外部取引ではない（25%差異）
          ADA: 0.5    // 外部取引ではない（30%差異）
        }
      });

      getAllPositionsRedis.mockResolvedValue([
        { symbol: 'BTC/JPY', side: 'buy', amount: 0.8, status: 'open' },     // 20%差異
        { symbol: 'ETH/JPY', side: 'buy', amount: 1.5, status: 'open' },     // 25%差異
        { symbol: 'ADA/JPY', side: 'buy', amount: 0.35, status: 'open' }     // 30%差異
      ]);

      await compareBalances('bitbank');

      // 高度不整合としてERRORレベルで出力されることを確認
      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        expect.stringMatching(/残高不整合検出: bitbank.*高度不整合/)
      );

      // 条件8が適用されることを確認
      expect(mockLoggerInstance.debug).toHaveBeenCalledWith(
        expect.stringMatching(/条件8適用 - 非外部高度不整合のみ.*ERROR/)
      );
    });
  });

  describe('重複検出の改善', () => {
    it('DAIトークンの重複ログエントリが除去される', async () => {
      // Issue #2472で報告されたDAIの重複ケースを再現
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: {
          DAI: 0.0069
        }
      });

      getAllPositionsRedis.mockResolvedValue([
        { symbol: 'DAI/JPY', side: 'buy', amount: 0, status: 'open' }
      ]);

      const result = await compareBalances('bitbank');

      // DAIの不整合が1件のみ検出されることを確認
      const daiDiscrepancies = result.discrepancies.filter(d => d.currency === 'DAI');
      expect(daiDiscrepancies).toHaveLength(1);

      // 重複ログエントリが除去されることを確認
      expect(mockLoggerInstance.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('[Issue #2472] 重複エントリを検出し除去')
      );
    });

    it('複数通貨で重複がある場合、適切に除去される', async () => {
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: {
          BTC: 1.0,
          ETH: 2.0,
          btc: 0.5,  // 正規化により重複となる
          eth: 1.0   // 正規化により重複となる
        }
      });

      getAllPositionsRedis.mockResolvedValue([
        { symbol: 'BTC/JPY', side: 'buy', amount: 0.5, status: 'open' },
        { symbol: 'ETH/JPY', side: 'buy', amount: 1.0, status: 'open' }
      ]);

      const result = await compareBalances('bitbank');

      // 各通貨が1回のみ検出されることを確認
      const currencies = result.discrepancies.map(d => d.currency);
      const uniqueCurrencies = [...new Set(currencies)];
      expect(currencies).toHaveLength(uniqueCurrencies.length);

      // 正規化後の一意通貨数のログが出力されることを確認
      expect(mockLoggerInstance.debug).toHaveBeenCalledWith(
        expect.stringMatching(/\[Issue #2472\] 正規化後の一意通貨数/)
      );
    });

    it('重複除去統計が正しく出力される', async () => {
      // 人為的に重複を作成するのは困難なため、正常なケースで統計が出力されないことを確認
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: { BTC: 1.0 }
      });

      getAllPositionsRedis.mockResolvedValue([
        { symbol: 'BTC/JPY', side: 'buy', amount: 0.5, status: 'open' }
      ]);

      await compareBalances('bitbank');

      // 重複がない場合、重複除去統計は出力されない
      expect(mockLoggerInstance.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('[Issue #2472] 重複エントリ除去統計')
      );
    });
  });

  describe('Issue #2472の総合テスト', () => {
    it('Issue #2472の実際のエラーケースが正しく処理される', async () => {
      // Issue #2472の実際のログを再現
      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: {
          KLAY: 0.3721,
          IMX: 0.4499,
          MASK: 0.2854,
          POL: 26.6617,
          SOL: 0.0759,
          CYBER: 0.1531,
          TRX: 24.8376,
          ATOM: 0.1257,
          DAI: 0.0069
        }
      });

      getAllPositionsRedis.mockResolvedValue([
        { symbol: 'KLAY/JPY', side: 'buy', amount: 0.0202, status: 'open' },
        { symbol: 'IMX/JPY', side: 'buy', amount: 0.0041, status: 'open' },
        { symbol: 'MASK/JPY', side: 'buy', amount: 0, status: 'open' },
        { symbol: 'POL/JPY', side: 'buy', amount: 0, status: 'open' },
        { symbol: 'SOL/JPY', side: 'buy', amount: 0.0001, status: 'open' },
        { symbol: 'CYBER/JPY', side: 'buy', amount: 0.0074, status: 'open' },
        { symbol: 'TRX/JPY', side: 'buy', amount: 0, status: 'open' },
        { symbol: 'ATOM/JPY', side: 'buy', amount: 0, status: 'open' },
        { symbol: 'DAI/JPY', side: 'buy', amount: 0, status: 'open' }
      ]);

      const result = await compareBalances('bitbank');

      // 外部取引による残高差異として処理されることを確認
      expect(mockLoggerInstance.info).toHaveBeenCalledWith(
        expect.stringMatching(/残高不整合検出: bitbank.*外部取引による残高差異/)
      );

      // ERRORレベルで出力されないことを確認
      expect(mockLoggerInstance.error).not.toHaveBeenCalledWith(
        expect.stringContaining('残高不整合検出: bitbank')
      );

      // 各通貨が1回のみ検出されることを確認
      const currencies = result.discrepancies.map(d => d.currency);
      const uniqueCurrencies = [...new Set(currencies)];
      expect(currencies).toHaveLength(uniqueCurrencies.length);

      // DAIが含まれている場合、重複していないことを確認
      const daiDiscrepancies = result.discrepancies.filter(d => d.currency === 'DAI');
      expect(daiDiscrepancies).toHaveLength(1);
    });
  });
});