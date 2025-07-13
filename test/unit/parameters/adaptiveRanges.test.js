/**
 * 適応的パラメータ範囲調整システムのユニットテスト
 */

const { AdaptiveParameterManager } = require('../../../src/parameters/adaptiveRanges');

describe('AdaptiveParameterManager', () => {
  let adaptiveManager;
  let sampleHistoricalResults;

  beforeEach(() => {
    sampleHistoricalResults = [
      { parameters: { shortPeriod: 5, longPeriod: 20 }, performance: 1.15 },
      { parameters: { shortPeriod: 10, longPeriod: 30 }, performance: 1.25 },
      { parameters: { shortPeriod: 15, longPeriod: 40 }, performance: 1.10 },
      { parameters: { shortPeriod: 8, longPeriod: 25 }, performance: 1.35 },
      { parameters: { shortPeriod: 12, longPeriod: 35 }, performance: 1.20 }
    ];

    adaptiveManager = new AdaptiveParameterManager('MA_CROSS', sampleHistoricalResults);
  });

  describe('初期化', () => {
    test('履歴データありで正しく初期化される', () => {
      expect(adaptiveManager.strategy).toBe('MA_CROSS');
      expect(adaptiveManager.history).toEqual(sampleHistoricalResults);
      expect(adaptiveManager.constraintEngine).toBeDefined();
      expect(adaptiveManager.sensitivity).toBeDefined();
    });

    test('履歴データなしで初期化される', () => {
      const manager = new AdaptiveParameterManager('RSI', []);
      expect(manager.strategy).toBe('RSI');
      expect(manager.history).toEqual([]);
      expect(manager.sensitivity).toEqual({});
    });
  });

  describe('パラメータ感度計算', () => {
    test('十分な履歴がある場合に感度が計算される', () => {
      const sensitivity = adaptiveManager.calculateParameterSensitivity();
      
      expect(typeof sensitivity).toBe('object');
      expect(sensitivity.shortPeriod).toBeDefined();
      expect(sensitivity.longPeriod).toBeDefined();
      
      expect(sensitivity.shortPeriod).toBeGreaterThanOrEqual(0);
      expect(sensitivity.shortPeriod).toBeLessThanOrEqual(1);
      expect(sensitivity.longPeriod).toBeGreaterThanOrEqual(0);
      expect(sensitivity.longPeriod).toBeLessThanOrEqual(1);
    });

    test('履歴が少ない場合に空オブジェクトが返される', () => {
      const manager = new AdaptiveParameterManager('MA_CROSS', [
        { parameters: { shortPeriod: 5, longPeriod: 20 }, performance: 1.15 }
      ]);
      
      const sensitivity = manager.calculateParameterSensitivity();
      expect(sensitivity).toEqual({});
    });
  });

  describe('単一パラメータ感度計算', () => {
    test('有効な履歴データで感度が計算される', () => {
      const sensitivity = adaptiveManager.calculateSingleParameterSensitivity('shortPeriod');
      
      expect(typeof sensitivity).toBe('number');
      expect(sensitivity).toBeGreaterThanOrEqual(0);
      expect(sensitivity).toBeLessThanOrEqual(1);
    });

    test('不十分な履歴でデフォルト感度が返される', () => {
      const manager = new AdaptiveParameterManager('MA_CROSS', [
        { parameters: { shortPeriod: 5, longPeriod: 20 }, performance: 1.15 }
      ]);
      
      const sensitivity = manager.calculateSingleParameterSensitivity('shortPeriod');
      expect(sensitivity).toBe(0.5);
    });
  });

  describe('相関係数計算', () => {
    test('正の相関が正しく計算される', () => {
      const x = [1, 2, 3, 4, 5];
      const y = [2, 4, 6, 8, 10];
      
      const correlation = adaptiveManager.calculateCorrelation(x, y);
      expect(correlation).toBeCloseTo(1, 2);
    });

    test('負の相関が正しく計算される', () => {
      const x = [1, 2, 3, 4, 5];
      const y = [10, 8, 6, 4, 2];
      
      const correlation = adaptiveManager.calculateCorrelation(x, y);
      expect(correlation).toBeCloseTo(-1, 2);
    });

    test('無相関が正しく計算される', () => {
      const x = [1, 2, 3, 4, 5];
      const y = [3, 1, 4, 1, 5];
      
      const correlation = adaptiveManager.calculateCorrelation(x, y);
      expect(Math.abs(correlation)).toBeLessThan(0.8);
    });

    test('異なる長さの配列で0が返される', () => {
      const x = [1, 2, 3];
      const y = [1, 2];
      
      const correlation = adaptiveManager.calculateCorrelation(x, y);
      expect(correlation).toBe(0);
    });

    test('空配列で0が返される', () => {
      const x = [];
      const y = [];
      
      const correlation = adaptiveManager.calculateCorrelation(x, y);
      expect(correlation).toBe(0);
    });
  });

  describe('感度に基づく範囲調整', () => {
    test('調整された範囲が返される', () => {
      const adjustedRanges = adaptiveManager.adjustRangesBasedOnSensitivity();
      
      expect(typeof adjustedRanges).toBe('object');
      
      if (Object.keys(adjustedRanges).length > 0) {
        Object.values(adjustedRanges).forEach(range => {
          expect(range.adjustedMin).toBeDefined();
          expect(range.adjustedMax).toBeDefined();
          expect(range.rangeFactor).toBeDefined();
          expect(range.sensitivity).toBeDefined();
          
          expect(range.rangeFactor).toBeGreaterThan(0);
          expect(range.sensitivity).toBeGreaterThanOrEqual(0);
          expect(range.sensitivity).toBeLessThanOrEqual(1);
        });
      }
    });

    test('存在しない戦略で空オブジェクトが返される', () => {
      const manager = new AdaptiveParameterManager('UNKNOWN_STRATEGY', sampleHistoricalResults);
      const adjustedRanges = manager.adjustRangesBasedOnSensitivity();
      
      expect(adjustedRanges).toEqual({});
    });
  });

  describe('範囲調整係数計算', () => {
    test('高感度で大きな係数が返される', () => {
      const factor = adaptiveManager.calculateRangeFactor(0.8);
      expect(factor).toBeGreaterThan(1);
      expect(factor).toBeLessThanOrEqual(2);
    });

    test('低感度で小さな係数が返される', () => {
      const factor = adaptiveManager.calculateRangeFactor(0.2);
      expect(factor).toBeLessThan(1);
      expect(factor).toBeGreaterThanOrEqual(0.1);
    });

    test('中程度の感度で1に近い係数が返される', () => {
      const factor = adaptiveManager.calculateRangeFactor(0.5);
      expect(factor).toBeCloseTo(1, 1);
    });
  });

  describe('有望な領域特定', () => {
    test('十分な履歴がある場合に有望な領域が特定される', () => {
      const promisingRegions = adaptiveManager.identifyPromisingRegions();
      
      expect(Array.isArray(promisingRegions)).toBe(true);
      
      promisingRegions.forEach(region => {
        expect(region.parameter).toBeDefined();
        expect(region.center).toBeDefined();
        expect(region.radius).toBeDefined();
        expect(region.confidence).toBeDefined();
        
        expect(typeof region.center).toBe('number');
        expect(typeof region.radius).toBe('number');
        expect(region.confidence).toBeGreaterThanOrEqual(0);
        expect(region.confidence).toBeLessThanOrEqual(1);
      });
    });

    test('履歴が少ない場合に空配列が返される', () => {
      const manager = new AdaptiveParameterManager('MA_CROSS', [
        { parameters: { shortPeriod: 5, longPeriod: 20 }, performance: 1.15 }
      ]);
      
      const promisingRegions = manager.identifyPromisingRegions();
      expect(promisingRegions).toEqual([]);
    });
  });

  describe('スマートサンプリング', () => {
    test('指定された数のサンプルが生成される', () => {
      const samples = adaptiveManager.generateSmartSamples(10);
      
      expect(Array.isArray(samples)).toBe(true);
      expect(samples.length).toBeLessThanOrEqual(10);
      
      samples.forEach(sample => {
        expect(typeof sample).toBe('object');
        // 制約チェック
        expect(adaptiveManager.constraintEngine.validateCombination(sample, 'MA_CROSS')).toBe(true);
      });
    });

    test('カスタムオプションでサンプリングが実行される', () => {
      const options = {
        method: 'adaptive_random',
        explorationRatio: 0.5
      };
      
      const samples = adaptiveManager.generateSmartSamples(5, options);
      
      expect(Array.isArray(samples)).toBe(true);
      expect(samples.length).toBeLessThanOrEqual(5);
    });
  });

  describe('正規分布乱数生成', () => {
    test('指定された平均と標準偏差で乱数が生成される', () => {
      const mean = 10;
      const stdDev = 2;
      
      // 生成された値が数値であることを確認
      const randomValue = adaptiveManager.generateNormalRandom(mean, stdDev);
      expect(typeof randomValue).toBe('number');
      expect(Number.isFinite(randomValue)).toBe(true);
      
      // 複数回呼び出して異なる値が生成されることを確認
      const samples = [];
      for (let i = 0; i < 10; i++) {
        samples.push(adaptiveManager.generateNormalRandom(mean, stdDev));
      }
      
      // 少なくとも一つは異なる値が生成されることを確認
      const uniqueValues = new Set(samples);
      expect(uniqueValues.size).toBeGreaterThan(1);
    });
  });

  describe('パラメータ重要度分析', () => {
    test('重要度が正しく計算される', () => {
      const importance = adaptiveManager.analyzeParameterImportance();
      
      expect(typeof importance).toBe('object');
      
      Object.values(importance).forEach(info => {
        expect(info.sensitivity).toBeDefined();
        expect(info.variabilityImpact).toBeDefined();
        expect(info.overallImportance).toBeDefined();
        
        expect(info.sensitivity).toBeGreaterThanOrEqual(0);
        expect(info.sensitivity).toBeLessThanOrEqual(1);
        expect(info.variabilityImpact).toBeGreaterThanOrEqual(0);
        expect(info.overallImportance).toBeGreaterThanOrEqual(0);
        expect(info.overallImportance).toBeLessThanOrEqual(1);
      });
    });

    test('履歴が少ない場合に空オブジェクトが返される', () => {
      const manager = new AdaptiveParameterManager('MA_CROSS', []);
      const importance = manager.analyzeParameterImportance();
      
      expect(importance).toEqual({});
    });
  });

  describe('変動影響計算', () => {
    test('変動影響が正しく計算される', () => {
      const impact = adaptiveManager.calculateVariabilityImpact('shortPeriod');
      
      expect(typeof impact).toBe('number');
      expect(impact).toBeGreaterThanOrEqual(0);
    });

    test('不十分な履歴でデフォルト値が返される', () => {
      const manager = new AdaptiveParameterManager('MA_CROSS', [
        { parameters: { shortPeriod: 5, longPeriod: 20 }, performance: 1.15 }
      ]);
      
      const impact = manager.calculateVariabilityImpact('shortPeriod');
      expect(impact).toBe(0.5);
    });
  });

  describe('分散計算', () => {
    test('分散が正しく計算される', () => {
      const values = [1, 2, 3, 4, 5];
      const variance = adaptiveManager.calculateVariance(values);
      
      expect(variance).toBe(2); // 分散の期待値
    });

    test('空配列で0が返される', () => {
      const variance = adaptiveManager.calculateVariance([]);
      expect(variance).toBe(0);
    });

    test('単一要素で0が返される', () => {
      const variance = adaptiveManager.calculateVariance([5]);
      expect(variance).toBe(0);
    });
  });
});