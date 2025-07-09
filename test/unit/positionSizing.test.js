const { calculateDynamicParams } = require('../../src/utils/positionSizing');

describe('calculateDynamicParams', () => {
  // 通常ボラティリティ時のパラメータ
  test('should return default parameters for normal volatility', () => {
    const ohlcv = Array(100).fill(0).map((_, i) => ({ high: 105 + Math.sin(i) * 2, low: 95 - Math.sin(i) * 2, close: 100 + Math.sin(i) * 5 })); // 5%程度の変動
    const params = calculateDynamicParams(ohlcv);
    expect(params.timeframe).toBe('1h');
    expect(params.limit).toBe(50);
  });

  // 高ボラティリティ時のパラメータ
  test('should adjust parameters for high volatility', () => {
    const ohlcv = Array(100).fill(0).map((_, i) => ({ high: 120 + Math.sin(i) * 5, low: 80 - Math.sin(i) * 5, close: 100 + Math.sin(i) * 20 })); // 20%程度の変動
    const params = calculateDynamicParams(ohlcv);
    expect(params.timeframe).toBe('30m'); // 短いtimeframeを期待
    expect(params.limit).toBeGreaterThan(50); // limitが増加することを期待
  });

  // 低ボラティリティ時のパラメータ
  test('should adjust parameters for low volatility', () => {
    const ohlcv = Array(100).fill(0).map((_, i) => ({ high: 100.5 + Math.sin(i) * 0.1, low: 99.5 - Math.sin(i) * 0.1, close: 100 + Math.sin(i) * 0.5 })); // 0.5%程度の変動
    const params = calculateDynamicParams(ohlcv);
    expect(params.timeframe).toBe('4h'); // 長いtimeframeを期待
    expect(params.limit).toBeLessThan(50); // limitが減少することを期待
  });

  // OHLCVデータが短い場合の挙動
  test('should handle insufficient OHLCV data gracefully', () => {
    const ohlcv = Array(5).fill({ high: 105, low: 95, close: 100 });
    const params = calculateDynamicParams(ohlcv);
    expect(params.timeframe).toBe('1h'); // デフォルト値を期待
    expect(params.limit).toBe(50); // デフォルト値を期待
  });

  // OHLCVデータに異常値（high < low）が含まれる場合の例外処理
  test('should throw error for invalid OHLCV data (high < low)', () => {
    const ohlcv = [{ high: 90, low: 100, close: 95 }];
    expect(() => calculateDynamicParams(ohlcv)).toThrow('Invalid OHLCV data: high is less than low');
  });

  // OHLCVデータに異常値（null/undefined）が含まれる場合の例外処理
  test('should throw error for invalid OHLCV data (null/undefined values)', () => {
    const ohlcv = [{ high: 100, low: 90, close: null }];
    expect(() => calculateDynamicParams(ohlcv)).toThrow('Invalid OHLCV data: missing high, low, or close');
  });

  // OHLCVデータが空の場合
  test('should return default parameters for empty OHLCV data', () => {
    const ohlcv = [];
    const params = calculateDynamicParams(ohlcv);
    expect(params.timeframe).toBe('1h');
    expect(params.limit).toBe(50);
  });
});
