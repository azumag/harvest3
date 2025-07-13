/**
 * 統合最適化インターフェース
 * ベイズ最適化、遺伝的アルゴリズム、粒子群最適化を統合
 */

const { BayesianOptimization } = require('./bayesian');
const { GeneticAlgorithm, MultiObjectiveGA } = require('./genetic');
const { ParticleSwarmOptimization, MultiSwarmPSO } = require('./pso');

class AdvancedOptimizer {
  constructor(options = {}) {
    this.options = {
      algorithm: options.algorithm || 'auto', // 'bayesian', 'genetic', 'pso', 'auto', 'ensemble'
      maxEvaluations: options.maxEvaluations || 100,
      timeLimit: options.timeLimit || 300, // 秒
      convergenceThreshold: options.convergenceThreshold || 1e-6,
      ...options
    };

    this.algorithms = {
      bayesian: null,
      genetic: null,
      pso: null
    };

    this.bounds = {};
    this.objectiveFunction = null;
    this.results = {};
    this.bestResult = null;
  }

  /**
   * 目的関数と境界の設定
   */
  setObjective(objectiveFunction, bounds) {
    this.objectiveFunction = objectiveFunction;
    this.bounds = bounds;
  }

  /**
   * アルゴリズムの初期化
   */
  initializeAlgorithms() {
    const dimension = Object.keys(this.bounds).length;
    const evaluationBudget = this.options.maxEvaluations;

    // ベイズ最適化
    this.algorithms.bayesian = new BayesianOptimization({
      maxIterations: Math.floor(evaluationBudget * 0.4),
      acquisitionFunction: 'ei',
      explorationWeight: 0.1
    });

    // 遺伝的アルゴリズム  
    this.algorithms.genetic = new GeneticAlgorithm({
      populationSize: Math.min(50, Math.max(20, dimension * 2)),
      generations: Math.floor(evaluationBudget / (dimension * 2)),
      crossoverRate: 0.8,
      mutationRate: 0.1,
      eliteSize: 2
    });

    // 粒子群最適化
    this.algorithms.pso = new ParticleSwarmOptimization({
      swarmSize: Math.min(30, Math.max(15, dimension * 1.5)),
      maxIterations: Math.floor(evaluationBudget / (dimension * 1.5)),
      inertiaWeight: 0.9,
      c1: 2.0,
      c2: 2.0,
      adaptiveParameters: true
    });

    // 各アルゴリズムに目的関数と境界を設定
    Object.values(this.algorithms).forEach(algorithm => {
      algorithm.setObjective(this.objectiveFunction, this.bounds);
    });
  }

  /**
   * 自動アルゴリズム選択
   */
  selectAlgorithm() {
    const dimension = Object.keys(this.bounds).length;
    const evaluationBudget = this.options.maxEvaluations;

    // 次元数と評価回数に基づく選択ルール
    if (dimension <= 5 && evaluationBudget >= 50) {
      return 'bayesian'; // 低次元で十分な評価回数がある場合
    } else if (dimension > 10 && evaluationBudget >= 100) {
      return 'genetic'; // 高次元の場合
    } else if (dimension <= 15 && evaluationBudget >= 80) {
      return 'pso'; // 中次元の場合
    } else {
      // 制約が厳しい場合は最も効率的なアルゴリズムを選択
      return evaluationBudget < 50 ? 'pso' : 'genetic';
    }
  }

  /**
   * 単一アルゴリズムでの最適化
   */
  async optimizeSingle(algorithmName) {
    if (!this.algorithms[algorithmName]) {
      throw new Error(`Unknown algorithm: ${algorithmName}`);
    }

    const startTime = Date.now();
    const algorithm = this.algorithms[algorithmName];

    try {
      const result = await algorithm.optimize();
      const endTime = Date.now();

      return {
        ...result,
        algorithmType: algorithmName,
        executionTime: (endTime - startTime) / 1000,
        success: true
      };
    } catch (error) {
      return {
        algorithmType: algorithmName,
        error: error.message,
        success: false,
        bestParameters: null,
        bestValue: -Infinity
      };
    }
  }

  /**
   * アンサンブル最適化
   */
  async optimizeEnsemble() {
    const results = {};
    const algorithmNames = ['bayesian', 'genetic', 'pso'];

    // 各アルゴリズムを並列実行
    const promises = algorithmNames.map(async (name) => {
      const result = await this.optimizeSingle(name);
      results[name] = result;
      return result;
    });

    await Promise.all(promises);

    // 最良結果の選択
    const validResults = Object.values(results).filter(r => r.success);
    
    if (validResults.length === 0) {
      throw new Error('All algorithms failed to optimize');
    }

    const bestResult = validResults.reduce((best, current) => 
      current.bestValue > best.bestValue ? current : best
    );

    return {
      ...bestResult,
      algorithmType: 'ensemble',
      allResults: results,
      consensus: this.calculateConsensus(validResults)
    };
  }

