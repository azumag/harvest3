/**
 * 粒子群最適化のユニットテスト
 */

const { ParticleSwarmOptimization, MultiSwarmPSO, Particle } = require('../../../src/optimization/pso');

describe('Particle', () => {
  let particle;
  let bounds;

  beforeEach(() => {
    bounds = { x: [0, 10], y: [-5, 5] };
    particle = new Particle(bounds);
  });

  describe('初期化', () => {
    test('位置が境界内で初期化される', () => {
      expect(particle.position.x).toBeGreaterThanOrEqual(0);
      expect(particle.position.x).toBeLessThanOrEqual(10);
      expect(particle.position.y).toBeGreaterThanOrEqual(-5);
      expect(particle.position.y).toBeLessThanOrEqual(5);
    });

    test('速度が適切な範囲で初期化される', () => {
      expect(typeof particle.velocity.x).toBe('number');
      expect(typeof particle.velocity.y).toBe('number');
    });

    test('個体最良位置が初期化される', () => {
      expect(particle.personalBest.x).toBe(particle.position.x);
      expect(particle.personalBest.y).toBe(particle.position.y);
      expect(particle.personalBestValue).toBe(-Infinity);
    });
  });

  describe('適応度更新', () => {
    test('適応度が正しく更新される', () => {
      const objectiveFunction = (pos) => pos.x + pos.y;
      
      const fitness = particle.updateFitness(objectiveFunction);
      
      expect(particle.fitness).toBe(fitness);
      expect(particle.personalBestValue).toBe(fitness);
    });

    test('個体最良位置が更新される', () => {
      const objectiveFunction = (pos) => pos.x;
      
      particle.position.x = 5;
      const firstFitness = particle.updateFitness(objectiveFunction);
      
      particle.position.x = 8;
      const secondFitness = particle.updateFitness(objectiveFunction);
      
      expect(secondFitness).toBeGreaterThan(firstFitness);
      expect(particle.personalBestValue).toBe(secondFitness);
      expect(particle.personalBest.x).toBe(8);
    });

    test('目的関数エラー時に適切に処理される', () => {
      const objectiveFunction = () => { throw new Error('Test error'); };
      
      const fitness = particle.updateFitness(objectiveFunction);
      
      expect(fitness).toBe(-Infinity);
      expect(particle.fitness).toBe(-Infinity);
    });
  });

  describe('速度更新', () => {
    test('速度が正しく更新される', () => {
      const globalBest = { x: 7, y: 2 };
      particle.position = { x: 3, y: -1 };
      particle.personalBest = { x: 5, y: 0 };
      
      const oldVelocity = { ...particle.velocity };
      
      particle.updateVelocity(globalBest, 0.9, 2.0, 2.0);
      
      // 速度が変更されることを確認
      expect(particle.velocity.x).not.toBe(oldVelocity.x);
      expect(particle.velocity.y).not.toBe(oldVelocity.y);
    });

    test('速度制限が適用される', () => {
      const globalBest = { x: 100, y: 100 };
      particle.velocity = { x: 50, y: -50 };
      
      particle.updateVelocity(globalBest, 1.0, 5.0, 5.0);
      
      // 速度が制限範囲内にあることを確認
      const maxVelocityX = (bounds.x[1] - bounds.x[0]) * 0.2;
      const maxVelocityY = (bounds.y[1] - bounds.y[0]) * 0.2;
      
      expect(Math.abs(particle.velocity.x)).toBeLessThanOrEqual(maxVelocityX);
      expect(Math.abs(particle.velocity.y)).toBeLessThanOrEqual(maxVelocityY);
    });
  });

  describe('位置更新', () => {
    test('位置が速度に基づいて更新される', () => {
      // 境界から十分離れた安全な位置に設定
      particle.position = { x: 5, y: 0 };
      const oldPosition = { ...particle.position };
      particle.velocity = { x: 1, y: -0.5 };
      
      particle.updatePosition();
      
      expect(particle.position.x).toBe(oldPosition.x + 1);
      expect(particle.position.y).toBe(oldPosition.y - 0.5);
    });

    test('境界制約が適用される', () => {
      particle.position = { x: 9.5, y: 4.5 };
      particle.velocity = { x: 2, y: 2 };
      
      particle.updatePosition();
      
      expect(particle.position.x).toBeLessThanOrEqual(10);
      expect(particle.position.y).toBeLessThanOrEqual(5);
    });

    test('境界超過時に速度がリセットされる', () => {
      particle.position = { x: 9.5, y: -4.5 };
      particle.velocity = { x: 2, y: -2 };
      
      particle.updatePosition();
      
      expect(particle.velocity.x).toBe(0); // 境界でリセット
      expect(particle.velocity.y).toBe(0); // 境界でリセット
    });
  });

  describe('リセット', () => {
    test('パーティクルがリセットされる', () => {
      const oldPosition = { ...particle.position };
      const oldPersonalBest = { ...particle.personalBest };
      
      particle.reset();
      
      expect(particle.position.x).not.toBe(oldPosition.x);
      expect(particle.fitness).toBe(-Infinity);
      expect(particle.personalBest.x).toBe(oldPersonalBest.x); // 個体最良は保持
    });
  });
});

