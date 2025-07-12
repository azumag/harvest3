/**
 * 定数モジュールのテスト
 * マジックナンバー排除による定数化の検証
 */

const {
  TRADING_EXECUTION_CONSTANTS,
  POSITION_CONTROL_CONSTANTS,
  PORTFOLIO_CONTROL_CONSTANTS
} = require('../../../src/common/const');

describe('取引実行定数テスト', () => {
  test('ボリューム正規化定数が正しく定義されている', () => {
    expect(TRADING_EXECUTION_CONSTANTS.VOLUME_NORMALIZATION_BASE).toBe(1000);
    expect(typeof TRADING_EXECUTION_CONSTANTS.VOLUME_NORMALIZATION_BASE).toBe('number');
  });

  test('実行確率定数が正しい範囲で定義されている', () => {
    expect(TRADING_EXECUTION_CONSTANTS.BASE_EXECUTION_PROBABILITY).toBe(0.85);
    expect(TRADING_EXECUTION_CONSTANTS.MAX_EXECUTION_PROBABILITY).toBe(0.99);
    expect(TRADING_EXECUTION_CONSTANTS.BASE_EXECUTION_PROBABILITY)
      .toBeLessThan(TRADING_EXECUTION_CONSTANTS.MAX_EXECUTION_PROBABILITY);
  });

  test('スリッページ定数が正しい範囲で定義されている', () => {
    expect(TRADING_EXECUTION_CONSTANTS.BASE_SLIPPAGE_PERCENT).toBe(0.0001);
    expect(TRADING_EXECUTION_CONSTANTS.MAX_SLIPPAGE_PERCENT).toBe(0.001);
    expect(TRADING_EXECUTION_CONSTANTS.BASE_SLIPPAGE_PERCENT)
      .toBeLessThan(TRADING_EXECUTION_CONSTANTS.MAX_SLIPPAGE_PERCENT);
  });

  test('スプレッド定数が正しい範囲で定義されている', () => {
    expect(TRADING_EXECUTION_CONSTANTS.BASE_SPREAD_PERCENT).toBe(0.0002);
    expect(TRADING_EXECUTION_CONSTANTS.MAX_SPREAD_PERCENT).toBe(0.002);
    expect(TRADING_EXECUTION_CONSTANTS.BASE_SPREAD_PERCENT)
      .toBeLessThan(TRADING_EXECUTION_CONSTANTS.MAX_SPREAD_PERCENT);
  });

  test('スプレッド計算係数が正しく定義されている', () => {
    expect(TRADING_EXECUTION_CONSTANTS.SPREAD_VOLATILITY_MULTIPLIER).toBe(2);
    expect(TRADING_EXECUTION_CONSTANTS.SPREAD_DIVISOR).toBe(2);
  });
});

describe('ポジション制御定数テスト', () => {
  test('ストップロス定数が正しく定義されている', () => {
    expect(POSITION_CONTROL_CONSTANTS.FIXED_STOP_LOSS_PERCENT).toBe(0.03);
    expect(POSITION_CONTROL_CONSTANTS.TRAILING_STOP_TRIGGER_PERCENT).toBe(0.02);
    expect(POSITION_CONTROL_CONSTANTS.TRAILING_STOP_DISTANCE_PERCENT).toBe(0.02);
  });

  test('時間ベース設定が正しく定義されている', () => {
    expect(POSITION_CONTROL_CONSTANTS.TIME_BASED_STOP_HOURS).toBe(24);
    expect(POSITION_CONTROL_CONSTANTS.POSITION_AGE_DIVISOR).toBe(1000 * 60 * 60);
  });

  test('ポジション年齢計算用除数が1時間のミリ秒数と一致している', () => {
    const oneHourInMs = 1000 * 60 * 60; // 1秒(1000ms) * 60秒 * 60分
    expect(POSITION_CONTROL_CONSTANTS.POSITION_AGE_DIVISOR).toBe(oneHourInMs);
  });
});

