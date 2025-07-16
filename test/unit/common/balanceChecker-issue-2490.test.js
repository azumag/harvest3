/**
 * Tests for Issue #2490: strategy-runnerサービスで例外が発生
 * 残高不整合のログレベル修正テスト
 */

// Mock dependencies
jest.mock('../../../src/config', () => ({
  config: {
    exchanges: {
      bitbank: {
        symbols: ['LTC/JPY', 'DOT/JPY', 'GALA/JPY', 'IMX/JPY', 'MANA/JPY', 'BAT/JPY', 'SAND/JPY', 'APE/JPY'],
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

describe('Issue #2490: strategy-runnerサービスで例外が発生 - ログレベル修正テスト', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    postOrderToDiscord.mockResolvedValue();
  });

  it('Issue #2490のLTCケース（100%差異）がINFOレベルで出力される', async () => {
    // Issue #2490で報告されたLTCの具体的なケースを再現
    config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
      total: { 
        LTC: 0.0472  // 取引所残高
      }
    });

    getAllPositionsRedis.mockResolvedValue([
      {
        exchange: 'bitbank',
        symbol: 'LTC/JPY',
        side: 'buy',
        amount: 0,  // Bot残高：0 -> 100%差異
        status: 'open'
      }
    ]);

    await compareBalances('bitbank');

    // 100%差異の外部取引として INFO レベルで出力されるべき
    expect(mockLoggerInstance.info).toHaveBeenCalledWith(
      expect.stringMatching(/残高不整合検出: bitbank.*外部取引による残高差異/)
    );

    // ERROR レベルでは出力されないべき
    expect(mockLoggerInstance.error).not.toHaveBeenCalledWith(
      expect.stringContaining('残高不整合検出: bitbank')
    );

    // LTCの詳細もINFOレベルで出力されるべき
    expect(mockLoggerInstance.info).toHaveBeenCalledWith(
      expect.stringMatching(/LTC: 取引所=0\.0472, Bot=0, 差異=0\.0472 \(100%\).*外部取引の可能性/)
    );
  });

  it('Issue #2490のログコンテキストケース - 複数の外部取引が大多数（80%以上）の場合', async () => {
    // Issue #2490のログコンテキストからの複数通貨ケースを再現
    config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
      total: { 
        DOT: 0.00030000,
        GALA: 0.00730000,
        IMX: 0.00410000,
        MANA: 0.00900000,
        BAT: 0.01700000,
        SAND: 0.00320000,
        APE: 0.00350000,
        LTC: 0.0472
      }
    });

    getAllPositionsRedis.mockResolvedValue([
      { exchange: 'bitbank', symbol: 'DOT/JPY', side: 'buy', amount: 0, status: 'open' },   // 100%差異
      { exchange: 'bitbank', symbol: 'GALA/JPY', side: 'buy', amount: 0, status: 'open' },  // 100%差異
      { exchange: 'bitbank', symbol: 'IMX/JPY', side: 'buy', amount: 0, status: 'open' },   // 100%差異
      { exchange: 'bitbank', symbol: 'MANA/JPY', side: 'buy', amount: 0, status: 'open' },  // 100%差異
      { exchange: 'bitbank', symbol: 'BAT/JPY', side: 'buy', amount: 0, status: 'open' },   // 100%差異
      { exchange: 'bitbank', symbol: 'SAND/JPY', side: 'buy', amount: 0, status: 'open' },  // 100%差異
      { exchange: 'bitbank', symbol: 'APE/JPY', side: 'buy', amount: 0, status: 'open' },   // 100%差異
      { exchange: 'bitbank', symbol: 'LTC/JPY', side: 'buy', amount: 0, status: 'open' }    // 100%差異
    ]);

    await compareBalances('bitbank');

    // 全て外部取引（100%差異）のため INFO レベルで出力されるべき
    expect(mockLoggerInstance.info).toHaveBeenCalledWith(
      expect.stringMatching(/残高不整合検出: bitbank.*外部取引による残高差異/)
    );

    // ERROR レベルでは出力されないべき
    expect(mockLoggerInstance.error).not.toHaveBeenCalledWith(
      expect.stringContaining('残高不整合検出: bitbank')
    );
  });

  it('外部取引が80%以上だが100%ではない場合もINFOレベルで出力される', async () => {
    // 8件の外部取引（100%差異）と2件の非外部取引（10%差異）の混在ケース
    config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
      total: { 
        // 外部取引ケース（8件）
        DOT: 0.00030000,
        GALA: 0.00730000,
        IMX: 0.00410000,
        MANA: 0.00900000,
        BAT: 0.01700000,
        SAND: 0.00320000,
        APE: 0.00350000,
        LTC: 0.0472,
        // 非外部取引ケース（2件）
        BTC: 1.0,
        ETH: 2.0
      }
    });

    getAllPositionsRedis.mockResolvedValue([
      // 外部取引ケース（8件、100%差異）
      { exchange: 'bitbank', symbol: 'DOT/JPY', side: 'buy', amount: 0, status: 'open' },
      { exchange: 'bitbank', symbol: 'GALA/JPY', side: 'buy', amount: 0, status: 'open' },
      { exchange: 'bitbank', symbol: 'IMX/JPY', side: 'buy', amount: 0, status: 'open' },
      { exchange: 'bitbank', symbol: 'MANA/JPY', side: 'buy', amount: 0, status: 'open' },
      { exchange: 'bitbank', symbol: 'BAT/JPY', side: 'buy', amount: 0, status: 'open' },
      { exchange: 'bitbank', symbol: 'SAND/JPY', side: 'buy', amount: 0, status: 'open' },
      { exchange: 'bitbank', symbol: 'APE/JPY', side: 'buy', amount: 0, status: 'open' },
      { exchange: 'bitbank', symbol: 'LTC/JPY', side: 'buy', amount: 0, status: 'open' },
      // 非外部取引ケース（2件、10%差異）
      { exchange: 'bitbank', symbol: 'BTC/JPY', side: 'buy', amount: 0.9, status: 'open' },
      { exchange: 'bitbank', symbol: 'ETH/JPY', side: 'buy', amount: 1.8, status: 'open' }
    ]);

    await compareBalances('bitbank');

    // 80%が外部取引（100%差異）なのでINFOレベルで出力されるべき
    expect(mockLoggerInstance.info).toHaveBeenCalledWith(
      expect.stringMatching(/残高不整合検出: bitbank.*外部取引による残高差異/)
    );

    // ERROR レベルでは出力されないべき
    expect(mockLoggerInstance.error).not.toHaveBeenCalledWith(
      expect.stringContaining('残高不整合検出: bitbank')
    );
  });

  it('外部取引が50%以上80%未満の場合はWARNレベルで出力される', async () => {
    // 6件の外部取引（100%差異）と4件の非外部取引（10%差異）の混在ケース
    config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
      total: { 
        // 外部取引ケース（6件）
        DOT: 0.00030000,
        GALA: 0.00730000,
        IMX: 0.00410000,
        MANA: 0.00900000,
        BAT: 0.01700000,
        SAND: 0.00320000,
        // 非外部取引ケース（4件）
        BTC: 1.0,
        ETH: 2.0,
        ADA: 1.5,
        XRP: 0.5
      }
    });

    getAllPositionsRedis.mockResolvedValue([
      // 外部取引ケース（6件、100%差異）
      { exchange: 'bitbank', symbol: 'DOT/JPY', side: 'buy', amount: 0, status: 'open' },
      { exchange: 'bitbank', symbol: 'GALA/JPY', side: 'buy', amount: 0, status: 'open' },
      { exchange: 'bitbank', symbol: 'IMX/JPY', side: 'buy', amount: 0, status: 'open' },
      { exchange: 'bitbank', symbol: 'MANA/JPY', side: 'buy', amount: 0, status: 'open' },
      { exchange: 'bitbank', symbol: 'BAT/JPY', side: 'buy', amount: 0, status: 'open' },
      { exchange: 'bitbank', symbol: 'SAND/JPY', side: 'buy', amount: 0, status: 'open' },
      // 非外部取引ケース（4件、10%差異）
      { exchange: 'bitbank', symbol: 'BTC/JPY', side: 'buy', amount: 0.9, status: 'open' },
      { exchange: 'bitbank', symbol: 'ETH/JPY', side: 'buy', amount: 1.8, status: 'open' },
      { exchange: 'bitbank', symbol: 'ADA/JPY', side: 'buy', amount: 1.35, status: 'open' },
      { exchange: 'bitbank', symbol: 'XRP/JPY', side: 'buy', amount: 0.45, status: 'open' }
    ]);

    await compareBalances('bitbank');

    // 60%が外部取引（50%以上80%未満）なのでWARNレベルで出力されるべき
    expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
      expect.stringMatching(/残高不整合検出: bitbank.*外部取引による残高差異/)
    );

    // ERROR レベルでは出力されないべき
    expect(mockLoggerInstance.error).not.toHaveBeenCalledWith(
      expect.stringContaining('残高不整合検出: bitbank')
    );
  });

  it('外部取引が50%未満の場合はERRORレベルで出力される', async () => {
    // 4件の外部取引（100%差異）と6件の非外部取引（10%差異）の混在ケース
    config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
      total: { 
        // 外部取引ケース（4件）
        DOT: 0.00030000,
        GALA: 0.00730000,
        IMX: 0.00410000,
        MANA: 0.00900000,
        // 非外部取引ケース（6件）
        BTC: 1.0,
        ETH: 2.0,
        ADA: 1.5,
        XRP: 0.5,
        LTC: 0.8,
        LINK: 0.3
      }
    });

    getAllPositionsRedis.mockResolvedValue([
      // 外部取引ケース（4件、100%差異）
      { exchange: 'bitbank', symbol: 'DOT/JPY', side: 'buy', amount: 0, status: 'open' },
      { exchange: 'bitbank', symbol: 'GALA/JPY', side: 'buy', amount: 0, status: 'open' },
      { exchange: 'bitbank', symbol: 'IMX/JPY', side: 'buy', amount: 0, status: 'open' },
      { exchange: 'bitbank', symbol: 'MANA/JPY', side: 'buy', amount: 0, status: 'open' },
      // 非外部取引ケース（6件、10%差異）
      { exchange: 'bitbank', symbol: 'BTC/JPY', side: 'buy', amount: 0.9, status: 'open' },
      { exchange: 'bitbank', symbol: 'ETH/JPY', side: 'buy', amount: 1.8, status: 'open' },
      { exchange: 'bitbank', symbol: 'ADA/JPY', side: 'buy', amount: 1.35, status: 'open' },
      { exchange: 'bitbank', symbol: 'XRP/JPY', side: 'buy', amount: 0.45, status: 'open' },
      { exchange: 'bitbank', symbol: 'LTC/JPY', side: 'buy', amount: 0.72, status: 'open' },
      { exchange: 'bitbank', symbol: 'LINK/JPY', side: 'buy', amount: 0.27, status: 'open' }
    ]);

    await compareBalances('bitbank');

    // 40%が外部取引（50%未満）なのでERRORレベルで出力されるべき
    expect(mockLoggerInstance.error).toHaveBeenCalledWith(
      expect.stringMatching(/残高不整合検出: bitbank.*混合不整合/)
    );
  });

  it('ログレベル判定のデバッグ情報が正しく出力される', async () => {
    // 混在ケースでのデバッグ情報出力テスト
    config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
      total: { 
        LTC: 0.0472,  // 100%差異（外部取引）
        BTC: 1.0      // 10%差異（非外部取引）
      }
    });

    getAllPositionsRedis.mockResolvedValue([
      { exchange: 'bitbank', symbol: 'LTC/JPY', side: 'buy', amount: 0, status: 'open' },
      { exchange: 'bitbank', symbol: 'BTC/JPY', side: 'buy', amount: 0.9, status: 'open' }
    ]);

    await compareBalances('bitbank');

    // デバッグ情報が出力されることを確認
    expect(mockLoggerInstance.debug).toHaveBeenCalledWith(
      expect.stringMatching(/ログレベル判定デバッグ \(bitbank\): 総不整合=\d+, 外部取引=\d+, 高度外部取引=\d+, 非外部高度不整合=\d+/)
    );

    // 最終的なログレベル判定結果が出力されることを確認
    expect(mockLoggerInstance.info).toHaveBeenCalledWith(
      expect.stringMatching(/\[Issue #2441\] ログレベル判定結果 \(bitbank\): \w+ - .+/)
    );
  });
});