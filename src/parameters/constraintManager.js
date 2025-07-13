/**
 * パラメータ制約管理システム
 * 戦略固有のパラメータ制約とバリデーションを管理
 */

/**
 * 戦略別パラメータ制約定義
 */
const STRATEGY_CONSTRAINTS = {
  'MA_CROSS': {
    parameters: {
      shortPeriod: { min: 3, max: 50, type: 'integer' },
      longPeriod: { min: 10, max: 200, type: 'integer' }
    },
    constraints: [
      'shortPeriod < longPeriod',
      'longPeriod / shortPeriod >= 1.5'
    ]
  },
  'MACD': {
    parameters: {
      fastPeriod: { min: 5, max: 30, type: 'integer' },
      slowPeriod: { min: 15, max: 100, type: 'integer' },
      signalPeriod: { min: 5, max: 30, type: 'integer' }
    },
    constraints: [
      'fastPeriod < slowPeriod',
      'slowPeriod / fastPeriod >= 1.5',
      'signalPeriod >= 3'
    ]
  },
  'RSI': {
    parameters: {
      period: { min: 5, max: 30, type: 'integer' },
      oversoldThreshold: { min: 10, max: 40, type: 'integer' },
      overboughtThreshold: { min: 60, max: 90, type: 'integer' }
    },
    constraints: [
      'overboughtThreshold > oversoldThreshold + 20',
      'oversoldThreshold >= 10',
      'overboughtThreshold <= 90'
    ]
  },
  'BOLLINGER_BANDS': {
    parameters: {
      period: { min: 10, max: 50, type: 'integer' },
      standardDeviation: { min: 1.0, max: 3.0, type: 'float', step: 0.1 }
    },
    constraints: [
      'period >= 10',
      'standardDeviation >= 1.0',
      'standardDeviation <= 3.0'
    ]
  }
};

/**
 * パラメータ制約エンジン
 */
class ParameterConstraintEngine {
  constructor() {
    this.constraints = STRATEGY_CONSTRAINTS;
  }

  /**
   * 戦略の制約定義を取得
   * @param {string} strategyType 戦略タイプ
   * @returns {Object|null} 制約定義
   */
  getStrategyConstraints(strategyType) {
    return this.constraints[strategyType] || null;
  }

  /**
   * パラメータ組み合わせの妥当性を検証
   * @param {Object} params パラメータ組み合わせ
   * @param {string} strategyType 戦略タイプ
   * @returns {boolean} 妥当性
   */
  validateCombination(params, strategyType) {
    const constraint = this.getStrategyConstraints(strategyType);
    if (!constraint) {
      return true; // 制約定義がない場合は通す
    }

    // パラメータ範囲の検証
    for (const [paramName, paramConfig] of Object.entries(constraint.parameters)) {
      const value = params[paramName];
      if (value === undefined || value === null) {
        continue; // パラメータが存在しない場合はスキップ
      }

      if (value < paramConfig.min || value > paramConfig.max) {
        return false;
      }

      // 型チェック
      if (paramConfig.type === 'integer' && !Number.isInteger(value)) {
        return false;
      }
    }

    // 制約式の検証
    return constraint.constraints.every(constraintExpr => 
      this.evaluateConstraint(params, constraintExpr)
    );
  }

  /**
   * 制約式を評価
   * @param {Object} params パラメータ
   * @param {string} constraint 制約式
   * @returns {boolean} 制約満足結果
   */
  evaluateConstraint(params, constraint) {
    try {
      // 安全な式評価のため、パラメータ名を値に置換
      let expression = constraint;
      
      // パラメータ名を値に置換
      for (const [key, value] of Object.entries(params)) {
        const regex = new RegExp(`\\b${key}\\b`, 'g');
        expression = expression.replace(regex, value.toString());
      }

      // 安全な演算子のみ許可
      const safeExpression = /^[\d\s+\-*\/().<>=!&|]+$/.test(expression);
      if (!safeExpression) {
        console.warn(`不正な制約式: ${constraint}`);
        return false;
      }

      // eslint-disable-next-line no-eval
      return eval(expression);
    } catch (error) {
      console.warn(`制約式評価エラー: ${constraint}`, error);
      return false;
    }
  }

