/**
 * 遺伝的アルゴリズム (Genetic Algorithm) 実装
 * パラメータ最適化のための進化計算アルゴリズム
 * 
 * 特徴:
 * - 実数値エンコーディング
 * - トーナメント選択
 * - BLX-α交叉とガウス突然変異
 * - エリート保存戦略
 * - 多様性維持機構
 */

class GeneticAlgorithm {
  constructor(options = {}) {
    this.options = {
      populationSize: options.populationSize || 50,
      generations: options.generations || 100,
      crossoverRate: options.crossoverRate || 0.8,
      mutationRate: options.mutationRate || 0.1,
      eliteSize: options.eliteSize || 2,
      tournamentSize: options.tournamentSize || 3,
      alpha: options.alpha || 0.5, // BLX-α交叉のパラメータ
      mutationStrength: options.mutationStrength || 0.1,
      diversityThreshold: options.diversityThreshold || 0.01,
      ...options
    };

    this.population = [];
    this.fitness = [];
    this.bounds = {};
    this.objectiveFunction = null;
    this.generation = 0;
    this.bestIndividual = null;
    this.bestFitness = -Infinity;
    this.fitnessHistory = [];
    this.diversityHistory = [];
  }

  /**
   * 目的関数と境界の設定
   */
  setObjective(objectiveFunction, bounds) {
    this.objectiveFunction = objectiveFunction;
    this.bounds = bounds;
  }

  /**
   * 初期集団の生成
   */
  initializePopulation() {
    this.population = [];
    const paramNames = Object.keys(this.bounds);

    for (let i = 0; i < this.options.populationSize; i++) {
      const individual = {};
      
      paramNames.forEach(param => {
        const [min, max] = this.bounds[param];
        individual[param] = min + Math.random() * (max - min);
      });

      this.population.push(individual);
    }
  }

  /**
   * 集団の適応度評価
   */
  evaluatePopulation() {
    this.fitness = this.population.map(individual => {
      try {
        return this.objectiveFunction(individual);
      } catch (error) {
        return -Infinity; // 評価失敗時は最低適応度
      }
    });

    // 最良個体の更新
    const currentBestIndex = this.fitness.indexOf(Math.max(...this.fitness));
    const currentBestFitness = this.fitness[currentBestIndex];

    if (currentBestFitness > this.bestFitness) {
      this.bestFitness = currentBestFitness;
      this.bestIndividual = { ...this.population[currentBestIndex] };
    }

    this.fitnessHistory.push({
      generation: this.generation,
      best: currentBestFitness,
      average: this.fitness.reduce((sum, f) => sum + f, 0) / this.fitness.length,
      worst: Math.min(...this.fitness)
    });
  }

  /**
   * トーナメント選択
   */
  tournamentSelection() {
    const tournamentIndices = [];
    
    for (let i = 0; i < this.options.tournamentSize; i++) {
      tournamentIndices.push(Math.floor(Math.random() * this.population.length));
    }

    let bestIndex = tournamentIndices[0];
    let bestFitness = this.fitness[bestIndex];

    for (let i = 1; i < tournamentIndices.length; i++) {
      const index = tournamentIndices[i];
      if (this.fitness[index] > bestFitness) {
        bestIndex = index;
        bestFitness = this.fitness[index];
      }
    }

    return this.population[bestIndex];
  }

  /**
   * BLX-α交叉 (Blend Crossover)
   */
  blxCrossover(parent1, parent2) {
    const child1 = {};
    const child2 = {};
    const paramNames = Object.keys(this.bounds);

    paramNames.forEach(param => {
      const p1 = parent1[param];
      const p2 = parent2[param];
      const [min, max] = this.bounds[param];

      // BLX-α交叉の計算
      const minVal = Math.min(p1, p2);
      const maxVal = Math.max(p1, p2);
      const range = maxVal - minVal;
      const alpha = this.options.alpha;

      const lowerBound = Math.max(min, minVal - alpha * range);
      const upperBound = Math.min(max, maxVal + alpha * range);

      child1[param] = lowerBound + Math.random() * (upperBound - lowerBound);
      child2[param] = lowerBound + Math.random() * (upperBound - lowerBound);
    });

    return [child1, child2];
  }

  /**
   * ガウス突然変異
   */
  gaussianMutation(individual) {
    const mutated = { ...individual };
    const paramNames = Object.keys(this.bounds);

    paramNames.forEach(param => {
      if (Math.random() < this.options.mutationRate) {
        const [min, max] = this.bounds[param];
        const range = max - min;
        const mutation = this.gaussianRandom() * this.options.mutationStrength * range;
        
        mutated[param] = Math.max(min, Math.min(max, individual[param] + mutation));
      }
    });

    return mutated;
  }

  /**
   * 標準正規分布に従う乱数生成 (Box-Muller法)
   */
  gaussianRandom() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  /**
   * エリート保存
   */
  preserveElites() {
    const elites = [];
    const sortedIndices = Array.from({ length: this.population.length }, (_, i) => i)
      .sort((a, b) => this.fitness[b] - this.fitness[a]);

    for (let i = 0; i < this.options.eliteSize; i++) {
      elites.push({ ...this.population[sortedIndices[i]] });
    }

    return elites;
  }

