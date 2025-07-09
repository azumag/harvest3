/**
 * 高度パフォーマンス指標のテスト (TDD実装)
 * Calmar Ratio, Sortino Ratio, VaR (Value at Risk)
 */

const {
  calculateCalmarRatio,
  calculateSortinoRatio,
  calculateVaR,
  calculateAnnualizedReturn,
  calculateDownsideDeviation,
  AdvancedPerformanceMetrics
} = require('../../../../src/strategies/utils/advancedPerformanceMetrics');

describe('高度パフォーマンス指標のテスト', () => {

  describe('calculateCalmarRatio', () => {
    it('正常な年間リターンとドローダウンでCalmar Ratioを計算する', () => {
      // テストデータ: 年間20%リターン、最大ドローダウン10%
      const annualizedReturn = 0.20;
      const maxDrawdown = 0.10;

      const calmarRatio = calculateCalmarRatio(annualizedReturn, maxDrawdown);

      // Calmar Ratio = 年間リターン / 最大ドローダウン = 0.20 / 0.10 = 2.0
      expect(calmarRatio).toBe(2.0);
    });

    it('ドローダウンが0の場合は高い値を返す', () => {
      const annualizedReturn = 0.15;
      const maxDrawdown = 0;

      const calmarRatio = calculateCalmarRatio(annualizedReturn, maxDrawdown);

      expect(calmarRatio).toBe(100); // Infinityの代わりに制限値100を返す
    });

    it('年間リターンが負の場合は負のCalmar Ratioを返す', () => {
      const annualizedReturn = -0.05;
      const maxDrawdown = 0.15;

      const calmarRatio = calculateCalmarRatio(annualizedReturn, maxDrawdown);

      expect(calmarRatio).toBe(-0.05 / 0.15);
    });

    it('無効な入力に対して0を返す', () => {
      expect(calculateCalmarRatio(NaN, 0.1)).toBe(0);
      expect(calculateCalmarRatio(0.1, NaN)).toBe(0);
      expect(calculateCalmarRatio(null, 0.1)).toBe(0);
    });
  });

  describe('calculateDownsideDeviation', () => {
    it('正常なリターン系列でダウンサイド偏差を計算する', () => {
      // テストデータ: 混合リターン (正負含む)
      const returns = [0.02, -0.01, 0.03, -0.02, 0.01, -0.015, 0.025];
      const targetReturn = 0; // ベンチマーク0%

      const downsideDeviation = calculateDownsideDeviation(returns, targetReturn);

      // 負のリターンのみ: [-0.01, -0.02, -0.015]
      // 分散 = (0.01² + 0.02² + 0.015²) / 3 = (0.0001 + 0.0004 + 0.000225) / 3
      const expectedVariance = (0.0001 + 0.0004 + 0.000225) / 3;
      const expectedDeviation = Math.sqrt(expectedVariance);

      expect(downsideDeviation).toBeCloseTo(expectedDeviation, 6);
    });

    it('全て正のリターンの場合は0を返す', () => {
      const returns = [0.01, 0.02, 0.03, 0.015];
      const targetReturn = 0;

      const downsideDeviation = calculateDownsideDeviation(returns, targetReturn);

      expect(downsideDeviation).toBe(0);
    });

    it('空配列の場合は0を返す', () => {
      const returns = [];
      const targetReturn = 0;

      const downsideDeviation = calculateDownsideDeviation(returns, targetReturn);

      expect(downsideDeviation).toBe(0);
    });
  });

  describe('calculateSortinoRatio', () => {
    it('正常なリターン系列でSortino Ratioを計算する', () => {
      const returns = [0.02, -0.01, 0.03, -0.02, 0.01];
      const riskFreeRate = 0.02; // 年率2%

      const sortinoRatio = calculateSortinoRatio(returns, riskFreeRate);

      // 平均リターン = (0.02 - 0.01 + 0.03 - 0.02 + 0.01) / 5 = 0.006
      // 年換算リターン = 0.006 * 365 = 2.19
      // ダウンサイド偏差計算（ベンチマーク: 年率2%の日次 ≈ 0.000055）
      // Sortino Ratio = (年換算リターン - リスクフリーレート) / ダウンサイド偏差

      expect(typeof sortinoRatio).toBe('number');
      expect(sortinoRatio).not.toBeNaN();
    });

    it('全て正のリターンの場合は高い値を返す', () => {
      const returns = [0.01, 0.02, 0.03, 0.015];
      const riskFreeRate = 0.005;

      const sortinoRatio = calculateSortinoRatio(returns, riskFreeRate);

      expect(sortinoRatio).toBe(100); // Infinityの代わりに制限値100を返す
    });
  });

  describe('calculateVaR', () => {
    it('95%信頼区間でVaRを計算する（ヒストリカル法）', () => {
      // テストデータ: 100個のリターン
      const returns = [];
      for (let i = 0; i < 100; i++) {
        returns.push((Math.random() - 0.5) * 0.1); // -5% to +5%
      }

      const var95 = calculateVaR(returns, 0.95);

      expect(typeof var95).toBe('number');
      expect(var95).toBeLessThan(0); // VaRは通常負の値
    });

    it('99%信頼区間でVaRを計算する', () => {
      const returns = [-0.05, -0.03, -0.01, 0.01, 0.02, 0.03, 0.04, 0.05];

      const var99 = calculateVaR(returns, 0.99);

      // 99%信頼区間 = 1%パーセンタイル
      expect(var99).toBeCloseTo(-0.05, 2);
    });

    it('信頼区間50%（メディアン）のテスト', () => {
      const returns = [-0.04, -0.02, 0, 0.02, 0.04];

      const var50 = calculateVaR(returns, 0.5);

      expect(var50).toBe(0); // メディアン
    });

    it('空配列の場合は0を返す', () => {
      const returns = [];

      const var95 = calculateVaR(returns);

      expect(var95).toBe(0);
    });
  });

  describe('calculateAnnualizedReturn', () => {
    it('日次リターンから年換算リターンを計算する', () => {
      const returns = [0.001, 0.002, -0.001, 0.0015]; // 0.1%, 0.2%, -0.1%, 0.15%

      const annualizedReturn = calculateAnnualizedReturn(returns);

      // 平均日次リターン = (0.001 + 0.002 - 0.001 + 0.0015) / 4 = 0.000875
      // 年換算 = 0.000875 * 365 = 0.319375
      expect(annualizedReturn).toBeCloseTo(0.319375, 4);
    });

    it('空配列の場合は0を返す', () => {
      const returns = [];

      const annualizedReturn = calculateAnnualizedReturn(returns);

      expect(annualizedReturn).toBe(0);
    });
  });

  describe('AdvancedPerformanceMetrics クラス', () => {
    let metrics;

    beforeEach(() => {
      metrics = new AdvancedPerformanceMetrics();
    });

    it('インスタンス化できる', () => {
      expect(metrics).toBeInstanceOf(AdvancedPerformanceMetrics);
    });

    it('全メトリクスを一括計算する', () => {
      const trades = [
        { pnl: 100, timestamp: Date.now() - 86400000 * 4 },
        { pnl: -50, timestamp: Date.now() - 86400000 * 3 },
        { pnl: 200, timestamp: Date.now() - 86400000 * 2 },
        { pnl: -75, timestamp: Date.now() - 86400000 * 1 },
        { pnl: 150, timestamp: Date.now() }
      ];

      const result = metrics.calculateAllMetrics(trades);

      expect(result).toHaveProperty('calmarRatio');
      expect(result).toHaveProperty('sortinoRatio');
      expect(result).toHaveProperty('var95');
      expect(result).toHaveProperty('var99');
      expect(result).toHaveProperty('annualizedReturn');
      expect(result).toHaveProperty('downsideDeviation');
      expect(result).toHaveProperty('maxDrawdown');
    });

    it('不十分なデータでデフォルト値を返す', () => {
      const trades = [
        { pnl: 100, timestamp: Date.now() }
      ];

      const result = metrics.calculateAllMetrics(trades);

      expect(result.calmarRatio).toBe(0);
      expect(result.sortinoRatio).toBe(0);
      expect(result.var95).toBe(0);
    });
  });

  describe('エッジケースと例外処理', () => {
    it('無効なデータ形式を処理する', () => {
      expect(() => calculateCalmarRatio('invalid', 0.1)).not.toThrow();
      expect(() => calculateSortinoRatio(['invalid'])).not.toThrow();
      expect(() => calculateVaR([null, undefined])).not.toThrow();
    });

    it('極端な値を処理する', () => {
      const extremeReturns = [1, -1, 0.5, -0.8, 2];

      expect(() => calculateSortinoRatio(extremeReturns)).not.toThrow();
      expect(() => calculateVaR(extremeReturns)).not.toThrow();
    });
  });
});