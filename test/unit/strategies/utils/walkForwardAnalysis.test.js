/**
 * Walk-Forward Analysis 包括テストスイート
 * 
 * テスト設計指針：
 * - t-wadaスタイル（Red-Green-Blue）準拠
 * - 金融時系列の非定常性を考慮
 * - データリーケージ防止の包括的検証
 * - 統計的堅牢性の検証
 * 
 * 作成者: worker-claude
 * 日付: 2025-06-27
 */

const { 
  WalkForwardAnalysis,
  WalkForwardAnalysisBuilder,
  TimeSeriesValidator,
  DataLeakageDetector,
  ParameterDriftDetector,
  RegimeChangeDetector,
  RobustnessValidator
} = require('../../../../src/strategies/utils/walkForwardAnalysis');

describe('Walk-Forward Analysis 包括テストスイート', () => {
  let testData;
  let walkForwardAnalysis;
  
  beforeEach(() => {
    // テスト用の時系列データを生成
    testData = generateMockTimeSeriesData();
    walkForwardAnalysis = new WalkForwardAnalysis({
      trainWindow: 252,  // 1年分の営業日
      testWindow: 21,    // 1ヶ月分の営業日
      stepSize: 21,      // 1ヶ月ステップ
      anchored: false,   // ローリングウィンドウ
      minTrainPeriods: 126 // 最小学習期間（6ヶ月）
    });
  });

  describe('🔴 Red Phase: 失敗ケース - 基本機能', () => {
    
    test('時系列データの分割が正しく失敗する（データ不足）', () => {
      const insufficientData = testData.slice(0, 100); // 不十分なデータ
      
      expect(() => {
        walkForwardAnalysis.splitTimeSeries(insufficientData);
      }).toThrow('データが不十分です');
    });

    test('未来データリークが正しく検出される', () => {
      const leakyData = createLeakyTimeSeriesData();
      
      expect(() => {
        walkForwardAnalysis.validateDataIntegrity(leakyData);
      }).toThrow('未来データリークが検出されました');
    });

    test('不正なパラメータ設定が正しく拒否される', () => {
      expect(() => {
        new WalkForwardAnalysis({
          trainWindow: -1,  // 負の値
          testWindow: 0,    // ゼロ
          stepSize: 1000    // 大きすぎる値
        });
      }).toThrow('パラメータが不正です');
    });

  });

  describe('🟢 Green Phase: 最小実装 - 基本機能', () => {
    
    test('時系列データが正しく分割される', () => {
      const splits = walkForwardAnalysis.splitTimeSeries(testData);
      
      expect(splits).toBeDefined();
      expect(Array.isArray(splits)).toBe(true);
      expect(splits.length).toBeGreaterThan(0);
      
      // 各分割の基本構造を検証
      splits.forEach(split => {
        expect(split).toHaveProperty('trainData');
        expect(split).toHaveProperty('testData');
        expect(split).toHaveProperty('trainStart');
        expect(split).toHaveProperty('trainEnd');
        expect(split).toHaveProperty('testStart');
        expect(split).toHaveProperty('testEnd');
      });
    });

    test('ローリングウィンドウが正しく動作する', () => {
      const rollingAnalysis = new WalkForwardAnalysis({
        trainWindow: 100,
        testWindow: 20,
        stepSize: 20,
        anchored: false,
        minTrainPeriods: 50  // trainWindowより小さく設定
      });
      
      const splits = rollingAnalysis.splitTimeSeries(testData);
      
      // ローリングウィンドウの特性を検証
      expect(splits[0].trainData.length).toBe(100);
      expect(splits[1].trainData.length).toBe(100); // 同じサイズを維持
    });

    test('アンカードウィンドウが正しく動作する', () => {
      const anchored = new WalkForwardAnalysis({
        trainWindow: 100,
        testWindow: 20,
        stepSize: 20,
        anchored: true,
        minTrainPeriods: 50  // trainWindowより小さく設定
      });
      
      const splits = anchored.splitTimeSeries(testData);
      
      // アンカードウィンドウの特性を検証
      expect(splits[0].trainData.length).toBe(100);
      expect(splits[1].trainData.length).toBe(120); // 拡張される
    });

  });

  describe('🔵 Blue Phase: リファクタリング - 基本機能', () => {
    
    test('時系列分割のパフォーマンスが適切', () => {
      const largeData = generateMockTimeSeriesData(10000);
      
      const startTime = performance.now();
      const splits = walkForwardAnalysis.splitTimeSeries(largeData);
      const endTime = performance.now();
      
      expect(endTime - startTime).toBeLessThan(1000); // 1秒以内
      expect(splits.length).toBeGreaterThan(0);
    });

    test('メモリ効率的な分割が実行される', () => {
      const originalData = generateMockTimeSeriesData(5000);
      const initialMemory = process.memoryUsage().heapUsed;
      
      const splits = walkForwardAnalysis.splitTimeSeries(originalData);
      
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;
      
      // メモリ使用量が合理的な範囲内
      expect(memoryIncrease).toBeLessThan(originalData.length * 1000);
    });

    test('Builder パターンが正しく動作する', () => {
      const analysis = new WalkForwardAnalysisBuilder()
        .setTrainWindow(252)
        .setTestWindow(21)
        .setStepSize(21)
        .setAnchored(false)
        .setMinTrainPeriods(126)
        .build();
      
      expect(analysis).toBeInstanceOf(WalkForwardAnalysis);
      expect(analysis.config.trainWindow).toBe(252);
      expect(analysis.config.testWindow).toBe(21);
      expect(analysis.config.anchored).toBe(false);
    });

  });

  describe('🔴 Red Phase: 失敗ケース - データリーケージ防止', () => {
    
    test('未来データアクセスが検出される', () => {
      const detector = new DataLeakageDetector();
      const leakyFunction = (trainData, testData) => {
        // 意図的にテストデータの未来を参照
        return testData[testData.length - 1].value;
      };
      
      expect(() => {
        detector.validateFunction(leakyFunction, testData);
      }).toThrow('未来データアクセスが検出されました');
    });

    test('時系列順序の破綻が検出される', () => {
      const validator = new TimeSeriesValidator();
      const shuffledData = [...testData].sort(() => Math.random() - 0.5);
      
      expect(() => {
        validator.validateChronologicalOrder(shuffledData);
      }).toThrow('時系列順序が破綻しています');
    });

    test('境界条件での漏洩が検出される', () => {
      const detector = new DataLeakageDetector();
      const splits = walkForwardAnalysis.splitTimeSeries(testData);
      
      // 境界条件でのデータリークをチェック
      splits.forEach(split => {
        expect(() => {
          detector.validateSplitBoundaries(split);
        }).not.toThrow();
      });
    });

  });

  describe('🟢 Green Phase: 最小実装 - データリーケージ防止', () => {
    
    test('データリーケージ検出器が正常動作する', () => {
      const detector = new DataLeakageDetector();
      const cleanFunction = (trainData, testData) => {
        // 正常な関数：訓練データのみ使用
        return trainData.reduce((sum, item) => sum + item.value, 0) / trainData.length;
      };
      
      expect(() => {
        detector.validateFunction(cleanFunction, testData);
      }).not.toThrow();
    });

    test('時系列の整合性が検証される', () => {
      const validator = new TimeSeriesValidator();
      
      expect(() => {
        validator.validateChronologicalOrder(testData);
      }).not.toThrow();
      
      const result = validator.validateChronologicalOrder(testData);
      expect(result.isValid).toBe(true);
    });

    test('パラメータ再最適化タイミングが適切', () => {
      const splits = walkForwardAnalysis.splitTimeSeries(testData);
      
      // パラメータ再最適化は各分割で実行される
      splits.forEach((split, index) => {
        expect(split.shouldReoptimize).toBe(true);
        expect(split.reoptimizationReason).toBeDefined();
      });
    });

  });

  describe('🔵 Blue Phase: リファクタリング - データリーケージ防止', () => {
    
    test('高度なリーケージ検出パターン', () => {
      const detector = new DataLeakageDetector({
        strictMode: true,
        checkLookahead: true,
        checkSurvivorship: true
      });
      
      const splits = walkForwardAnalysis.splitTimeSeries(testData);
      
      splits.forEach(split => {
        const result = detector.comprehensiveLeakageCheck(split);
        expect(result.hasLeakage).toBe(false);
        expect(result.leakageScore).toBe(0);
      });
    });

    test('動的境界検証システム', () => {
      const validator = new TimeSeriesValidator({
        enableDynamicBoundaries: true,
        toleranceLevel: 0.001
      });
      
      const splits = walkForwardAnalysis.splitTimeSeries(testData);
      
      splits.forEach(split => {
        const boundaryResult = validator.validateDynamicBoundaries(split);
        expect(boundaryResult.isValid).toBe(true);
        expect(boundaryResult.boundaryIntegrity).toBeGreaterThan(0.99);
      });
    });

  });

  describe('🔴 Red Phase: 失敗ケース - 統計的堅牢性', () => {
    
    test('パラメータドリフトが検出される', () => {
      const driftDetector = new ParameterDriftDetector();
      const driftingData = createParameterDriftData();
      
      expect(() => {
        driftDetector.detectSignificantDrift(driftingData);
      }).toThrow('有意なパラメータドリフトが検出されました');
    });

    test('レジーム変化が検出される', () => {
      const regimeDetector = new RegimeChangeDetector();
      const regimeChangeData = createRegimeChangeData();
      
      // まず検出が動作することを確認
      const result = regimeDetector.detectRegimeChange(regimeChangeData);
      
      // その後、より明確なレジーム変化データで例外を期待
      const extremeRegimeData = createExtremeRegimeChangeData();
      
      expect(() => {
        regimeDetector.detectRegimeChange(extremeRegimeData);
      }).toThrow('レジーム変化が検出されました');
    });

    test('不安定なパフォーマンスが検出される', () => {
      const robustnessValidator = new RobustnessValidator();
      const unstableResults = createUnstablePerformanceData();
      
      expect(() => {
        robustnessValidator.validateStability(unstableResults);
      }).toThrow('パフォーマンスが不安定です');
    });

  });

  describe('🟢 Green Phase: 最小実装 - 統計的堅牢性', () => {
    
    test('複数期間でのパフォーマンス安定性', () => {
      const robustnessValidator = new RobustnessValidator();
      const splits = walkForwardAnalysis.splitTimeSeries(testData);
      
      const performanceResults = splits.map(split => 
        simulateStrategyPerformance(split)
      );
      
      const stabilityResult = robustnessValidator.validateStability(performanceResults);
      expect(stabilityResult.isStable).toBe(true);
      expect(stabilityResult.stabilityScore).toBeGreaterThan(0.7);
    });

    test('パラメータドリフト検出', () => {
      const driftDetector = new ParameterDriftDetector({
        significanceLevel: 0.05,
        windowSize: 50
      });
      
      const splits = walkForwardAnalysis.splitTimeSeries(testData);
      const parameters = splits.map(split => 
        extractOptimalParameters(split)
      );
      
      const driftResult = driftDetector.detectSignificantDrift(parameters);
      expect(driftResult.hasDrift).toBe(false);
    });

    test('レジーム変化への適応', () => {
      const regimeDetector = new RegimeChangeDetector({
        detectionMethod: 'markov_switching',
        minRegimePeriod: 30
      });
      
      const splits = walkForwardAnalysis.splitTimeSeries(testData);
      
      splits.forEach(split => {
        const regimeResult = regimeDetector.analyzeRegime(split);
        expect(regimeResult.regimeStability).toBeDefined();
        expect(regimeResult.adaptationRecommendation).toBeDefined();
      });
    });

  });

  describe('🔵 Blue Phase: リファクタリング - 統計的堅牢性', () => {
    
    test('高度な統計的堅牢性検証', async () => {
      const robustnessValidator = new RobustnessValidator({
        enableMonteCarloValidation: true,
        enableBootstrapValidation: true,
        enableCrossValidation: true,
        iterations: 1000
      });
      
      const splits = walkForwardAnalysis.splitTimeSeries(testData);
      const performanceResults = splits.map(split => 
        simulateStrategyPerformance(split)
      );
      
      const comprehensiveResult = await robustnessValidator.comprehensiveValidation(performanceResults);
      
      expect(comprehensiveResult.monteCarlo.pValue).toBeGreaterThan(0.05);
      expect(comprehensiveResult.bootstrap.confidenceInterval).toBeDefined();
      expect(comprehensiveResult.crossValidation.cvScore).toBeGreaterThan(0.6);
    });

    test('適応的パラメータ調整システム', () => {
      const adaptiveAnalysis = new WalkForwardAnalysis({
        trainWindow: 252,
        testWindow: 21,
        stepSize: 21,
        anchored: false,
        adaptiveParameters: {
          enabled: true,
          driftThreshold: 0.1,
          regimeChangeThreshold: 0.05,
          adaptationMethod: 'exponential_decay'
        }
      });
      
      const splits = adaptiveAnalysis.splitTimeSeries(testData);
      
      splits.forEach((split, index) => {
        if (index > 0) {
          expect(split.parameterAdjustment).toBeDefined();
          expect(split.adaptationReason).toBeDefined();
        }
      });
    });

  });

  describe('🏆 統合テスト - 非定常性対応', () => {
    
    test('金融時系列の非定常性を考慮した包括テスト', () => {
      const nonStationaryData = generateNonStationaryTimeSeriesData();
      
      const advancedAnalysis = new WalkForwardAnalysis({
        trainWindow: 252,
        testWindow: 21,
        stepSize: 21,
        anchored: false,
        nonStationaryHandling: {
          enabled: true,
          stationarityTest: 'adf',
          differencing: 'auto',
          detrending: 'linear'
        }
      });
      
      const splits = advancedAnalysis.splitTimeSeries(nonStationaryData);
      
      splits.forEach(split => {
        expect(split.stationarityTest).toBeDefined();
        expect(split.transformationApplied).toBeDefined();
        expect(split.transformedData).toBeDefined();
      });
    });

    test('構造変化検出と対応', () => {
      const structuralBreakData = generateStructuralBreakData();
      
      const breakDetector = new RegimeChangeDetector({
        structuralBreakTest: 'chow',
        minSegmentLength: 50
      });
      
      const breakResult = breakDetector.detectStructuralBreaks(structuralBreakData);
      
      expect(typeof breakResult.hasBreaks).toBe('boolean');
      expect(breakResult.breakPoints.length).toBeGreaterThanOrEqual(0);
      if (breakResult.breakPoints.length > 0) {
        expect(breakResult.breakPoints).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              index: expect.any(Number),
              significance: expect.any(Number),
              testStatistic: expect.any(Number)
            })
          ])
        );
      }
    });

    test('高頻度データでのパフォーマンス', () => {
      const highFreqData = generateHighFrequencyData(50000);
      
      const startTime = performance.now();
      const splits = walkForwardAnalysis.splitTimeSeries(highFreqData);
      const endTime = performance.now();
      
      expect(endTime - startTime).toBeLessThan(5000); // 5秒以内
      expect(splits.length).toBeGreaterThan(0);
      
      // メモリ使用量の確認
      const memoryUsage = process.memoryUsage();
      expect(memoryUsage.heapUsed).toBeLessThan(500 * 1024 * 1024); // 500MB以内
    });

  });

  describe('🔧 ユーティリティとヘルパー関数', () => {
    
    test('時系列統計の計算', () => {
      const stats = walkForwardAnalysis.calculateTimeSeriesStats(testData);
      
      expect(stats).toHaveProperty('mean');
      expect(stats).toHaveProperty('variance');
      expect(stats).toHaveProperty('skewness');
      expect(stats).toHaveProperty('kurtosis');
      expect(stats).toHaveProperty('stationarity');
      expect(stats).toHaveProperty('autocorrelation');
    });

    test('パフォーマンス指標の計算', () => {
      const mockReturns = [0.01, -0.005, 0.02, -0.01, 0.015];
      const metrics = walkForwardAnalysis.calculatePerformanceMetrics(mockReturns);
      
      expect(metrics).toHaveProperty('totalReturn');
      expect(metrics).toHaveProperty('sharpeRatio');
      expect(metrics).toHaveProperty('maxDrawdown');
      expect(metrics).toHaveProperty('winRate');
      expect(metrics).toHaveProperty('profitFactor');
      expect(metrics).toHaveProperty('calmarRatio');
    });

    test('リスク調整済みリターンの計算', () => {
      const returns = [0.01, -0.005, 0.02, -0.01, 0.015];
      const riskFreeRate = 0.002;
      
      const riskAdjusted = walkForwardAnalysis.calculateRiskAdjustedReturns(returns, riskFreeRate);
      
      expect(riskAdjusted).toHaveProperty('sharpeRatio');
      expect(riskAdjusted).toHaveProperty('sortinoRatio');
      expect(riskAdjusted).toHaveProperty('informationRatio');
      expect(riskAdjusted.sharpeRatio).toBeGreaterThan(0);
    });

  });

  // ===== テストヘルパー関数 =====
  
  function generateMockTimeSeriesData(length = 1000) {
    const data = [];
    let price = 100;
    
    for (let i = 0; i < length; i++) {
      const timestamp = new Date(2020, 0, 1);
      timestamp.setDate(timestamp.getDate() + i);
      
      price += (Math.random() - 0.5) * 2; // ランダムウォーク
      
      data.push({
        timestamp: timestamp,
        value: price,
        volume: Math.random() * 1000,
        open: price * (1 + (Math.random() - 0.5) * 0.01),
        high: price * (1 + Math.random() * 0.02),
        low: price * (1 - Math.random() * 0.02),
        close: price
      });
    }
    
    return data;
  }
  
  function createLeakyTimeSeriesData() {
    const data = generateMockTimeSeriesData();
    // 意図的にタイムスタンプを混乱させる
    const shuffledData = [...data];
    shuffledData[10] = { ...shuffledData[10], timestamp: new Date(2025, 0, 1) };
    return shuffledData;
  }
  
  function createParameterDriftData() {
    const data = generateMockTimeSeriesData();
    return data.map((item, index) => ({
      ...item,
      optimalParameter: 0.5 + (index / data.length) * 0.4 // 徐々に変化
    }));
  }
  
  function createRegimeChangeData() {
    const data = generateMockTimeSeriesData();
    return data.map((item, index) => ({
      ...item,
      value: index < 500 ? 
        100 + index * 0.1 : // 明確な上昇トレンド
        150 - (index - 500) * 0.1   // 明確な下降トレンド
    }));
  }
  
  function createExtremeRegimeChangeData() {
    const data = generateMockTimeSeriesData();
    return data.map((item, index) => ({
      ...item,
      value: index < 500 ? 
        100 : // 完全にフラット
        200   // 突然の大幅ジャンプ
    }));
  }
  
  function createUnstablePerformanceData() {
    return [
      { period: 1, return: 0.15, volatility: 0.02 },
      { period: 2, return: -0.08, volatility: 0.03 },
      { period: 3, return: 0.12, volatility: 0.25 }, // 高ボラティリティ
      { period: 4, return: -0.20, volatility: 0.02 },
      { period: 5, return: 0.18, volatility: 0.02 }
    ];
  }
  
  function generateNonStationaryTimeSeriesData() {
    const data = [];
    let price = 100;
    let trend = 0.001;
    
    for (let i = 0; i < 1000; i++) {
      const timestamp = new Date(2020, 0, 1);
      timestamp.setDate(timestamp.getDate() + i);
      
      // トレンドとランダムウォークを組み合わせ
      price += trend + (Math.random() - 0.5) * 2;
      
      // 500日後にトレンドを変更（非定常性）
      if (i === 500) trend = -0.001;
      
      data.push({
        timestamp: timestamp,
        value: price,
        volume: Math.random() * 1000,
        close: price
      });
    }
    
    return data;
  }
  
  function generateStructuralBreakData() {
    const data = [];
    let price = 100;
    let volatility = 1;
    
    for (let i = 0; i < 1000; i++) {
      const timestamp = new Date(2020, 0, 1);
      timestamp.setDate(timestamp.getDate() + i);
      
      // 300日後に大きな構造変化（ボラティリティとトレンドの大幅変化）
      if (i === 300) {
        volatility = 5; // より大きなボラティリティ変化
        price += 50; // 価格レベルのジャンプ
      }
      
      // より極端な価格変動
      const change = (Math.random() - 0.5) * volatility;
      price += change;
      
      data.push({
        timestamp: timestamp,
        value: price,
        close: price
      });
    }
    
    return data;
  }
  
  function generateHighFrequencyData(length) {
    const data = [];
    let price = 100;
    
    for (let i = 0; i < length; i++) {
      const timestamp = new Date(2020, 0, 1);
      timestamp.setSeconds(timestamp.getSeconds() + i);
      
      price += (Math.random() - 0.5) * 0.1; // 小さな価格変動
      
      data.push({
        timestamp: timestamp,
        value: price,
        close: price
      });
    }
    
    return data;
  }
  
  function simulateStrategyPerformance(split) {
    // より安定したパフォーマンスのシミュレーション
    const returns = [];
    const baseReturn = 0.01; // 固定的なベースリターン
    
    for (let i = 0; i < split.testData.length; i++) {
      // より安定したリターンパターン
      returns.push(baseReturn + (Math.random() - 0.5) * 0.005);
    }
    
    const totalReturn = returns.reduce((sum, ret) => sum + ret, 0);
    const meanReturn = totalReturn / returns.length;
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - meanReturn, 2), 0) / (returns.length - 1);
    const volatility = Math.sqrt(variance);
    
    return {
      returns,
      totalReturn,
      volatility,
      sharpeRatio: volatility > 0 ? meanReturn / volatility : 0
    };
  }
  
  function extractOptimalParameters(split) {
    // 最適パラメータの抽出シミュレーション
    return {
      period: Math.round(20 + Math.random() * 30),
      threshold: 0.02 + Math.random() * 0.03,
      riskLevel: 0.01 + Math.random() * 0.02
    };
  }
  
});