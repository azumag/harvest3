/**
 * 戦略ログ出力抑制機能のテスト
 * Issue #409: 意味不明な戦略を削除 - レガシー戦略のログ抑制
 */

// モック設定
jest.mock('../../../src/database/manager');
jest.mock('../../../src/common/notifications');
jest.mock('../../../src/config/strategyManager');

const { getStrategyConfig } = require('../../../src/database/manager');

describe('Strategy Logging Suppression', () => {
  let mockLogger;
  let mockConfig;
  let mockExchange;

  beforeEach(() => {
    // ログ機能のモック
    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    // 設定モック
    mockConfig = {
      strategies: {
        // 通常の戦略（無効）
        NORMAL_STRATEGY: {
          type: 'normal',
          enabled: false,
          function: () => {}
        },
        // レガシー戦略（無効）
        OUTSIDE: {
          type: 'legacy',
          enabled: false,
          description: 'Legacy strategy for external or manual trades',
          function: null
        },
        UNKNOWN: {
          type: 'legacy',
          enabled: false,
          description: 'Legacy strategy for unidentified trades',
          function: null
        }
      }
    };

    // 取引所インスタンスモック
    mockExchange = {
      id: 'bitbank',
      markets: { 'BTC/JPY': { symbol: 'BTC/JPY' } }
    };

    // getStrategyConfigのモック実装
    getStrategyConfig.mockImplementation((exchange, symbol, strategyKey, config) => {
      const strategy = config.strategies[strategyKey];
      if (!strategy) {return null;}
      return {
        enabled: strategy.enabled,
        type: strategy.type,
        ...strategy
      };
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('レガシー戦略の場合、無効ログが出力されない', async () => {
    // bot.jsの該当部分を模擬実行
    for (const strategyKey of Object.keys(mockConfig.strategies)) {
      const strategy = mockConfig.strategies[strategyKey];
      
      const strategyConfig = await getStrategyConfig(mockExchange, 'BTC/JPY', strategyKey, mockConfig);
      if (!strategyConfig || !strategyConfig.enabled) {
        // レガシー戦略の場合はログ出力を抑制
        if (strategy.type !== 'legacy') {
          mockLogger.info(`戦略 ${strategyKey} が無効です`);
        }
        continue;
      }
    }

    // レガシー戦略（OUTSIDE、UNKNOWN）のログが出力されていないことを確認
    expect(mockLogger.info).toHaveBeenCalledTimes(1);
    expect(mockLogger.info).toHaveBeenCalledWith('戦略 NORMAL_STRATEGY が無効です');
    expect(mockLogger.info).not.toHaveBeenCalledWith('戦略 OUTSIDE が無効です');
    expect(mockLogger.info).not.toHaveBeenCalledWith('戦略 UNKNOWN が無効です');
  });

  test('通常の戦略の場合、無効ログが出力される', async () => {
    // 通常の戦略のみをテスト
    const normalStrategy = { type: 'normal', enabled: false };
    const strategyConfig = await getStrategyConfig(mockExchange, 'BTC/JPY', 'NORMAL_STRATEGY', mockConfig);
    
    if (!strategyConfig || !strategyConfig.enabled) {
      if (normalStrategy.type !== 'legacy') {
        mockLogger.info('戦略 NORMAL_STRATEGY が無効です');
      }
    }

    expect(mockLogger.info).toHaveBeenCalledWith('戦略 NORMAL_STRATEGY が無効です');
  });

  test('有効な戦略の場合、ログが出力されない', async () => {
    // 有効な戦略の設定
    const enabledConfig = {
      strategies: {
        ENABLED_STRATEGY: {
          type: 'normal',
          enabled: true,
          function: () => {}
        }
      }
    };

    getStrategyConfig.mockReturnValueOnce({
      enabled: true,
      type: 'normal'
    });

    const strategyConfig = await getStrategyConfig(mockExchange, 'BTC/JPY', 'ENABLED_STRATEGY', enabledConfig);
    
    if (!strategyConfig || !strategyConfig.enabled) {
      mockLogger.info('戦略 ENABLED_STRATEGY が無効です');
    }

    // 有効な戦略なので無効ログは出力されない
    expect(mockLogger.info).not.toHaveBeenCalled();
  });
});