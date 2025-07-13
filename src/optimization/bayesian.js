/**
 * ベイズ最適化インターフェース
 * 既存のbayesianOptimizer.jsをラップして統一インターフェースを提供
 */

const { BayesianOptimizer } = require('../strategies/utils/bayesianOptimizer');

class BayesianOptimization {
  constructor(options = {}) {
    this.options = {
      acquisitionFunction: options.acquisitionFunction || 'ei',
      kernelType: options.kernelType || 'rbf',
      initialSamples: options.initialSamples || 5,
      maxIterations: options.maxIterations || 50,
      explorationWeight: options.explorationWeight || 0.1,
      ...options
    };

    this.optimizer = new BayesianOptimizer(this.options);
    this.bounds = {};
    this.objectiveFunction = null;
  }

  /**
   * 目的関数と境界の設定
   */
  setObjective(objectiveFunction, bounds) {
    this.objectiveFunction = objectiveFunction;
    this.bounds = bounds;
    this.optimizer.setObjective(objectiveFunction, bounds);
  }

  /**
   * 制約の追加
   */
  addConstraints(constraints) {
    this.optimizer.addConstraints(constraints);
  }

  /**
   * 獲得関数の設定
   */
  setAcquisitionFunction(acquisitionFunction) {
    this.optimizer.setAcquisitionFunction(acquisitionFunction);
  }

  /**
   * ベイズ最適化の実行
   */
  async optimize() {
    if (!this.objectiveFunction || Object.keys(this.bounds).length === 0) {
      throw new Error('Objective function and bounds must be set before optimization');
    }

    const result = await this.optimizer.optimize();

    return {
      bestParameters: result.bestParameters,
      bestValue: result.bestValue,
      iterations: result.iterations,
      evaluations: result.evaluations,
      convergenceInfo: result.convergenceInfo,
      algorithmType: 'bayesian'
    };
  }

  /**
   * パラメータ制約の作成ヘルパー
   */
  createParameterConstraints(parameterBounds) {
    const constraints = [];

    Object.entries(parameterBounds).forEach(([param, [min, max]]) => {
      constraints.push({
        type: 'range',
        parameter: param,
        min: min,
        max: max
      });
    });

    return constraints;
  }

  /**
   * バックテスト専用の最適化設定
   */
  configureForBacktest(retryCount = 0) {
    // リトライ回数に応じて探索の強度を調整
    const explorationBoost = 1 + (retryCount * 0.2);
    
    this.options.explorationWeight = Math.min(0.5, this.options.explorationWeight * explorationBoost);
    this.options.maxIterations = Math.max(20, this.options.maxIterations - (retryCount * 5));
    
    // より探索的な獲得関数に切り替え
    if (retryCount > 2) {
      this.setAcquisitionFunction('ucb');
    }
  }

  /**
   * パラメータの正規化
   */
  normalizeParameters(parameters) {
    const normalized = {};
    
    Object.entries(parameters).forEach(([param, value]) => {
      if (this.bounds[param]) {
        const [min, max] = this.bounds[param];
        normalized[param] = Math.max(min, Math.min(max, Math.round(value)));
      } else {
        normalized[param] = value;
      }
    });

    return normalized;
  }
}

module.exports = {
  BayesianOptimization
};