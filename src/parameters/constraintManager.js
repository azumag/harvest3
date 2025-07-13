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

      // 安全な式評価を実行（eval()を使わない）
      return this.safeEvaluateExpression(expression);
    } catch (error) {
      console.warn(`制約式評価エラー: ${constraint}`, error);
      return false;
    }
  }

  /**
   * 安全な式評価（eval()を使わない実装）
   * @param {string} expression 評価する式
   * @returns {boolean} 評価結果
   */
  safeEvaluateExpression(expression) {
    // 許可される文字のみをチェック
    const allowedChars = /^[\d\s+\-*\/().<>=!&|]+$/;
    if (!allowedChars.test(expression)) {
      console.warn(`不正な文字が含まれています: ${expression}`);
      return false;
    }

    // 基本的な数学・比較演算をサポート
    try {
      // シンプルな比較演算の解析
      const comparisonOperators = ['>=', '<=', '>', '<', '==', '!='];
      
      for (const op of comparisonOperators) {
        if (expression.includes(op)) {
          const parts = expression.split(op).map(part => part.trim());
          if (parts.length === 2) {
            const left = this.evaluateMathExpression(parts[0]);
            const right = this.evaluateMathExpression(parts[1]);
            
            switch (op) {
              case '>=': return left >= right;
              case '<=': return left <= right;
              case '>': return left > right;
              case '<': return left < right;
              case '==': return left === right;
              case '!=': return left !== right;
            }
          }
        }
      }

      // 単純な数学式として評価
      const result = this.evaluateMathExpression(expression);
      return Boolean(result);
    } catch (error) {
      console.warn(`式評価エラー: ${expression}`, error);
      return false;
    }
  }

  /**
   * 数学式を安全に評価
   * @param {string} expr 数学式
   * @returns {number} 計算結果
   */
  evaluateMathExpression(expr) {
    // 空白を除去
    expr = expr.replace(/\s/g, '');
    
    // 数値のみの場合
    if (/^\d+(\.\d+)?$/.test(expr)) {
      return parseFloat(expr);
    }

    // 基本的な四則演算をサポート
    // より複雑な式については追加実装が必要だが、
    // 現在の制約式は比較的シンプルなので十分
    
    // 括弧の処理
    while (expr.includes('(')) {
      const innerMost = expr.match(/\([^()]+\)/);
      if (!innerMost) break;
      
      const innerExpr = innerMost[0].slice(1, -1);
      const innerResult = this.evaluateMathExpression(innerExpr);
      expr = expr.replace(innerMost[0], innerResult.toString());
    }

    // 乗除の処理
    expr = expr.replace(/(\d+(?:\.\d+)?)\s*([*/])\s*(\d+(?:\.\d+)?)/g, (match, a, op, b) => {
      const numA = parseFloat(a);
      const numB = parseFloat(b);
      return op === '*' ? (numA * numB).toString() : (numA / numB).toString();
    });

    // 加減の処理
    expr = expr.replace(/(\d+(?:\.\d+)?)\s*([+-])\s*(\d+(?:\.\d+)?)/g, (match, a, op, b) => {
      const numA = parseFloat(a);
      const numB = parseFloat(b);
      return op === '+' ? (numA + numB).toString() : (numA - numB).toString();
    });

    return parseFloat(expr) || 0;
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
    let consecutiveFailures = 0;
    const maxConsecutiveFailures = count * 2; // 連続失敗の上限

    while (combinations.length < count && attempts < maxAttempts) {
      const candidate = this.generateCandidate(constraint.parameters);
      if (this.validateCombination(candidate, strategyType)) {
        combinations.push(candidate);
        consecutiveFailures = 0; // 成功時はリセット
      } else {
        consecutiveFailures++;
        // 連続失敗が多い場合は早期終了
        if (consecutiveFailures > maxConsecutiveFailures) {
          console.warn(`制約が厳しすぎて有効なパラメータが生成できません: ${strategyType}`);
          break;
        }
      }
      attempts++;
    }

    if (combinations.length === 0) {
      console.warn(`有効なパラメータが1つも生成できませんでした: ${strategyType}`);
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
        // 浮動小数点精度問題を回避するため、整数計算で実装
        const minSteps = Math.round(paramConfig.min / step);
        const maxSteps = Math.round(paramConfig.max / step);
        const randomSteps = Math.floor(Math.random() * (maxSteps - minSteps + 1)) + minSteps;
        
        // 値を再構成し、指定された桁数で丸める
        const value = randomSteps * step;
        const decimals = (step.toString().split('.')[1] || '').length;
        candidate[paramName] = Number(value.toFixed(decimals));
        
        // 範囲チェック（浮動小数点誤差対策）
        candidate[paramName] = Math.max(paramConfig.min, 
          Math.min(paramConfig.max, candidate[paramName]));
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