  /**
   * 結果の合意計算
   */
  calculateConsensus(results) {
    if (results.length < 2) return null;

    const paramNames = Object.keys(this.bounds);
    const consensus = {};
    const confidence = {};

    paramNames.forEach(param => {
      const values = results.map(r => r.bestParameters[param]).filter(v => v !== undefined);
      
      if (values.length > 0) {
        // 平均値と分散を計算
        const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
        const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
        
        consensus[param] = mean;
        confidence[param] = 1 / (1 + variance); // 分散が小さいほど信頼度が高い
      }
    });

    return { consensus, confidence };
  }

  /**
   * ハイブリッド最適化（逐次実行）
   */
  async optimizeHybrid() {
    const results = [];
    
    // 1. PSO で大域的探索
    console.log('Phase 1: PSO大域的探索');
    const psoResult = await this.optimizeSingle('pso');
    results.push(psoResult);

    // 2. PSO結果を初期点としてベイズ最適化で精密化
    if (psoResult.success) {
      console.log('Phase 2: ベイズ最適化による精密化');
      
      // ベイズ最適化の初期サンプルにPSO結果を含める
      const bayesianAlgorithm = this.algorithms.bayesian;
      
      // PSO結果周辺の探索に集中
      const focusedBounds = this.createFocusedBounds(psoResult.bestParameters, 0.2);
      bayesianAlgorithm.setObjective(this.objectiveFunction, focusedBounds);
      
      const bayesianResult = await this.optimizeSingle('bayesian');
      results.push(bayesianResult);
    }

    // 3. 遺伝的アルゴリズムで最終検証
    console.log('Phase 3: GA最終検証');
    const gaResult = await this.optimizeSingle('genetic');
    results.push(gaResult);

    // 最良結果の選択
    const validResults = results.filter(r => r.success);
    const bestResult = validResults.reduce((best, current) => 
      current.bestValue > best.bestValue ? current : best
    );

    return {
      ...bestResult,
      algorithmType: 'hybrid',
      phaseResults: results
    };
  }

  /**
   * 集中探索用の境界作成
   */
  createFocusedBounds(centerPoint, focusRadius) {
    const focusedBounds = {};
    
    Object.entries(this.bounds).forEach(([param, [min, max]]) => {
      const center = centerPoint[param];
      const range = max - min;
      const focusRange = range * focusRadius;
      
      focusedBounds[param] = [
        Math.max(min, center - focusRange / 2),
        Math.min(max, center + focusRange / 2)
      ];
    });

    return focusedBounds;
  }

  /**
   * メイン最適化実行
   */
  async optimize() {
    if (!this.objectiveFunction || Object.keys(this.bounds).length === 0) {
      throw new Error('Objective function and bounds must be set before optimization');
    }

    this.initializeAlgorithms();

    const startTime = Date.now();
    let result;

    try {
      switch (this.options.algorithm) {
      case 'bayesian':
        result = await this.optimizeSingle('bayesian');
        break;
      case 'genetic':
        result = await this.optimizeSingle('genetic');
        break;
      case 'pso':
        result = await this.optimizeSingle('pso');
        break;
      case 'ensemble':
        result = await this.optimizeEnsemble();
        break;
      case 'hybrid':
        result = await this.optimizeHybrid();
        break;
      case 'auto':
        const selectedAlgorithm = this.selectAlgorithm();
        console.log(`自動選択されたアルゴリズム: ${selectedAlgorithm}`);
        result = await this.optimizeSingle(selectedAlgorithm);
        break;
      default:
        throw new Error(`Unknown algorithm: ${this.options.algorithm}`);
      }

      const endTime = Date.now();
      result.totalExecutionTime = (endTime - startTime) / 1000;

      this.bestResult = result;
      return result;

    } catch (error) {
      throw new Error(`Optimization failed: ${error.message}`);
    }
  }

  /**
   * バックテスト用の最適化設定
   */
  configureForBacktest(retryCount = 0, parameterCount = 5) {
    // リトライ回数に応じて戦略を調整
    if (retryCount === 0) {
      this.options.algorithm = 'auto';
      this.options.maxEvaluations = Math.max(50, parameterCount * 10);
    } else if (retryCount === 1) {
      this.options.algorithm = 'pso';
      this.options.maxEvaluations = Math.max(60, parameterCount * 12);
    } else if (retryCount === 2) {
      this.options.algorithm = 'genetic';
      this.options.maxEvaluations = Math.max(80, parameterCount * 15);
    } else {
      this.options.algorithm = 'hybrid';
      this.options.maxEvaluations = Math.max(100, parameterCount * 20);
    }

    // より探索的なパラメータに調整
    if (retryCount > 1) {
      this.options.convergenceThreshold = this.options.convergenceThreshold * 10;
    }
  }