  /**
   * 有効なパラメータ組み合わせを生成
   * @param {string} strategyType 戦略タイプ
   * @param {number} count 生成数
   * @returns {Array} 有効なパラメータ組み合わせ配列
   */
  generateValidCombinations(strategyType, count = 50) {
    const constraint = this.getStrategyConstraints(strategyType);
    if (!constraint) {
      return [];
    }

    const combinations = [];
    let attempts = 0;
    const maxAttempts = count * 20; // 十分な試行回数を確保

    while (combinations.length < count && attempts < maxAttempts) {
      const candidate = this.generateCandidate(constraint.parameters);
      if (this.validateCombination(candidate, strategyType)) {
        combinations.push(candidate);
      }
      attempts++;
    }

    return combinations;
  }

  /**
   * 候補パラメータを生成
   * @param {Object} parameterDefs パラメータ定義
   * @returns {Object} 候補パラメータ
   */
  generateCandidate(parameterDefs) {
    const candidate = {};

    for (const [paramName, paramConfig] of Object.entries(parameterDefs)) {
      if (paramConfig.type === 'integer') {
        candidate[paramName] = Math.floor(
          Math.random() * (paramConfig.max - paramConfig.min + 1) + paramConfig.min
        );
      } else if (paramConfig.type === 'float') {
        const step = paramConfig.step || 0.1;
        const range = (paramConfig.max - paramConfig.min) / step;
        const randomStep = Math.floor(Math.random() * (range + 1));
        candidate[paramName] = Number((paramConfig.min + randomStep * step).toFixed(2));
      }
    }

    return candidate;
  }

  /**
   * パラメータの品質指標を計算
   * @param {Array} parameterSet パラメータセット
   * @param {string} strategyType 戦略タイプ
   * @returns {Object} 品質指標
   */
  calculateParameterQuality(parameterSet, strategyType) {
    const constraint = this.getStrategyConstraints(strategyType);
    if (!constraint || parameterSet.length === 0) {
      return {
        validity: 0,
        diversity: 0,
        coverage: 0,
        efficiency: 0
      };
    }

    // 妥当性: 制約を満たすパラメータの割合
    const validCount = parameterSet.filter(params => 
      this.validateCombination(params, strategyType)
    ).length;
    const validity = validCount / parameterSet.length;

    // 多様性: パラメータ値の分散
    const diversity = this.calculateParameterDiversity(parameterSet, constraint.parameters);

    // カバー率: パラメータ空間のカバー率
    const coverage = this.assessParameterSpaceCoverage(parameterSet, constraint.parameters);

    // 効率性: 有効なパラメータ生成の効率
    const efficiency = validity;

    return {
      validity,
      diversity,
      coverage,
      efficiency
    };
  }

  /**
   * パラメータの多様性を計算
   * @param {Array} parameterSet パラメータセット
   * @param {Object} parameterDefs パラメータ定義
   * @returns {number} 多様性スコア (0-1)
   */
  calculateParameterDiversity(parameterSet, parameterDefs) {
    if (parameterSet.length === 0) return 0;

    const paramNames = Object.keys(parameterDefs);
    let totalVariance = 0;

    for (const paramName of paramNames) {
      const values = parameterSet.map(params => params[paramName]).filter(v => v !== undefined);
      if (values.length === 0) continue;

      const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
      const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
      
      // 正規化された分散
      const paramRange = parameterDefs[paramName].max - parameterDefs[paramName].min;
      const normalizedVariance = variance / Math.pow(paramRange, 2);
      
      totalVariance += normalizedVariance;
    }

    return Math.min(1, totalVariance / paramNames.length);
  }

  /**
   * パラメータ空間のカバー率を評価
   * @param {Array} parameterSet パラメータセット
   * @param {Object} parameterDefs パラメータ定義
   * @returns {number} カバー率スコア (0-1)
   */
  assessParameterSpaceCoverage(parameterSet, parameterDefs) {
    if (parameterSet.length === 0) return 0;

    const paramNames = Object.keys(parameterDefs);
    let totalCoverage = 0;

    for (const paramName of paramNames) {
      const values = parameterSet.map(params => params[paramName]).filter(v => v !== undefined);
      if (values.length === 0) continue;

      const min = Math.min(...values);
      const max = Math.max(...values);
      const paramRange = parameterDefs[paramName].max - parameterDefs[paramName].min;
      const coverage = (max - min) / paramRange;
      
      totalCoverage += Math.min(1, coverage);
    }

    return totalCoverage / paramNames.length;
  }
}

module.exports = {
  ParameterConstraintEngine,
  STRATEGY_CONSTRAINTS
};