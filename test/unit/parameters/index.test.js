/**
 * インテリジェントパラメータ管理システム統合インターフェースのユニットテスト
 */

const { 
  IntelligentParameterManager, 
  createIntelligentParameterManager 
} = require('../../../src/parameters/index');

describe('IntelligentParameterManager', () => {
  let parameterManager;

  beforeEach(() => {
    parameterManager = new IntelligentParameterManager('MA_CROSS');
  });

  describe('初期化', () => {
    test('デフォルトオプションで初期化される', () => {
      expect(parameterManager.strategyType).toBe('MA_CROSS');
      expect(parameterManager.constraintEngine).toBeDefined();
      expect(parameterManager.samplingEngine).toBeDefined();
      expect(parameterManager.adaptiveManager).toBeNull();
    });

    test('履歴データありで初期化される', () => {
      const historicalResults = [
        { parameters: { shortPeriod: 5, longPeriod: 20 }, performance: 1.15 }
      ];
      
      const manager = new IntelligentParameterManager('MA_CROSS', { historicalResults });
      
      expect(manager.adaptiveManager).toBeDefined();
      expect(manager.adaptiveManager.history).toEqual(historicalResults);
    });

    test('カスタムオプションで初期化される', () => {
      const options = {
        count: 30,
        method: 'latin_hypercube'
      };
      
      const manager = new IntelligentParameterManager('RSI', options);
      
      expect(manager.strategyType).toBe('RSI');
      expect(manager.options).toEqual(options);
    });
  });

  describe('インテリジェントパラメータ組み合わせ生成', () => {
    test('制約認識手法でパラメータが生成される', () => {
      const combinations = parameterManager.generateIntelligentParameterCombinations({
        count: 10,
        method: 'constraint_aware'
      });
      
      expect(Array.isArray(combinations)).toBe(true);
      expect(combinations.length).toBeLessThanOrEqual(10);
      
      combinations.forEach(combo => {
        expect(parameterManager.constraintEngine.validateCombination(combo, 'MA_CROSS')).toBe(true);
      });
    });

    test('ラテン超方体手法でパラメータが生成される', () => {
      const combinations = parameterManager.generateIntelligentParameterCombinations({
        count: 8,
        method: 'latin_hypercube'
      });
      
      expect(Array.isArray(combinations)).toBe(true);
      expect(combinations.length).toBeLessThanOrEqual(8);
    });

    test('適応的手法でパラメータが生成される（履歴あり）', () => {
      const historicalResults = [
        { parameters: { shortPeriod: 5, longPeriod: 20 }, performance: 1.15 },
        { parameters: { shortPeriod: 10, longPeriod: 30 }, performance: 1.25 }
      ];
      
      const manager = new IntelligentParameterManager('MA_CROSS', { historicalResults });
      
      const combinations = manager.generateIntelligentParameterCombinations({
        count: 5,
        method: 'adaptive'
      });
      
      expect(Array.isArray(combinations)).toBe(true);
      expect(combinations.length).toBeLessThanOrEqual(5);
    });

    test('適応的手法でパラメータが生成される（履歴なし）', () => {
      const combinations = parameterManager.generateIntelligentParameterCombinations({
        count: 5,
        method: 'adaptive'
      });
      
      expect(Array.isArray(combinations)).toBe(true);
      expect(combinations.length).toBeLessThanOrEqual(5);
    });

    test('多様性手法でパラメータが生成される', () => {
      const combinations = parameterManager.generateIntelligentParameterCombinations({
        count: 6,
        method: 'diversity',
        minDistance: 0.15
      });
      
      expect(Array.isArray(combinations)).toBe(true);
      expect(combinations.length).toBeLessThanOrEqual(6);
    });

    test('ハイブリッド手法でパラメータが生成される', () => {
      const combinations = parameterManager.generateIntelligentParameterCombinations({
        count: 12,
        method: 'hybrid'
      });
      
      expect(Array.isArray(combinations)).toBe(true);
      expect(combinations.length).toBeLessThanOrEqual(12);
    });

    test('デフォルト設定でパラメータが生成される', () => {
      const combinations = parameterManager.generateIntelligentParameterCombinations();
      
      expect(Array.isArray(combinations)).toBe(true);
      expect(combinations.length).toBeLessThanOrEqual(50); // デフォルトのcount
    });
  });

  describe('レガシーインターフェース - グリッドサーチ', () => {
    test('generateParameterCombinationsが動作する', () => {
      const defaultConfig = { shortPeriod: 10, longPeriod: 25, otherParam: 'test' };
      const numericKeys = ['shortPeriod', 'longPeriod'];
      
      const combinations = parameterManager.generateParameterCombinations(
        defaultConfig, 
        numericKeys, 
        0.2, 
        5
      );
      
      expect(Array.isArray(combinations)).toBe(true);
      combinations.forEach(combo => {
        expect(combo.shortPeriod).toBeDefined();
        expect(combo.longPeriod).toBeDefined();
        expect(combo.otherParam).toBe('test'); // 非数値パラメータが保持される
        expect(typeof combo.shortPeriod).toBe('number');
        expect(typeof combo.longPeriod).toBe('number');
      });
    });

    test('空のnumericKeysで動作する', () => {
      const defaultConfig = { nonNumeric: 'test' };
      const numericKeys = [];
      
      const combinations = parameterManager.generateParameterCombinations(
        defaultConfig, 
        numericKeys
      );
      
      expect(Array.isArray(combinations)).toBe(true);
    });
  });

  describe('レガシーインターフェース - ランダムサーチ', () => {
    test('generateRandomParameterCombinationsが動作する', () => {
      const defaultConfig = { shortPeriod: 10, longPeriod: 25, strategy: 'MA' };
      const numericKeys = ['shortPeriod', 'longPeriod'];
      
      const combinations = parameterManager.generateRandomParameterCombinations(
        defaultConfig, 
        numericKeys, 
        8, 
        0.15
      );
      
      expect(Array.isArray(combinations)).toBe(true);
      expect(combinations.length).toBeLessThanOrEqual(8);
      
      // 最初の要素がデフォルト設定であることを確認
      if (combinations.length > 0) {
        expect(combinations[0]).toEqual(defaultConfig);
      }
      
      combinations.forEach(combo => {
        expect(combo.shortPeriod).toBeDefined();
        expect(combo.longPeriod).toBeDefined();
        expect(combo.strategy).toBe('MA'); // 非数値パラメータが保持される
      });
    });

    test('生成失敗時にデフォルト設定のみ返される', () => {
      const defaultConfig = { shortPeriod: 10, longPeriod: 25 };
      const numericKeys = ['shortPeriod', 'longPeriod'];
      
      // constraintEngineを一時的に破壊してエラーを発生させる
      const originalMethod = parameterManager.generateIntelligentParameterCombinations;
      parameterManager.generateIntelligentParameterCombinations = () => [];
      
      const combinations = parameterManager.generateRandomParameterCombinations(
        defaultConfig, 
        numericKeys, 
        5
      );
      
      expect(combinations).toHaveLength(1);
      expect(combinations[0]).toEqual(defaultConfig);
      
      // 元に戻す
      parameterManager.generateIntelligentParameterCombinations = originalMethod;
    });
  });

  describe('品質フィルタリング', () => {
    test('高品質なパラメータがそのまま返される', () => {
      const combinations = [
        { shortPeriod: 5, longPeriod: 20 },
        { shortPeriod: 10, longPeriod: 30 }
      ];
      
      const filtered = parameterManager.filterByQuality(combinations, 0.8);
      
      expect(filtered.length).toBeGreaterThan(0);
      filtered.forEach(combo => {
        expect(parameterManager.constraintEngine.validateCombination(combo, 'MA_CROSS')).toBe(true);
      });
    });

    test('低品質なパラメータで有効なもののみ返される', () => {
      const combinations = [
        { shortPeriod: 5, longPeriod: 20 },    // 有効
        { shortPeriod: 25, longPeriod: 15 },   // 無効（shortPeriod > longPeriod）
        { shortPeriod: 10, longPeriod: 30 }    // 有効
      ];
      
      // 低い閾値を設定して品質フィルタリングを強制的に動作させる
      const filtered = parameterManager.filterByQuality(combinations, 1.0);
      
      expect(filtered.length).toBeLessThanOrEqual(combinations.length);
      filtered.forEach(combo => {
        expect(parameterManager.constraintEngine.validateCombination(combo, 'MA_CROSS')).toBe(true);
      });
    });
  });

  describe('分析レポート生成', () => {
    test('包括的な分析レポートが生成される', () => {
      const combinations = [
        { shortPeriod: 5, longPeriod: 20 },
        { shortPeriod: 10, longPeriod: 30 },
        { shortPeriod: 15, longPeriod: 40 }
      ];
      
      const report = parameterManager.generateAnalysisReport(combinations);
      
      expect(report.parameterCount).toBe(3);
      expect(report.quality).toBeDefined();
      expect(report.quality.validity).toBeDefined();
      expect(report.quality.diversity).toBeDefined();
      expect(report.quality.coverage).toBeDefined();
      expect(report.quality.uniformity).toBeDefined();
      
      expect(report.parameterImportance).toBeDefined();
      expect(report.promisingRegions).toBeDefined();
      expect(report.constraints).toBeDefined();
      expect(report.recommendations).toBeDefined();
      
      expect(Array.isArray(report.recommendations)).toBe(true);
    });

    test('履歴ありで詳細な分析レポートが生成される', () => {
      const historicalResults = [
        { parameters: { shortPeriod: 5, longPeriod: 20 }, performance: 1.15 },
        { parameters: { shortPeriod: 10, longPeriod: 30 }, performance: 1.25 },
        { parameters: { shortPeriod: 8, longPeriod: 25 }, performance: 1.18 },
        { parameters: { shortPeriod: 12, longPeriod: 35 }, performance: 1.30 },
        { parameters: { shortPeriod: 15, longPeriod: 40 }, performance: 1.22 }
      ];
      
      const manager = new IntelligentParameterManager('MA_CROSS', { historicalResults });
      
      const combinations = [
        { shortPeriod: 8, longPeriod: 25 }
      ];
      
      const report = manager.generateAnalysisReport(combinations);
      
      expect(Object.keys(report.parameterImportance).length).toBeGreaterThan(0);
      expect(report.promisingRegions.length).toBeGreaterThanOrEqual(0);
    });

    test('空の組み合わせで基本レポートが生成される', () => {
      const report = parameterManager.generateAnalysisReport([]);
      
      expect(report.parameterCount).toBe(0);
      expect(report.quality.validity).toBe(0);
    });
  });

  describe('推奨事項生成', () => {
    test('低品質で警告推奨が生成される', () => {
      const lowQuality = {
        validity: 0.5,  // 低い妥当性
        diversity: 0.8,
        coverage: 0.7
      };
      
      const recommendations = parameterManager.generateRecommendations(lowQuality, {});
      
      expect(Array.isArray(recommendations)).toBe(true);
      const warningRec = recommendations.find(rec => rec.type === 'warning');
      expect(warningRec).toBeDefined();
      expect(warningRec.action).toBe('constraint_review');
    });

    test('低多様性で改善推奨が生成される', () => {
      const quality = {
        validity: 0.9,
        diversity: 0.3,  // 低い多様性
        coverage: 0.8
      };
      
      const recommendations = parameterManager.generateRecommendations(quality, {});
      
      const improvementRec = recommendations.find(rec => rec.action === 'increase_diversity');
      expect(improvementRec).toBeDefined();
      expect(improvementRec.type).toBe('improvement');
    });

    test('低カバー率で改善推奨が生成される', () => {
      const quality = {
        validity: 0.9,
        diversity: 0.8,
        coverage: 0.4   // 低いカバー率
      };
      
      const recommendations = parameterManager.generateRecommendations(quality, {});
      
      const improvementRec = recommendations.find(rec => rec.action === 'increase_samples');
      expect(improvementRec).toBeDefined();
    });

    test('高重要度パラメータで重点推奨が生成される', () => {
      const quality = {
        validity: 0.9,
        diversity: 0.8,
        coverage: 0.8
      };
      
      const importance = {
        shortPeriod: { overallImportance: 0.9 },  // 高重要度
        longPeriod: { overallImportance: 0.6 }
      };
      
      const recommendations = parameterManager.generateRecommendations(quality, importance);
      
      const focusRec = recommendations.find(rec => rec.action === 'focus_parameter');
      expect(focusRec).toBeDefined();
      expect(focusRec.parameter).toBe('shortPeriod');
    });

    test('高品質で推奨事項なし', () => {
      const highQuality = {
        validity: 0.95,
        diversity: 0.85,
        coverage: 0.9
      };
      
      const importance = {
        shortPeriod: { overallImportance: 0.6 },
        longPeriod: { overallImportance: 0.5 }
      };
      
      const recommendations = parameterManager.generateRecommendations(highQuality, importance);
      
      expect(recommendations.length).toBe(0);
    });
  });

  describe('戦略タイプ自動検出', () => {
    test('MA_CROSS戦略が検出される', () => {
      const config = { shortPeriod: 10, longPeriod: 25 };
      const numericKeys = ['shortPeriod', 'longPeriod'];
      
      const strategyType = IntelligentParameterManager.detectStrategyType(config, numericKeys);
      expect(strategyType).toBe('MA_CROSS');
    });

    test('MACD戦略が検出される', () => {
      const config = { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 };
      const numericKeys = ['fastPeriod', 'slowPeriod', 'signalPeriod'];
      
      const strategyType = IntelligentParameterManager.detectStrategyType(config, numericKeys);
      expect(strategyType).toBe('MACD');
    });

    test('RSI戦略が検出される', () => {
      const config = { period: 14, oversoldThreshold: 30, overboughtThreshold: 70 };
      const numericKeys = ['period', 'oversoldThreshold', 'overboughtThreshold'];
      
      const strategyType = IntelligentParameterManager.detectStrategyType(config, numericKeys);
      expect(strategyType).toBe('RSI');
    });

    test('BOLLINGER_BANDS戦略が検出される', () => {
      const config = { period: 20, stdDev: 2.0 };
      const numericKeys = ['period', 'stdDev'];
      
      const strategyType = IntelligentParameterManager.detectStrategyType(config, numericKeys);
      expect(strategyType).toBe('BOLLINGER_BANDS');
    });

    test('MEAN_REVERSION戦略が検出される', () => {
      const config = { period: 20, deviationThreshold: 3.0 };
      const numericKeys = ['period', 'deviationThreshold'];
      
      const strategyType = IntelligentParameterManager.detectStrategyType(config, numericKeys);
      expect(strategyType).toBe('MEAN_REVERSION');
    });

    test('MUTUAL_INFORMATION戦略が検出される', () => {
      const config = { threshold: 0.5, correlationWindow: 30, zScoreThreshold: 2.0 };
      const numericKeys = ['threshold', 'correlationWindow', 'zScoreThreshold'];
      
      const strategyType = IntelligentParameterManager.detectStrategyType(config, numericKeys);
      expect(strategyType).toBe('MUTUAL_INFORMATION');
    });

    test('MULTI_INDICATOR戦略が検出される', () => {
      const config = { macdFastPeriod: 12, emaShortPeriod: 5, rsiPeriod: 14 };
      const numericKeys = ['macdFastPeriod', 'emaShortPeriod', 'rsiPeriod'];
      
      const strategyType = IntelligentParameterManager.detectStrategyType(config, numericKeys);
      expect(strategyType).toBe('MULTI_INDICATOR');
    });

    test('未知の戦略でGENERICが返される', () => {
      const config = { unknownParam: 10 };
      const numericKeys = ['unknownParam'];
      
      const strategyType = IntelligentParameterManager.detectStrategyType(config, numericKeys);
      expect(strategyType).toBe('GENERIC');
    });
  });

  describe('汎用制約の自動生成', () => {
    test('GENERIC戦略で自動的に制約が生成される', () => {
      const sampleConfig = { customPeriod: 20, customThreshold: 2.5 };
      const numericKeys = ['customPeriod', 'customThreshold'];
      const manager = new IntelligentParameterManager('GENERIC');
      
      const combinations = manager.generateIntelligentParameterCombinations({
        count: 10,
        method: 'constraint_aware',
        sampleConfig
      });
      
      expect(Array.isArray(combinations)).toBe(true);
      expect(combinations.length).toBeGreaterThan(0);
      
      // 生成されたパラメータが期待する範囲内にあることを確認
      combinations.forEach(combo => {
        expect(combo.customPeriod).toBeDefined();
        expect(combo.customThreshold).toBeDefined();
        expect(typeof combo.customPeriod).toBe('number');
        expect(typeof combo.customThreshold).toBe('number');
      });
    });

    test('品質メトリクスが0.0%以上になる', () => {
      const sampleConfig = { testParam: 15 };
      const numericKeys = ['testParam'];
      const manager = new IntelligentParameterManager('GENERIC');
      
      const combinations = manager.generateIntelligentParameterCombinations({
        count: 5,
        method: 'constraint_aware',
        sampleConfig
      });
      
      const report = manager.generateAnalysisReport(combinations);
      
      // 品質メトリクスが0.0%以上であることを確認
      expect(report.quality.validity).toBeGreaterThan(0);
      expect(report.quality.diversity).toBeGreaterThanOrEqual(0);
      expect(report.quality.coverage).toBeGreaterThanOrEqual(0);
    });

    test('レガシーインターフェースでGENERIC戦略が動作する', () => {
      const defaultConfig = { customParam1: 10, customParam2: 0.5 };
      const numericKeys = ['customParam1', 'customParam2'];
      const manager = new IntelligentParameterManager('GENERIC');
      
      const combinations = manager.generateParameterCombinations(
        defaultConfig, 
        numericKeys, 
        0.2, 
        3
      );
      
      expect(Array.isArray(combinations)).toBe(true);
      expect(combinations.length).toBeGreaterThan(0);
      
      combinations.forEach(combo => {
        expect(combo.customParam1).toBeDefined();
        expect(combo.customParam2).toBeDefined();
        expect(typeof combo.customParam1).toBe('number');
        expect(typeof combo.customParam2).toBe('number');
      });
    });
  });
});

