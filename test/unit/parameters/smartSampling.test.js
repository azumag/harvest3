/**
 * スマートサンプリングシステムのユニットテスト
 */

const { SmartSamplingEngine } = require('../../../src/parameters/smartSampling');

describe('SmartSamplingEngine', () => {
  let samplingEngine;

  beforeEach(() => {
    samplingEngine = new SmartSamplingEngine();
  });

  describe('初期化', () => {
    test('サンプリングエンジンが正しく初期化される', () => {
      expect(samplingEngine.constraintEngine).toBeDefined();
    });
  });

  describe('ラテン超方体サンプリング', () => {
    test('指定された数のサンプルが生成される', () => {
      const samples = samplingEngine.latinHypercubeSampling('MA_CROSS', 10);
      
      expect(Array.isArray(samples)).toBe(true);
      expect(samples.length).toBeLessThanOrEqual(10);
      
      samples.forEach(sample => {
        expect(sample.shortPeriod).toBeDefined();
        expect(sample.longPeriod).toBeDefined();
        expect(Number.isInteger(sample.shortPeriod)).toBe(true);
        expect(Number.isInteger(sample.longPeriod)).toBe(true);
        expect(sample.shortPeriod).toBeLessThan(sample.longPeriod);
      });
    });

    test('RSI戦略のサンプルが正しく生成される', () => {
      const samples = samplingEngine.latinHypercubeSampling('RSI', 5);
      
      expect(samples.length).toBeLessThanOrEqual(5);
      
      samples.forEach(sample => {
        expect(sample.period).toBeDefined();
        expect(sample.oversoldThreshold).toBeDefined();
        expect(sample.overboughtThreshold).toBeDefined();
        expect(sample.overboughtThreshold - sample.oversoldThreshold).toBeGreaterThanOrEqual(20);
      });
    });

    test('存在しない戦略で空配列が返される', () => {
      const samples = samplingEngine.latinHypercubeSampling('UNKNOWN_STRATEGY', 10);
      expect(samples).toEqual([]);
    });

    test('パラメータなしの戦略で空配列が返される', () => {
      // 制約エンジンにパラメータ定義がない戦略をモック
      samplingEngine.constraintEngine.getStrategyConstraints = jest.fn().mockReturnValue({
        parameters: {},
        constraints: []
      });
      
      const samples = samplingEngine.latinHypercubeSampling('EMPTY_STRATEGY', 10);
      expect(samples).toEqual([]);
    });
  });

  describe('ラテン超方体位置生成', () => {
    test('正しい次元数とサンプル数の位置が生成される', () => {
      const positions = samplingEngine.generateLatinHypercube(5, 2);
      
      expect(positions).toHaveLength(5);
      positions.forEach(position => {
        expect(position).toHaveLength(2);
        position.forEach(coord => {
          expect(coord).toBeGreaterThanOrEqual(0);
          expect(coord).toBeLessThanOrEqual(1);
        });
      });
    });

    test('各次元で均等分布が確保される', () => {
      const positions = samplingEngine.generateLatinHypercube(10, 1);
      const coords = positions.map(p => p[0]).sort((a, b) => a - b);
      
      // 各ストラタムが一度ずつ使用されることを確認
      for (let i = 0; i < 10; i++) {
        const expectedMin = i / 10;
        const expectedMax = (i + 1) / 10;
        const coordInStratum = coords.find(c => c >= expectedMin && c < expectedMax);
        expect(coordInStratum).toBeDefined();
      }
    });
  });

  describe('配列シャッフル', () => {
    test('配列が正しくシャッフルされる', () => {
      const original = [1, 2, 3, 4, 5];
      const toShuffle = [...original];
      
      samplingEngine.shuffleArray(toShuffle);
      
      expect(toShuffle).toHaveLength(original.length);
      expect(toShuffle.sort()).toEqual(original);
      
      // 元の順序と異なる可能性が高い（確率的テスト）
      // 複数回実行して少なくとも一度は異なる順序になることを確認
      let isDifferent = false;
      for (let i = 0; i < 10; i++) {
        const testArray = [1, 2, 3, 4, 5];
        samplingEngine.shuffleArray(testArray);
        if (JSON.stringify(testArray) !== JSON.stringify(original)) {
          isDifferent = true;
          break;
        }
      }
      expect(isDifferent).toBe(true);
    });
  });

  describe('適応的グリッドサンプリング', () => {
    test('有望な領域なしでサンプルが生成される', () => {
      const samples = samplingEngine.adaptiveGridSampling('MA_CROSS', [], 10);
      
      expect(Array.isArray(samples)).toBe(true);
      expect(samples.length).toBeLessThanOrEqual(10);
      
      samples.forEach(sample => {
        expect(samplingEngine.constraintEngine.validateCombination(sample, 'MA_CROSS')).toBe(true);
      });
    });

    test('有望な領域ありでサンプルが生成される', () => {
      const promisingRegions = [
        { parameter: 'shortPeriod', center: 10, radius: 5, confidence: 0.8 }
      ];
      
      const samples = samplingEngine.adaptiveGridSampling('MA_CROSS', promisingRegions, 8);
      
      expect(Array.isArray(samples)).toBe(true);
      expect(samples.length).toBeLessThanOrEqual(8);
    });
  });

  describe('有望領域グリッドサンプリング', () => {
    test('領域に焦点を当てたサンプルが生成される', () => {
      const promisingRegions = [
        { parameter: 'shortPeriod', center: 10, radius: 3, confidence: 0.8 }
      ];
      
      const samples = samplingEngine.generateFocusedGridSamples('MA_CROSS', promisingRegions, 5);
      
      expect(Array.isArray(samples)).toBe(true);
      samples.forEach(sample => {
        expect(sample.shortPeriod).toBeDefined();
        expect(sample.shortPeriod).toBeGreaterThanOrEqual(7); // center - radius
        expect(sample.shortPeriod).toBeLessThanOrEqual(13); // center + radius
      });
    });
  });

  describe('領域内グリッド生成', () => {
    test('整数型パラメータのグリッドが生成される', () => {
      const region = { parameter: 'shortPeriod', center: 10, radius: 5 };
      const paramConfig = { min: 3, max: 50, type: 'integer' };
      
      const gridValues = samplingEngine.generateRegionGrid(region, paramConfig, 5);
      
      expect(Array.isArray(gridValues)).toBe(true);
      expect(gridValues.length).toBeGreaterThan(0);
      gridValues.forEach(value => {
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(paramConfig.min);
        expect(value).toBeLessThanOrEqual(paramConfig.max);
      });
    });

    test('浮動小数点型パラメータのグリッドが生成される', () => {
      const region = { parameter: 'standardDeviation', center: 2.0, radius: 0.5 };
      const paramConfig = { min: 1.0, max: 3.0, type: 'float' };
      
      const gridValues = samplingEngine.generateRegionGrid(region, paramConfig, 5);
      
      expect(Array.isArray(gridValues)).toBe(true);
      expect(gridValues.length).toBeGreaterThan(0);
      gridValues.forEach(value => {
        expect(typeof value).toBe('number');
        expect(value).toBeGreaterThanOrEqual(paramConfig.min);
        expect(value).toBeLessThanOrEqual(paramConfig.max);
      });
    });
  });

  describe('多様性ベースサンプリング', () => {
    test('多様性を考慮したサンプルが生成される', () => {
      const samples = samplingEngine.diversityBasedSampling('MA_CROSS', 5, 0.2);
      
      expect(Array.isArray(samples)).toBe(true);
      expect(samples.length).toBeLessThanOrEqual(5);
      
      // 最小距離チェック
      for (let i = 0; i < samples.length; i++) {
        for (let j = i + 1; j < samples.length; j++) {
          const distance = samplingEngine.calculateNormalizedDistance(
            samples[i], 
            samples[j], 
            samplingEngine.constraintEngine.getStrategyConstraints('MA_CROSS').parameters
          );
          expect(distance).toBeGreaterThanOrEqual(0.2);
        }
      }
    });

    test('厳しい距離制約で少ないサンプルが生成される', () => {
      const samples = samplingEngine.diversityBasedSampling('MA_CROSS', 10, 0.8);
      
      // 厳しい制約により、実際のサンプル数は要求より少なくなる可能性
      expect(samples.length).toBeLessThanOrEqual(10);
    });
  });

  describe('最小距離チェック', () => {
    test('距離条件を満たすサンプルでtrueが返される', () => {
      const candidate = { shortPeriod: 30, longPeriod: 100 };
      const existing = [{ shortPeriod: 5, longPeriod: 20 }];
      const paramDefs = {
        shortPeriod: { min: 3, max: 50, type: 'integer' },
        longPeriod: { min: 10, max: 200, type: 'integer' }
      };
      
      const result = samplingEngine.checkMinimumDistance(candidate, existing, paramDefs, 0.1);
      expect(result).toBe(true);
    });

    test('距離条件を満たさないサンプルでfalseが返される', () => {
      const candidate = { shortPeriod: 5, longPeriod: 21 };
      const existing = [{ shortPeriod: 5, longPeriod: 20 }];
      const paramDefs = {
        shortPeriod: { min: 3, max: 50, type: 'integer' },
        longPeriod: { min: 10, max: 200, type: 'integer' }
      };
      
      const result = samplingEngine.checkMinimumDistance(candidate, existing, paramDefs, 0.1);
      expect(result).toBe(false);
    });

    test('既存サンプルなしでtrueが返される', () => {
      const candidate = { shortPeriod: 10, longPeriod: 30 };
      const existing = [];
      const paramDefs = {};
      
      const result = samplingEngine.checkMinimumDistance(candidate, existing, paramDefs, 0.1);
      expect(result).toBe(true);
    });
  });

  describe('正規化ユークリッド距離計算', () => {
    test('正規化距離が正しく計算される', () => {
      const sample1 = { shortPeriod: 5, longPeriod: 20 };
      const sample2 = { shortPeriod: 15, longPeriod: 40 };
      const paramDefs = {
        shortPeriod: { min: 0, max: 50, type: 'integer' },
        longPeriod: { min: 0, max: 200, type: 'integer' }
      };
      
      const distance = samplingEngine.calculateNormalizedDistance(sample1, sample2, paramDefs);
      
      expect(distance).toBeGreaterThan(0);
      expect(distance).toBeLessThanOrEqual(Math.sqrt(2)); // 最大可能距離
      
      // 手動計算による検証（正規化されたユークリッド距離）
      const expectedDistance = Math.sqrt(
        (Math.pow((15 - 5) / 50, 2) + Math.pow((40 - 20) / 200, 2)) / 2
      );
      expect(distance).toBeCloseTo(expectedDistance, 3);
    });

    test('同一サンプルで距離0が返される', () => {
      const sample = { shortPeriod: 10, longPeriod: 30 };
      const paramDefs = {
        shortPeriod: { min: 0, max: 50, type: 'integer' },
        longPeriod: { min: 0, max: 200, type: 'integer' }
      };
      
      const distance = samplingEngine.calculateNormalizedDistance(sample, sample, paramDefs);
      expect(distance).toBe(0);
    });

    test('パラメータなしで距離0が返される', () => {
      const sample1 = {};
      const sample2 = {};
      const paramDefs = {};
      
      const distance = samplingEngine.calculateNormalizedDistance(sample1, sample2, paramDefs);
      expect(distance).toBe(0);
    });
  });

  describe('ハイブリッドサンプリング', () => {
    test('デフォルト設定でサンプルが生成される', () => {
      const samples = samplingEngine.hybridSampling('MA_CROSS', 15);
      
      expect(Array.isArray(samples)).toBe(true);
      expect(samples.length).toBeLessThanOrEqual(15);
      
      samples.forEach(sample => {
        expect(samplingEngine.constraintEngine.validateCombination(sample, 'MA_CROSS')).toBe(true);
      });
    });

    test('カスタム比率でサンプルが生成される', () => {
      const options = {
        latinHypercubeRatio: 0.5,
        diversityRatio: 0.3,
        randomRatio: 0.2
      };
      
      const samples = samplingEngine.hybridSampling('MA_CROSS', 10, options);
      
      expect(Array.isArray(samples)).toBe(true);
      expect(samples.length).toBeLessThanOrEqual(10);
    });

    test('有望な領域を考慮したサンプリングが実行される', () => {
      const options = {
        promisingRegions: [
          { parameter: 'shortPeriod', center: 8, radius: 3, confidence: 0.7 }
        ]
      };
      
      const samples = samplingEngine.hybridSampling('MA_CROSS', 8, options);
      
      expect(Array.isArray(samples)).toBe(true);
      expect(samples.length).toBeLessThanOrEqual(8);
    });
  });

  describe('重複除去', () => {
    test('重複サンプルが正しく除去される', () => {
      const samples = [
        { shortPeriod: 5, longPeriod: 20 },
        { shortPeriod: 10, longPeriod: 30 },
        { shortPeriod: 5, longPeriod: 20 }, // 重複
        { shortPeriod: 15, longPeriod: 40 }
      ];
      
      const unique = samplingEngine.removeDuplicates(samples);
      
      expect(unique).toHaveLength(3);
      expect(unique).toContainEqual({ shortPeriod: 5, longPeriod: 20 });
      expect(unique).toContainEqual({ shortPeriod: 10, longPeriod: 30 });
      expect(unique).toContainEqual({ shortPeriod: 15, longPeriod: 40 });
    });

    test('重複なしの場合に全サンプルが保持される', () => {
      const samples = [
        { shortPeriod: 5, longPeriod: 20 },
        { shortPeriod: 10, longPeriod: 30 }
      ];
      
      const unique = samplingEngine.removeDuplicates(samples);
      
      expect(unique).toHaveLength(2);
      expect(unique).toEqual(samples);
    });
  });

  describe('サンプリング品質評価', () => {
    test('有効なサンプルの品質が評価される', () => {
      const samples = [
        { shortPeriod: 5, longPeriod: 20 },
        { shortPeriod: 10, longPeriod: 30 },
        { shortPeriod: 15, longPeriod: 40 }
      ];
      
      const quality = samplingEngine.evaluateSamplingQuality(samples, 'MA_CROSS');
      
      expect(quality.coverage).toBeDefined();
      expect(quality.diversity).toBeDefined();
      expect(quality.uniformity).toBeDefined();
      expect(quality.validity).toBeDefined();
      
      expect(quality.coverage).toBeGreaterThanOrEqual(0);
      expect(quality.coverage).toBeLessThanOrEqual(1);
      expect(quality.uniformity).toBeGreaterThanOrEqual(0);
      expect(quality.uniformity).toBeLessThanOrEqual(1);
    });

    test('空サンプルで0品質が返される', () => {
      const quality = samplingEngine.evaluateSamplingQuality([], 'MA_CROSS');
      
      expect(quality.coverage).toBe(0);
      expect(quality.diversity).toBe(0);
      expect(quality.uniformity).toBe(0);
      expect(quality.validity).toBe(0);
    });
  });

  describe('均一性計算', () => {
    test('均一なサンプルで高い均一性が返される', () => {
      // 均等に分散したサンプル
      const samples = [
        { testParam: 10 },
        { testParam: 20 },
        { testParam: 30 }
      ];
      const paramDefs = {
        testParam: { min: 0, max: 40, type: 'integer' }
      };
      
      const uniformity = samplingEngine.calculateUniformity(samples, paramDefs);
      expect(uniformity).toBeGreaterThan(0.5);
    });

    test('集中したサンプルで適切な均一性が返される', () => {
      // 僅かに異なるが集中したサンプル
      const samples = [
        { testParam: 19 },
        { testParam: 20 },
        { testParam: 21 }
      ];
      const paramDefs = {
        testParam: { min: 0, max: 40, type: 'integer' }
      };
      
      const uniformity = samplingEngine.calculateUniformity(samples, paramDefs);
      expect(uniformity).toBeGreaterThanOrEqual(0);  // 均一性は0以上
      expect(uniformity).toBeLessThanOrEqual(1);     // 均一性は1以下
    });

    test('単一サンプルで1が返される', () => {
      const samples = [{ testParam: 10 }];
      const paramDefs = { testParam: { min: 0, max: 20, type: 'integer' } };
      
      const uniformity = samplingEngine.calculateUniformity(samples, paramDefs);
      expect(uniformity).toBe(1);
    });

    test('空サンプルで1が返される', () => {
      const uniformity = samplingEngine.calculateUniformity([], {});
      expect(uniformity).toBe(1);
    });
  });
});