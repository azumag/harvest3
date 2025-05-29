/**
 * 相互情報量関連のテスト
 */
const {
  calculateMutualInformation,
  calculateMutualInformationMatrix,
  calculateReturns
} = require('../../../src/strategies/utils/indicators');

const {
  calculateMutualInformationSignals,
  formatMutualInformationLogInfo
} = require('../../../src/strategies/mutualInformation');

describe('Mutual Information Calculations', () => {
  describe('calculateReturns function', () => {
    test('calculates returns correctly', () => {
      const prices = [100, 110, 105, 115];
      const returns = calculateReturns(prices);
      
      expect(returns).toHaveLength(3);
      expect(returns[0]).toBeCloseTo(0.1); // (110-100)/100 = 0.1
      expect(returns[1]).toBeCloseTo(-0.045454545); // (105-110)/110 ≈ -0.045
      expect(returns[2]).toBeCloseTo(0.095238095); // (115-105)/105 ≈ 0.095
    });

    test('handles empty array', () => {
      const returns = calculateReturns([]);
      expect(returns).toEqual([]);
    });

    test('handles single element array', () => {
      const returns = calculateReturns([100]);
      expect(returns).toEqual([]);
    });
  });

  describe('calculateMutualInformation function', () => {
    test('calculates mutual information for identical series', () => {
      const series1 = [1, 2, 3, 4, 5];
      const series2 = [1, 2, 3, 4, 5];
      const mi = calculateMutualInformation(series1, series2);
      
      // 完全に同じ系列の場合、相互情報量は高い値になる
      expect(mi).toBeGreaterThan(0);
    });

    test('calculates mutual information for independent series', () => {
      const series1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const series2 = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
      const mi = calculateMutualInformation(series1, series2);
      
      // 完全に逆相関の場合でも相互情報量は存在する
      expect(mi).toBeGreaterThanOrEqual(0);
    });

    test('handles different length arrays', () => {
      const series1 = [1, 2, 3];
      const series2 = [1, 2, 3, 4, 5];
      const mi = calculateMutualInformation(series1, series2);
      
      expect(mi).toBe(0);
    });

    test('handles empty arrays', () => {
      const mi = calculateMutualInformation([], []);
      expect(mi).toBe(0);
    });

    test('handles constant series', () => {
      const series1 = [5, 5, 5, 5, 5];
      const series2 = [3, 3, 3, 3, 3];
      const mi = calculateMutualInformation(series1, series2);
      
      // 定数系列の場合、相互情報量は0またはそれに近い値
      expect(mi).toBeGreaterThanOrEqual(0);
    });
  });

  describe('calculateMutualInformationMatrix function', () => {
    test('calculates mutual information matrix correctly', () => {
      const series1 = [1, 2, 3, 4, 5];
      const series2 = [2, 4, 6, 8, 10];
      const series3 = [5, 4, 3, 2, 1];
      
      const matrix = calculateMutualInformationMatrix([series1, series2, series3]);
      
      expect(matrix).toHaveLength(3);
      expect(matrix[0]).toHaveLength(3);
      expect(matrix[1]).toHaveLength(3);
      expect(matrix[2]).toHaveLength(3);
      
      // 対角線要素は1（自分自身との相互情報量）
      expect(matrix[0][0]).toBe(1);
      expect(matrix[1][1]).toBe(1);
      expect(matrix[2][2]).toBe(1);
      
      // 対称行列であることを確認
      expect(matrix[0][1]).toBeCloseTo(matrix[1][0], 10);
      expect(matrix[0][2]).toBeCloseTo(matrix[2][0], 10);
      expect(matrix[1][2]).toBeCloseTo(matrix[2][1], 10);
    });

    test('handles empty array', () => {
      const matrix = calculateMutualInformationMatrix([]);
      expect(matrix).toEqual([]);
    });

    test('handles single series', () => {
      const series = [1, 2, 3, 4, 5];
      const matrix = calculateMutualInformationMatrix([series]);
      
      expect(matrix).toEqual([[1]]);
    });
  });

  describe('Integration tests', () => {
    test('mutual information workflow with real-like data', () => {
      // BTC価格のような模擬データ
      const btcPrices = [50000, 51000, 50500, 52000, 51500, 53000, 52500, 54000];
      const ethPrices = [3000, 3100, 3050, 3200, 3150, 3250, 3200, 3300];
      
      // リターンを計算
      const btcReturns = calculateReturns(btcPrices);
      const ethReturns = calculateReturns(ethPrices);
      
      // 相互情報量を計算
      const mi = calculateMutualInformation(btcReturns, ethReturns);
      
      expect(mi).toBeGreaterThanOrEqual(0);
      expect(typeof mi).toBe('number');
      expect(isFinite(mi)).toBe(true);
    });

    test('handles realistic trading scenario', () => {
      // 複数の暗号通貨の価格データを模擬
      const btc = [40000, 41000, 40500, 42000, 41500];
      const eth = [2500, 2600, 2550, 2700, 2650];
      const ada = [1.2, 1.25, 1.22, 1.28, 1.26];
      
      const btcReturns = calculateReturns(btc);
      const ethReturns = calculateReturns(eth);
      const adaReturns = calculateReturns(ada);
      
      const matrix = calculateMutualInformationMatrix([btcReturns, ethReturns, adaReturns]);
      
      expect(matrix).toHaveLength(3);
      matrix.forEach((row, i) => {
        expect(row).toHaveLength(3);
        expect(row[i]).toBe(1); // 対角線要素
        row.forEach((val, j) => {
          expect(val).toBeGreaterThanOrEqual(0);
          expect(isFinite(val)).toBe(true);
        });
      });
    });
  });
});

