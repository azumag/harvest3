/**
 * Tests for Issue #2489: strategy-runnerサービスで例外が発生
 * 複数通貨での同時発生する外部取引による残高差異のログレベル修正
 */

// Mock dependencies
jest.mock('../../../src/config', () => ({
  config: {
    exchanges: {
      bitbank: {
        symbols: ['BTC/JPY', 'ETH/JPY', 'GRT/JPY', 'AXS/JPY', 'FLR/JPY', 'SAND/JPY', 'GALA/JPY', 'CHZ/JPY', 'APE/JPY', 'OAS/JPY', 'MANA/JPY'],
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

const { compareBalances } = require('../../../src/common/balanceChecker');
const { config } = require('../../../src/config');
const { getAllPositionsRedis } = require('../../../src/database/redisDatabase');
const { postOrderToDiscord } = require('../../../src/common/notifications');

describe('Issue #2489: strategy-runnerサービスで例外が発生 - 修正テスト', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    postOrderToDiscord.mockResolvedValue();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('Issue #2489のケース: 複数通貨で100%差異が発生した場合、INFOレベルで出力される', async () => {
    // Issue #2489で報告された実際のケースを再現
    config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
      total: {
        AXS: 0.1488,
        FLR: 235.7937,
        SAND: 16.288,
        GALA: 273.3722,
        CHZ: 14.0043,
        APE: 0.9309,
        OAS: 921.0375,
        MANA: 4.4588,
        GRT: 9.9385
      }
    });

    // Bot残高がすべて0またはごく少量（100%に近い差異）
    getAllPositionsRedis.mockResolvedValue([
      { exchange: 'bitbank', symbol: 'AXS/JPY', side: 'buy', amount: 0.0021, status: 'open' },
      { exchange: 'bitbank', symbol: 'FLR/JPY', side: 'buy', amount: 0, status: 'open' },
      { exchange: 'bitbank', symbol: 'SAND/JPY', side: 'buy', amount: 0.0032, status: 'open' },
      { exchange: 'bitbank', symbol: 'GALA/JPY', side: 'buy', amount: 0.0073, status: 'open' },
      { exchange: 'bitbank', symbol: 'CHZ/JPY', side: 'buy', amount: 0.0999, status: 'open' },
      { exchange: 'bitbank', symbol: 'APE/JPY', side: 'buy', amount: 0.0035, status: 'open' },
      { exchange: 'bitbank', symbol: 'OAS/JPY', side: 'buy', amount: 0, status: 'open' },
      { exchange: 'bitbank', symbol: 'MANA/JPY', side: 'buy', amount: 0.009, status: 'open' },
      { exchange: 'bitbank', symbol: 'GRT/JPY', side: 'buy', amount: 0, status: 'open' }
    ]);

    await compareBalances('bitbank');

    // 修正前はERRORレベルで出力されていたが、修正後はINFOレベルで出力される
    expect(mockLoggerInstance.info).toHaveBeenCalledWith(
      expect.stringMatching(/残高不整合検出: bitbank.*外部取引による残高差異/)
    );

    // ERRORレベルでは出力されていないことを確認
    expect(mockLoggerInstance.error).not.toHaveBeenCalledWith(
      expect.stringContaining('残高不整合検出: bitbank')
    );

    // 各通貨の詳細もINFOレベルで出力されることを確認
    expect(mockLoggerInstance.info).toHaveBeenCalledWith(
      expect.stringMatching(/GRT: 取引所=9\.9385, Bot=0, 差異=9\.9385 \(100%\).*外部取引の可能性/)
    );
  });

  it('90%以上の外部取引が過半数の場合、INFOレベルで出力される', async () => {
    config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
      total: {
        BTC: 1.0,    // 外部取引（95%差異）
        ETH: 2.0,    // 外部取引（95%差異） 
        ADA: 1.0     // 非外部取引（20%差異）
      }
    });

    getAllPositionsRedis.mockResolvedValue([
      { exchange: 'bitbank', symbol: 'BTC/JPY', side: 'buy', amount: 0.05, status: 'open' },  // 95%差異
      { exchange: 'bitbank', symbol: 'ETH/JPY', side: 'buy', amount: 0.1, status: 'open' },   // 95%差異
      { exchange: 'bitbank', symbol: 'ADA/JPY', side: 'buy', amount: 0.8, status: 'open' }    // 20%差異
    ]);

    await compareBalances('bitbank');

    // 90%以上の外部取引が過半数（2/3）なので、INFOレベルで出力される
    expect(mockLoggerInstance.info).toHaveBeenCalledWith(
      expect.stringMatching(/残高不整合検出: bitbank.*外部取引による残高差異/)
    );

    // ERRORレベルでは出力されていないことを確認
    expect(mockLoggerInstance.error).not.toHaveBeenCalledWith(
      expect.stringContaining('残高不整合検出: bitbank')
    );
  });

  it('50%以上の外部取引が過半数の場合、INFOレベルで出力される', async () => {
    config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
      total: {
        BTC: 1.0,    // 外部取引（60%差異）
        ETH: 2.0,    // 外部取引（70%差異）
        ADA: 1.0     // 非外部取引（30%差異）
      }
    });

    getAllPositionsRedis.mockResolvedValue([
      { exchange: 'bitbank', symbol: 'BTC/JPY', side: 'buy', amount: 0.4, status: 'open' },   // 60%差異
      { exchange: 'bitbank', symbol: 'ETH/JPY', side: 'buy', amount: 0.6, status: 'open' },   // 70%差異
      { exchange: 'bitbank', symbol: 'ADA/JPY', side: 'buy', amount: 0.7, status: 'open' }    // 30%差異
    ]);

    await compareBalances('bitbank');

    // 50%以上の外部取引が過半数（2/3）なので、INFOレベルで出力される
    expect(mockLoggerInstance.info).toHaveBeenCalledWith(
      expect.stringMatching(/残高不整合検出: bitbank.*外部取引による残高差異/)
    );

    // ERRORレベルでは出力されていないことを確認
    expect(mockLoggerInstance.error).not.toHaveBeenCalledWith(
      expect.stringContaining('残高不整合検出: bitbank')
    );
  });

  it('90%以上の外部取引が過半数未満の場合、WARNレベルで出力される', async () => {
    config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
      total: {
        BTC: 1.0,    // 外部取引（95%差異）
        ETH: 2.0,    // 非外部取引（30%差異）
        ADA: 1.0     // 非外部取引（20%差異）
      }
    });

    getAllPositionsRedis.mockResolvedValue([
      { exchange: 'bitbank', symbol: 'BTC/JPY', side: 'buy', amount: 0.05, status: 'open' },  // 95%差異
      { exchange: 'bitbank', symbol: 'ETH/JPY', side: 'buy', amount: 1.4, status: 'open' },   // 30%差異
      { exchange: 'bitbank', symbol: 'ADA/JPY', side: 'buy', amount: 0.8, status: 'open' }    // 20%差異
    ]);

    await compareBalances('bitbank');

    // 90%以上の外部取引が過半数未満（1/3）なので、WARNレベルで出力される
    expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
      expect.stringMatching(/残高不整合検出: bitbank.*外部取引による残高差異.*一部混在/)
    );

    // ERRORレベルでは出力されていないことを確認
    expect(mockLoggerInstance.error).not.toHaveBeenCalledWith(
      expect.stringContaining('残高不整合検出: bitbank')
    );
  });

  it('外部取引ではない高度不整合のみの場合、ERRORレベルで出力される', async () => {
    config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
      total: {
        BTC: 1.0,    // 非外部取引（20%差異）
        ETH: 2.0,    // 非外部取引（30%差異）
        ADA: 1.0     // 非外部取引（15%差異）
      }
    });

    getAllPositionsRedis.mockResolvedValue([
      { exchange: 'bitbank', symbol: 'BTC/JPY', side: 'buy', amount: 0.8, status: 'open' },   // 20%差異（非外部取引）
      { exchange: 'bitbank', symbol: 'ETH/JPY', side: 'buy', amount: 1.4, status: 'open' },   // 30%差異（非外部取引）
      { exchange: 'bitbank', symbol: 'ADA/JPY', side: 'buy', amount: 0.85, status: 'open' }   // 15%差異（非外部取引）
    ]);

    await compareBalances('bitbank');

    // 外部取引ではない高度不整合のみなので、ERRORレベルで出力される
    expect(mockLoggerInstance.error).toHaveBeenCalledWith(
      expect.stringMatching(/残高不整合検出: bitbank.*高度不整合/)
    );
  });

  it('境界値テスト: 外部取引の比率がちょうど50%の場合、INFOレベルで出力される', async () => {
    config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
      total: {
        BTC: 1.0,    // 外部取引（95%差異）
        ETH: 2.0,    // 非外部取引（30%差異）
      }
    });

    getAllPositionsRedis.mockResolvedValue([
      { exchange: 'bitbank', symbol: 'BTC/JPY', side: 'buy', amount: 0.05, status: 'open' },  // 95%差異
      { exchange: 'bitbank', symbol: 'ETH/JPY', side: 'buy', amount: 1.4, status: 'open' }    // 30%差異
    ]);

    await compareBalances('bitbank');

    // 90%以上の外部取引が50%（1/2）なので、INFOレベルで出力される
    expect(mockLoggerInstance.info).toHaveBeenCalledWith(
      expect.stringMatching(/残高不整合検出: bitbank.*外部取引による残高差異/)
    );
  });

  it('境界値テスト: 外部取引の比率が50%未満の場合、WARNレベルで出力される', async () => {
    config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
      total: {
        BTC: 1.0,    // 外部取引（95%差異）
        ETH: 2.0,    // 非外部取引（30%差異）
        ADA: 1.0,    // 非外部取引（20%差異）
        DOT: 1.0     // 非外部取引（25%差異）
      }
    });

    getAllPositionsRedis.mockResolvedValue([
      { exchange: 'bitbank', symbol: 'BTC/JPY', side: 'buy', amount: 0.05, status: 'open' },  // 95%差異
      { exchange: 'bitbank', symbol: 'ETH/JPY', side: 'buy', amount: 1.4, status: 'open' },   // 30%差異
      { exchange: 'bitbank', symbol: 'ADA/JPY', side: 'buy', amount: 0.8, status: 'open' },   // 20%差異
      { exchange: 'bitbank', symbol: 'DOT/JPY', side: 'buy', amount: 0.75, status: 'open' }   // 25%差異
    ]);

    await compareBalances('bitbank');

    // 90%以上の外部取引が25%（1/4）なので、WARNレベルで出力される
    expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
      expect.stringMatching(/残高不整合検出: bitbank.*外部取引による残高差異.*一部混在/)
    );
  });
});