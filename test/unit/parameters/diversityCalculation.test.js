/**
 * パラメータ多様性計算の改善版ユニットテスト
 */

const { ParameterConstraintEngine } = require('../../../src/parameters/constraintManager');
const { SmartSamplingEngine } = require('../../../src/parameters/smartSampling');

describe('改善されたパラメータ多様性計算', () => {
  let constraintEngine;
  let samplingEngine;

  beforeEach(() => {
    constraintEngine = new ParameterConstraintEngine();
    samplingEngine = new SmartSamplingEngine();
  });

  describe('calculateParameterDiversity', () => {
    test('空のパラメータセットで0が返される', () => {
      const diversity = constraintEngine.calculateParameterDiversity([], {});
      expect(diversity).toBe(0);
    });

    test('単一パラメータセットで最小値0.1が返される', () => {
      const parameterSet = [{ period: 10 }];
      const parameterDefs = { period: { min: 5, max: 50, type: 'integer' } };
      const diversity = constraintEngine.calculateParameterDiversity(parameterSet, parameterDefs);
      expect(diversity).toBe(0.1);
    });

    test('完全に多様なパラメータセットで高い多様性スコアが返される', () => {
      const parameterSet = [
        { period: 5, threshold: 1.0 },
        { period: 25, threshold: 3.0 },
        { period: 45, threshold: 5.0 }
      ];
      const parameterDefs = {
        period: { min: 5, max: 50, type: 'integer' },
        threshold: { min: 1.0, max: 5.0, type: 'float' }
      };
      const diversity = constraintEngine.calculateParameterDiversity(parameterSet, parameterDefs);
      expect(diversity).toBeGreaterThan(0.5); // 良好な多様性
    });

    test('類似したパラメータセットで低い多様性スコアが返される', () => {
      const parameterSet = [
        { period: 10, threshold: 2.0 },
        { period: 11, threshold: 2.1 },
        { period: 12, threshold: 2.2 }
      ];
      const parameterDefs = {
        period: { min: 5, max: 50, type: 'integer' },
        threshold: { min: 1.0, max: 5.0, type: 'float' }
      };
      const diversity = constraintEngine.calculateParameterDiversity(parameterSet, parameterDefs);
      expect(diversity).toBeLessThan(0.5); // 改善されたアルゴリズムでも相対的に低い多様性
    });

    test('部分的に多様なパラメータセットで中程度の多様性スコアが返される', () => {
      const parameterSet = [
        { period: 5, threshold: 1.0 },
        { period: 10, threshold: 1.1 },
        { period: 50, threshold: 1.2 }
      ];
      const parameterDefs = {
        period: { min: 5, max: 50, type: 'integer' },
        threshold: { min: 1.0, max: 5.0, type: 'float' }
      };
      const diversity = constraintEngine.calculateParameterDiversity(parameterSet, parameterDefs);
      expect(diversity).toBeGreaterThan(0.3);
      expect(diversity).toBeLessThan(0.7);
    });
  });

  describe('calculateSingleParameterDiversity', () => {
    test('単一値配列で0が返される', () => {
      const values = [10];
      const paramDef = { min: 5, max: 50, type: 'integer' };
      const diversity = constraintEngine.calculateSingleParameterDiversity(values, paramDef);
      expect(diversity).toBe(0);
    });

    test('均等分布値で高い多様性スコアが返される', () => {
      const values = [5, 15, 25, 35, 45];
      const paramDef = { min: 5, max: 50, type: 'integer' };
      const diversity = constraintEngine.calculateSingleParameterDiversity(values, paramDef);
      expect(diversity).toBeGreaterThan(0.7);
    });

    test('クラスター化された値で低い多様性スコアが返される', () => {
      const values = [10, 11, 12, 13, 14];
      const paramDef = { min: 5, max: 50, type: 'integer' };
      const diversity = constraintEngine.calculateSingleParameterDiversity(values, paramDef);
      expect(diversity).toBeLessThan(0.6); // 改善されたアルゴリズムに合わせて調整
    });

    test('重複値がある場合に一意性が考慮される', () => {
      const values = [10, 10, 20, 20, 30, 30];
      const paramDef = { min: 5, max: 50, type: 'integer' };
      const diversity = constraintEngine.calculateSingleParameterDiversity(values, paramDef);
      
      const uniqueValues = [10, 20, 30, 40, 50];
      const diversityUnique = constraintEngine.calculateSingleParameterDiversity(uniqueValues, paramDef);
      
      expect(diversity).toBeLessThan(diversityUnique);
    });
  });

  describe('calculateDistributionUniformity', () => {
    test('2点以下で適切な値が返される', () => {
      const uniformity1 = constraintEngine.calculateDistributionUniformity([10], { min: 5, max: 50 });
      const uniformity2 = constraintEngine.calculateDistributionUniformity([10, 30], { min: 5, max: 50 });
      
      expect(uniformity1).toBe(0);
      expect(uniformity2).toBe(0.5);
    });

    test('均等分布で高い均一性スコアが返される', () => {
      const uniformity = constraintEngine.calculateDistributionUniformity(
        [5, 17.5, 30, 42.5, 55], 
        { min: 5, max: 55 }
      );
      expect(uniformity).toBeGreaterThan(0.8);
    });

    test('不均等分布で低い均一性スコアが返される', () => {
      const uniformity = constraintEngine.calculateDistributionUniformity(
        [5, 7, 9, 45, 50], 
        { min: 5, max: 50 }
      );
      expect(uniformity).toBeLessThan(0.8); // より不均等な分布で検証
    });
  });

  describe('改善されたハイブリッドサンプリング', () => {
    test('MA_CROSS戦略で多様性の高いサンプルが生成される', () => {
      const samples = samplingEngine.hybridSampling('MA_CROSS', 20);
      
      expect(samples.length).toBeGreaterThan(0);
      expect(samples.length).toBeLessThanOrEqual(20);
      
      // 生成されたサンプルの多様性を検証
      const constraint = constraintEngine.getStrategyConstraints('MA_CROSS');
      const diversity = constraintEngine.calculateParameterDiversity(samples, constraint.parameters);
      
      expect(diversity).toBeGreaterThan(0.3); // 改善された多様性
    });

    test('BOLLINGER_BANDS戦略で制約を満たすサンプルが生成される', () => {
      const samples = samplingEngine.hybridSampling('BOLLINGER_BANDS', 15);
      
      expect(samples.length).toBeGreaterThan(0);
      
      // 全てのサンプルが制約を満たすことを確認
      samples.forEach(sample => {
        expect(constraintEngine.validateCombination(sample, 'BOLLINGER_BANDS')).toBe(true);
      });
    });

    test('有望な領域を考慮したサンプリングが機能する', () => {
      const promisingRegions = [
        { parameter: 'period', center: 20, radius: 5 }
      ];
      
      const samples = samplingEngine.hybridSampling('BOLLINGER_BANDS', 10, {
        promisingRegions
      });
      
      expect(samples.length).toBeGreaterThan(0);
      
      // 有望な領域周辺にサンプルが配置されていることを確認
      const periodsAroundRegion = samples.filter(sample => 
        Math.abs(sample.period - 20) <= 10
      );
      expect(periodsAroundRegion.length).toBeGreaterThan(0);
    });
  });

  describe('enhancedDiversityBasedSampling', () => {
    test('既存サンプルを考慮した多様性サンプリングが機能する', () => {
      const existingSamples = [
        { period: 10, stdDev: 1.5 }
      ];
      
      const newSamples = samplingEngine.enhancedDiversityBasedSampling(
        'BOLLINGER_BANDS', 
        5, 
        0.15, 
        existingSamples
      );
      
      expect(newSamples.length).toBeGreaterThan(0);
      
      // 新しいサンプルが既存サンプルから十分離れていることを確認
      const constraint = constraintEngine.getStrategyConstraints('BOLLINGER_BANDS');
      newSamples.forEach(newSample => {
        const distance = samplingEngine.calculateNormalizedDistance(
          newSample, 
          existingSamples[0], 
          constraint.parameters
        );
        expect(distance).toBeGreaterThan(0.1); // 最小距離の確保
      });
    });
  });

  describe('optimizeSampleDiversity', () => {
    test('多数のサンプルから多様性を最大化して選択する', () => {
      // 多くのサンプルを生成
      const allSamples = [];
      for (let i = 0; i < 50; i++) {
        allSamples.push({
          period: 10 + (i % 40),
          stdDev: 1.0 + (i % 20) * 0.1
        });
      }
      
      const optimizedSamples = samplingEngine.optimizeSampleDiversity(
        allSamples, 
        'BOLLINGER_BANDS', 
        10
      );
      
      expect(optimizedSamples.length).toBe(10);
      
      // 最適化されたサンプルの多様性を検証
      const constraint = constraintEngine.getStrategyConstraints('BOLLINGER_BANDS');
      const diversity = constraintEngine.calculateParameterDiversity(
        optimizedSamples, 
        constraint.parameters
      );
      
      expect(diversity).toBeGreaterThan(0.4); // 最適化により高い多様性
    });

    test('サンプル数が目標以下の場合は全て返される', () => {
      const samples = [
        { period: 10, stdDev: 1.5 },
        { period: 20, stdDev: 2.0 }
      ];
      
      const result = samplingEngine.optimizeSampleDiversity(
        samples, 
        'BOLLINGER_BANDS', 
        5
      );
      
      expect(result).toEqual(samples);
    });
  });

  describe('パフォーマンステスト', () => {
    test('大量のパラメータでも適切な時間で処理される', () => {
      const start = Date.now();
      
      const largeParameterSet = [];
      for (let i = 0; i < 100; i++) {
        largeParameterSet.push({
          period: 5 + (i % 45),
          threshold: 1.0 + (i % 40) * 0.1
        });
      }
      
      const parameterDefs = {
        period: { min: 5, max: 50, type: 'integer' },
        threshold: { min: 1.0, max: 5.0, type: 'float' }
      };
      
      const diversity = constraintEngine.calculateParameterDiversity(
        largeParameterSet, 
        parameterDefs
      );
      
      const duration = Date.now() - start;
      
      expect(diversity).toBeGreaterThan(0);
      expect(duration).toBeLessThan(1000); // 1秒以内
    });
  });

  describe('エッジケーステスト', () => {
    test('非常に小さなパラメータ範囲で正しく処理される', () => {
      const parameterSet = [
        { value: 1.0 },
        { value: 1.1 }
      ];
      const parameterDefs = {
        value: { min: 1.0, max: 1.2, type: 'float', step: 0.1 }
      };
      
      const diversity = constraintEngine.calculateParameterDiversity(
        parameterSet, 
        parameterDefs
      );
      
      expect(diversity).toBeGreaterThan(0);
      expect(diversity).toBeLessThanOrEqual(1);
    });

    test('undefined値が含まれるパラメータセットで正しく処理される', () => {
      const parameterSet = [
        { period: 10, threshold: 2.0 },
        { period: undefined, threshold: 3.0 },
        { period: 30, threshold: undefined }
      ];
      const parameterDefs = {
        period: { min: 5, max: 50, type: 'integer' },
        threshold: { min: 1.0, max: 5.0, type: 'float' }
      };
      
      const diversity = constraintEngine.calculateParameterDiversity(
        parameterSet, 
        parameterDefs
      );
      
      expect(diversity).toBeGreaterThan(0);
      expect(diversity).toBeLessThanOrEqual(1);
    });
  });
});