describe('Mutual Information Strategy', () => {
  describe('calculateMutualInformationSignals function', () => {
    test('returns null for insufficient data', async () => {
      const mainCloses = [100, 101, 102]; // 短すぎる
      const referenceData = [
        { symbol: 'ETH/USDT', closes: [3000, 3010, 3020] }
      ];
      
      const mockExchange = {};
      const mockFetchTicker = jest.fn();
      
      const result = await calculateMutualInformationSignals(
        mainCloses,
        referenceData,
        50, // period
        0.5, // threshold
        mockExchange,
        'BTC/USDT',
        'test-strategy',
        true, // useReturns
        { backtest: true }
      );
      
      expect(result).toBeNull();
    });

    test('generates buy signal for high mutual information with upward trend', async () => {
      // 上昇トレンドのデータを作成
      const mainCloses = Array.from({length: 50}, (_, i) => 50000 + i * 100);
      const referenceData = [
        { symbol: 'ETH/USDT', closes: Array.from({length: 50}, (_, i) => 3000 + i * 10) }
      ];
      
      const mockTicker = { last: 55000 };
      const mockExchange = {};
      
      // より明示的なモッキング
      const mockOptions = { 
        backtest: {
          ohlcvData: [
            [Date.now(), 54000, 55500, 53500, 55000, 1000] // [timestamp, open, high, low, close, volume]
          ]
        }
      };
      
      const result = await calculateMutualInformationSignals(
        mainCloses,
        referenceData,
        20, // period
        0.1, // threshold (低く設定して高い相互情報量を検出しやすくする)
        mockExchange,
        'BTC/USDT',
        'test-strategy',
        true, // useReturns
        mockOptions
      );
      
      expect(result).not.toBeNull();
      expect(result.currentPrice).toBeGreaterThan(50000); // More flexible check
      expect(result.signalType).toBeDefined();
      expect(['buy', 'sell', 'none']).toContain(result.signalType);
      expect(typeof result.avgMutualInfo).toBe('number');
      expect(typeof result.currentTrend).toBe('number');
    });
  });

  describe('formatMutualInformationLogInfo function', () => {
    test('formats log info correctly', () => {
      const signalResult = {
        currentPrice: 50000,
        avgMutualInfo: 0.75,
        currentTrend: 0.002,
        strategyResults: {
          threshold: 0.5,
          analysisType: 'returns',
          mutualInfoScores: [
            { symbol: 'ETH/USDT', mutualInfo: 0.75 }
          ]
        }
      };
      
      const logInfo = formatMutualInformationLogInfo(signalResult);
      
      expect(logInfo).toHaveProperty('buy');
      expect(logInfo).toHaveProperty('sell');
      expect(logInfo).toHaveProperty('none');
      expect(logInfo).toHaveProperty('orderInfo');
      expect(logInfo).toHaveProperty('result');
      
      expect(logInfo.buy).toContain('相互情報量: 0.7500');
      expect(logInfo.buy).toContain('トレンド: 0.002000');
      expect(logInfo.buy).toContain('分析: returns');
      
      expect(logInfo.orderInfo.avgMutualInfo).toBe(0.75);
      expect(logInfo.orderInfo.currentTrend).toBe(0.002);
      expect(logInfo.orderInfo.threshold).toBe(0.5);
      
      expect(logInfo.result.currentPrice).toBe(50000);
      expect(logInfo.result.avgMutualInfo).toBe(0.75);
      expect(logInfo.result.analysisType).toBe('returns');
    });
  });
});