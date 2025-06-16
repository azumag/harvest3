const { calculateATR, calculateVolatilityBasedPositionSize } = require('../src/strategies/utils/indicators');
const { DynamicPositionSizing } = require('../src/strategies/utils/positionSizing');
const { PerformanceTracker } = require('../src/strategies/utils/performanceTracker');

describe('動的ポジションサイジングとポートフォリオ管理', () => {
  describe('ATR計算', () => {
    test('ATRを正しく計算する', () => {
      const ohlcData = [
        { high: 100, low: 98, close: 99 },
        { high: 102, low: 99, close: 101 },
        { high: 104, low: 101, close: 103 },
        { high: 105, low: 102, close: 104 },
        { high: 106, low: 103, close: 105 },
        { high: 108, low: 104, close: 107 },
        { high: 109, low: 106, close: 108 },
        { high: 110, low: 107, close: 109 },
        { high: 112, low: 108, close: 111 },
        { high: 113, low: 110, close: 112 },
        { high: 115, low: 111, close: 114 },
        { high: 116, low: 113, close: 115 },
        { high: 118, low: 114, close: 117 },
        { high: 119, low: 116, close: 118 },
        { high: 121, low: 117, close: 120 }
      ];
      
      const atr = calculateATR(ohlcData, 14);
      
      // 最初の14個はnullであることを確認
      expect(atr.slice(0, 14).every(val => val === null)).toBe(true);
      
      // 15番目の値が存在することを確認
      expect(atr[14]).toBeGreaterThan(0);
      expect(typeof atr[14]).toBe('number');
    });

    test('データ不足の場合は空配列を返す', () => {
      const ohlcData = [
        { high: 100, low: 98, close: 99 },
        { high: 102, low: 99, close: 101 }
      ];
      
      const atr = calculateATR(ohlcData, 14);
      expect(atr).toEqual([]);
    });
  });

  describe('ボラティリティベースのポジションサイズ計算', () => {
    test('正常なパラメータでポジションサイズを計算する', () => {
      const accountBalance = 1000000; // 100万円
      const riskPerTrade = 0.01; // 1%
      const atr = 3.5;
      const atrMultiplier = 2;
      const currentPrice = 120;
      
      const positionSize = calculateVolatilityBasedPositionSize(
        accountBalance,
        riskPerTrade,
        atr,
        atrMultiplier,
        currentPrice
      );
      
      expect(positionSize).toBeGreaterThan(0);
      expect(typeof positionSize).toBe('number');
      
      // リスク金額 = 1000000 * 0.01 = 10000
      // ストップロス距離 = 3.5 * 2 = 7
      // ポジションサイズ = 10000 / 7 ≈ 1428.57
      expect(positionSize).toBeCloseTo(1428.57, 1);
    });

    test('無効なパラメータの場合は0を返す', () => {
      expect(calculateVolatilityBasedPositionSize(0, 0.01, 3.5, 2, 120)).toBe(0);
      expect(calculateVolatilityBasedPositionSize(1000000, 0, 3.5, 2, 120)).toBe(0);
      expect(calculateVolatilityBasedPositionSize(1000000, 0.01, 0, 2, 120)).toBe(0);
      expect(calculateVolatilityBasedPositionSize(1000000, 0.01, 3.5, 2, 0)).toBe(0);
    });
  });

  describe('動的ポジションサイジングクラス', () => {
    test('ATRベースのポジション計算を実行する', () => {
      const config = {
        baseRiskPerTrade: 0.01,
        atrPeriod: 14,
        atrMultiplier: 2,
        maxPositionPercent: 0.1,
        minPositionPercent: 0.001,
        kellyEnabled: false,
        performanceAdjustment: false
      };
      
      const sizing = new DynamicPositionSizing(config);
      
      const ohlcData = [];
      for (let i = 0; i < 30; i++) {
        const base = 100 + i;
        ohlcData.push({
          high: base + 2,
          low: base - 2,
          close: base
        });
      }
      
      const result = sizing.calculateATRBasedPosition({
        accountBalance: 1000000,
        ohlcData,
        currentPrice: 130,
        strategyKey: 'TEST_STRATEGY'
      });
      
      expect(result.reason).toBe('success');
      expect(result.positionSize).toBeGreaterThan(0);
      expect(result.atr).toBeGreaterThan(0);
      expect(result.adjustedRisk).toBe(0.01);
    });

    test('データ不足の場合はエラーを返す', () => {
      const config = {
        baseRiskPerTrade: 0.01,
        atrPeriod: 14,
        atrMultiplier: 2,
        maxPositionPercent: 0.1,
        minPositionPercent: 0.001
      };
      
      const sizing = new DynamicPositionSizing(config);
      
      const result = sizing.calculateATRBasedPosition({
        accountBalance: 1000000,
        ohlcData: [], // 空のデータ
        currentPrice: 130,
        strategyKey: 'TEST_STRATEGY'
      });
      
      expect(result.positionSize).toBe(0);
      expect(result.reason).toBe('invalid_atr');
    });
  });

  describe('パフォーマンス追跡', () => {
    test('トレード記録とパフォーマンス指標計算', async () => {
      const tracker = new PerformanceTracker();
      
      // テスト用のトレード記録
      const trades = [
        { side: 'buy', amount: 0.1, price: 100, pnl: null },
        { side: 'sell', amount: 0.1, price: 105, pnl: 50 }
      ];
      
      for (const trade of trades) {
        await tracker.recordTrade('bitbank', 'BTC/JPY', 'TEST_STRATEGY', trade);
      }
      
      const performance = await tracker.getPerformance('bitbank', 'BTC/JPY', 'TEST_STRATEGY');
      
      expect(performance).toBeDefined();
      expect(performance.totalTrades).toBe(1); // 買い注文のみカウント
      expect(performance.winningTrades).toBe(1);
      expect(performance.totalPnL).toBe(50);
      expect(performance.winRate).toBe(1);
    });

    test('パフォーマンスレポート生成', async () => {
      const tracker = new PerformanceTracker();
      
      await tracker.recordTrade('bitbank', 'BTC/JPY', 'TEST_STRATEGY_2', {
        side: 'buy', amount: 0.1, price: 100, pnl: null
      });
      await tracker.recordTrade('bitbank', 'BTC/JPY', 'TEST_STRATEGY_2', {
        side: 'sell', amount: 0.1, price: 105, pnl: 50
      });
      
      const report = await tracker.generatePerformanceReport('bitbank', 'BTC/JPY', 'TEST_STRATEGY_2');
      
      expect(report).toBeDefined();
      expect(report.strategy).toBe('TEST_STRATEGY_2');
      expect(report.symbol).toBe('BTC/JPY');
      expect(report.exchange).toBe('bitbank');
      expect(report.summary.totalPnL).toBe('50.00');
    });
  });
});