/**
 * マルチ指標戦略のテスト
 */
const {
  calculateADX
} = require('../../src/strategies/utils/indicators');

const {
  confirmMultipleIndicators,
  identifyMarketEnvironment
} = require('../../src/strategies/utils/common');

describe('ADX指標テスト', () => {
  test('ADXが正しく計算される', () => {
    // テスト用のOHLCデータ
    const ohlcData = [
      { high: 100, low: 95, close: 98 },
      { high: 102, low: 97, close: 101 },
      { high: 105, low: 100, close: 103 },
      { high: 107, low: 102, close: 106 },
      { high: 109, low: 104, close: 108 },
      { high: 111, low: 106, close: 110 },
      { high: 113, low: 108, close: 112 },
      { high: 115, low: 110, close: 114 },
      { high: 117, low: 112, close: 116 },
      { high: 119, low: 114, close: 118 },
      { high: 121, low: 116, close: 120 },
      { high: 123, low: 118, close: 122 },
      { high: 125, low: 120, close: 124 },
      { high: 127, low: 122, close: 126 },
      { high: 129, low: 124, close: 128 },
      { high: 131, low: 126, close: 130 }
    ];

    const result = calculateADX(ohlcData, 14);

    expect(result).toHaveProperty('adx');
    expect(result).toHaveProperty('plusDI');
    expect(result).toHaveProperty('minusDI');

    expect(Array.isArray(result.adx)).toBe(true);
    expect(Array.isArray(result.plusDI)).toBe(true);
    expect(Array.isArray(result.minusDI)).toBe(true);

    // ADXの値が有効な範囲内にある
    const validADX = result.adx.filter(val => val !== null && val !== undefined);
    validADX.forEach(adx => {
      expect(adx).toBeGreaterThanOrEqual(0);
      expect(adx).toBeLessThanOrEqual(100);
    });
  });

  test('データ不足時にADXが空の配列を返す', () => {
    const shortData = [
      { high: 100, low: 95, close: 98 },
      { high: 102, low: 97, close: 101 }
    ];

    const result = calculateADX(shortData, 14);

    expect(result.adx).toEqual([]);
    expect(result.plusDI).toEqual([]);
    expect(result.minusDI).toEqual([]);
  });
});

describe('マルチ指標確認システムテスト', () => {
  test('強気シグナルが正しく確認される', () => {
    const indicators = {
      macd: {
        histogram: [null, null, -0.5, -0.2, 0.1, 0.3],
        signal: [null, null, 0.5, 0.7, 0.8, 0.9],
        macd: [null, null, 0.0, 0.5, 0.9, 1.2]
      },
      emaShort: [null, null, 100, 101, 102, 103],
      emaLong: [null, null, 99, 100, 101, 102],
      rsi: [null, null, 25, 35, 45, 55],
      volume: [1000, 1200, 1500, 1800, 2000, 2200],
      volumeMA: [null, null, 1100, 1200, 1300, 1400],
      priceChange: 2,
      adx: {
        adx: [null, null, 15, 20, 25, 30],
        plusDI: [null, null, 20, 25, 30, 35],
        minusDI: [null, null, 15, 18, 20, 22]
      }
    };

    const config = {
      requiredConfirmations: 3,
      weights: {
        macd: 1.0,
        ema: 0.8,
        rsi: 0.7,
        volume: 0.5,
        adx: 0.9
      }
    };

    const result = confirmMultipleIndicators(indicators, config);

    expect(result.confirmed).toBe(true);
    expect(result.direction).toBe('bullish');
    expect(result.bullishSignals.length).toBeGreaterThanOrEqual(3);
    expect(parseFloat(result.bullishScore)).toBeGreaterThan(parseFloat(result.bearishScore));
  });

  test('弱気シグナルが正しく確認される', () => {
    const indicators = {
      macd: {
        histogram: [null, null, 0.5, 0.2, -0.1, -0.3],
        signal: [null, null, 0.5, 0.7, 0.8, 0.9],
        macd: [null, null, 1.0, 0.9, 0.7, 0.6]
      },
      emaShort: [null, null, 103, 102, 101, 100],
      emaLong: [null, null, 102, 103, 104, 105], // 短期が長期を下回る
      rsi: [null, null, 75, 65, 55, 45],
      volume: [1000, 1200, 1500, 1800, 2000, 2200],
      volumeMA: [null, null, 1100, 1200, 1300, 1400],
      priceChange: -2,
      adx: {
        adx: [null, null, 15, 20, 25, 30],
        plusDI: [null, null, 20, 22, 24, 25],
        minusDI: [null, null, 25, 28, 32, 35]
      }
    };

    const config = {
      requiredConfirmations: 3,
      weights: {
        macd: 1.0,
        ema: 0.8,
        rsi: 0.7,
        volume: 0.5,
        adx: 0.9
      }
    };

    const result = confirmMultipleIndicators(indicators, config);

    expect(result.confirmed).toBe(true);
    expect(result.direction).toBe('bearish');
    expect(result.bearishSignals.length).toBeGreaterThanOrEqual(3);
    expect(parseFloat(result.bearishScore)).toBeGreaterThan(parseFloat(result.bullishScore));
  });

  test('確認数不足でシグナルが否定される', () => {
    const indicators = {
      macd: {
        histogram: [null, null, -0.5, -0.2, 0.1, 0.3],
        signal: [null, null, 0.5, 0.7, 0.8, 0.9],
        macd: [null, null, 0.0, 0.5, 0.9, 1.2]
      },
      emaShort: [null, null, 100, 101, 102, 103],
      emaLong: [null, null, 102, 103, 104, 105], // 短期が長期を下回る
      rsi: [null, null, 25, 35, 45, 55],
      adx: {
        adx: [null, null, 15, 20, 25, 30],
        plusDI: [null, null, 20, 25, 30, 35],
        minusDI: [null, null, 15, 18, 20, 22]
      }
    };

    const config = {
      requiredConfirmations: 4 // 高い確認数を要求
    };

    const result = confirmMultipleIndicators(indicators, config);

    expect(result.confirmed).toBe(false);
    expect(result.direction).toBe('neutral');
  });
});

