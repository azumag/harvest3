/**
 * 統合最適化インターフェースのユニットテスト
 */

const { AdvancedOptimizer, BacktestOptimizer } = require('../../../src/optimization');

describe('AdvancedOptimizer', () => {
  let optimizer;

  beforeEach(() => {
    optimizer = new AdvancedOptimizer({
      algorithm: 'auto',
      maxEvaluations: 30
    });
  });

  describe('初期化', () => {
    test('デフォルトオプションで初期化される', () => {
      const defaultOptimizer = new AdvancedOptimizer();
      expect(defaultOptimizer.options.algorithm).toBe('auto');
      expect(defaultOptimizer.options.maxEvaluations).toBe(100);
    });

    test('カスタムオプションで初期化される', () => {
      expect(optimizer.options.algorithm).toBe('auto');
      expect(optimizer.options.maxEvaluations).toBe(30);
    });
  });

  describe('目的関数設定', () => {
    test('目的関数と境界が正しく設定される', () => {
      const objectiveFunction = (x) => x.param1 + x.param2;
      const bounds = { param1: [0, 10], param2: [0, 10] };
      
      optimizer.setObjective(objectiveFunction, bounds);
      
      expect(optimizer.objectiveFunction).toBe(objectiveFunction);
      expect(optimizer.bounds).toEqual(bounds);
    });
  });

  describe('アルゴリズム初期化', () => {
    test('すべてのアルゴリズムが初期化される', () => {
      const bounds = { x: [0, 10], y: [0, 10] };
      optimizer.setObjective((params) => params.x + params.y, bounds);
      
      optimizer.initializeAlgorithms();
      
      expect(optimizer.algorithms.bayesian).toBeTruthy();
      expect(optimizer.algorithms.genetic).toBeTruthy();
      expect(optimizer.algorithms.pso).toBeTruthy();
    });
  });

  describe('アルゴリズム自動選択', () => {
    test('低次元でベイズ最適化が選択される', () => {
      optimizer.bounds = { x: [0, 10], y: [0, 10] }; // 2次元
      optimizer.options.maxEvaluations = 100;
      
      const selected = optimizer.selectAlgorithm();
      
      expect(selected).toBe('bayesian');
    });

    test('高次元で遺伝的アルゴリズムが選択される', () => {
      optimizer.bounds = Array.from({ length: 12 }, (_, i) => [`param${i}`, [0, 10]])
        .reduce((obj, [key, value]) => ({ ...obj, [key]: value }), {}); // 12次元
      optimizer.options.maxEvaluations = 200;
      
      const selected = optimizer.selectAlgorithm();
      
      expect(selected).toBe('genetic');
    });

    test('評価回数制限時にPSOが選択される', () => {
      optimizer.bounds = { x: [0, 10], y: [0, 10] };
      optimizer.options.maxEvaluations = 20; // 少ない評価回数
      
      const selected = optimizer.selectAlgorithm();
      
      expect(['pso', 'genetic']).toContain(selected);
    });
  });

  describe('単一アルゴリズム最適化', () => {
    test('PSO最適化が実行される', async () => {
      const objectiveFunction = (params) => -(Math.pow(params.x - 5, 2)) + 25;
      const bounds = { x: [0, 10] };
      
      optimizer.setObjective(objectiveFunction, bounds);
      optimizer.initializeAlgorithms();
      
      const result = await optimizer.optimizeSingle('pso');
      
      expect(result).toHaveProperty('bestParameters');
      expect(result).toHaveProperty('bestValue');
      expect(result).toHaveProperty('algorithmType');
      expect(result.algorithmType).toBe('pso');
      expect(result.success).toBe(true);
    }, 15000);

    test('存在しないアルゴリズムでエラーが発生する', async () => {
      optimizer.initializeAlgorithms();
      
      await expect(optimizer.optimizeSingle('nonexistent')).rejects.toThrow('Unknown algorithm: nonexistent');
    });
  });

  describe('アンサンブル最適化', () => {
    test('複数アルゴリズムが並列実行される', async () => {
      const objectiveFunction = (params) => params.x * params.y;
      const bounds = { x: [1, 5], y: [1, 5] };
      
      optimizer.setObjective(objectiveFunction, bounds);
      optimizer.initializeAlgorithms();
      
      const result = await optimizer.optimizeEnsemble();
      
      expect(result).toHaveProperty('bestParameters');
      expect(result).toHaveProperty('bestValue');
      expect(result).toHaveProperty('algorithmType');
      expect(result.algorithmType).toBe('ensemble');
      expect(result).toHaveProperty('allResults');
      expect(result).toHaveProperty('consensus');
      
      // 3つのアルゴリズムの結果が含まれることを確認
      expect(Object.keys(result.allResults)).toHaveLength(3);
    }, 20000);
  });

  describe('結果の合意計算', () => {
    test('複数結果から合意が計算される', () => {
      // boundsを設定
      const bounds = { x: [0, 10], y: [0, 10] };
      optimizer.setObjective((params) => params.x + params.y, bounds);
      
      const results = [
        { bestParameters: { x: 5.1, y: 3.9 }, bestValue: 20 },
        { bestParameters: { x: 4.9, y: 4.1 }, bestValue: 19 },
        { bestParameters: { x: 5.0, y: 4.0 }, bestValue: 21 }
      ];
      
      const consensus = optimizer.calculateConsensus(results);
      
      expect(consensus).toHaveProperty('consensus');
      expect(consensus).toHaveProperty('confidence');
      expect(consensus.consensus.x).toBeCloseTo(5.0, 1);
      expect(consensus.consensus.y).toBeCloseTo(4.0, 1);
    });

    test('単一結果でnullが返される', () => {
      // boundsを設定
      const bounds = { x: [0, 10], y: [0, 10] };
      optimizer.setObjective((params) => params.x + params.y, bounds);
      
      const results = [
        { bestParameters: { x: 5.0, y: 4.0 }, bestValue: 20 }
      ];
      
      const consensus = optimizer.calculateConsensus(results);
      
      expect(consensus).toBeNull();
    });
  });

  describe('集中探索境界作成', () => {
    test('中心点周辺の境界が作成される', () => {
      optimizer.bounds = { x: [0, 10], y: [0, 10] };
      const centerPoint = { x: 5, y: 7 };
      const focusRadius = 0.2;
      
      const focusedBounds = optimizer.createFocusedBounds(centerPoint, focusRadius);
      
      expect(focusedBounds.x[0]).toBeGreaterThanOrEqual(4);
      expect(focusedBounds.x[1]).toBeLessThanOrEqual(6);
      expect(focusedBounds.y[0]).toBeGreaterThanOrEqual(6);
      expect(focusedBounds.y[1]).toBeLessThanOrEqual(8);
    });
  });

  describe('メイン最適化実行', () => {
    test('自動選択で最適化が実行される', async () => {
      const objectiveFunction = (params) => -(Math.pow(params.x - 5, 2)) + 25;
      const bounds = { x: [0, 10] };
      
      optimizer.setObjective(objectiveFunction, bounds);
      
      const result = await optimizer.optimize();
      
      expect(result).toHaveProperty('bestParameters');
      expect(result).toHaveProperty('bestValue');
      expect(result).toHaveProperty('totalExecutionTime');
      expect(result.bestParameters.x).toBeCloseTo(5, 1);
    }, 15000);

    test('指定アルゴリズムで最適化が実行される', async () => {
      optimizer.options.algorithm = 'pso';
      const objectiveFunction = (params) => params.x;
      const bounds = { x: [0, 10] };
      
      optimizer.setObjective(objectiveFunction, bounds);
      
      const result = await optimizer.optimize();
      
      expect(result.algorithmType).toBe('pso');
    }, 15000);

    test('目的関数未設定時にエラーが発生する', async () => {
      await expect(optimizer.optimize()).rejects.toThrow('Objective function and bounds must be set before optimization');
    });
  });

  describe('バックテスト設定', () => {
    test('リトライ回数に応じて設定が調整される', () => {
      optimizer.configureForBacktest(0, 3);
      expect(optimizer.options.algorithm).toBe('auto');
      
      optimizer.configureForBacktest(1, 3);
      expect(optimizer.options.algorithm).toBe('pso');
      
      optimizer.configureForBacktest(2, 3);
      expect(optimizer.options.algorithm).toBe('genetic');
      
      optimizer.configureForBacktest(3, 3);
      expect(optimizer.options.algorithm).toBe('hybrid');
    });
  });

  describe('結果品質評価', () => {
    test('結果の品質が評価される', () => {
      const result = {
        bestValue: 12000,
        convergenceInfo: {
          reason: 'convergence',
          improvementRate: 0.2
        },
        algorithmType: 'genetic'
      };
      
      const quality = optimizer.evaluateResultQuality(result);
      
      expect(quality).toHaveProperty('score');
      expect(quality).toHaveProperty('confidence');
      expect(quality).toHaveProperty('reliability');
      expect(quality).toHaveProperty('overall');
      expect(quality).toHaveProperty('explanation');
      
      expect(quality.overall).toBeGreaterThan(0);
      expect(Array.isArray(quality.explanation)).toBe(true);
    });
  });
});

