/**
 * Tests for Issue #2417: strategy-runnerサービスで例外が発生
 * 個別ログレベル判定機能のテスト
 */

// Mock dependencies
jest.mock('../../../src/config', () => ({
  config: {
    exchanges: {
      bitbank: {
        symbols: ['BTC/JPY', 'CHZ/JPY', 'DOGE/JPY', 'ASTR/JPY', 'ADA/JPY'],
        instance: {
          id: 'bitbank',
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

jest.mock('../../../src/database/manager', () => ({
  getAllTradeSummaries: jest.fn(),
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
      significantBalance: 0.00001,
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

describe('Issue #2417: 個別ログレベル判定機能のテスト', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    postOrderToDiscord.mockResolvedValue();
    
    const { getClient } = require('../../../src/database/redisDatabase');
    getClient.mockReturnValue({
      set: jest.fn(),
      get: jest.fn(),
      eval: jest.fn(),
      isReady: true
    });
  });

  it('Issue #2417の実際のケース：99%以上の差異がある外部取引は個別にINFOレベルで出力される', async () => {
    // Issue #2417で報告された実際の残高データを再現
    config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
      total: {
        DOGE: 2.5773,
        ASTR: 263.8481,
        ADA: 0.4659,
        AVAX: 0.0141,
        AXS: 0.1488,
        FLR: 235.7937,
        SAND: 16.288,
        GALA: 273.3722,
        CHZ: 14.0043
      }
    });

    // Bot残高：全て非常に小さい値（外部取引の典型的パターン）
    getAllPositionsRedis.mockResolvedValue([
      { exchange: 'bitbank', symbol: 'DOGE/JPY', side: 'buy', amount: 0.0011, status: 'open' },
      { exchange: 'bitbank', symbol: 'ASTR/JPY', side: 'buy', amount: 0, status: 'open' },
      { exchange: 'bitbank', symbol: 'ADA/JPY', side: 'buy', amount: 0.0016, status: 'open' },
      { exchange: 'bitbank', symbol: 'AVAX/JPY', side: 'buy', amount: 0.0002, status: 'open' },
      { exchange: 'bitbank', symbol: 'AXS/JPY', side: 'buy', amount: 0.0021, status: 'open' },
      { exchange: 'bitbank', symbol: 'FLR/JPY', side: 'buy', amount: 0, status: 'open' },
      { exchange: 'bitbank', symbol: 'SAND/JPY', side: 'buy', amount: 0.0032, status: 'open' },
      { exchange: 'bitbank', symbol: 'GALA/JPY', side: 'buy', amount: 0.0073, status: 'open' },
      { exchange: 'bitbank', symbol: 'CHZ/JPY', side: 'buy', amount: 0.0999, status: 'open' }
    ]);

    const result = await compareBalances('bitbank');

    // 複数の不整合が検出されることを確認
    expect(result.discrepancies.length).toBeGreaterThan(0);
    
    // 全ての不整合が外部取引として判定されることを確認
    const externalTradeDiscrepancies = result.discrepancies.filter(d => d.isExternalTradeSuspected);
    expect(externalTradeDiscrepancies.length).toBe(result.discrepancies.length);

    // CHZの具体的な値を確認（Issue #2417の実際の値）
    const chzDiscrepancy = result.discrepancies.find(d => d.currency === 'CHZ');
    expect(chzDiscrepancy).toBeTruthy();
    expect(chzDiscrepancy.exchangeAmount).toBe(14.0043);
    expect(chzDiscrepancy.botAmount).toBe(0.0999);
    expect(chzDiscrepancy.discrepancyPercent).toBeGreaterThan(99);
    expect(chzDiscrepancy.isExternalTradeSuspected).toBe(true);

    // 各個別ログエントリがINFOレベルで出力されることを確認（修正後の動作）
    expect(mockLoggerInstance.info).toHaveBeenCalledWith(
      expect.stringMatching(/CHZ: 取引所=14\.0043, Bot=0\.0999, 差異=13\.9044 \(99\.29%\).*⚠️外部取引の可能性/)
    );
    
    expect(mockLoggerInstance.info).toHaveBeenCalledWith(
      expect.stringMatching(/DOGE: 取引所=2\.5773, Bot=0\.0011, 差異=2\.5762 \(99\.96%\).*⚠️外部取引の可能性/)
    );
    
    expect(mockLoggerInstance.info).toHaveBeenCalledWith(
      expect.stringMatching(/ASTR: 取引所=263\.8481, Bot=0, 差異=263\.8481 \(100%\).*⚠️外部取引の可能性/)
    );

    // ERRORレベルでは個別エントリが出力されていないことを確認
    expect(mockLoggerInstance.error).not.toHaveBeenCalledWith(
      expect.stringContaining('CHZ:')
    );
    expect(mockLoggerInstance.error).not.toHaveBeenCalledWith(
      expect.stringContaining('DOGE:')
    );
    expect(mockLoggerInstance.error).not.toHaveBeenCalledWith(
      expect.stringContaining('ASTR:')
    );
  });

  it('混在ケース：外部取引とシステム不整合で個別に適切なログレベルが適用される', async () => {
    // 外部取引（90%以上）とシステム不整合（50%未満）の混在
    config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
      total: {
        CHZ: 14.0043,    // 外部取引：99.29%差異 → INFO
        BTC: 1.0,        // システム不整合：15%差異 → ERROR（高度不整合）
        ETH: 2.0         // 軽微不整合：5%差異 → WARN
      }
    });

    getAllPositionsRedis.mockResolvedValue([
      { exchange: 'bitbank', symbol: 'CHZ/JPY', side: 'buy', amount: 0.0999, status: 'open' },
      { exchange: 'bitbank', symbol: 'BTC/JPY', side: 'buy', amount: 0.85, status: 'open' },
      { exchange: 'bitbank', symbol: 'ETH/JPY', side: 'buy', amount: 1.9, status: 'open' }
    ]);

    const result = await compareBalances('bitbank');

    // 3件の不整合が検出されることを確認
    expect(result.discrepancies).toHaveLength(3);

    // CHZ（外部取引）はINFOレベルで出力
    expect(mockLoggerInstance.info).toHaveBeenCalledWith(
      expect.stringMatching(/CHZ: 取引所=14\.0043, Bot=0\.0999.*⚠️外部取引の可能性/)
    );

    // BTC（高度不整合）はERRORレベルで出力
    expect(mockLoggerInstance.error).toHaveBeenCalledWith(
      expect.stringMatching(/BTC: 取引所=1, Bot=0\.85/)
    );

    // ETH（軽微不整合）はWARNレベルで出力
    expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
      expect.stringMatching(/ETH: 取引所=2, Bot=1\.9/)
    );
  });

  it('境界値テスト：50%ちょうどの差異は外部取引としてINFOレベルで出力される', async () => {
    config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
      total: { BTC: 1.0 }
    });

    getAllPositionsRedis.mockResolvedValue([
      { exchange: 'bitbank', symbol: 'BTC/JPY', side: 'buy', amount: 0.5, status: 'open' } // 50%差異
    ]);

    const result = await compareBalances('bitbank');

    // 50%の差異は外部取引として判定
    expect(result.discrepancies).toHaveLength(1);
    expect(result.discrepancies[0].discrepancyPercent).toBe(50);
    expect(result.discrepancies[0].isExternalTradeSuspected).toBe(true);

    // 個別ログエントリがINFOレベルで出力される
    expect(mockLoggerInstance.info).toHaveBeenCalledWith(
      expect.stringMatching(/BTC: 取引所=1, Bot=0\.5.*⚠️外部取引の可能性/)
    );

    // ERRORレベルでは出力されない
    expect(mockLoggerInstance.error).not.toHaveBeenCalledWith(
      expect.stringContaining('BTC:')
    );
  });

  it('90%以上の差異は明らかな外部取引としてINFOレベルで出力される', async () => {
    config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
      total: { CHZ: 14.0043 }
    });

    getAllPositionsRedis.mockResolvedValue([
      { exchange: 'bitbank', symbol: 'CHZ/JPY', side: 'buy', amount: 0.0999, status: 'open' } // 99.29%差異
    ]);

    await compareBalances('bitbank');

    // 90%以上の明らかな外部取引はINFOレベルで出力
    expect(mockLoggerInstance.info).toHaveBeenCalledWith(
      expect.stringMatching(/CHZ: 取引所=14\.0043, Bot=0\.0999.*⚠️外部取引の可能性/)
    );

    // ERRORレベルでは出力されない
    expect(mockLoggerInstance.error).not.toHaveBeenCalledWith(
      expect.stringContaining('CHZ:')
    );
  });

  it('50%未満の差異で高度不整合（10%以上）はERRORレベルで出力される', async () => {
    config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
      total: { BTC: 1.0 }
    });

    getAllPositionsRedis.mockResolvedValue([
      { exchange: 'bitbank', symbol: 'BTC/JPY', side: 'buy', amount: 0.8, status: 'open' } // 20%差異
    ]);

    const result = await compareBalances('bitbank');

    // 20%の差異は外部取引ではなく高度不整合として判定
    expect(result.discrepancies).toHaveLength(1);
    expect(result.discrepancies[0].discrepancyPercent).toBe(20);
    expect(result.discrepancies[0].isExternalTradeSuspected).toBe(false);

    // 個別ログエントリがERRORレベルで出力される
    expect(mockLoggerInstance.error).toHaveBeenCalledWith(
      expect.stringMatching(/BTC: 取引所=1, Bot=0\.8/)
    );

    // ⚠️外部取引の可能性マークは付かない
    expect(mockLoggerInstance.error).toHaveBeenCalledWith(
      expect.not.stringMatching(/⚠️外部取引の可能性/)
    );
  });

  it('軽微な不整合（10%未満）はWARNレベルで出力される', async () => {
    config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
      total: { BTC: 1.0 }
    });

    getAllPositionsRedis.mockResolvedValue([
      { exchange: 'bitbank', symbol: 'BTC/JPY', side: 'buy', amount: 0.95, status: 'open' } // 5%差異
    ]);

    const result = await compareBalances('bitbank');

    // 5%の差異は軽微な不整合として判定
    expect(result.discrepancies).toHaveLength(1);
    expect(result.discrepancies[0].discrepancyPercent).toBe(5);
    expect(result.discrepancies[0].isExternalTradeSuspected).toBe(false);

    // 個別ログエントリがWARNレベルで出力される
    expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
      expect.stringMatching(/BTC: 取引所=1, Bot=0\.95/)
    );

    // ERRORレベルでは出力されない
    expect(mockLoggerInstance.error).not.toHaveBeenCalledWith(
      expect.stringContaining('BTC:')
    );
  });
});