describe('ParticleSwarmOptimization', () => {
  let pso;

  beforeEach(() => {
    pso = new ParticleSwarmOptimization({
      swarmSize: 20,
      maxIterations: 10,
      inertiaWeight: 0.9,
      c1: 2.0,
      c2: 2.0
    });
  });

  describe('初期化', () => {
    test('デフォルトオプションで初期化される', () => {
      const defaultPSO = new ParticleSwarmOptimization();
      expect(defaultPSO.options.swarmSize).toBe(30);
      expect(defaultPSO.options.maxIterations).toBe(100);
      expect(defaultPSO.options.inertiaWeight).toBe(0.9);
    });

    test('カスタムオプションで初期化される', () => {
      expect(pso.options.swarmSize).toBe(20);
      expect(pso.options.maxIterations).toBe(10);
    });
  });

  describe('目的関数設定', () => {
    test('目的関数と境界が正しく設定される', () => {
      const objectiveFunction = (x) => x.param1 + x.param2;
      const bounds = { param1: [0, 10], param2: [0, 10] };
      
      pso.setObjective(objectiveFunction, bounds);
      
      expect(pso.objectiveFunction).toBe(objectiveFunction);
      expect(pso.bounds).toEqual(bounds);
    });
  });

  describe('スワーム初期化', () => {
    test('指定されたサイズのスワームが初期化される', () => {
      const bounds = { x: [0, 10], y: [0, 10] };
      pso.setObjective((params) => params.x + params.y, bounds);
      
      pso.initializeSwarm();
      
      expect(pso.swarm).toHaveLength(20);
      expect(pso.globalBest).toBeTruthy();
      expect(pso.globalBestValue).toBeGreaterThan(-Infinity);
    });
  });

  describe('慣性重み計算', () => {
    test('線形減衰が正しく計算される', () => {
      pso.iteration = 5;
      pso.options.maxIterations = 10;
      
      const inertiaWeight = pso.calculateInertiaWeight();
      
      expect(inertiaWeight).toBeGreaterThan(pso.options.inertiaWeightMin);
      expect(inertiaWeight).toBeLessThan(pso.options.inertiaWeight);
    });

    test('適応的調整が機能する', () => {
      pso.options.adaptiveParameters = true;
      pso.swarm = [new Particle({ x: [0, 10] }), new Particle({ x: [0, 10] })];
      
      const inertiaWeight = pso.calculateInertiaWeight();
      
      expect(typeof inertiaWeight).toBe('number');
      expect(inertiaWeight).toBeGreaterThan(0);
    });
  });

  describe('多様性計算', () => {
    test('スワームの多様性が計算される', () => {
      const bounds = { x: [0, 10], y: [0, 10] };
      pso.setObjective((params) => params.x + params.y, bounds);
      
      pso.initializeSwarm();
      const diversity = pso.calculateSwarmDiversity();
      
      expect(diversity).toBeGreaterThanOrEqual(0);
      expect(typeof diversity).toBe('number');
    });
  });

  describe('収束判定', () => {
    test('収束が正しく判定される', () => {
      // 同じ値の履歴を作成
      pso.fitnessHistory = [
        { best: 10.0 },
        { best: 10.0001 },
        { best: 10.0002 },
        { best: 10.0001 },
        { best: 10.0003 }
      ];
      
      const converged = pso.checkConvergence();
      
      expect(typeof converged).toBe('boolean');
    });
  });

  describe('最適化実行', () => {
    test('簡単な最適化問題が解ける', async () => {
      // 最大化問題: f(x) = -(x-5)^2 + 25 (最適解: x=5, 最適値=25)
      const objectiveFunction = (params) => -(Math.pow(params.x - 5, 2)) + 25;
      const bounds = { x: [0, 10] };
      
      pso.setObjective(objectiveFunction, bounds);
      
      const result = await pso.optimize();
      
      expect(result).toHaveProperty('bestParameters');
      expect(result).toHaveProperty('bestValue');
      expect(result).toHaveProperty('iterations');
      expect(result).toHaveProperty('fitnessHistory');
      
      // 最適解に近い値が得られることを確認
      expect(result.bestParameters.x).toBeCloseTo(5, 1);
      expect(result.bestValue).toBeGreaterThan(20);
    }, 10000);

    test('多次元最適化問題が解ける', async () => {
      // Sphere関数の最大化版: f(x,y) = 100 - (x^2 + y^2)
      const objectiveFunction = (params) => 100 - (Math.pow(params.x, 2) + Math.pow(params.y, 2));
      const bounds = { x: [-5, 5], y: [-5, 5] };
      
      pso.setObjective(objectiveFunction, bounds);
      
      const result = await pso.optimize();
      
      // 最適解 (0, 0) に近い値が得られることを確認
      expect(Math.abs(result.bestParameters.x)).toBeLessThan(2);
      expect(Math.abs(result.bestParameters.y)).toBeLessThan(2);
      expect(result.bestValue).toBeGreaterThan(80);
    }, 10000);
  });

  describe('エラーハンドリング', () => {
    test('目的関数未設定時にエラーが発生する', async () => {
      await expect(pso.optimize()).rejects.toThrow('Objective function and bounds must be set before optimization');
    });
  });
});

