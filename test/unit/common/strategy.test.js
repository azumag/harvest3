/**
 * 戦略基盤ライブラリのテスト
 * src/common/strategy.js の全機能をテスト
 */

const {
  BaseStrategy,
  generateSignalResult,
  IndicatorCalculator,
  StrategyParameterManager,
  StrategyMetrics,
  strategyMetrics
} = require('../../../src/common/strategy');

// 依存関係のモック
const mockUtils = {
  validateStrategyParams: jest.fn(),
  validateOHLCVData: jest.fn(),
  handleStrategyError: jest.fn()
};

const mockDatabase = {
  validateAndSanitizeData: jest.fn()
};

jest.mock('../../../src/common/utils', () => mockUtils);
jest.mock('../../../src/common/database', () => mockDatabase);

describe('戦略基盤ライブラリテスト', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('BaseStrategy', () => {
    class TestStrategy extends BaseStrategy {
      constructor() {
        super('TEST_STRATEGY', 'bitbank', 'BTC/JPY');
      }

      async doExecute(params, ohlcvData, additionalData) {
        return {
          signal: 'buy',
          price: ohlcvData[ohlcvData.length - 1][4], // close price
          confidence: 0.8
        };
      }

      getRequiredParams() {
        return ['period', 'threshold'];
      }

      getMinDataLength() {
        return 10;
      }
    }

    let strategy;

    beforeEach(() => {
      strategy = new TestStrategy();
    });

    test('基本的なプロパティの初期化', () => {
      expect(strategy.strategyName).toBe('TEST_STRATEGY');
      expect(strategy.exchange).toBe('bitbank');
      expect(strategy.symbol).toBe('BTC/JPY');
      expect(strategy.executionCount).toBe(0);
      expect(strategy.errorCount).toBe(0);
      expect(strategy.lastExecutionTime).toBe(null);
    });

    test('正常な実行フロー', async () => {
      const params = { period: 14, threshold: 0.5 };
      const ohlcvData = [
        [1640995200000, 100, 105, 95, 102, 1000],
        [1640995260000, 102, 107, 98, 104, 1200]
      ];

      mockUtils.validateStrategyParams.mockReturnValue(true);
      mockUtils.validateOHLCVData.mockReturnValue(true);

      const result = await strategy.execute(params, ohlcvData);

      expect(result.signal).toBe('buy');
      expect(result.price).toBe(104);
      expect(result.confidence).toBe(0.8);
      expect(result.strategy).toBe('TEST_STRATEGY');
      expect(result.exchange).toBe('bitbank');
      expect(result.symbol).toBe('BTC/JPY');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('executionTime');
      expect(result.executionCount).toBe(1);

      expect(strategy.executionCount).toBe(1);
      expect(strategy.lastExecutionTime).not.toBe(null);
    });

    test('実行エラーの処理', async () => {
      const params = { period: 14, threshold: 0.5 };
      const ohlcvData = [];

      mockUtils.validateStrategyParams.mockReturnValue(true);
      mockUtils.validateOHLCVData.mockImplementation(() => {
        throw new Error('データ不足');
      });

      await expect(strategy.execute(params, ohlcvData)).rejects.toThrow('データ不足');

      expect(strategy.executionCount).toBe(1);
      expect(strategy.errorCount).toBe(1);
      expect(mockUtils.handleStrategyError).toHaveBeenCalled();
    });

    test('統計情報の取得', () => {
      strategy.executionCount = 10;
      strategy.errorCount = 2;
      strategy.lastExecutionTime = Date.now();

      const stats = strategy.getStats();

      expect(stats.strategyName).toBe('TEST_STRATEGY');
      expect(stats.exchange).toBe('bitbank');
      expect(stats.symbol).toBe('BTC/JPY');
      expect(stats.executionCount).toBe(10);
      expect(stats.errorCount).toBe(2);
      expect(stats.errorRate).toBe(0.2);
      expect(stats.lastExecutionTime).not.toBe(null);
    });

    test('抽象メソッドの未実装エラー', async () => {
      const baseStrategy = new BaseStrategy('BASE', 'test', 'TEST/USD');
      
      await expect(baseStrategy.doExecute({}, [])).rejects.toThrow(
        'doExecute メソッドは子クラスで実装してください'
      );
    });
  });

  describe('generateSignalResult', () => {
    test('買いシグナルの生成', () => {
      const result = generateSignalResult(true, false, {
        confidence: 0.9,
        metadata: { indicator: 'SMA' }
      });

      expect(result.signal).toBe('buy');
      expect(result.hasBuySignal).toBe(true);
      expect(result.hasSellSignal).toBe(false);
      expect(result.confidence).toBe(0.9);
      expect(result.metadata).toEqual({ indicator: 'SMA' });
      expect(result).toHaveProperty('timestamp');
    });

    test('売りシグナルの生成', () => {
      const result = generateSignalResult(false, true);

      expect(result.signal).toBe('sell');
      expect(result.hasBuySignal).toBe(false);
      expect(result.hasSellSignal).toBe(true);
      expect(result.confidence).toBe(0.5); // default
      expect(result.metadata).toEqual({}); // default
    });

    test('シグナルなしの場合', () => {
      const result = generateSignalResult(false, false);

      expect(result.signal).toBe('none');
      expect(result.hasBuySignal).toBe(false);
      expect(result.hasSellSignal).toBe(false);
    });
  });

  describe('IndicatorCalculator', () => {
    describe('calculateSMA', () => {
      test('正常なSMA計算', () => {
        const prices = [10, 12, 14, 16, 18, 20];
        const result = IndicatorCalculator.calculateSMA(prices, 3);

        expect(result).toHaveLength(4);
        expect(result[0]).toBe(12); // (10+12+14)/3
        expect(result[1]).toBe(14); // (12+14+16)/3
        expect(result[2]).toBe(16); // (14+16+18)/3
        expect(result[3]).toBe(18); // (16+18+20)/3
      });

      test('データ不足の場合は空配列', () => {
        const prices = [10, 12];
        const result = IndicatorCalculator.calculateSMA(prices, 5);

        expect(result).toEqual([]);
      });

      test('無効な入力の場合', () => {
        expect(IndicatorCalculator.calculateSMA(null, 3)).toEqual([]);
        expect(IndicatorCalculator.calculateSMA('not_array', 3)).toEqual([]);
      });
    });

    describe('calculateEMA', () => {
      test('正常なEMA計算', () => {
        const prices = [10, 12, 14, 16, 18];
        const result = IndicatorCalculator.calculateEMA(prices, 3);

        expect(result).toHaveLength(5);
        expect(result[0]).toBe(10); // 最初の値
        // EMA計算の正確性を検証
        const multiplier = 2 / (3 + 1); // 0.5
        expect(result[1]).toBeCloseTo(10 + (12 - 10) * multiplier);
      });

      test('空配列の場合', () => {
        const result = IndicatorCalculator.calculateEMA([], 3);
        expect(result).toEqual([]);
      });
    });

    describe('calculateRSI', () => {
      test('正常なRSI計算', () => {
        // RSI計算用の価格データ（上昇・下降を含む）
        const prices = [
          44, 44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.85, 46.08, 45.89,
          46.03, 46.83, 46.69, 46.45, 46.59, 46.3, 46.28, 46.28, 46.00, 46.03
        ];
        
        const result = IndicatorCalculator.calculateRSI(prices, 14);

        expect(result.length).toBeGreaterThan(0);
        // RSIは0-100の範囲内
        result.forEach(rsi => {
          expect(rsi).toBeGreaterThanOrEqual(0);
          expect(rsi).toBeLessThanOrEqual(100);
        });
      });

      test('データ不足の場合', () => {
        const prices = [10, 12, 14]; // 期間14に対して不足
        const result = IndicatorCalculator.calculateRSI(prices, 14);

        expect(result).toEqual([]);
      });
    });

    describe('calculateBollingerBands', () => {
      test('正常なボリンジャーバンド計算', () => {
        const prices = Array.from({ length: 25 }, (_, i) => 100 + Math.sin(i) * 5);
        const result = IndicatorCalculator.calculateBollingerBands(prices, 20, 2);

        expect(result.middle.length).toBe(6); // 25 - 20 + 1
        expect(result.upper.length).toBe(6);
        expect(result.lower.length).toBe(6);

        // 上位バンドは中央値より上、下位バンドは中央値より下
        for (let i = 0; i < result.middle.length; i++) {
          expect(result.upper[i]).toBeGreaterThan(result.middle[i]);
          expect(result.lower[i]).toBeLessThan(result.middle[i]);
        }
      });
    });
  });

  describe('StrategyParameterManager', () => {
    let manager;
    let mockManagerInstance;

    beforeEach(() => {
      mockManagerInstance = {
        getStrategyParameters: jest.fn(),
        saveStrategyParameters: jest.fn()
      };
      manager = new StrategyParameterManager(mockManagerInstance, 'bitbank', 'BTC/JPY');
    });

    test('パラメータの取得成功', async () => {
      const mockParams = { period: 14, threshold: 0.5 };
      mockManagerInstance.getStrategyParameters.mockResolvedValue(mockParams);

      const result = await manager.getParameters('MA_STRATEGY', { period: 10 });

      expect(result).toEqual({ period: 14, threshold: 0.5 });
      expect(mockManagerInstance.getStrategyParameters).toHaveBeenCalledWith(
        'bitbank', 'BTC/JPY', 'MA_STRATEGY'
      );
    });

    test('パラメータ取得失敗時はデフォルト値', async () => {
      mockManagerInstance.getStrategyParameters.mockRejectedValue(new Error('取得失敗'));
      
      const result = await manager.getParameters('MA_STRATEGY', { period: 10 });

      expect(result).toEqual({ period: 10 });
      expect(mockUtils.handleStrategyError).toHaveBeenCalled();
    });

    test('パラメータの保存成功', async () => {
      mockManagerInstance.saveStrategyParameters.mockResolvedValue();

      const result = await manager.saveParameters('MA_STRATEGY', { period: 20 });

      expect(result).toBe(true);
      expect(mockManagerInstance.saveStrategyParameters).toHaveBeenCalledWith(
        'bitbank', 'BTC/JPY', 'MA_STRATEGY', { period: 20 }
      );
    });

    test('パラメータ保存失敗', async () => {
      mockManagerInstance.saveStrategyParameters.mockRejectedValue(new Error('保存失敗'));

      const result = await manager.saveParameters('MA_STRATEGY', { period: 20 });

      expect(result).toBe(false);
      expect(mockUtils.handleStrategyError).toHaveBeenCalled();
    });

    test('パラメータの検証', () => {
      const params = { period: '14', threshold: '0.5' };
      const schema = {
        period: { type: 'number', required: true },
        threshold: { type: 'number', required: true }
      };
      
      mockDatabase.validateAndSanitizeData.mockReturnValue({
        period: 14,
        threshold: 0.5
      });

      const result = manager.validateParameters(params, schema);

      expect(mockDatabase.validateAndSanitizeData).toHaveBeenCalledWith(
        params, schema, 'bitbank-BTC/JPY'
      );
      expect(result).toEqual({ period: 14, threshold: 0.5 });
    });
  });

  describe('StrategyMetrics', () => {
    let metrics;

    beforeEach(() => {
      metrics = new StrategyMetrics();
    });

    test('実行メトリクスの記録', () => {
      const result = {
        signal: 'buy',
        executionTime: 150,
        error: false
      };

      metrics.recordExecution('strategy1', result);

      const metricData = metrics.getMetrics('strategy1');
      expect(metricData.totalExecutions).toBe(1);
      expect(metricData.successCount).toBe(1);
      expect(metricData.errorCount).toBe(0);
      expect(metricData.totalExecutionTime).toBe(150);
      expect(metricData.signals.buy).toBe(1);
    });

    test('エラー実行の記録', () => {
      const result = { error: true };

      metrics.recordExecution('strategy1', result);

      const metricData = metrics.getMetrics('strategy1');
      expect(metricData.errorCount).toBe(1);
      expect(metricData.successCount).toBe(0);
    });

    test('計算メトリクスの確認', () => {
      // 成功2回、失敗1回を記録
      metrics.recordExecution('strategy1', { executionTime: 100 });
      metrics.recordExecution('strategy1', { executionTime: 200 });
      metrics.recordExecution('strategy1', { error: true });

      const metricData = metrics.getMetrics('strategy1');
      expect(metricData.successRate).toBe(2/3);
      expect(metricData.averageExecutionTime).toBe(150); // (100+200)/2
    });

    test('未知の戦略ID', () => {
      const result = metrics.getMetrics('unknown');
      expect(result).toBe(null);
    });

    test('全メトリクスの取得', () => {
      metrics.recordExecution('strategy1', { signal: 'buy' });
      metrics.recordExecution('strategy2', { signal: 'sell' });

      const allMetrics = metrics.getAllMetrics();
      
      expect(Object.keys(allMetrics)).toEqual(['strategy1', 'strategy2']);
      expect(allMetrics.strategy1.signals.buy).toBe(1);
      expect(allMetrics.strategy2.signals.sell).toBe(1);
    });
  });
});