  /**
   * 集団の多様性計算
   */
  calculateDiversity() {
    const paramNames = Object.keys(this.bounds);
    let totalDistance = 0;
    let pairCount = 0;

    for (let i = 0; i < this.population.length; i++) {
      for (let j = i + 1; j < this.population.length; j++) {
        let distance = 0;
        
        paramNames.forEach(param => {
          const [min, max] = this.bounds[param];
          const range = max - min;
          const diff = (this.population[i][param] - this.population[j][param]) / range;
          distance += diff * diff;
        });
        
        totalDistance += Math.sqrt(distance);
        pairCount++;
      }
    }

    return pairCount > 0 ? totalDistance / pairCount : 0;
  }

  /**
   * 多様性維持のための個体再初期化
   */
  maintainDiversity() {
    const diversity = this.calculateDiversity();
    this.diversityHistory.push(diversity);

    if (diversity < this.options.diversityThreshold) {
      // 下位個体の一部を再初期化
      const sortedIndices = Array.from({ length: this.population.length }, (_, i) => i)
        .sort((a, b) => this.fitness[a] - this.fitness[b]);

      const reinitializeCount = Math.floor(this.options.populationSize * 0.2);
      const paramNames = Object.keys(this.bounds);

      for (let i = 0; i < reinitializeCount; i++) {
        const index = sortedIndices[i];
        
        paramNames.forEach(param => {
          const [min, max] = this.bounds[param];
          this.population[index][param] = min + Math.random() * (max - min);
        });
      }
    }
  }

  /**
   * 世代交代
   */
  reproduction() {
    const elites = this.preserveElites();
    const newPopulation = [...elites];

    while (newPopulation.length < this.options.populationSize) {
      const parent1 = this.tournamentSelection();
      const parent2 = this.tournamentSelection();

      if (Math.random() < this.options.crossoverRate) {
        const [child1, child2] = this.blxCrossover(parent1, parent2);
        
        newPopulation.push(this.gaussianMutation(child1));
        if (newPopulation.length < this.options.populationSize) {
          newPopulation.push(this.gaussianMutation(child2));
        }
      } else {
        newPopulation.push(this.gaussianMutation({ ...parent1 }));
        if (newPopulation.length < this.options.populationSize) {
          newPopulation.push(this.gaussianMutation({ ...parent2 }));
        }
      }
    }

    // 集団サイズを正確に維持
    this.population = newPopulation.slice(0, this.options.populationSize);
  }

  /**
   * 遺伝的アルゴリズムの実行
   */
  async optimize() {
    if (!this.objectiveFunction || Object.keys(this.bounds).length === 0) {
      throw new Error('Objective function and bounds must be set before optimization');
    }

    this.generation = 0;
    this.bestFitness = -Infinity;
    this.bestIndividual = null;
    this.fitnessHistory = [];
    this.diversityHistory = [];

    // 初期集団の生成と評価
    this.initializePopulation();
    this.evaluatePopulation();

    // 進化プロセス
    for (let gen = 0; gen < this.options.generations; gen++) {
      this.generation = gen;

      // 早期収束判定
      if (this.checkEarlyConvergence()) {
        break;
      }

      // 世代交代
      this.reproduction();

      // 適応度評価
      this.evaluatePopulation();

      // 多様性維持
      this.maintainDiversity();
    }

    return {
      bestParameters: this.bestIndividual,
      bestValue: this.bestFitness,
      generations: this.generation + 1,
      fitnessHistory: this.fitnessHistory,
      diversityHistory: this.diversityHistory,
      convergenceInfo: this.getConvergenceInfo()
    };
  }

  /**
   * 早期収束判定
   */
  checkEarlyConvergence() {
    if (this.fitnessHistory.length < 10) {
      return false;
    }

    const recent = this.fitnessHistory.slice(-10);
    const improvements = recent.filter((current, i) => {
      if (i === 0) return false;
      return current.best > recent[i - 1].best;
    });

    return improvements.length === 0;
  }

  /**
   * 収束情報の取得
   */
  getConvergenceInfo() {
    const finalDiversity = this.diversityHistory[this.diversityHistory.length - 1] || 0;
    const improvementGenerations = this.fitnessHistory.filter((current, i) => {
      if (i === 0) return true;
      return current.best > this.fitnessHistory[i - 1].best;
    }).length;

    return {
      finalDiversity,
      improvementRate: improvementGenerations / this.fitnessHistory.length,
      convergenceSpeed: this.fitnessHistory.findIndex(entry => entry.best === this.bestFitness),
      stagnationPeriod: this.fitnessHistory.length - this.fitnessHistory.findIndex(entry => entry.best === this.bestFitness) - 1
    };
  }