  /**
   * 結果の品質評価
   */
  evaluateResultQuality(result) {
    const quality = {
      score: 0,
      confidence: 0,
      reliability: 0,
      explanation: []
    };

    // 適応度による評価
    if (result.bestValue > 10000) { // 初期資金を上回る
      quality.score += 0.4;
      quality.explanation.push('利益を生成');
    }

    // 収束情報による評価
    if (result.convergenceInfo) {
      if (result.convergenceInfo.reason === 'convergence') {
        quality.confidence += 0.3;
        quality.explanation.push('適切な収束');
      }
      
      if (result.convergenceInfo.improvementRate > 0.1) {
        quality.reliability += 0.3;
        quality.explanation.push('良好な改善率');
      }
    }

    // アルゴリズム固有の評価
    if (result.algorithmType === 'ensemble' && result.consensus) {
      const avgConfidence = Object.values(result.consensus.confidence)
        .reduce((sum, conf) => sum + conf, 0) / Object.keys(result.consensus.confidence).length;
      
      quality.confidence += avgConfidence * 0.4;
      quality.explanation.push('アンサンブル合意');
    }

    quality.overall = (quality.score + quality.confidence + quality.reliability) / 3;
    return quality;
  }
}

/**
 * バックテスト特化型最適化クラス
 */
class BacktestOptimizer extends AdvancedOptimizer {
  constructor(options = {}) {
    super({
      algorithm: 'auto',
      maxEvaluations: 60,
      convergenceThreshold: 1e-4,
      ...options
    });
  }

  /**
   * パラメータ組み合わせの生成（既存インターフェース互換）
   */
  generateParameterCombinations(defaultConfig, numericKeys, variationRange = 0.1, count = 50) {
    // 境界の設定
    const bounds = {};
    numericKeys.forEach(key => {
      const defaultValue = defaultConfig[key];
      const range = defaultValue * variationRange;
      bounds[key] = [
        Math.max(1, Math.floor(defaultValue - range)),
        Math.ceil(defaultValue + range)
      ];
    });

    this.setObjective(
      (params) => this.evaluateParameterCombination(params),
      bounds
    );

    return this.generateCombinationsFromBounds(bounds, count);
  }

  /**
   * 境界からパラメータ組み合わせを生成
   */
  generateCombinationsFromBounds(bounds, count) {
    const combinations = [];
    const paramNames = Object.keys(bounds);

    for (let i = 0; i < count; i++) {
      const combination = {};
      
      paramNames.forEach(param => {
        const [min, max] = bounds[param];
        combination[param] = Math.floor(min + Math.random() * (max - min + 1));
      });

      combinations.push(combination);
    }

    return combinations;
  }

  /**
   * パラメータ組み合わせの評価（プレースホルダー）
   */
  evaluateParameterCombination(params) {
    // 実際の評価は外部から注入される目的関数で行う
    return Math.random() * 1000 + 10000; // ダミー値
  }

  /**
   * 最適化実行（既存インターフェース互換）
   */
  async optimizeParameters(objectiveFunction, defaultConfig, numericKeys, options = {}) {
    const variationRange = options.variationRange || (0.1 + (options.retryCount || 0) * 0.1);
    const evaluationCount = options.evaluationCount || Math.max(50, numericKeys.length * 10);

    // 境界の設定
    const bounds = {};
    numericKeys.forEach(key => {
      const defaultValue = defaultConfig[key];
      const range = defaultValue * variationRange;
      bounds[key] = [
        Math.max(1, Math.floor(defaultValue - range)),
        Math.ceil(defaultValue + range)
      ];
    });

    this.setObjective(objectiveFunction, bounds);
    this.configureForBacktest(options.retryCount || 0, numericKeys.length);
    this.options.maxEvaluations = evaluationCount;

    const result = await this.optimize();

    return {
      bestParameters: result.bestParameters,
      bestValue: result.bestValue,
      evaluations: result.evaluations || evaluationCount,
      algorithmUsed: result.algorithmType,
      quality: this.evaluateResultQuality(result)
    };
  }
}

module.exports = {
  AdvancedOptimizer,
  BacktestOptimizer,
  BayesianOptimization,
  GeneticAlgorithm,
  ParticleSwarmOptimization
};