describe('BacktestOptimizer', () => {
  let optimizer;

  beforeEach(() => {
    optimizer = new BacktestOptimizer({
      maxEvaluations: 20
    });
  });

  describe('初期化', () => {
    test('バックテスト特化設定で初期化される', () => {
      expect(optimizer.options.algorithm).toBe('auto');
      expect(optimizer.options.maxEvaluations).toBe(20);
      expect(optimizer.options.convergenceThreshold).toBe(1e-4);
    });
  });

  describe('パラメータ組み合わせ生成', () => {
    test('従来インターフェース互換の組み合わせが生成される', () => {
      const defaultConfig = { param1: 10, param2: 20 };
      const numericKeys = ['param1', 'param2'];
      
      const combinations = optimizer.generateParameterCombinations(
        defaultConfig, 
        numericKeys, 
        0.2, 
        10
      );
      
      expect(Array.isArray(combinations)).toBe(true);
      expect(combinations.length).toBe(10);
      
      combinations.forEach(combo => {
        expect(combo).toHaveProperty('param1');
        expect(combo).toHaveProperty('param2');
        expect(combo.param1).toBeGreaterThanOrEqual(8);
        expect(combo.param1).toBeLessThanOrEqual(12);
      });
    });
  });

  describe('境界からの組み合わせ生成', () => {
    test('指定された境界から組み合わせが生成される', () => {
      const bounds = { x: [1, 5], y: [10, 20] };
      
      const combinations = optimizer.generateCombinationsFromBounds(bounds, 5);
      
      expect(combinations).toHaveLength(5);
      
      combinations.forEach(combo => {
        expect(combo.x).toBeGreaterThanOrEqual(1);
        expect(combo.x).toBeLessThanOrEqual(5);
        expect(combo.y).toBeGreaterThanOrEqual(10);
        expect(combo.y).toBeLessThanOrEqual(20);
      });
    });
  });

  describe('パラメータ最適化実行', () => {
    test('最適化が実行される', async () => {
      const objectiveFunction = (params) => params.x + params.y;
      const defaultConfig = { x: 5, y: 5 };
      const numericKeys = ['x', 'y'];
      
      const result = await optimizer.optimizeParameters(
        objectiveFunction,
        defaultConfig,
        numericKeys,
        { retryCount: 0, variationRange: 0.2 }
      );
      
      expect(result).toHaveProperty('bestParameters');
      expect(result).toHaveProperty('bestValue');
      expect(result).toHaveProperty('evaluations');
      expect(result).toHaveProperty('algorithmUsed');
      expect(result).toHaveProperty('quality');
      
      expect(typeof result.bestValue).toBe('number');
      expect(typeof result.algorithmUsed).toBe('string');
    }, 15000);
  });

  describe('エラーハンドリング', () => {
    test('無効な目的関数でも処理を継続する', async () => {
      const objectiveFunction = () => { throw new Error('Test error'); };
      const defaultConfig = { x: 5 };
      const numericKeys = ['x'];
      
      const result = await optimizer.optimizeParameters(
        objectiveFunction,
        defaultConfig,
        numericKeys
      );
      
      expect(result).toHaveProperty('bestParameters');
      expect(result).toHaveProperty('bestValue');
    }, 15000);
  });
});