describe('市場環境識別テスト', () => {
  test('強いトレンド相場が正しく識別される', () => {
    const adxData = {
      adx: [null, null, 20, 30, 40, 45],
      plusDI: [null, null, 30, 35, 40, 45],
      minusDI: [null, null, 15, 18, 20, 22]
    };

    const result = identifyMarketEnvironment(adxData);

    expect(result.environment).toBe('strong_trend');
    expect(result.direction).toBe('bullish');
    expect(result.strength).toBe(45);
    expect(result.description).toBe('強いトレンド相場');
    expect(result.recommendation.strategy).toBe('trend_following');
  });

  test('レンジ相場が正しく識別される', () => {
    const adxData = {
      adx: [null, null, 25, 20, 18, 15],
      plusDI: [null, null, 20, 22, 21, 23],
      minusDI: [null, null, 22, 24, 23, 25]
    };

    const result = identifyMarketEnvironment(adxData);

    expect(result.environment).toBe('range');
    expect(result.strength).toBe(15);
    expect(result.description).toBe('レンジ相場');
    expect(result.recommendation.strategy).toBe('range_trading');
  });

  test('データ不足時の処理', () => {
    const adxData = {
      adx: [],
      plusDI: [],
      minusDI: []
    };

    const result = identifyMarketEnvironment(adxData);

    expect(result.environment).toBe('unknown');
    expect(result.strength).toBe(0);
    expect(result.description).toBe('データ不足');
  });

  test('カスタム閾値での環境識別', () => {
    const adxData = {
      adx: [null, null, 20, 25, 30, 35],
      plusDI: [null, null, 30, 32, 34, 36],
      minusDI: [null, null, 20, 22, 24, 26]
    };

    const config = {
      strongTrendThreshold: 50,
      trendThreshold: 30,
      weakTrendThreshold: 25
    };

    const result = identifyMarketEnvironment(adxData, config);

    expect(result.environment).toBe('trend');
    expect(result.strength).toBe(35);
  });
});

describe('統合テスト', () => {
  test('マルチ指標戦略の総合的な動作', () => {
    // 強いトレンド相場での強気シグナル
    const indicators = {
      macd: {
        histogram: [null, null, -0.5, -0.2, 0.1, 0.5],
        signal: [null, null, 0.5, 0.7, 0.8, 0.9],
        macd: [null, null, 0.0, 0.5, 0.9, 1.4]
      },
      emaShort: [null, null, 100, 101, 102, 103],
      emaLong: [null, null, 99, 100, 101, 102],
      rsi: [null, null, 25, 35, 55, 65],
      volume: [1000, 1200, 1500, 1800, 2000, 2500],
      volumeMA: [null, null, 1100, 1200, 1300, 1400],
      priceChange: 3,
      adx: {
        adx: [null, null, 15, 25, 35, 42],
        plusDI: [null, null, 20, 28, 35, 40],
        minusDI: [null, null, 15, 18, 20, 22]
      }
    };

    const confirmationConfig = {
      requiredConfirmations: 3,
      weights: {
        macd: 1.0,
        ema: 0.8,
        rsi: 0.7,
        volume: 0.5,
        adx: 0.9
      }
    };

    const marketConfig = {
      strongTrendThreshold: 40,
      trendThreshold: 25,
      weakTrendThreshold: 20
    };

    const confirmation = confirmMultipleIndicators(indicators, confirmationConfig);
    const marketEnvironment = identifyMarketEnvironment(indicators.adx, marketConfig);

    // 確認結果の検証
    expect(confirmation.confirmed).toBe(true);
    expect(confirmation.direction).toBe('bullish');

    // 市場環境の検証
    expect(marketEnvironment.environment).toBe('strong_trend');
    expect(marketEnvironment.direction).toBe('bullish');

    // 統合判定（実際の戦略ロジック）
    let shouldTrade = false;
    if (confirmation.confirmed &&
        marketEnvironment.environment !== 'range' &&
        confirmation.direction === marketEnvironment.direction) {
      shouldTrade = true;
    }

    expect(shouldTrade).toBe(true);
  });

  test('レンジ相場での慎重な判定', () => {
    const indicators = {
      macd: {
        histogram: [null, null, -0.1, 0.0, 0.1, 0.2],
        signal: [null, null, 0.5, 0.5, 0.5, 0.5],
        macd: [null, null, 0.4, 0.5, 0.6, 0.7]
      },
      emaShort: [null, null, 100, 100.5, 101, 101.5],
      emaLong: [null, null, 99.5, 100, 100.5, 101],
      rsi: [null, null, 45, 48, 52, 55],
      adx: {
        adx: [null, null, 25, 22, 18, 15],
        plusDI: [null, null, 20, 22, 21, 23],
        minusDI: [null, null, 22, 24, 23, 25]
      }
    };

    const confirmation = confirmMultipleIndicators(indicators);
    const marketEnvironment = identifyMarketEnvironment(indicators.adx);

    // レンジ相場では慎重な判定
    expect(marketEnvironment.environment).toBe('range');

    // レンジ相場では高いスコアが必要
    const shouldTradeInRange = confirmation.confirmed &&
                              marketEnvironment.environment === 'range' &&
                              parseFloat(confirmation.bullishScore) > 70;

    expect(shouldTradeInRange).toBe(false); // 通常はレンジ相場では取引しない
  });
});