describe('ポートフォリオ制御定数テスト', () => {
  test('グローバル制限が正しく定義されている', () => {
    expect(PORTFOLIO_CONTROL_CONSTANTS.MAX_TOTAL_POSITIONS).toBe(200);
    expect(PORTFOLIO_CONTROL_CONSTANTS.MAX_TOTAL_VALUE).toBe(1000000);
  });

  test('配分制限が正しい範囲で定義されている', () => {
    expect(PORTFOLIO_CONTROL_CONSTANTS.MAX_SINGLE_STRATEGY_RATIO).toBe(0.35);
    expect(PORTFOLIO_CONTROL_CONSTANTS.MAX_SINGLE_CURRENCY_RATIO).toBe(0.10);
    expect(PORTFOLIO_CONTROL_CONSTANTS.MAX_SINGLE_STRATEGY_RATIO)
      .toBeGreaterThan(PORTFOLIO_CONTROL_CONSTANTS.MAX_SINGLE_CURRENCY_RATIO);
  });

  test('リスク制限が正しく定義されている', () => {
    expect(PORTFOLIO_CONTROL_CONSTANTS.MAX_DRAWDOWN).toBe(0.15);
    expect(PORTFOLIO_CONTROL_CONSTANTS.MAX_DAILY_LOSS).toBe(0.05);
    expect(PORTFOLIO_CONTROL_CONSTANTS.MAX_LONG_RATIO).toBe(0.75);
    expect(PORTFOLIO_CONTROL_CONSTANTS.MAX_CORRELATION).toBe(0.8);
    expect(PORTFOLIO_CONTROL_CONSTANTS.VOLATILITY_THRESHOLD).toBe(0.3);
  });

  test('戦略配分設定が正しく定義されている', () => {
    const allocation = PORTFOLIO_CONTROL_CONSTANTS.STRATEGY_ALLOCATION;
    expect(allocation).toBeDefined();
    expect(typeof allocation).toBe('object');

    // 各戦略の設定が存在し、正しい構造を持っていることを確認
    const strategies = [
      'BOLLINGER_BANDS_CONSERVATIVE',
      'BOLLINGER_BANDS_AGGRESSIVE',
      'MULTI_INDICATOR',
      'MEAN_REVERSION',
      'MACD',
      'TECHNICAL_MOMENTUM'
    ];

    strategies.forEach(strategy => {
      expect(allocation[strategy]).toBeDefined();
      expect(allocation[strategy]).toHaveProperty('min');
      expect(allocation[strategy]).toHaveProperty('max');
      expect(allocation[strategy]).toHaveProperty('target');
      
      // min <= target <= max の関係が成り立っていることを確認
      expect(allocation[strategy].min).toBeLessThanOrEqual(allocation[strategy].target);
      expect(allocation[strategy].target).toBeLessThanOrEqual(allocation[strategy].max);
    });
  });

  test('戦略配分の合計目標値が100%以下である', () => {
    const allocation = PORTFOLIO_CONTROL_CONSTANTS.STRATEGY_ALLOCATION;
    const totalTarget = Object.values(allocation).reduce((sum, strategy) => sum + strategy.target, 0);
    expect(totalTarget).toBeLessThanOrEqual(1.0); // 100%以下
  });
});

describe('定数の型チェック', () => {
  test('すべての数値定数が正しい型を持っている', () => {
    // 取引実行定数
    Object.values(TRADING_EXECUTION_CONSTANTS).forEach(value => {
      if (typeof value !== 'object') {
        expect(typeof value).toBe('number');
        expect(value).toBeGreaterThan(0);
      }
    });

    // ポジション制御定数
    Object.values(POSITION_CONTROL_CONSTANTS).forEach(value => {
      expect(typeof value).toBe('number');
      expect(value).toBeGreaterThan(0);
    });

    // ポートフォリオ制御定数（戦略配分以外）
    Object.entries(PORTFOLIO_CONTROL_CONSTANTS).forEach(([key, value]) => {
      if (key !== 'STRATEGY_ALLOCATION') {
        expect(typeof value).toBe('number');
        expect(value).toBeGreaterThan(0);
      }
    });
  });
});