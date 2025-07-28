/**
 * Backtest Enhancement Integration Tests
 *
 * backtestRunner.jsとオーバーフィッティング防止機能の統合テスト
 *
 * 作成者: worker-claude
 * 日付: 2025-06-28
 */

const { WalkForwardAnalysis } = require('../../src/strategies/utils/walkForwardAnalysis');
const { TimeSeriesCrossValidator: TSCV, FinancialTimeSeriesValidator } = require('../../src/strategies/utils/timeSeriesCrossValidation');
const { MonteCarloBootstrapping } = require('../../src/strategies/utils/monteCarloBootstrapping');
const { BacktestEnhancer } = require('../../src/strategies/utils/backtestEnhancer');
const { RealtimeValidationSystem } = require('../../src/strategies/utils/realtimeValidationSystem');

describe('Backtest Enhancement Integration Tests', () => {
  let sampleBacktestResults;
  let sampleTimeSeriesData;

  beforeEach(() => {
    // サンプルバックテスト結果
    sampleBacktestResults = Array.from({ length: 50 }, (_, i) => ({
      finalBaseFund: 10000 + (Math.random() - 0.5) * 2000,
      parameters: {
        period: 20 + Math.floor(Math.random() * 10),
        threshold: 0.5 + Math.random() * 0.5
      },
      timeframe: '1h'
    }));

    // サンプル時系列データ
    sampleTimeSeriesData = Array.from({ length: 100 }, (_, i) => ({
      timestamp: new Date(Date.now() - (100 - i) * 24 * 60 * 60 * 1000),
      value: 100 + Math.sin(i * 0.1) * 10 + (Math.random() - 0.5) * 5,
      price: 100 + Math.sin(i * 0.1) * 10 + (Math.random() - 0.5) * 5
    }));
  });

  describe('Walk-Forward Analysis Integration', () => {
    test('should successfully analyze backtest results with WFA', async () => {
      const walkForward = new WalkForwardAnalysis({
        trainWindow: 50,
        testWindow: 10,
        stepSize: 5,
        minTrainPeriods: 30,
        anchored: false
      });

      const splits = walkForward.splitTimeSeries(sampleTimeSeriesData);

      expect(splits).toBeDefined();
      expect(splits.length).toBeGreaterThan(0);
      expect(splits[0]).toHaveProperty('trainData');
      expect(splits[0]).toHaveProperty('testData');

      // パフォーマンス計算
      const performanceResults = [];
      for (const split of splits) {
        const returns = split.testData.map(d => (d.value - 100) / 100);
        const performance = walkForward.calculatePerformanceMetrics(returns);
        performanceResults.push(performance);
      }

      expect(performanceResults.length).toBe(splits.length);
      expect(performanceResults[0]).toHaveProperty('sharpeRatio');
      expect(performanceResults[0]).toHaveProperty('maxDrawdown');
    });

    test('should validate data integrity', () => {
      const walkForward = new WalkForwardAnalysis();

      expect(() => {
        walkForward.validateDataIntegrity(sampleTimeSeriesData);
      }).not.toThrow();

      // 不正なデータでのテスト
      const invalidData = [
        { timestamp: new Date('2025-01-02'), value: 100 },
        { timestamp: new Date('2025-01-01'), value: 105 } // 順序が逆
      ];

      expect(() => {
        walkForward.validateDataIntegrity(invalidData);
      }).toThrow('未来データリークが検出されました');
    });
  });

  describe('Time Series Cross-Validation Integration', () => {
    test('should perform time series split correctly', async () => {
      const timeSeriesCV = new TSCV({
        nSplits: 3,
        testSize: 0.2,
        purgeGap: 1,
        embargoLength: 1,
        minTrainSize: 10
      });

      const splits = timeSeriesCV.timeSeriesSplit(sampleTimeSeriesData);

      expect(splits).toBeDefined();
      expect(splits.length).toBe(3);

      // データリーケージ検証
      timeSeriesCV.validateSplits(splits);

      splits.forEach(split => {
        expect(split.trainData.length).toBeGreaterThan(0);
        expect(split.testData.length).toBeGreaterThan(0);

        // 時系列順序の確認
        const lastTrainTime = split.trainData[split.trainData.length - 1].timestamp.getTime();
        const firstTestTime = split.testData[0].timestamp.getTime();
        expect(firstTestTime).toBeGreaterThan(lastTrainTime);
      });
    });

    test('should calculate adaptive test size', () => {
      const timeSeriesCV = new TSCV({
        adaptiveTestSize: true,
        testSize: 0.2,
        maxTestSize: 50
      });

      const adaptiveSize = timeSeriesCV.calculateAdaptiveTestSize(sampleTimeSeriesData);

      expect(adaptiveSize).toBeGreaterThan(0);
      expect(adaptiveSize).toBeLessThanOrEqual(50);
    });
  });

  describe('Monte Carlo Bootstrapping Integration', () => {
    test('should perform comprehensive analysis', async () => {
      const mcBootstrap = new MonteCarloBootstrapping({
        iterations: 100, // テスト用に軽量化
        confidenceLevel: 0.95
      });

      const returns = sampleBacktestResults.map(r => (r.finalBaseFund - 10000) / 10000);

      const analysis = await mcBootstrap.comprehensiveAnalysis(returns, {
        riskFreeRate: 0,
        includeHigherMoments: true,
        includeTailRisk: true
      });

      expect(analysis).toHaveProperty('basicStats');
      expect(analysis).toHaveProperty('sharpeAnalysis');
      expect(analysis).toHaveProperty('drawdownAnalysis');
      expect(analysis).toHaveProperty('varAnalysis');
      expect(analysis).toHaveProperty('higherMoments');
      expect(analysis).toHaveProperty('tailRisk');

      expect(analysis.sharpeAnalysis).toHaveProperty('originalSharpe');
      expect(analysis.sharpeAnalysis).toHaveProperty('confidenceInterval');
    });

    test('should calculate Sharpe ratio confidence interval', async () => {
      const mcBootstrap = new MonteCarloBootstrapping({
        iterations: 100,
        confidenceLevel: 0.95
      });

      const returns = Array.from({ length: 30 }, () => (Math.random() - 0.5) * 0.1);

      const sharpeCI = await mcBootstrap.calculateSharpeConfidenceInterval(returns);

      expect(sharpeCI).toHaveProperty('originalSharpe');
      expect(sharpeCI).toHaveProperty('confidenceInterval');
      expect(sharpeCI).toHaveProperty('standardError');
      expect(sharpeCI.confidenceInterval).toHaveProperty('lower');
      expect(sharpeCI.confidenceInterval).toHaveProperty('upper');
      expect(sharpeCI.confidenceInterval.upper).toBeGreaterThan(sharpeCI.confidenceInterval.lower);
    });
  });

  describe('Backtest Enhancer Integration', () => {
    test('should enhance backtest results with all features', async () => {
      const enhancer = new BacktestEnhancer({
        iterations: 100,
        confidenceLevel: 0.95,
        minTradesRequired: 5
      });

      const enhancedResults = await enhancer.enhanceBacktestResults(sampleBacktestResults);

      expect(enhancedResults).toHaveProperty('monteCarloAnalysis');
      expect(enhancedResults).toHaveProperty('robustnessValidation');
      expect(enhancedResults).toHaveProperty('riskAdjustedMetrics');
      expect(enhancedResults).toHaveProperty('performanceEvaluation');
      expect(enhancedResults).toHaveProperty('recommendations');
      expect(enhancedResults).toHaveProperty('summary');

      expect(enhancedResults.summary).toHaveProperty('performance');
      expect(enhancedResults.summary).toHaveProperty('riskProfile');
      expect(enhancedResults.summary).toHaveProperty('confidence');
    });

    test('should generate Discord report', async () => {
      const enhancer = new BacktestEnhancer({
        iterations: 50,
        minTradesRequired: 5
      });

      const enhancedResults = await enhancer.enhanceBacktestResults(sampleBacktestResults);
      const report = enhancer.generateDiscordReport(enhancedResults);

      expect(typeof report).toBe('string');
      expect(report).toContain('Monte Carlo Bootstrapping');
      expect(report).toContain('総合評価');
      expect(report).toContain('主要指標');
    });

    test('should handle insufficient data gracefully', async () => {
      const enhancer = new BacktestEnhancer({
        minTradesRequired: 100 // 要求データ数を高く設定
      });

      const limitedResults = sampleBacktestResults.slice(0, 5);
      const enhancedResults = await enhancer.enhanceBacktestResults(limitedResults);

      expect(enhancedResults.limited).toBe(true);
      expect(enhancedResults.reason).toBe('insufficient_data');
      expect(enhancedResults.recommendations).toBeDefined();
      expect(enhancedResults.recommendations[0].type).toBe('data_collection');
    });
  });

  describe('Realtime Validation System Integration', () => {
    let realtimeSystem;

    beforeEach(() => {
      realtimeSystem = new RealtimeValidationSystem({
        validationWindow: 50,
        monitoringInterval: 1000,
        enableAdaptiveAdjustment: true
      });
    });

    afterEach(() => {
      if (realtimeSystem.isMonitoring) {
        realtimeSystem.stopMonitoring();
      }
    });

    test('should start and stop monitoring', () => {
      expect(realtimeSystem.isMonitoring).toBe(false);

      realtimeSystem.startMonitoring();
      expect(realtimeSystem.isMonitoring).toBe(true);

      realtimeSystem.stopMonitoring();
      expect(realtimeSystem.isMonitoring).toBe(false);
    });

    test('should add trade results and maintain window size', () => {
      // 100個のトレード結果を追加
      for (let i = 0; i < 100; i++) {
        realtimeSystem.addTradeResult({
          timestamp: new Date(),
          returnValue: (Math.random() - 0.5) * 0.1,
          profit: (Math.random() - 0.5) * 1000,
          parameters: { period: 20, threshold: 0.5 },
          strategyName: 'TEST_STRATEGY',
          symbol: 'BTC/USDT'
        });
      }

      // ウィンドウサイズの制限確認
      expect(realtimeSystem.monitoringData.recentReturns.length).toBeLessThanOrEqual(50);
      expect(realtimeSystem.monitoringData.historicalPerformance.length).toBeLessThanOrEqual(100);
    });

    test('should set and use performance baseline', () => {
      const baseline = {
        sharpeRatio: 1.5,
        meanReturn: 0.05,
        maxDrawdown: 0.1
      };

      realtimeSystem.setPerformanceBaseline(baseline);

      expect(realtimeSystem.monitoringData.performanceBaseline).toMatchObject(baseline);
      expect(realtimeSystem.monitoringData.performanceBaseline.timestamp).toBeDefined();
    });

    test('should detect performance degradation', async () => {
      // ベースライン設定
      realtimeSystem.setPerformanceBaseline({
        sharpeRatio: 2.0,
        meanReturn: 0.1,
        maxDrawdown: 0.05
      });

      // 劣化したパフォーマンスのデータを追加
      for (let i = 0; i < 30; i++) {
        realtimeSystem.addTradeResult({
          timestamp: new Date(),
          returnValue: -0.05, // 負のリターン
          parameters: { period: 20 }
        });
      }

      const degradationResult = await realtimeSystem.detectPerformanceDegradation();

      expect(degradationResult.detected).toBe(true);
      expect(degradationResult.degradationScore).toBeGreaterThan(0);
    });

    test('should generate monitoring summary', () => {
      // いくつかのトレード結果を追加
      for (let i = 0; i < 10; i++) {
        realtimeSystem.addTradeResult({
          timestamp: new Date(),
          returnValue: Math.random() * 0.1,
          parameters: { period: 20 }
        });
      }

      const summary = realtimeSystem.getMonitoringSummary();

      expect(summary).toHaveProperty('isMonitoring');
      expect(summary).toHaveProperty('totalTrades');
      expect(summary).toHaveProperty('recentTradeCount');
      expect(summary).toHaveProperty('alertCount');
      expect(summary.totalTrades).toBe(10);
    });

    test('should generate Discord report', () => {
      const report = realtimeSystem.generateDiscordReport();

      expect(typeof report).toBe('string');
      expect(report).toContain('リアルタイム検証システム');
      expect(report).toContain('監視状態');
    });
  });

  describe('Financial Time Series Validator Integration', () => {
    test('should perform comprehensive validation', () => {
      const validator = new FinancialTimeSeriesValidator({
        timeSeriesSplit: { nSplits: 3, testSize: 0.2, minTrainSize: 10 },
        embargo: { embargoLength: 2 },
        detectAutocorrelation: true,
        detectHeteroskedasticity: true
      });

      const results = validator.validateComprehensively(sampleTimeSeriesData);

      expect(results).toHaveProperty('timeSeriesSplits');
      expect(results).toHaveProperty('purgedSplits');
      expect(results).toHaveProperty('embargoResults');
      expect(results).toHaveProperty('overallScore');
      expect(results).toHaveProperty('recommendedMethod');

      expect(results.timeSeriesSplits.length).toBeGreaterThan(0);
    });

    test('should diagnose time series characteristics', () => {
      const validator = new FinancialTimeSeriesValidator({
        detectAutocorrelation: true,
        detectHeteroskedasticity: true,
        detectNonStationarity: true,
        detectStructuralBreaks: true
      });

      const diagnostics = validator.diagnoseTimeSeries(sampleTimeSeriesData);

      expect(diagnostics).toHaveProperty('autocorrelationTest');
      expect(diagnostics).toHaveProperty('heteroskedasticityTest');
      expect(diagnostics).toHaveProperty('stationarityTest');
      expect(diagnostics).toHaveProperty('structuralBreakTest');
      expect(diagnostics).toHaveProperty('recommendations');

      expect(Array.isArray(diagnostics.recommendations)).toBe(true);
    });
  });

  describe('Overfitting Detection Integration', () => {
    test('should detect parameter instability', () => {
      // 不安定なパラメータを持つ結果を生成
      const unstableResults = Array.from({ length: 30 }, (_, i) => ({
        finalBaseFund: 10000 + Math.random() * 2000,
        parameters: {
          period: 10 + Math.floor(Math.random() * 40), // 大きな変動
          threshold: Math.random() // 0-1の範囲で変動
        },
        timeframe: '1h'
      }));

      // パラメータ安定性分析関数（backtestRunner.jsから）
      function analyzeParameterStability(results) {
        if (results.length < 2) {
          return 0;
        }

        const parameterKeys = Object.keys(results[0].parameters || {});
        if (parameterKeys.length === 0) {
          return 0;
        }

        let totalVariability = 0;

        for (const key of parameterKeys) {
          const values = results.map(r => r.parameters[key]).filter(v => typeof v === 'number');
          if (values.length < 2) {
            continue;
          }

          const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
          const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (values.length - 1);
          const cv = mean !== 0 ? Math.sqrt(variance) / Math.abs(mean) : 0;

          totalVariability += cv;
        }

        return parameterKeys.length > 0 ? totalVariability / parameterKeys.length : 0;
      }

      const instability = analyzeParameterStability(unstableResults);
      expect(instability).toBeGreaterThan(0.1); // ある程度の不安定性を期待
    });

    test('should estimate out-of-sample performance', () => {
      // Out-of-sample性能推定関数（backtestRunner.jsから）
      function estimateOutOfSamplePerformance(results) {
        if (results.length < 10) {
          return 0.5;
        }

        const sortedResults = results.sort((a, b) => (b.finalBaseFund || 10000) - (a.finalBaseFund || 10000));
        const topQuartile = sortedResults.slice(0, Math.floor(results.length / 4));
        const bottomQuartile = sortedResults.slice(-Math.floor(results.length / 4));

        const topAvg = topQuartile.reduce((sum, r) => sum + (r.finalBaseFund || 10000), 0) / topQuartile.length;
        const bottomAvg = bottomQuartile.reduce((sum, r) => sum + (r.finalBaseFund || 10000), 0) / bottomQuartile.length;

        return bottomAvg / topAvg;
      }

      const oosPerformance = estimateOutOfSamplePerformance(sampleBacktestResults);
      expect(oosPerformance).toBeGreaterThan(0);
      expect(oosPerformance).toBeLessThanOrEqual(1);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle empty data gracefully', async () => {
      const enhancer = new BacktestEnhancer();

      const result = await enhancer.enhanceBacktestResults([]);
      expect(result.error).toBeDefined();
    });

    test('should handle invalid time series data', () => {
      const walkForward = new WalkForwardAnalysis();

      expect(() => {
        walkForward.splitTimeSeries([]);
      }).toThrow();

      expect(() => {
        walkForward.splitTimeSeries([{ value: 100 }]); // timestampなし
      }).toThrow();
    });

    test('should handle NaN and infinite values', async () => {
      const mcBootstrap = new MonteCarloBootstrapping({
        iterations: 50
      });

      const invalidReturns = [0.1, NaN, 0.2, Infinity, -0.1];

      // 有効でない値を除外して処理
      const validReturns = invalidReturns.filter(r => isFinite(r) && !isNaN(r));

      const sharpeCI = await mcBootstrap.calculateSharpeConfidenceInterval(validReturns);

      expect(sharpeCI.validIterations).toBeGreaterThan(0);
      expect(isFinite(sharpeCI.originalSharpe)).toBe(true);
    });
  });

  describe('Performance and Memory Tests', () => {
    test('should handle large datasets efficiently', async () => {
      const largeResults = Array.from({ length: 1000 }, (_, i) => ({
        finalBaseFund: 10000 + (Math.random() - 0.5) * 2000,
        parameters: {
          period: 20 + Math.floor(Math.random() * 10),
          threshold: 0.5 + Math.random() * 0.5
        },
        timeframe: '1h'
      }));

      const startTime = Date.now();

      const enhancer = new BacktestEnhancer({
        iterations: 100, // 軽量化
        minTradesRequired: 10
      });

      const result = await enhancer.enhanceBacktestResults(largeResults);

      const executionTime = Date.now() - startTime;

      expect(result.monteCarloAnalysis).toBeDefined();
      expect(executionTime).toBeLessThan(60000); // 60秒以内 (CI環境対応)
    });

    test('should maintain memory efficiency in realtime system', () => {
      const memoryTestSystem = new RealtimeValidationSystem({
        validationWindow: 100
      });

      // 大量のデータを追加
      for (let i = 0; i < 500; i++) {
        memoryTestSystem.addTradeResult({
          timestamp: new Date(),
          returnValue: Math.random() * 0.1,
          parameters: { period: 20 }
        });
      }

      // メモリ効率の確認
      expect(memoryTestSystem.monitoringData.recentReturns.length).toBeLessThanOrEqual(100);
      expect(memoryTestSystem.monitoringData.historicalPerformance.length).toBeLessThanOrEqual(200);
      expect(memoryTestSystem.monitoringData.alerts.length).toBeLessThanOrEqual(100);
    });
  });
});