describe('createIntelligentParameterManager', () => {
  test('ファクトリー関数が動作する', () => {
    const defaultConfig = { shortPeriod: 10, longPeriod: 25 };
    const numericKeys = ['shortPeriod', 'longPeriod'];
    
    const manager = createIntelligentParameterManager(defaultConfig, numericKeys);
    
    expect(manager).toBeInstanceOf(IntelligentParameterManager);
    expect(manager.strategyType).toBe('MA_CROSS');
  });

  test('明示的な戦略タイプで動作する', () => {
    const defaultConfig = { period: 14 };
    const numericKeys = ['period'];
    const options = { strategyType: 'RSI' };
    
    const manager = createIntelligentParameterManager(defaultConfig, numericKeys, options);
    
    expect(manager.strategyType).toBe('RSI');
  });

  test('検出失敗時にGENERICが設定される', () => {
    const defaultConfig = { unknownParam: 10 };
    const numericKeys = ['unknownParam'];
    
    const manager = createIntelligentParameterManager(defaultConfig, numericKeys);
    
    expect(manager.strategyType).toBe('GENERIC');
  });

  test('追加オプションが正しく渡される', () => {
    const defaultConfig = { shortPeriod: 10, longPeriod: 25 };
    const numericKeys = ['shortPeriod', 'longPeriod'];
    const options = { 
      count: 30,
      method: 'latin_hypercube',
      historicalResults: []
    };
    
    const manager = createIntelligentParameterManager(defaultConfig, numericKeys, options);
    
    expect(manager.options).toEqual(options);
  });
});