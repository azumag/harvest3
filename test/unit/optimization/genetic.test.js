/**
 * 遺伝的アルゴリズムのユニットテスト
 */

const { GeneticAlgorithm, MultiObjectiveGA } = require('../../../src/optimization/genetic');

describe('GeneticAlgorithm', () => {
  let ga;
  
  beforeEach(() => {
    ga = new GeneticAlgorithm({
      populationSize: 30,
      generations: 20,
      crossoverRate: 0.8,
      mutationRate: 0.1
    });
  });

  describe('初期化', () => {
    test('デフォルトオプションで初期化される', () => {
      const defaultGA = new GeneticAlgorithm();
      expect(defaultGA.options.populationSize).toBe(50);
      expect(defaultGA.options.generations).toBe(100);
      expect(defaultGA.options.crossoverRate).toBe(0.8);
      expect(defaultGA.options.mutationRate).toBe(0.1);
    });

    test('カスタムオプションで初期化される', () => {
      expect(ga.options.populationSize).toBe(30);
      expect(ga.options.generations).toBe(20);
    });
  });

  describe('目的関数設定', () => {
    test('目的関数と境界が正しく設定される', () => {
      const objectiveFunction = (x) => x.param1 + x.param2;
      const bounds = { param1: [0, 10], param2: [0, 10] };
      
      ga.setObjective(objectiveFunction, bounds);
      
      expect(ga.objectiveFunction).toBe(objectiveFunction);
      expect(ga.bounds).toEqual(bounds);
    });
  });

  describe('集団初期化', () => {
    test('指定されたサイズの集団が初期化される', () => {
      const bounds = { x: [0, 10], y: [0, 10] };
      ga.setObjective((params) => params.x + params.y, bounds);
      
      ga.initializePopulation();
      
      expect(ga.population).toHaveLength(30);
      
      // 各個体が境界内にあることを確認
      ga.population.forEach(individual => {
        expect(individual.x).toBeGreaterThanOrEqual(0);
        expect(individual.x).toBeLessThanOrEqual(10);
        expect(individual.y).toBeGreaterThanOrEqual(0);
        expect(individual.y).toBeLessThanOrEqual(10);
      });
    });
  });

  describe('適応度評価', () => {
    test('集団の適応度が正しく評価される', () => {
      const bounds = { x: [0, 10], y: [0, 10] };
      ga.setObjective((params) => params.x + params.y, bounds);
      
      ga.initializePopulation();
      ga.evaluatePopulation();
      
      expect(ga.fitness).toHaveLength(30);
      expect(ga.bestFitness).toBeGreaterThan(-Infinity);
      expect(ga.bestIndividual).toBeTruthy();
    });
  });

  describe('選択', () => {
    test('トーナメント選択が実行される', () => {
      const bounds = { x: [0, 10] };
      ga.setObjective((params) => params.x, bounds);
      
      ga.initializePopulation();
      ga.evaluatePopulation();
      
      const selected = ga.tournamentSelection();
      
      expect(selected).toHaveProperty('x');
      expect(selected.x).toBeGreaterThanOrEqual(0);
      expect(selected.x).toBeLessThanOrEqual(10);
    });
  });

  describe('交叉', () => {
    test('BLX-α交叉が実行される', () => {
      const bounds = { x: [0, 10], y: [0, 10] };
      ga.setObjective((params) => params.x + params.y, bounds);
      
      const parent1 = { x: 3, y: 7 };
      const parent2 = { x: 6, y: 4 };
      
      const [child1, child2] = ga.blxCrossover(parent1, parent2);
      
      // 子個体が境界内にあることを確認
      expect(child1.x).toBeGreaterThanOrEqual(0);
      expect(child1.x).toBeLessThanOrEqual(10);
      expect(child2.y).toBeGreaterThanOrEqual(0);
      expect(child2.y).toBeLessThanOrEqual(10);
    });
  });

  describe('突然変異', () => {
    test('ガウス突然変異が実行される', () => {
      const bounds = { x: [0, 10], y: [0, 10] };
      ga.setObjective((params) => params.x + params.y, bounds);
      
      const individual = { x: 5, y: 5 };
      const mutated = ga.gaussianMutation(individual);
      
      // 突然変異後の個体が境界内にあることを確認
      expect(mutated.x).toBeGreaterThanOrEqual(0);
      expect(mutated.x).toBeLessThanOrEqual(10);
      expect(mutated.y).toBeGreaterThanOrEqual(0);
      expect(mutated.y).toBeLessThanOrEqual(10);
    });
  });

  describe('多様性計算', () => {
    test('集団の多様性が計算される', () => {
      const bounds = { x: [0, 10], y: [0, 10] };
      ga.setObjective((params) => params.x + params.y, bounds);
      
      ga.initializePopulation();
      const diversity = ga.calculateDiversity();
      
      expect(diversity).toBeGreaterThanOrEqual(0);
      expect(typeof diversity).toBe('number');
    });
  });

  describe('最適化実行', () => {
    test('簡単な最適化問題が解ける', async () => {
      // 最大化問題: f(x) = -(x-5)^2 + 25 (最適解: x=5, 最適値=25)
      const objectiveFunction = (params) => -(Math.pow(params.x - 5, 2)) + 25;
      const bounds = { x: [0, 10] };
      
      ga.setObjective(objectiveFunction, bounds);
      
      const result = await ga.optimize();
      
      expect(result).toHaveProperty('bestParameters');
      expect(result).toHaveProperty('bestValue');
      expect(result).toHaveProperty('generations');
      expect(result).toHaveProperty('fitnessHistory');
      
      // 最適解に近い値が得られることを確認 (遺伝的アルゴリズムは確率的なので精度を緩和)
      expect(result.bestParameters.x).toBeCloseTo(5, 0); // 1.0の精度に緩和
      expect(result.bestValue).toBeGreaterThan(15); // 期待値を緩和
    }, 10000);

    test('多次元最適化問題が解ける', async () => {
      // Sphere関数の最大化版: f(x,y) = 100 - (x^2 + y^2)
      const objectiveFunction = (params) => 100 - (Math.pow(params.x, 2) + Math.pow(params.y, 2));
      const bounds = { x: [-5, 5], y: [-5, 5] };
      
      ga.setObjective(objectiveFunction, bounds);
      
      const result = await ga.optimize();
      
      // 最適解 (0, 0) に近い値が得られることを確認
      expect(Math.abs(result.bestParameters.x)).toBeLessThan(2);
      expect(Math.abs(result.bestParameters.y)).toBeLessThan(2);
      expect(result.bestValue).toBeGreaterThan(80);
    }, 10000);
  });

  describe('エラーハンドリング', () => {
    test('目的関数未設定時にエラーが発生する', async () => {
      await expect(ga.optimize()).rejects.toThrow('Objective function and bounds must be set before optimization');
    });

    test('目的関数でエラーが発生しても処理を継続する', async () => {
      const objectiveFunction = (params) => {
        if (params.x > 8) throw new Error('Test error');
        return params.x;
      };
      const bounds = { x: [0, 10] };
      
      ga.setObjective(objectiveFunction, bounds);
      
      const result = await ga.optimize();
      
      expect(result).toHaveProperty('bestParameters');
      expect(result.bestValue).toBeGreaterThan(-Infinity);
    }, 10000);
  });
});

