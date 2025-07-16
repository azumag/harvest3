/**
 * Tests for Issue #2441: strategy-runnerサービスで例外が発生
 * 複数通貨での外部取引による残高差異のログレベル修正
 */

// Mock dependencies
jest.mock('../../../src/config', () => ({
  config: {
    exchanges: {
      bitbank: {
        symbols: ['IMX/JPY', 'OAS/JPY', 'MANA/JPY', 'GRT/JPY', 'RENDER/JPY', 'BNB/JPY', 'OP/JPY', 'ARB/JPY', 'KLAY/JPY'],
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

describe('Issue #2441: strategy-runnerサービスで例外が発生 - 修正テスト', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    postOrderToDiscord.mockResolvedValue();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('Issue #2441のケース: 全て外部取引（90%以上）で、INFOレベルで出力される', async () => {
    // Issue #2441で報告された実際の値を設定
    config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
      total: {
        OAS: 921.0375,
        MANA: 4.4588,
        GRT: 9.9385,
        RENDER: 1.7324,
        BNB: 0.0008,
        OP: 2.0372,
        ARB: 4.6001,
        KLAY: 0.3721,
        IMX: 0.4499
      }
    });

    // Bot残高: 全て0またはごく少量（94-100%の差異）
    getAllPositionsRedis.mockResolvedValue([
      { exchange: 'bitbank', symbol: 'OAS/JPY', side: 'buy', amount: 0, status: 'open' },
      { exchange: 'bitbank', symbol: 'MANA/JPY', side: 'buy', amount: 0.009, status: 'open' },
      { exchange: 'bitbank', symbol: 'GRT/JPY', side: 'buy', amount: 0, status: 'open' },
      { exchange: 'bitbank', symbol: 'RENDER/JPY', side: 'buy', amount: 0, status: 'open' },
      { exchange: 'bitbank', symbol: 'BNB/JPY', side: 'buy', amount: 0, status: 'open' },
      { exchange: 'bitbank', symbol: 'OP/JPY', side: 'buy', amount: 0, status: 'open' },
      { exchange: 'bitbank', symbol: 'ARB/JPY', side: 'buy', amount: 0, status: 'open' },
      { exchange: 'bitbank', symbol: 'KLAY/JPY', side: 'buy', amount: 0.0202, status: 'open' },
      { exchange: 'bitbank', symbol: 'IMX/JPY', side: 'buy', amount: 0.0041, status: 'open' }
    ]);

    await compareBalances('bitbank');

    // 修正後はINFOレベルで出力される
    expect(mockLoggerInstance.info).toHaveBeenCalledWith(
      expect.stringMatching(/残高不整合検出: bitbank.*外部取引による残高差異/)
    );

    // Issue #2441修正: 判定結果が強制的に記録されることを確認
    expect(mockLoggerInstance.info).toHaveBeenCalledWith(
      expect.stringMatching(/\[Issue #2441\] ログレベル判定結果 \(bitbank\): INFO - 外部取引による残高差異/)
    );

    // ERRORレベルでは出力されていないことを確認
    expect(mockLoggerInstance.error).not.toHaveBeenCalledWith(
      expect.stringContaining('残高不整合検出: bitbank')
    );

    // 各通貨の詳細もINFOレベルで出力されることを確認
    expect(mockLoggerInstance.info).toHaveBeenCalledWith(
      expect.stringMatching(/GRT: 取引所=9\.9385, Bot=0, 差異=9\.9385 \(100%\).*外部取引の可能性/)
    );

    expect(mockLoggerInstance.info).toHaveBeenCalledWith(
      expect.stringMatching(/IMX: 取引所=0\.4499, Bot=0\.0041, 差異=0\.4458 \(99\.09%\).*外部取引の可能性/)
    );

    // デバッグ情報も出力されることを確認
    expect(mockLoggerInstance.debug).toHaveBeenCalledWith(
      expect.stringMatching(/ログレベル判定デバッグ \(bitbank\):/)
    );
  });

  it('Issue #2441修正: 異常な場合の強制修正機能が動作する', async () => {
    // 全て外部取引（90%以上）だが、何らかの理由でERRORレベルが選択されるケースを模擬
    config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
      total: {
        BTC: 1.0,
        ETH: 2.0
      }
    });

    getAllPositionsRedis.mockResolvedValue([
      { exchange: 'bitbank', symbol: 'BTC/JPY', side: 'buy', amount: 0.05, status: 'open' },  // 95%差異
      { exchange: 'bitbank', symbol: 'ETH/JPY', side: 'buy', amount: 0.1, status: 'open' }    // 95%差異
    ]);

    await compareBalances('bitbank');

    // 正常にINFOレベルで出力される
    expect(mockLoggerInstance.info).toHaveBeenCalledWith(
      expect.stringMatching(/残高不整合検出: bitbank.*外部取引による残高差異/)
    );

    // 異常検出の警告は出力されない（正常なケースのため）
    expect(mockLoggerInstance.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('[Issue #2441] 異常検出: 全て外部取引（90%以上）なのにERRORレベル選択')
    );
  });

  it('Issue #2441修正: 非外部取引の場合はERRORレベルが維持される', async () => {
    // 非外部取引（90%未満）の高度不整合の場合
    config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
      total: {
        BTC: 1.0,
        ETH: 2.0
      }
    });

    getAllPositionsRedis.mockResolvedValue([
      { exchange: 'bitbank', symbol: 'BTC/JPY', side: 'buy', amount: 0.8, status: 'open' },   // 20%差異（非外部取引）
      { exchange: 'bitbank', symbol: 'ETH/JPY', side: 'buy', amount: 1.4, status: 'open' }    // 30%差異（非外部取引）
    ]);

    await compareBalances('bitbank');

    // 非外部取引の高度不整合のため、ERRORレベルで出力される
    expect(mockLoggerInstance.error).toHaveBeenCalledWith(
      expect.stringMatching(/残高不整合検出: bitbank.*高度不整合/)
    );

    // 判定結果がERRORであることを確認
    expect(mockLoggerInstance.info).toHaveBeenCalledWith(
      expect.stringMatching(/\[Issue #2441\] ログレベル判定結果 \(bitbank\): ERROR - 高度不整合/)
    );

    // 異常検出の警告は出力されない（非外部取引のため）
    expect(mockLoggerInstance.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('[Issue #2441] 異常検出:')
    );
  });

  it('Issue #2441修正: デバッグ情報が適切に出力される', async () => {
    config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
      total: {
        BTC: 1.0,
        ETH: 2.0,
        ADA: 1.0
      }
    });

    getAllPositionsRedis.mockResolvedValue([
      { exchange: 'bitbank', symbol: 'BTC/JPY', side: 'buy', amount: 0.33, status: 'open' },  // 67%差異（外部取引）
      { exchange: 'bitbank', symbol: 'ETH/JPY', side: 'buy', amount: 0.33, status: 'open' },   // 83.5%差異（外部取引）
      { exchange: 'bitbank', symbol: 'ADA/JPY', side: 'buy', amount: 0.8, status: 'open' }    // 20%差異（非外部取引）
    ]);

    await compareBalances('bitbank');

    // デバッグ情報が出力されることを確認
    expect(mockLoggerInstance.debug).toHaveBeenCalledWith(
      expect.stringMatching(/ログレベル判定デバッグ \(bitbank\): 総不整合=3, 外部取引=2, 高度外部取引=0, 非外部高度不整合=1/)
    );

    // 具体的な条件適用のデバッグ情報も確認
    expect(mockLoggerInstance.debug).toHaveBeenCalledWith(
      expect.stringMatching(/ログレベル判定 \(bitbank\): 条件3a適用 - 外部取引比率66\.7% >= 50% -> INFO/)
    );
  });

  it('Issue #2441修正: 各判定パターンでの正確な動作確認', async () => {
    const testCases = [
      {
        name: '全て高度外部取引（90%以上）',
        exchangeBalance: { BTC: 1.0, ETH: 2.0 },
        botPositions: [
          { symbol: 'BTC/JPY', amount: 0.05 },  // 95%差異
          { symbol: 'ETH/JPY', amount: 0.1 }    // 95%差異
        ],
        expectedLogLevel: 'info',
        expectedSeverityText: '外部取引による残高差異'
      },
      {
        name: '過半数が高度外部取引（90%以上）',
        exchangeBalance: { BTC: 1.0, ETH: 2.0, ADA: 1.0 },
        botPositions: [
          { symbol: 'BTC/JPY', amount: 0.05 },  // 95%差異（外部取引）
          { symbol: 'ETH/JPY', amount: 0.1 },   // 95%差異（外部取引）
          { symbol: 'ADA/JPY', amount: 0.8 }    // 20%差異（非外部取引）
        ],
        expectedLogLevel: 'info',
        expectedSeverityText: '外部取引による残高差異（一部混在）'
      },
      {
        name: '非外部取引の高度不整合のみ',
        exchangeBalance: { BTC: 1.0, ETH: 2.0 },
        botPositions: [
          { symbol: 'BTC/JPY', amount: 0.8 },   // 20%差異（非外部取引）
          { symbol: 'ETH/JPY', amount: 1.4 }    // 30%差異（非外部取引）
        ],
        expectedLogLevel: 'error',
        expectedSeverityText: '高度不整合'
      }
    ];

    for (const testCase of testCases) {
      jest.clearAllMocks();

      config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
        total: testCase.exchangeBalance
      });

      getAllPositionsRedis.mockResolvedValue(
        testCase.botPositions.map(pos => ({
          exchange: 'bitbank',
          symbol: pos.symbol,
          side: 'buy',
          amount: pos.amount,
          status: 'open'
        }))
      );

      await compareBalances('bitbank');

      // 判定結果が正しいことを確認
      expect(mockLoggerInstance.info).toHaveBeenCalledWith(
        expect.stringMatching(new RegExp(`\\[Issue #2441\\] ログレベル判定結果 \\(bitbank\\): ${testCase.expectedLogLevel.toUpperCase()} - ${testCase.expectedSeverityText}`))
      );

      // メインログが期待されるレベルで出力されることを確認
      expect(mockLoggerInstance[testCase.expectedLogLevel]).toHaveBeenCalledWith(
        expect.stringMatching(new RegExp(`残高不整合検出: bitbank.*${testCase.expectedSeverityText}`))
      );
    }
  });
});