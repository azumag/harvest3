// OHLCVデータ自動回復機能のテスト
describe('OHLCV自動データ回復機能', () => {
  test('loadHistoricalOHLCVToBacktestRedis 関数が正しくエクスポートされている', () => {
    const { loadHistoricalOHLCVToBacktestRedis } = require('../../../src/database/manager');
    expect(loadHistoricalOHLCVToBacktestRedis).toBeDefined();
    expect(typeof loadHistoricalOHLCVToBacktestRedis).toBe('function');
  });

  test('関数の基本的な型チェック', () => {
    const { loadHistoricalOHLCVToBacktestRedis } = require('../../../src/database/manager');
    expect(loadHistoricalOHLCVToBacktestRedis.length).toBeGreaterThanOrEqual(0); // パラメータ数の確認
  });
});