describe('MultiSwarmPSO', () => {
  let multiPSO;

  beforeEach(() => {
    multiPSO = new MultiSwarmPSO({
      numberOfSwarms: 3,
      swarmSize: 10,
      maxIterations: 5,
      migrationInterval: 3
    });
  });

  describe('初期化', () => {
    test('マルチスワームが初期化される', () => {
      const bounds = { x: [0, 10] };
      multiPSO.setObjective((params) => params.x, bounds);
      
      multiPSO.initializeSwarms();
      
      expect(multiPSO.swarms).toHaveLength(3);
      expect(multiPSO.globalBest).toBeTruthy();
      expect(multiPSO.globalBestValue).toBeGreaterThan(-Infinity);
    });
  });

  describe('移住', () => {
    test('スワーム間の移住が実行される', () => {
      const bounds = { x: [0, 10] };
      multiPSO.setObjective((params) => params.x, bounds);
      
      multiPSO.initializeSwarms();
      
      // 移住前の状態を記録
      const beforeMigration = multiPSO.swarms.map(swarm => 
        swarm.swarm.map(particle => ({ ...particle.position }))
      );
      
      multiPSO.performMigration();
      
      // 移住後に何らかの変化があることを確認
      let hasChanged = false;
      multiPSO.swarms.forEach((swarm, i) => {
        swarm.swarm.forEach((particle, j) => {
          if (particle.position.x !== beforeMigration[i][j].x) {
            hasChanged = true;
          }
        });
      });
      
      expect(hasChanged).toBe(true);
    });
  });

  describe('最適化実行', () => {
    test('マルチスワーム最適化が実行される', async () => {
      const objectiveFunction = (params) => -(Math.pow(params.x - 5, 2)) + 25;
      const bounds = { x: [0, 10] };
      
      multiPSO.setObjective(objectiveFunction, bounds);
      
      const result = await multiPSO.optimize();
      
      expect(result).toHaveProperty('bestParameters');
      expect(result).toHaveProperty('bestValue');
      expect(result).toHaveProperty('swarmResults');
      expect(result.swarmResults).toHaveLength(3);
      
      // 各スワームの結果が含まれることを確認
      result.swarmResults.forEach(swarmResult => {
        expect(swarmResult).toHaveProperty('bestValue');
        expect(swarmResult).toHaveProperty('bestParameters');
      });
    }, 10000);
  });

  describe('エラーハンドリング', () => {
    test('目的関数未設定時にエラーが発生する', async () => {
      await expect(multiPSO.optimize()).rejects.toThrow('Objective function and bounds must be set before optimization');
    });
  });
});