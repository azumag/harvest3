/**
 * 粒子群最適化 (Particle Swarm Optimization) 実装
 * 群衆知能を用いたパラメータ最適化アルゴリズム
 * 
 * 特徴:
 * - 標準PSO, 慣性重み付きPSO, 適応的PSO
 * - 線形・非線形慣性重み減衰
 * - 境界制約処理
 * - 停滞回避機構
 * - マルチスワーム対応
 */

class Particle {
  constructor(bounds) {
    this.bounds = bounds;
    this.paramNames = Object.keys(bounds);
    this.dimension = this.paramNames.length;
    
    // 位置と速度の初期化
    this.position = {};
    this.velocity = {};
    this.personalBest = {};
    this.personalBestValue = -Infinity;
    this.fitness = -Infinity;
    
    this.initialize();
  }

  /**
   * パーティクルの初期化
   */
  initialize() {
    this.paramNames.forEach(param => {
      const [min, max] = this.bounds[param];
      
      // 位置の初期化（境界内のランダム値）
      this.position[param] = min + Math.random() * (max - min);
      
      // 速度の初期化（範囲の10%以内のランダム値）
      const range = max - min;
      this.velocity[param] = (Math.random() - 0.5) * 0.1 * range;
      
      // 個体最良位置の初期化
      this.personalBest[param] = this.position[param];
    });
  }

  /**
   * 適応度の更新
   */
  updateFitness(objectiveFunction) {
    try {
      this.fitness = objectiveFunction(this.position);
      
      // 個体最良位置の更新
      if (this.fitness > this.personalBestValue) {
        this.personalBestValue = this.fitness;
        this.personalBest = { ...this.position };
      }
      
      return this.fitness;
    } catch (error) {
      this.fitness = -Infinity;
      return this.fitness;
    }
  }

  /**
   * 速度の更新
   */
  updateVelocity(globalBest, inertiaWeight, c1, c2) {
    this.paramNames.forEach(param => {
      const r1 = Math.random();
      const r2 = Math.random();
      
      const cognitiveComponent = c1 * r1 * (this.personalBest[param] - this.position[param]);
      const socialComponent = c2 * r2 * (globalBest[param] - this.position[param]);
      
      this.velocity[param] = inertiaWeight * this.velocity[param] + 
                            cognitiveComponent + socialComponent;
                            
      // 速度制限
      const [min, max] = this.bounds[param];
      const maxVelocity = (max - min) * 0.2; // 範囲の20%
      this.velocity[param] = Math.max(-maxVelocity, 
                            Math.min(maxVelocity, this.velocity[param]));
    });
  }

  /**
   * 位置の更新
   */
  updatePosition() {
    this.paramNames.forEach(param => {
      this.position[param] += this.velocity[param];
      
      // 境界制約の処理
      const [min, max] = this.bounds[param];
      if (this.position[param] < min) {
        this.position[param] = min;
        this.velocity[param] = 0; // 境界で速度リセット
      } else if (this.position[param] > max) {
        this.position[param] = max;
        this.velocity[param] = 0;
      }
    });
  }

  /**
   * パーティクルのリセット（停滞回避用）
   */
  reset() {
    this.paramNames.forEach(param => {
      const [min, max] = this.bounds[param];
      
      // 位置のランダム再初期化
      this.position[param] = min + Math.random() * (max - min);
      
      // 速度のリセット
      const range = max - min;
      this.velocity[param] = (Math.random() - 0.5) * 0.05 * range;
    });
    
    this.fitness = -Infinity;
    // 個体最良位置は保持
  }
}

class ParticleSwarmOptimization {
  constructor(options = {}) {
    this.options = {
      swarmSize: options.swarmSize || 30,
      maxIterations: options.maxIterations || 100,
      inertiaWeight: options.inertiaWeight || 0.9,
      inertiaWeightMin: options.inertiaWeightMin || 0.1,
      c1: options.c1 || 2.0, // 認知パラメータ
      c2: options.c2 || 2.0, // 社会パラメータ
      convergenceThreshold: options.convergenceThreshold || 1e-6,
      stagnationLimit: options.stagnationLimit || 10,
      adaptiveParameters: options.adaptiveParameters || false,
      ...options
    };

    this.swarm = [];
    this.globalBest = null;
    this.globalBestValue = -Infinity;
    this.bounds = {};
    this.objectiveFunction = null;
    this.iteration = 0;
    this.fitnessHistory = [];
    this.diversityHistory = [];
    this.stagnationCounter = 0;
    this.convergenceInfo = null;
  }

