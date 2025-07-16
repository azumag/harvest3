/**
 * Tests for Issue #2465: strategy-runnerサービスで例外が発生
 * 外部取引による残高差異が100%近い場合のログレベル修正
 */

// Mock dependencies
jest.mock('../../../src/config', () => ({
  config: {
    exchanges: {
      bitbank: {
        symbols: ['BTC/JPY', 'ETH/JPY', 'LTC/JPY', 'XRP/JPY', 'MONA/JPY', 'XLM/JPY', 'QTUM/JPY', 'BAT/JPY'],
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
      significantBalance: 0.00001,
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

const { compareBalances } = require('../../../src/common/balanceChecker');
const { config } = require('../../../src/config');
const { getAllPositionsRedis } = require('../../../src/database/redisDatabase');
const { postOrderToDiscord } = require('../../../src/common/notifications');

describe('Issue #2465: strategy-runnerサービスで例外が発生 - 修正テスト', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    postOrderToDiscord.mockResolvedValue();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('Issue #2465のケース: 全ての残高差異が外部取引（99%以上）の場合、INFOレベルで出力される', async () => {
    // Issue #2465で報告された実際のケースを再現
    // 40件の高度不整合（外部取引の可能性含む）
    config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
      total: {
        LTC: 0.0472,
        XRP: 0.9271,
        ETH: 0.0003,
        MONA: 1.7181,
        XLM: 13.0594,
        QTUM: 6.0666,
        BAT: 5.6061,
        // 追加の通貨を含めて40件に近づける
        BTC: 0.0123,
        ADA: 45.678,
        DOT: 2.345,
        LINK: 1.234,
        UNI: 0.567,
        AAVE: 0.089,
        SNX: 12.345,
        MKR: 0.012,
        COMP: 0.345,
        YFI: 0.0001,
        SUSHI: 6.789,
        CRV: 23.456,
        BAL: 0.987,
        REN: 34.567,
        KNC: 8.901,
        ZRX: 45.678,
        BAND: 1.234,
        STORJ: 56.789,
        GRT: 9.876,
        SAND: 12.345,
        MANA: 6.789,
        ENJ: 23.456,
        AXS: 0.789,
        ICP: 0.123,
        MATIC: 89.012,
        AVAX: 0.456,
        ATOM: 1.789,
        ALGO: 234.567,
        VET: 8901.234,
        THETA: 5.678,
        FIL: 0.234,
        TRX: 567.890
      }
    });

    // Bot残高がすべて0またはごく少量（99%以上の差異）
    getAllPositionsRedis.mockResolvedValue([
      { exchange: 'bitbank', symbol: 'LTC/JPY', side: 'buy', amount: 0, status: 'open' },
      { exchange: 'bitbank', symbol: 'XRP/JPY', side: 'buy', amount: 0.0023, status: 'open' },
      { exchange: 'bitbank', symbol: 'ETH/JPY', side: 'buy', amount: 0, status: 'open' },
      { exchange: 'bitbank', symbol: 'MONA/JPY', side: 'buy', amount: 0.0317, status: 'open' },
      { exchange: 'bitbank', symbol: 'XLM/JPY', side: 'buy', amount: 0, status: 'open' },
      { exchange: 'bitbank', symbol: 'QTUM/JPY', side: 'buy', amount: 0.0001, status: 'open' },
      { exchange: 'bitbank', symbol: 'BAT/JPY', side: 'buy', amount: 0.017, status: 'open' },
      // 追加の通貨
      { exchange: 'bitbank', symbol: 'BTC/JPY', side: 'buy', amount: 0.0001, status: 'open' },
      { exchange: 'bitbank', symbol: 'ADA/JPY', side: 'buy', amount: 0.012, status: 'open' },
      { exchange: 'bitbank', symbol: 'DOT/JPY', side: 'buy', amount: 0.001, status: 'open' },
      { exchange: 'bitbank', symbol: 'LINK/JPY', side: 'buy', amount: 0.002, status: 'open' },
      { exchange: 'bitbank', symbol: 'UNI/JPY', side: 'buy', amount: 0.003, status: 'open' },
      { exchange: 'bitbank', symbol: 'AAVE/JPY', side: 'buy', amount: 0.001, status: 'open' },
      { exchange: 'bitbank', symbol: 'SNX/JPY', side: 'buy', amount: 0.005, status: 'open' },
      { exchange: 'bitbank', symbol: 'MKR/JPY', side: 'buy', amount: 0.0001, status: 'open' },
      { exchange: 'bitbank', symbol: 'COMP/JPY', side: 'buy', amount: 0.001, status: 'open' },
      { exchange: 'bitbank', symbol: 'YFI/JPY', side: 'buy', amount: 0.00001, status: 'open' },
      { exchange: 'bitbank', symbol: 'SUSHI/JPY', side: 'buy', amount: 0.009, status: 'open' },
      { exchange: 'bitbank', symbol: 'CRV/JPY', side: 'buy', amount: 0.056, status: 'open' },
      { exchange: 'bitbank', symbol: 'BAL/JPY', side: 'buy', amount: 0.007, status: 'open' },
      { exchange: 'bitbank', symbol: 'REN/JPY', side: 'buy', amount: 0.067, status: 'open' },
      { exchange: 'bitbank', symbol: 'KNC/JPY', side: 'buy', amount: 0.001, status: 'open' },
      { exchange: 'bitbank', symbol: 'ZRX/JPY', side: 'buy', amount: 0.078, status: 'open' },
      { exchange: 'bitbank', symbol: 'BAND/JPY', side: 'buy', amount: 0.004, status: 'open' },
      { exchange: 'bitbank', symbol: 'STORJ/JPY', side: 'buy', amount: 0.089, status: 'open' },
      { exchange: 'bitbank', symbol: 'GRT/JPY', side: 'buy', amount: 0.076, status: 'open' },
      { exchange: 'bitbank', symbol: 'SAND/JPY', side: 'buy', amount: 0.045, status: 'open' },
      { exchange: 'bitbank', symbol: 'MANA/JPY', side: 'buy', amount: 0.089, status: 'open' },
      { exchange: 'bitbank', symbol: 'ENJ/JPY', side: 'buy', amount: 0.056, status: 'open' },
      { exchange: 'bitbank', symbol: 'AXS/JPY', side: 'buy', amount: 0.009, status: 'open' },
      { exchange: 'bitbank', symbol: 'ICP/JPY', side: 'buy', amount: 0.003, status: 'open' },
      { exchange: 'bitbank', symbol: 'MATIC/JPY', side: 'buy', amount: 0.012, status: 'open' },
      { exchange: 'bitbank', symbol: 'AVAX/JPY', side: 'buy', amount: 0.006, status: 'open' },
      { exchange: 'bitbank', symbol: 'ATOM/JPY', side: 'buy', amount: 0.009, status: 'open' },
      { exchange: 'bitbank', symbol: 'ALGO/JPY', side: 'buy', amount: 0.567, status: 'open' },
      { exchange: 'bitbank', symbol: 'VET/JPY', side: 'buy', amount: 1.234, status: 'open' },
      { exchange: 'bitbank', symbol: 'THETA/JPY', side: 'buy', amount: 0.078, status: 'open' },
      { exchange: 'bitbank', symbol: 'FIL/JPY', side: 'buy', amount: 0.004, status: 'open' },
      { exchange: 'bitbank', symbol: 'TRX/JPY', side: 'buy', amount: 0.890, status: 'open' }
    ]);

    await compareBalances('bitbank');

    // 修正後: 全ての不整合が外部取引なので、INFOレベルで出力される
    expect(mockLoggerInstance.info).toHaveBeenCalledWith(
      expect.stringMatching(/残高不整合検出: bitbank.*外部取引による残高差異/)
    );

    // ERRORレベルでは出力されていないことを確認
    expect(mockLoggerInstance.error).not.toHaveBeenCalledWith(
      expect.stringContaining('残高不整合検出: bitbank')
    );

    // 各通貨の詳細もINFOレベルで出力されることを確認
    expect(mockLoggerInstance.info).toHaveBeenCalledWith(
      expect.stringMatching(/BAT: 取引所=5\.6061, Bot=0\.017, 差異=5\.5891 \(99\.7%\).*外部取引の可能性/)
    );

    // Issue #2465で報告された具体的な通貨の確認
    expect(mockLoggerInstance.info).toHaveBeenCalledWith(
      expect.stringMatching(/LTC: 取引所=0\.0472, Bot=0, 差異=0\.0472 \(100%\).*外部取引の可能性/)
    );

    expect(mockLoggerInstance.info).toHaveBeenCalledWith(
      expect.stringMatching(/XRP: 取引所=0\.9271, Bot=0\.0023, 差異=0\.9248 \(99\.75%\).*外部取引の可能性/)
    );

    // ログレベル判定の詳細確認
    expect(mockLoggerInstance.info).toHaveBeenCalledWith(
      expect.stringMatching(/ログレベル判定結果.*bitbank.*INFO.*外部取引による残高差異/)
    );
  });

  it('修正前の問題: 全て外部取引だがERRORレベルでログ出力されていた問題の検証', async () => {
    // 簡単なケース: 少数の通貨ですべて99%以上の差異
    config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
      total: {
        BTC: 1.0,
        ETH: 2.0,
        LTC: 3.0
      }
    });

    getAllPositionsRedis.mockResolvedValue([
      { exchange: 'bitbank', symbol: 'BTC/JPY', side: 'buy', amount: 0.01, status: 'open' },  // 99%差異
      { exchange: 'bitbank', symbol: 'ETH/JPY', side: 'buy', amount: 0.02, status: 'open' },  // 99%差異
      { exchange: 'bitbank', symbol: 'LTC/JPY', side: 'buy', amount: 0.03, status: 'open' }   // 99%差異
    ]);

    await compareBalances('bitbank');

    // 修正後: 全て外部取引なのでINFOレベルで出力される
    expect(mockLoggerInstance.info).toHaveBeenCalledWith(
      expect.stringMatching(/残高不整合検出: bitbank.*外部取引による残高差異/)
    );

    // ERRORレベルでは出力されていないことを確認
    expect(mockLoggerInstance.error).not.toHaveBeenCalledWith(
      expect.stringContaining('残高不整合検出: bitbank')
    );

    // 条件4が適用されることを確認
    expect(mockLoggerInstance.debug).toHaveBeenCalledWith(
      expect.stringMatching(/ログレベル判定.*条件4適用 - 全て外部取引.*INFO/)
    );
  });

  it('境界値テスト: 50%ちょうどの差異でも外部取引として判定される', async () => {
    config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
      total: {
        BTC: 1.0,
        ETH: 2.0
      }
    });

    getAllPositionsRedis.mockResolvedValue([
      { exchange: 'bitbank', symbol: 'BTC/JPY', side: 'buy', amount: 0.5, status: 'open' },   // 50%差異
      { exchange: 'bitbank', symbol: 'ETH/JPY', side: 'buy', amount: 1.0, status: 'open' }    // 50%差異
    ]);

    await compareBalances('bitbank');

    // 全て外部取引なのでINFOレベルで出力される
    expect(mockLoggerInstance.info).toHaveBeenCalledWith(
      expect.stringMatching(/残高不整合検出: bitbank.*外部取引による残高差異/)
    );

    // ERRORレベルでは出力されていないことを確認
    expect(mockLoggerInstance.error).not.toHaveBeenCalledWith(
      expect.stringContaining('残高不整合検出: bitbank')
    );
  });

  it('一つでも外部取引でない不整合があると、条件1は適用されない', async () => {
    config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
      total: {
        BTC: 1.0,    // 外部取引（99%差異）
        ETH: 2.0,    // 外部取引（99%差異）
        LTC: 3.0     // 非外部取引（20%差異）
      }
    });

    getAllPositionsRedis.mockResolvedValue([
      { exchange: 'bitbank', symbol: 'BTC/JPY', side: 'buy', amount: 0.01, status: 'open' },  // 99%差異
      { exchange: 'bitbank', symbol: 'ETH/JPY', side: 'buy', amount: 0.02, status: 'open' },  // 99%差異
      { exchange: 'bitbank', symbol: 'LTC/JPY', side: 'buy', amount: 2.4, status: 'open' }    // 20%差異
    ]);

    await compareBalances('bitbank');

    // 条件4は適用されない（全て外部取引ではないため）
    expect(mockLoggerInstance.debug).not.toHaveBeenCalledWith(
      expect.stringMatching(/ログレベル判定.*条件4適用 - 全て外部取引.*INFO/)
    );

    // 他の条件（条件6等）が適用される
    expect(mockLoggerInstance.debug).toHaveBeenCalledWith(
      expect.stringMatching(/ログレベル判定.*条件6適用 - 外部取引比率66\.7% >= 50%.*WARN/)
    );
  });
});