  /**
   * ハイパーパラメータの自動調整
   */
  autoTuneParameters() {
    const diversityTrend = this.calculateDiversityTrend();
    const improvementRate = this.calculateImprovementRate();

    // 多様性が低下している場合
    if (diversityTrend < -0.1) {
      this.options.mutationRate = Math.min(0.5, this.options.mutationRate * 1.2);
      this.options.mutationStrength = Math.min(0.3, this.options.mutationStrength * 1.1);
    }

    // 改善率が低い場合
    if (improvementRate < 0.1) {
      this.options.crossoverRate = Math.max(0.5, this.options.crossoverRate * 0.9);
      this.options.tournamentSize = Math.min(5, this.options.tournamentSize + 1);
    }
  }

  /**
   * 多様性トレンドの計算
   */
  calculateDiversityTrend() {
    if (this.diversityHistory.length < 5) return 0;

    const recent = this.diversityHistory.slice(-5);
    const slope = (recent[recent.length - 1] - recent[0]) / recent.length;
    return slope;
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
}

/**
 * 多目的遺伝的アルゴリズム (NSGA-II風実装)
 */
class MultiObjectiveGA extends GeneticAlgorithm {
  constructor(options = {}) {
    super(options);
    this.objectives = [];
    this.paretoFront = [];
    this.crowdingDistances = [];
  }

  /**
   * 多目的関数の設定
   */
  setMultiObjectives(objectives) {
    this.objectives = objectives;
  }

  /**
   * 多目的適応度評価
   */
  evaluateMultiObjective() {
    this.fitness = this.population.map(individual => {
      const objectiveValues = this.objectives.map(obj => {
        try {
          return obj.function(individual);
        } catch {
          return obj.minimize ? Infinity : -Infinity;
        }
      });
      return objectiveValues;
    });
  }

  /**
   * パレート支配関係の判定
   */
  dominates(solution1, solution2) {
    let atLeastOneBetter = false;
    
    for (let i = 0; i < this.objectives.length; i++) {
      const obj = this.objectives[i];
      const val1 = solution1[i];
      const val2 = solution2[i];

      if (obj.minimize) {
        if (val1 > val2) return false;
        if (val1 < val2) atLeastOneBetter = true;
      } else {
        if (val1 < val2) return false;
        if (val1 > val2) atLeastOneBetter = true;
      }
    }

    return atLeastOneBetter;
  }

  /**
   * 非支配ソート
   */
  nonDominatedSort() {
    const fronts = [[]];
    const dominationCounts = new Array(this.population.length).fill(0);
    const dominatedSolutions = Array(this.population.length).fill(null).map(() => []);

    // 支配関係の計算
    for (let i = 0; i < this.population.length; i++) {
      for (let j = 0; j < this.population.length; j++) {
        if (i !== j) {
          if (this.dominates(this.fitness[i], this.fitness[j])) {
            dominatedSolutions[i].push(j);
          } else if (this.dominates(this.fitness[j], this.fitness[i])) {
            dominationCounts[i]++;
          }
        }
      }

      if (dominationCounts[i] === 0) {
        fronts[0].push(i);
      }
    }

    // 後続フロントの生成
    let frontIndex = 0;
    while (fronts[frontIndex].length > 0) {
      const nextFront = [];
      
      fronts[frontIndex].forEach(i => {
        dominatedSolutions[i].forEach(j => {
          dominationCounts[j]--;
          if (dominationCounts[j] === 0) {
            nextFront.push(j);
          }
        });
      });

      if (nextFront.length > 0) {
        fronts.push(nextFront);
      }
      frontIndex++;
    }

    return fronts.filter(front => front.length > 0);
  }

  /**
   * 混雑距離の計算
   */
  calculateCrowdingDistance(front) {
    const distances = new Array(front.length).fill(0);

    for (let objIndex = 0; objIndex < this.objectives.length; objIndex++) {
      // 目的関数値でソート
      const sortedIndices = front.slice().sort((a, b) => {
        return this.fitness[a][objIndex] - this.fitness[b][objIndex];
      });

      // 境界解に無限大の距離を設定
      distances[sortedIndices.indexOf(sortedIndices[0])] = Infinity;
      distances[sortedIndices.indexOf(sortedIndices[sortedIndices.length - 1])] = Infinity;

      // 目的関数の範囲
      const objValues = front.map(i => this.fitness[i][objIndex]);
      const range = Math.max(...objValues) - Math.min(...objValues);

      if (range > 0) {
        for (let i = 1; i < sortedIndices.length - 1; i++) {
          const currentIndex = sortedIndices.indexOf(sortedIndices[i]);
          const prevValue = this.fitness[sortedIndices[i - 1]][objIndex];
          const nextValue = this.fitness[sortedIndices[i + 1]][objIndex];
          
          distances[currentIndex] += (nextValue - prevValue) / range;
        }
      }
    }

    return distances;
  }

  /**
   * パレートフロントの更新
   */
  updateParetoFront() {
    const fronts = this.nonDominatedSort();
    if (fronts.length > 0) {
      this.paretoFront = fronts[0].map(i => ({
        parameters: { ...this.population[i] },
        objectives: [...this.fitness[i]]
      }));
    }
  }
}

module.exports = {
  GeneticAlgorithm,
  MultiObjectiveGA
};