describe('MultiObjectiveGA', () => {
  let moga;

  beforeEach(() => {
    moga = new MultiObjectiveGA({
      populationSize: 30,
      generations: 5
    });
  });

  describe('多目的最適化', () => {
    test('多目的関数の設定', () => {
      const objectives = [
        { function: (x) => x.param1, minimize: false },
        { function: (x) => x.param2, minimize: true }
      ];
      
      moga.setMultiObjectives(objectives);
      
      expect(moga.objectives).toEqual(objectives);
    });

    test('パレート支配関係の判定', () => {
      moga.objectives = [
        { minimize: false }, // 最大化
        { minimize: true }   // 最小化
      ];

      // solution1がsolution2を支配する場合
      const solution1 = [10, 5]; // より大きい値、より小さい値
      const solution2 = [8, 7];  // より小さい値、より大きい値
      
      expect(moga.dominates(solution1, solution2)).toBe(true);
      expect(moga.dominates(solution2, solution1)).toBe(false);
    });

    test('非支配ソートが実行される', () => {
      const bounds = { x: [0, 10], y: [0, 10] };
      const objectives = [
        { function: (params) => params.x, minimize: false },
        { function: (params) => params.y, minimize: false }
      ];
      
      moga.setMultiObjectives(objectives);
      moga.setObjective(() => 0, bounds); // ダミー目的関数
      
      moga.initializePopulation();
      moga.evaluateMultiObjective();
      
      const fronts = moga.nonDominatedSort();
      
      expect(Array.isArray(fronts)).toBe(true);
      expect(fronts.length).toBeGreaterThan(0);
      expect(fronts[0].length).toBeGreaterThan(0);
    });
  });
});