  /**
   * 目的関数と境界の設定
   */
  setObjective(objectiveFunction, bounds) {
    this.objectiveFunction = objectiveFunction;
    this.bounds = bounds;
  }

  /**
   * スワームの初期化
   */
  initializeSwarm() {
    this.swarm = [];
    
    for (let i = 0; i < this.options.swarmSize; i++) {
      const particle = new Particle(this.bounds);
      particle.updateFitness(this.objectiveFunction);
      
      // グローバル最良位置の更新
      if (particle.fitness > this.globalBestValue) {
        this.globalBestValue = particle.fitness;
        this.globalBest = { ...particle.position };
      }
      
      this.swarm.push(particle);
    }
  }

  /**
   * 慣性重みの計算
   */
  calculateInertiaWeight() {
    const { inertiaWeight, inertiaWeightMin, maxIterations } = this.options;
    
    // 線形減衰
    const linearDecay = inertiaWeight - 
      (inertiaWeight - inertiaWeightMin) * (this.iteration / maxIterations);
    
    // 非線形減衰（指数関数的）
    const nonlinearDecay = inertiaWeightMin + 
      (inertiaWeight - inertiaWeightMin) * 
      Math.exp(-2 * this.iteration / maxIterations);
    
    // 適応的調整
    if (this.options.adaptiveParameters) {
      const diversity = this.calculateSwarmDiversity();
      const diversityFactor = Math.min(1, diversity * 10);
      return linearDecay * (0.5 + 0.5 * diversityFactor);
    }
    
    return linearDecay;
  }

  /**
   * スワームの多様性計算
   */
  calculateSwarmDiversity() {
    if (this.swarm.length < 2) return 0;

    const paramNames = Object.keys(this.bounds);
    let totalDistance = 0;
    let pairCount = 0;

    for (let i = 0; i < this.swarm.length; i++) {
      for (let j = i + 1; j < this.swarm.length; j++) {
        let distance = 0;
        
        paramNames.forEach(param => {
          const [min, max] = this.bounds[param];
          const range = max - min;
          const diff = (this.swarm[i].position[param] - this.swarm[j].position[param]) / range;
          distance += diff * diff;
        });
        
        totalDistance += Math.sqrt(distance);
        pairCount++;
      }
    }

    return pairCount > 0 ? totalDistance / pairCount : 0;
  }

  /**
   * 停滞検出と回避
   */
  handleStagnation() {
    const recentHistory = this.fitnessHistory.slice(-this.options.stagnationLimit);
    
    if (recentHistory.length >= this.options.stagnationLimit) {
      const improvements = recentHistory.filter((current, i) => {
        if (i === 0) return false;
        return current.best > recentHistory[i - 1].best;
      });

      if (improvements.length === 0) {
        this.stagnationCounter++;
        
        // 停滞回避：下位パーティクルの再初期化
        const sortedParticles = this.swarm.slice()
          .sort((a, b) => b.fitness - a.fitness);
        
        const resetCount = Math.floor(this.options.swarmSize * 0.3);
        for (let i = this.options.swarmSize - resetCount; i < this.options.swarmSize; i++) {
          sortedParticles[i].reset();
          sortedParticles[i].updateFitness(this.objectiveFunction);
        }
      } else {
        this.stagnationCounter = 0;
      }
    }
  }

  /**
   * 適応的パラメータ調整
   */
  adaptParameters() {
    if (!this.options.adaptiveParameters) return;

    const diversity = this.calculateSwarmDiversity();
    const improvementRate = this.calculateImprovementRate();

    // 多様性が低い場合、探索を強化
    if (diversity < 0.1) {
      this.options.c1 = Math.min(3.0, this.options.c1 * 1.1);
      this.options.c2 = Math.max(1.0, this.options.c2 * 0.9);
    }

    // 改善率が低い場合、開発を強化
    if (improvementRate < 0.1) {
      this.options.c1 = Math.max(1.0, this.options.c1 * 0.9);
      this.options.c2 = Math.min(3.0, this.options.c2 * 1.1);
    }
  }

