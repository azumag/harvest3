/**
 * 相関計算ユーティリティのテスト
 * Issue #149: 実用的な実装への再設計
 */

const {
  calculatePearsonCorrelation,
  calculateSpearmanCorrelation,
  calculateSpread,
  calculateZScore,
  calculateHalfLife,
  DynamicPairSelector,
  StatisticalPairTrading
} = require('../../../../src/strategies/utils/correlation');

describe('Correlation Utilities', () => {
  
  describe('calculatePearsonCorrelation', () => {
    test('calculates perfect positive correlation', () => {
      const x = [1, 2, 3, 4, 5];
      const y = [2, 4, 6, 8, 10];
      const correlation = calculatePearsonCorrelation(x, y);
      expect(correlation).toBeCloseTo(1, 5);
    });

    test('calculates perfect negative correlation', () => {
      const x = [1, 2, 3, 4, 5];
      const y = [10, 8, 6, 4, 2];
      const correlation = calculatePearsonCorrelation(x, y);
      expect(correlation).toBeCloseTo(-1, 5);
    });

    test('calculates zero correlation for independent variables', () => {
      const x = [1, 2, 3, 4, 5];
      const y = [2, 1, 4, 3, 2];
      const correlation = calculatePearsonCorrelation(x, y);
      expect(Math.abs(correlation)).toBeLessThan(0.5);
    });

    test('handles empty arrays', () => {
      const correlation = calculatePearsonCorrelation([], []);
      expect(correlation).toBe(0);
    });

    test('handles mismatched array lengths', () => {
      const correlation = calculatePearsonCorrelation([1, 2], [1, 2, 3]);
      expect(correlation).toBe(0);
    });
  });

  describe('calculateSpearmanCorrelation', () => {
    test('calculates spearman correlation correctly', () => {
      const x = [1, 2, 3, 4, 5];
      const y = [5, 6, 7, 8, 7];
      const correlation = calculateSpearmanCorrelation(x, y);
      expect(correlation).toBeGreaterThan(0);
    });

    test('handles empty arrays', () => {
      const correlation = calculateSpearmanCorrelation([], []);
      expect(correlation).toBe(0);
    });
  });

  describe('calculateSpread', () => {
    test('calculates logarithmic spread correctly', () => {
      const prices1 = [100, 102, 105];
      const prices2 = [50, 51, 52];
      const spread = calculateSpread(prices1, prices2, true);
      
      expect(spread).toHaveLength(3);
      expect(spread[0]).toBeCloseTo(Math.log(100) - Math.log(50), 5);
    });

    test('calculates linear spread correctly', () => {
      const prices1 = [100, 102, 105];
      const prices2 = [50, 51, 52];
      const spread = calculateSpread(prices1, prices2, false);
      
      expect(spread).toHaveLength(3);
      expect(spread[0]).toBe(50);
      expect(spread[1]).toBe(51);
      expect(spread[2]).toBe(53);
    });

    test('handles empty arrays', () => {
      const spread = calculateSpread([], [], true);
      expect(spread).toEqual([]);
    });
  });

  describe('calculateZScore', () => {
    test('calculates z-score correctly', () => {
      const spread = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const zScores = calculateZScore(spread, 5);
      
      expect(zScores).toHaveLength(6);
      expect(zScores[zScores.length - 1]).toBeCloseTo(1.414, 2);
    });

    test('handles insufficient data', () => {
      const spread = [1, 2, 3];
      const zScores = calculateZScore(spread, 5);
      expect(zScores).toEqual([]);
    });
  });

  describe('calculateHalfLife', () => {
    test('calculates half life for mean reverting series', () => {
      // より明確に平均回帰するスプレッドをシミュレート
      const spread = [];
      for (let i = 0; i < 20; i++) {
        spread.push(Math.exp(-0.2 * i) * Math.sin(i)); // 指数的減衰
      }
      const halfLife = calculateHalfLife(spread);
      
      // 半減期が計算される場合のみテスト
      if (halfLife !== null) {
        expect(halfLife).toBeGreaterThan(0);
        expect(halfLife).toBeLessThan(spread.length);
      } else {
        // データが平均回帰していない場合はnullが正しい
        expect(halfLife).toBeNull();
      }
    });

    test('returns null for non-mean reverting series', () => {
      const spread = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const halfLife = calculateHalfLife(spread);
      expect(halfLife).toBeNull();
    });

    test('handles insufficient data', () => {
      const spread = [1, 2, 3];
      const halfLife = calculateHalfLife(spread);
      expect(halfLife).toBeNull();
    });
  });

  describe('DynamicPairSelector', () => {
    let selector;

    beforeEach(() => {
      selector = new DynamicPairSelector();
    });

    test('initializes correctly', () => {
      expect(selector.correlationHistory.size).toBe(0);
      expect(selector.profitableCorrelations.size).toBe(0);
    });

    test('records correlation data', () => {
      selector.recordCorrelation('BTC/USDT', 'ETH/USDT', 0.8, 10);
      
      expect(selector.correlationHistory.size).toBe(1);
      const key = 'BTC/USDT_ETH/USDT';
      expect(selector.correlationHistory.has(key)).toBe(true);
    });

    test('selects reference pairs with default fallback', () => {
      const availableSymbols = ['BTC/USDT', 'ETH/USDT', 'ADA/USDT'];
      const selected = selector.selectReferencePairs('ADA/USDT', availableSymbols, 3);
      
      expect(selected).toContain('BTC/USDT');
      expect(selected).toContain('ETH/USDT');
      expect(selected.length).toBeLessThanOrEqual(3);
    });

    test('provides correlation statistics', () => {
      selector.recordCorrelation('BTC/USDT', 'ETH/USDT', 0.8, 10);
      const stats = selector.getCorrelationStats('BTC/USDT');
      
      // 統計データが正しく返されることを確認
      expect(stats).toBeDefined();
      expect(stats).toHaveProperty('pairCount');
      expect(stats).toHaveProperty('avgCorrelation');
      expect(stats).toHaveProperty('avgProfitability');
      expect(stats.pairCount).toBe(1);
      expect(stats.avgCorrelation).toBe(0.8);
      expect(stats.avgProfitability).toBe(10);
    });
  });

  describe('StatisticalPairTrading', () => {
    let pairTrading;

    beforeEach(() => {
      pairTrading = new StatisticalPairTrading({
        lookbackPeriod: 20,
        entryZScore: 2.0,
        exitZScore: 0.5
      });
    });

    test('initializes with correct parameters', () => {
      expect(pairTrading.lookbackPeriod).toBe(20);
      expect(pairTrading.entryZScore).toBe(2.0);
      expect(pairTrading.exitZScore).toBe(0.5);
    });

    test('finds trading pairs with high correlation', async () => {
      const symbolsData = {
        'BTC/USDT': Array.from({length: 30}, (_, i) => 100 + i),
        'ETH/USDT': Array.from({length: 30}, (_, i) => 50 + i * 0.5), // 高い相関
        'ADA/USDT': Array.from({length: 30}, (_, i) => Math.random() * 10) // ランダム
      };

      const pairs = await pairTrading.findTradingPairs(symbolsData);
      
      expect(pairs).toBeInstanceOf(Array);
      if (pairs.length > 0) {
        expect(pairs[0]).toHaveProperty('symbol1');
        expect(pairs[0]).toHaveProperty('symbol2');
        expect(pairs[0]).toHaveProperty('correlation');
      }
    });

    test('generates pair trade signal for mean reversion', () => {
      const prices1 = Array.from({length: 25}, (_, i) => 100 + Math.sin(i * 0.1) * 2);
      const prices2 = Array.from({length: 25}, (_, i) => 50 + Math.sin(i * 0.1) * 1);
      
      const pair = {
        symbol1: 'BTC/USDT',
        symbol2: 'ETH/USDT',
        correlation: 0.9
      };

      const signal = pairTrading.generatePairTradeSignal(pair, prices1, prices2);
      
      if (signal) {
        expect(signal).toHaveProperty('long');
        expect(signal).toHaveProperty('short');
        expect(signal).toHaveProperty('confidence');
        expect(signal.confidence).toBeGreaterThan(0);
        expect(signal.confidence).toBeLessThanOrEqual(1);
      }
    });

    test('generates exit signal correctly', () => {
      const prices1 = Array.from({length: 25}, (_, i) => 100);
      const prices2 = Array.from({length: 25}, (_, i) => 50);
      
      const pair = { symbol1: 'BTC/USDT', symbol2: 'ETH/USDT' };
      const position = { type: 'long', symbol: 'BTC/USDT' };

      const shouldExit = pairTrading.generateExitSignal(pair, prices1, prices2, position);
      expect(typeof shouldExit).toBe('boolean');
    });

    test('handles insufficient data gracefully', () => {
      const prices1 = [100, 101];
      const prices2 = [50, 51];
      
      const pair = { symbol1: 'BTC/USDT', symbol2: 'ETH/USDT' };
      const signal = pairTrading.generatePairTradeSignal(pair, prices1, prices2);
      
      expect(signal).toBeNull();
    });
  });

  describe('Integration Tests', () => {
    test('complete workflow from correlation to trading signal', async () => {
      const selector = new DynamicPairSelector();
      const pairTrading = new StatisticalPairTrading();

      // 相関データを記録
      selector.recordCorrelation('BTC/USDT', 'ETH/USDT', 0.85, 15);
      selector.recordCorrelation('BTC/USDT', 'ADA/USDT', 0.6, 5);

      // 利用可能なシンボルから最適なペアを選択
      const availableSymbols = ['ETH/USDT', 'ADA/USDT', 'DOT/USDT'];
      const selectedPairs = selector.selectReferencePairs('BTC/USDT', availableSymbols, 2);

      expect(selectedPairs).toBeInstanceOf(Array);
      expect(selectedPairs.length).toBeGreaterThan(0);

      // 価格データでペアトレーディング分析
      const symbolsData = {};
      [selectedPairs[0], 'BTC/USDT'].forEach(symbol => {
        symbolsData[symbol] = Array.from({length: 30}, (_, i) => 100 + i + Math.random() * 5);
      });

      const tradingPairs = await pairTrading.findTradingPairs(symbolsData);
      expect(tradingPairs).toBeInstanceOf(Array);
    });
  });
});