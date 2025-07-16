/**
 * Tests for Issue #2301: strategy-runnerサービスで例外が発生
 * 外部取引による残高差異の適切な処理のテスト
 */

// Mock dependencies
jest.mock('../../../src/config', () => ({
  config: {
    exchanges: {
      bitbank: {
        symbols: ['BTC/JPY', 'ETH/JPY', 'MANA/JPY', 'AVAX/JPY', 'AXS/JPY'],
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

describe('Issue #2301: 外部取引による残高差異の適切な処理', () => {
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

  it('Issue #2301の実際のケース：全て外部取引の可能性が高い場合、INFOレベルで処理される', async () => {
    // Issue #2301で報告された実際の残高データを再現
    config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
      total: {
        AVAX: 0.0141,
        AXS: 0.1488,
        FLR: 235.7937,
        SAND: 16.288,
        GALA: 273.3722,
        CHZ: 14.0043,
        APE: 0.9309,
        OAS: 921.0375,
        MANA: 4.4588
      }
    });

    // Bot残高：全て非常に小さい値（外部取引の典型的パターン）
    getAllPositionsRedis.mockResolvedValue([
      { exchange: 'bitbank', symbol: 'AVAX/JPY', side: 'buy', amount: 0.0002, status: 'open' },
      { exchange: 'bitbank', symbol: 'AXS/JPY', side: 'buy', amount: 0.0021, status: 'open' },
      { exchange: 'bitbank', symbol: 'FLR/JPY', side: 'buy', amount: 0, status: 'open' },
      { exchange: 'bitbank', symbol: 'SAND/JPY', side: 'buy', amount: 0.0032, status: 'open' },
      { exchange: 'bitbank', symbol: 'GALA/JPY', side: 'buy', amount: 0.0073, status: 'open' },
      { exchange: 'bitbank', symbol: 'CHZ/JPY', side: 'buy', amount: 0.0999, status: 'open' },
      { exchange: 'bitbank', symbol: 'APE/JPY', side: 'buy', amount: 0.0035, status: 'open' },
      { exchange: 'bitbank', symbol: 'OAS/JPY', side: 'buy', amount: 0, status: 'open' },
      { exchange: 'bitbank', symbol: 'MANA/JPY', side: 'buy', amount: 0.009, status: 'open' }
    ]);

    const result = await compareBalances('bitbank');

    // 複数の不整合が検出されることを確認
    expect(result.discrepancies.length).toBeGreaterThan(0);
    
    // 全ての不整合が外部取引として判定されることを確認
    const externalTradeDiscrepancies = result.discrepancies.filter(d => d.isExternalTradeSuspected);
    expect(externalTradeDiscrepancies.length).toBe(result.discrepancies.length);

    // 高い差異率を確認（Issue #2301の実際の値）
    const manaDiscrepancy = result.discrepancies.find(d => d.currency === 'MANA');
    expect(manaDiscrepancy).toBeTruthy();
    expect(manaDiscrepancy.exchangeAmount).toBe(4.4588);
    expect(manaDiscrepancy.botAmount).toBe(0.009);
    expect(manaDiscrepancy.discrepancyPercent).toBeGreaterThan(90);
    expect(manaDiscrepancy.isExternalTradeSuspected).toBe(true);

    // INFOレベルでログ出力されることを確認（ERRORではない）
    expect(mockLoggerInstance.info).toHaveBeenCalledWith(
      expect.stringContaining('残高不整合検出: bitbank')
    );
    expect(mockLoggerInstance.info).toHaveBeenCalledWith(
      expect.stringContaining('外部取引による残高差異')
    );

    // ERRORレベルでは出力されていないことを確認
    expect(mockLoggerInstance.error).not.toHaveBeenCalledWith(
      expect.stringContaining('残高不整合検出: bitbank')
    );
  });

  it('外部取引とシステム不整合が混在する場合、ERRORレベルで処理される', async () => {
    // 一部は外部取引、一部はシステム不整合のパターン
    config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
      total: {
        BTC: 1.0,     // 通常の不整合（15%差異）
        MANA: 2.0     // 外部取引（67%差異、90%未満なので very high ではない）
      }
    });

    getAllPositionsRedis.mockResolvedValue([
      { exchange: 'bitbank', symbol: 'BTC/JPY', side: 'buy', amount: 0.85, status: 'open' }, // 15%差異
      { exchange: 'bitbank', symbol: 'MANA/JPY', side: 'buy', amount: 0.66, status: 'open' } // 67%差異
    ]);

    const result = await compareBalances('bitbank');

    // 2件の不整合が検出されることを確認
    expect(result.discrepancies).toHaveLength(2);

    // 一部のみが外部取引として判定されることを確認
    const externalTradeDiscrepancies = result.discrepancies.filter(d => d.isExternalTradeSuspected);
    expect(externalTradeDiscrepancies.length).toBe(1);
    expect(externalTradeDiscrepancies[0].currency).toBe('MANA');

    // 混在の場合はWARNレベルで処理されることを確認（外部取引要因を含むため）
    expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
      expect.stringContaining('残高不整合検出: bitbank')
    );
    expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
      expect.stringContaining('混合不整合（外部取引と高度不整合）')
    );
  });

  it('Discord通知メッセージが外部取引向けに最適化される', async () => {
    // 全て外部取引のケース
    config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
      total: {
        MANA: 4.4588,
        AVAX: 0.0141
      }
    });

    getAllPositionsRedis.mockResolvedValue([
      { exchange: 'bitbank', symbol: 'MANA/JPY', side: 'buy', amount: 0.009, status: 'open' },
      { exchange: 'bitbank', symbol: 'AVAX/JPY', side: 'buy', amount: 0.0002, status: 'open' }
    ]);

    await compareBalances('bitbank');

    // Discord通知が送信されることを確認
    expect(postOrderToDiscord).toHaveBeenCalled();
    
    const discordMessage = postOrderToDiscord.mock.calls[0][0];
    
    // 外部取引向けのメッセージであることを確認
    expect(discordMessage).toContain('💡'); // 情報アイコン
    expect(discordMessage).toContain('外部取引による残高差異検出');
    expect(discordMessage).toContain('外部取引が原因の可能性があります');
    expect(discordMessage).toContain('取引所での手動取引履歴を確認し');
    
    // エラーメッセージではないことを確認
    expect(discordMessage).not.toContain('🚨'); // エラーアイコンが使われていない
    expect(discordMessage).not.toContain('緊急対応が必要です');
  });

  it('軽微な不整合（50%未満）の場合、従来通りWARNレベルで処理される', async () => {
    // 50%未満の差異（外部取引ではない）
    config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
      total: { BTC: 1.0 }
    });

    getAllPositionsRedis.mockResolvedValue([
      { exchange: 'bitbank', symbol: 'BTC/JPY', side: 'buy', amount: 0.95, status: 'open' } // 5%差異
    ]);

    const result = await compareBalances('bitbank');

    // 1件の不整合が検出され、外部取引ではないことを確認
    expect(result.discrepancies).toHaveLength(1);
    expect(result.discrepancies[0].isExternalTradeSuspected).toBe(false);

    // WARNレベルで処理されることを確認
    expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
      expect.stringContaining('残高不整合検出: bitbank')
    );
    expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
      expect.stringContaining('軽微な不整合')
    );
  });

  it('外部取引閾値ちょうど（50%）の境界値テスト', async () => {
    // ちょうど50%の差異
    config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
      total: { BTC: 1.0 }
    });

    getAllPositionsRedis.mockResolvedValue([
      { exchange: 'bitbank', symbol: 'BTC/JPY', side: 'buy', amount: 0.5, status: 'open' } // 50%差異
    ]);

    const result = await compareBalances('bitbank');

    // 50%の差異は外部取引として判定されることを確認
    expect(result.discrepancies).toHaveLength(1);
    expect(result.discrepancies[0].discrepancyPercent).toBe(50);
    expect(result.discrepancies[0].isExternalTradeSuspected).toBe(true);

    // 全て外部取引なのでINFOレベルで処理されることを確認
    expect(mockLoggerInstance.info).toHaveBeenCalledWith(
      expect.stringContaining('外部取引による残高差異')
    );
  });

  it('Issue #2301の修正により詳細ログにも適切なレベルが適用される', async () => {
    config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
      total: { MANA: 4.4588 }
    });

    getAllPositionsRedis.mockResolvedValue([
      { exchange: 'bitbank', symbol: 'MANA/JPY', side: 'buy', amount: 0.009, status: 'open' }
    ]);

    await compareBalances('bitbank');

    // 詳細ログもINFOレベルで出力されることを確認
    expect(mockLoggerInstance.info).toHaveBeenCalledWith(
      expect.stringMatching(/MANA: 取引所=4\.4588, Bot=0\.009, 差異=4\.4498 \(99\.8%\).*⚠️外部取引の可能性/)
    );

    // ERRORレベルでは出力されていないことを確認
    expect(mockLoggerInstance.error).not.toHaveBeenCalledWith(
      expect.stringContaining('MANA:')
    );
  });
});