  /**
   * 改善率の計算
   */
  calculateImprovementRate() {
    if (this.fitnessHistory.length < 10) return 1;

    const recent = this.fitnessHistory.slice(-10);
    const improvements = recent.filter((current, i) => {
      if (i === 0) return false;
      return current.best > recent[i - 1].best;
    });

    return improvements.length / recent.length;
  }

  /**
   * 収束判定
   */
  checkConvergence() {
    if (this.fitnessHistory.length < 5) return false;

    const recent = this.fitnessHistory.slice(-5);
    const variance = this.calculateVariance(recent.map(h => h.best));

    return variance < this.options.convergenceThreshold;
  }

  /**
   * 分散の計算
   */
  calculateVariance(values) {
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    return variance;
  }

  /**
   * PSO最適化の実行
   */
  async optimize() {
    if (!this.objectiveFunction || Object.keys(this.bounds).length === 0) {
      throw new Error('Objective function and bounds must be set before optimization');
    }

    this.iteration = 0;
    this.globalBestValue = -Infinity;
    this.globalBest = null;
    this.fitnessHistory = [];
    this.diversityHistory = [];
    this.stagnationCounter = 0;

    // スワームの初期化
    this.initializeSwarm();

    // 最適化ループ
    for (let iter = 0; iter < this.options.maxIterations; iter++) {
      this.iteration = iter;

      // 慣性重みの計算
      const inertiaWeight = this.calculateInertiaWeight();

      // 各パーティクルの更新
      this.swarm.forEach(particle => {
        // 速度の更新
        particle.updateVelocity(
          this.globalBest,
          inertiaWeight,
          this.options.c1,
          this.options.c2
        );

        // 位置の更新
        particle.updatePosition();

        // 適応度の評価
        particle.updateFitness(this.objectiveFunction);

        // グローバル最良位置の更新
        if (particle.fitness > this.globalBestValue) {
          this.globalBestValue = particle.fitness;
          this.globalBest = { ...particle.position };
        }
      });

      // 統計情報の記録
      const currentBestFitness = Math.max(...this.swarm.map(p => p.fitness));
      const averageFitness = this.swarm.reduce((sum, p) => sum + p.fitness, 0) / this.swarm.length;
      const diversity = this.calculateSwarmDiversity();

      this.fitnessHistory.push({
        iteration: iter,
        best: currentBestFitness,
        average: averageFitness,
        worst: Math.min(...this.swarm.map(p => p.fitness))
      });

      this.diversityHistory.push(diversity);

      // 停滞処理
      this.handleStagnation();

      // 適応的パラメータ調整
      this.adaptParameters();

      // 収束判定
      if (this.checkConvergence()) {
        this.convergenceInfo = {
          reason: 'convergence',
          iteration: iter
        };
        break;
      }
    }

    return {
      bestParameters: this.globalBest,
      bestValue: this.globalBestValue,
      iterations: this.iteration + 1,
      fitnessHistory: this.fitnessHistory,
      diversityHistory: this.diversityHistory,
      convergenceInfo: this.convergenceInfo || {
        reason: 'max_iterations',
        iteration: this.iteration
      },
      stagnationCount: this.stagnationCounter
    };
  }

  /**
   * スワーム状態の取得
   */
  getSwarmState() {
    return {
      globalBest: this.globalBest,
      globalBestValue: this.globalBestValue,
      swarmSize: this.swarm.length,
      iteration: this.iteration,
      diversity: this.calculateSwarmDiversity(),
      averageFitness: this.swarm.reduce((sum, p) => sum + p.fitness, 0) / this.swarm.length
    };
  }
}

/**
 * マルチスワームPSO実装
 */
class MultiSwarmPSO {
  constructor(options = {}) {
    this.options = {
      numberOfSwarms: options.numberOfSwarms || 3,
      swarmSize: options.swarmSize || 20,
      migrationInterval: options.migrationInterval || 10,
      migrationRate: options.migrationRate || 0.1,
      ...options
    };

    this.swarms = [];
    this.globalBest = null;
    this.globalBestValue = -Infinity;
    this.bounds = {};
    this.objectiveFunction = null;
  }

  /**
   * 目的関数と境界の設定
   */
  setObjective(objectiveFunction, bounds) {
    this.objectiveFunction = objectiveFunction;
    this.bounds = bounds;
  }

  /**
   * マルチスワームの初期化
   */
  initializeSwarms() {
    this.swarms = [];

    for (let i = 0; i < this.options.numberOfSwarms; i++) {
      const swarmOptions = {
        ...this.options,
        swarmSize: this.options.swarmSize
      };

      const swarm = new ParticleSwarmOptimization(swarmOptions);
      swarm.setObjective(this.objectiveFunction, this.bounds);
      swarm.initializeSwarm();

      // 各スワームの最良解をチェック
      if (swarm.globalBestValue > this.globalBestValue) {
        this.globalBestValue = swarm.globalBestValue;
        this.globalBest = { ...swarm.globalBest };
      }

      this.swarms.push(swarm);
    }
  }

  /**
   * スワーム間の移住
   */
  performMigration() {
    const migrantCount = Math.floor(this.options.swarmSize * this.options.migrationRate);

    for (let i = 0; i < this.swarms.length; i++) {
      const sourceSwarm = this.swarms[i];
      const targetSwarm = this.swarms[(i + 1) % this.swarms.length];

      // 最良パーティクルの選択
      const sortedParticles = sourceSwarm.swarm.slice()
        .sort((a, b) => b.fitness - a.fitness);

      // 移住の実行
      for (let j = 0; j < migrantCount; j++) {
        const migrant = sortedParticles[j];
        const targetIndex = targetSwarm.swarm.length - 1 - j;

        if (targetIndex >= 0) {
          // 位置と速度をコピー
          targetSwarm.swarm[targetIndex].position = { ...migrant.position };
          targetSwarm.swarm[targetIndex].velocity = { ...migrant.velocity };
          targetSwarm.swarm[targetIndex].updateFitness(this.objectiveFunction);
        }
      }
    }
  }

  /**
   * マルチスワーム最適化の実行
   */
  async optimize() {
    if (!this.objectiveFunction || Object.keys(this.bounds).length === 0) {
      throw new Error('Objective function and bounds must be set before optimization');
    }

    this.initializeSwarms();

    const maxIterations = this.options.maxIterations || 100;
    let iteration = 0;

    while (iteration < maxIterations) {
      // 各スワームを1イテレーション実行
      for (const swarm of this.swarms) {
        swarm.iteration = iteration;
        
        // スワーム内最適化
        const inertiaWeight = swarm.calculateInertiaWeight();

        swarm.swarm.forEach(particle => {
          particle.updateVelocity(
            swarm.globalBest,
            inertiaWeight,
            swarm.options.c1,
            swarm.options.c2
          );
          particle.updatePosition();
          particle.updateFitness(this.objectiveFunction);

          // スワーム内最良解の更新
          if (particle.fitness > swarm.globalBestValue) {
            swarm.globalBestValue = particle.fitness;
            swarm.globalBest = { ...particle.position };
          }

          // グローバル最良解の更新
          if (particle.fitness > this.globalBestValue) {
            this.globalBestValue = particle.fitness;
            this.globalBest = { ...particle.position };
          }
        });
      }

      // 移住の実行
      if (iteration % this.options.migrationInterval === 0 && iteration > 0) {
        this.performMigration();
      }

      iteration++;
    }

    // 最良スワームの結果を返す
    const bestSwarm = this.swarms.reduce((best, current) => 
      current.globalBestValue > best.globalBestValue ? current : best
    );

    return {
      bestParameters: this.globalBest,
      bestValue: this.globalBestValue,
      iterations: iteration,
      swarmResults: this.swarms.map(swarm => ({
        bestValue: swarm.globalBestValue,
        bestParameters: swarm.globalBest
      })),
      convergenceInfo: {
        reason: 'max_iterations',
        iteration
      }
    };
  }
}

module.exports = {
  ParticleSwarmOptimization,
  MultiSwarmPSO,
  Particle
};