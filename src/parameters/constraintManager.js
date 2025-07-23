/**
 * パラメータ制約管理システム
 * 戦略固有のパラメータ制約とバリデーションを管理
 */

/**
 * 多様性計算用の定数
 */
const DIVERSITY_CALCULATION_WEIGHTS = {
  UNIQUENESS: 0.25,      // 一意性 25%
  COVERAGE: 0.35,        // カバー率 35% 
  DISTRIBUTION: 0.25,    // 分布均一性 25%
  SCATTER: 0.15         // 散らばり度 15%
};

/**
 * 制約エンジンの設定定数
 */
const CONSTRAINT_ENGINE_CONFIG = {
  MAX_CONSECUTIVE_FAILURES: 50,
  ATTEMPT_MULTIPLIER: 15,
  BATCH_SIZE_LIMIT: 100,
  COMPLEXITY_THRESHOLD: 0.7,
  SCATTER_MULTIPLIER: 4
};

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
      stdDev: { min: 1.0, max: 3.0, type: 'float', step: 0.1 }
    },
    constraints: [
      'period >= 10',
      'stdDev >= 1.0',
      'stdDev <= 3.0'
    ]
  },
  'MEAN_REVERSION': {
    parameters: {
      period: { min: 10, max: 50, type: 'integer' },
      deviationThreshold: { min: 1.0, max: 5.0, type: 'float', step: 0.1 }
    },
    constraints: [
      'period >= 10',
      'deviationThreshold >= 1.0',
      'deviationThreshold <= 5.0'
    ]
  },
  'OSCILLATOR': {
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
  'MUTUAL_INFORMATION': {
    parameters: {
      period: { min: 10, max: 50, type: 'integer' },
      threshold: { min: 0.1, max: 1.0, type: 'float', step: 0.05 },
      correlationWindow: { min: 20, max: 100, type: 'integer' },
      zScoreThreshold: { min: 1.0, max: 3.0, type: 'float', step: 0.1 }
    },
    constraints: [
      'period >= 10',
      'threshold >= 0.1',
      'threshold <= 1.0',
      'correlationWindow >= period',
      'zScoreThreshold >= 1.0'
    ]
  },
  'MULTI_INDICATOR': {
    parameters: {
      macdFastPeriod: { min: 5, max: 30, type: 'integer' },
      macdSlowPeriod: { min: 15, max: 100, type: 'integer' },
      macdSignalPeriod: { min: 5, max: 30, type: 'integer' },
      emaShortPeriod: { min: 3, max: 50, type: 'integer' },
      emaLongPeriod: { min: 10, max: 200, type: 'integer' },
      rsiPeriod: { min: 5, max: 30, type: 'integer' },
      adxPeriod: { min: 10, max: 30, type: 'integer' },
      volumeMAPeriod: { min: 5, max: 50, type: 'integer' }
    },
    constraints: [
      'macdFastPeriod < macdSlowPeriod',
      'macdSlowPeriod / macdFastPeriod >= 1.5',
      'macdSignalPeriod >= 3',
      'emaShortPeriod < emaLongPeriod',
      'emaLongPeriod / emaShortPeriod >= 1.5',
      'rsiPeriod >= 5',
      'adxPeriod >= 10',
      'volumeMAPeriod >= 5'
    ]
  },
  'GENERIC': {
    parameters: {
      period: { min: 5, max: 100, type: 'integer' },
      threshold: { min: 0.1, max: 5.0, type: 'float', step: 0.1 }
    },
    constraints: [
      'period >= 5',
      'threshold >= 0.1'
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
   * パラメータ定義の妥当性をチェックするヘルパーメソッド
   * @param {*} paramDefs パラメータ定義
   * @param {string} methodName 呼び出し元メソッド名
   * @param {*} defaultValue デフォルト値
   * @returns {Object} {isValid: boolean, defaultValue: any}
   */
  validateParameterDefinitions(paramDefs, methodName, defaultValue = 0) {
    if (!paramDefs || typeof paramDefs !== 'object') {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`${methodName}: paramDefs が null または無効です`);
      }
      return { isValid: false, defaultValue };
    }
    return { isValid: true };
  }

  /**
   * 戦略の制約定義を取得
   * @param {string} strategyType 戦略タイプ
   * @returns {Object|null} 制約定義
   */
  getStrategyConstraints(strategyType) {
    return this.constraints[strategyType] || this.constraints.GENERIC;
  }

  /**
   * パラメータから汎用制約を自動生成
   * @param {Object} params サンプルパラメータオブジェクト
   * @returns {Object} 汎用制約定義
   */
  generateGenericConstraints(params) {
    const parameters = {};
    const constraints = [];

    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'number' && !['ohlcvInterval', 'amount'].includes(key)) {
        if (Number.isInteger(value)) {
          parameters[key] = { 
            min: Math.max(1, Math.floor(value * 0.1)), 
            max: Math.ceil(value * 10), 
            type: 'integer' 
          };
        } else {
          parameters[key] = { 
            min: Math.max(0.1, value * 0.1), 
            max: value * 10, 
            type: 'float', 
            step: 0.1 
          };
        }
        constraints.push(`${key} >= ${parameters[key].min}`);
      }
    }

    return {
      parameters,
      constraints
    };
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
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`制約式評価エラー: ${constraint}`, error);
      }
      return false;
    }
  }

  /**
   * 安全な式評価（eval()を使わない実装）
   * @param {string} expression 評価する式
   * @returns {boolean} 評価結果
   */
  safeEvaluateExpression(expression) {
    // より厳密な許可文字パターン（セキュリティ強化）
    const allowedChars = /^[\d\s+\-*\/().<>=]+$/;
    if (!allowedChars.test(expression)) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`不正な文字が含まれています: ${expression}`);
      }
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
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`式評価エラー: ${expression}`, error);
      }
      return false;
    }
  }

  /**
   * 数学式を安全に評価
   * @param {string} expr 数学式
   * @returns {number} 計算結果
   */
  evaluateMathExpression(expr) {
    try {
      // 入力検証
      if (typeof expr !== 'string') {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`evaluateMathExpression: 無効な入力タイプ: ${typeof expr}`);
        }
        return 0;
      }

      // 空白を除去
      expr = expr.replace(/\s/g, '');
      
      // 空文字列の処理
      if (!expr) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('evaluateMathExpression: 空の式が渡されました');
        }
        return 0;
      }
      
      // 数値のみの場合
      if (/^\d+(\.\d+)?$/.test(expr)) {
        const result = parseFloat(expr);
        return isNaN(result) ? 0 : result;
      }

      // 基本的な四則演算をサポート
      // より複雑な式については追加実装が必要だが、
      // 現在の制約式は比較的シンプルなので十分
      
      // 無限ループ防止のための試行回数制限
      const maxIterations = 50;
      let iterations = 0;
      
      // 括弧の処理
      while (expr.includes('(') && iterations < maxIterations) {
        const innerMost = expr.match(/\([^()]+\)/);
        if (!innerMost) {break;}
        
        const innerExpr = innerMost[0].slice(1, -1);
        const innerResult = this.evaluateMathExpression(innerExpr);
        
        // 結果の有効性チェック
        if (isNaN(innerResult)) {
          if (process.env.NODE_ENV !== 'production') {
            console.warn(`evaluateMathExpression: 括弧内の式評価に失敗: ${innerExpr}`);
          }
          return 0;
        }
        
        expr = expr.replace(innerMost[0], innerResult.toString());
        iterations++;
      }

      // 無限ループを検出した場合の処理
      if (iterations >= maxIterations) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`evaluateMathExpression: 最大反復回数に達しました: ${expr}`);
        }
        return 0;
      }

      // 乗除の処理
      expr = expr.replace(/(\d+(?:\.\d+)?)\s*([*/])\s*(\d+(?:\.\d+)?)/g, (match, a, op, b) => {
        const numA = parseFloat(a);
        const numB = parseFloat(b);
        
        // ゼロ除算のチェック
        if (op === '/' && numB === 0) {
          if (process.env.NODE_ENV !== 'production') {
            console.warn(`evaluateMathExpression: ゼロ除算が検出されました: ${match}`);
          }
          return '0';
        }
        
        const result = op === '*' ? (numA * numB) : (numA / numB);
        return isNaN(result) ? '0' : result.toString();
      });

      // 加減の処理
      expr = expr.replace(/(\d+(?:\.\d+)?)\s*([+-])\s*(\d+(?:\.\d+)?)/g, (match, a, op, b) => {
        const numA = parseFloat(a);
        const numB = parseFloat(b);
        const result = op === '+' ? (numA + numB) : (numA - numB);
        return isNaN(result) ? '0' : result.toString();
      });

      const finalResult = parseFloat(expr);
      return isNaN(finalResult) ? 0 : finalResult;
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`evaluateMathExpression: 予期しないエラー: ${expr}`, error);
      }
      return 0;
    }
  }

  /**
   * 有効なパラメータ組み合わせを生成（パフォーマンス最適化版）
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
    const maxAttempts = count * CONSTRAINT_ENGINE_CONFIG.ATTEMPT_MULTIPLIER; // 試行回数を最適化
    let consecutiveFailures = 0;
    const maxConsecutiveFailures = Math.min(count, CONSTRAINT_ENGINE_CONFIG.MAX_CONSECUTIVE_FAILURES); // 連続失敗の上限を調整
    
    // 制約の複雑さを事前分析
    const constraintComplexity = this.analyzeConstraintComplexity(constraint);
    const shouldUseBatch = constraintComplexity > CONSTRAINT_ENGINE_CONFIG.COMPLEXITY_THRESHOLD && count > 10;

    // 複雑な制約の場合はバッチ生成を使用
    if (shouldUseBatch) {
      return this.generateValidCombinationsBatch(strategyType, count, constraint);
    }

    while (combinations.length < count && attempts < maxAttempts) {
      const candidate = this.generateCandidate(constraint.parameters);
      if (this.validateCombination(candidate, strategyType)) {
        combinations.push(candidate);
        consecutiveFailures = 0; // 成功時はリセット
      } else {
        consecutiveFailures++;
        // 連続失敗が多い場合は早期終了
        if (consecutiveFailures > maxConsecutiveFailures) {
          if (process.env.NODE_ENV !== 'production') {
            console.warn(`制約が厳しすぎて有効なパラメータが生成できません: ${strategyType}`);
          }
          break;
        }
      }
      attempts++;
    }

    if (combinations.length === 0) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`有効なパラメータが1つも生成できませんでした: ${strategyType}`);
      }
    }

    return combinations;
  }

  /**
   * 制約の複雑さを分析
   * @param {Object} constraint 制約定義
   * @returns {number} 複雑さスコア (0-1)
   */
  analyzeConstraintComplexity(constraint) {
    const constraintCount = constraint.constraints.length;
    const paramCount = Object.keys(constraint.parameters).length;
    
    // 制約あたりのパラメータ数で複雑さを評価
    const complexityScore = (constraintCount * 2) / (paramCount + 1);
    return Math.min(1, complexityScore / 3);
  }

  /**
   * バッチ生成による効率的なパラメータ生成
   * @param {string} strategyType 戦略タイプ
   * @param {number} count 生成数
   * @param {Object} constraint 制約定義
   * @returns {Array} 有効なパラメータ組み合わせ配列
   */
  generateValidCombinationsBatch(strategyType, count, constraint) {
    const combinations = [];
    const batchSize = Math.min(count * 3, CONSTRAINT_ENGINE_CONFIG.BATCH_SIZE_LIMIT); // バッチサイズを制限
    let totalAttempts = 0;
    const maxTotalAttempts = count * 10;

    while (combinations.length < count && totalAttempts < maxTotalAttempts) {
      // バッチで候補を生成
      const candidates = Array.from({ length: batchSize }, () => 
        this.generateCandidate(constraint.parameters)
      );

      // 並列でバリデーション
      const validCandidates = candidates.filter(candidate => 
        this.validateCombination(candidate, strategyType)
      );

      // 必要な数だけ追加
      const neededCount = count - combinations.length;
      combinations.push(...validCandidates.slice(0, neededCount));

      totalAttempts += batchSize;

      // 効率が悪い場合は早期終了
      if (validCandidates.length === 0 && totalAttempts > count * 5) {
        break;
      }
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

    // constraint.parameters のnullチェックを追加
    const paramValidation = this.validateParameterDefinitions(
      constraint.parameters, 
      `calculateParameterQuality (戦略: ${strategyType})`,
      {
        validity: 0,
        diversity: 0,
        coverage: 0,
        efficiency: 0
      }
    );
    if (!paramValidation.isValid) {
      return paramValidation.defaultValue;
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
    if (parameterSet.length === 0) {return 0;}
    if (parameterSet.length === 1) {return 0.1;} // 単一パラメータの場合は最小値

    // parameterDefs のnullチェックを追加
    const paramValidation = this.validateParameterDefinitions(
      parameterDefs, 
      'calculateParameterDiversity',
      0
    );
    if (!paramValidation.isValid) {
      return paramValidation.defaultValue;
    }

    const paramNames = Object.keys(parameterDefs);
    if (paramNames.length === 0) {return 0;}

    let totalDiversityScore = 0;

    for (const paramName of paramNames) {
      const values = parameterSet.map(params => params[paramName]).filter(v => v !== undefined);
      if (values.length <= 1) {continue;}

      const diversityScore = this.calculateSingleParameterDiversity(values, parameterDefs[paramName]);
      totalDiversityScore += diversityScore;
    }

    return paramNames.length > 0 ? Math.min(1, totalDiversityScore / paramNames.length) : 0;
  }

  /**
   * 単一パラメータの多様性を計算
   * @param {Array} values パラメータ値の配列
   * @param {Object} paramDef パラメータ定義
   * @returns {number} 多様性スコア (0-1)
   */
  calculateSingleParameterDiversity(values, paramDef) {
    if (values.length <= 1) {return 0;}

    const sortedValues = [...values].sort((a, b) => a - b);
    const uniqueValues = [...new Set(sortedValues)];
    
    // 1. 一意値の比率（重複を考慮）
    const uniquenessRatio = uniqueValues.length / values.length;
    
    // 2. 範囲カバー率
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const paramRange = paramDef.max - paramDef.min;
    const coverageRatio = paramRange > 0 ? (maxValue - minValue) / paramRange : 0;
    
    // 3. 分布の均一性（ヒストグラム分析）
    const distributionScore = this.calculateDistributionUniformity(uniqueValues, paramDef);
    
    // 4. 標準偏差による散らばり度
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    const normalizedStdDev = paramRange > 0 ? stdDev / paramRange : 0;
    
    // より直感的な多様性スコア計算
    // 各要素に重みを付けて組み合わせ
    const diversityScore = (
      uniquenessRatio * DIVERSITY_CALCULATION_WEIGHTS.UNIQUENESS +
      coverageRatio * DIVERSITY_CALCULATION_WEIGHTS.COVERAGE +
      distributionScore * DIVERSITY_CALCULATION_WEIGHTS.DISTRIBUTION +
      Math.min(1, normalizedStdDev * CONSTRAINT_ENGINE_CONFIG.SCATTER_MULTIPLIER) * DIVERSITY_CALCULATION_WEIGHTS.SCATTER
    );
    
    return Math.min(1, Math.max(0, diversityScore));
  }

  /**
   * パラメータ値の分布の均一性を計算
   * @param {Array} uniqueValues ユニークな値の配列（ソート済み）
   * @param {Object} paramDef パラメータ定義
   * @returns {number} 分布均一性スコア (0-1)
   */
  calculateDistributionUniformity(uniqueValues, paramDef) {
    if (uniqueValues.length <= 2) {return uniqueValues.length === 2 ? 0.5 : 0;}

    // パラメータ範囲を等分割した場合の理想的な間隔
    const paramRange = paramDef.max - paramDef.min;
    const idealInterval = paramRange / (uniqueValues.length - 1);
    
    // 実際の間隔と理想間隔の差を計算
    let totalDeviation = 0;
    for (let i = 1; i < uniqueValues.length; i++) {
      const actualInterval = uniqueValues[i] - uniqueValues[i - 1];
      const deviation = Math.abs(actualInterval - idealInterval);
      totalDeviation += deviation;
    }
    
    // 正規化（最大偏差は全体の範囲）
    const normalizedDeviation = totalDeviation / (paramRange * (uniqueValues.length - 1));
    
    // 均一性スコア（偏差が小さいほど高い）
    return Math.max(0, 1 - normalizedDeviation);
  }

  /**
   * パラメータ空間のカバー率を評価
   * @param {Array} parameterSet パラメータセット
   * @param {Object} parameterDefs パラメータ定義
   * @returns {number} カバー率スコア (0-1)
   */
  assessParameterSpaceCoverage(parameterSet, parameterDefs) {
    if (parameterSet.length === 0) {return 0;}

    // parameterDefs のnullチェックを追加
    const paramValidation = this.validateParameterDefinitions(
      parameterDefs, 
      'assessParameterSpaceCoverage',
      0
    );
    if (!paramValidation.isValid) {
      return paramValidation.defaultValue;
    }

    const paramNames = Object.keys(parameterDefs);
    
    // paramNames が空の場合、division by zero を防ぐ
    if (paramNames.length === 0) {
      return 0;
    }
    
    let totalCoverage = 0;

    for (const paramName of paramNames) {
      const values = parameterSet.map(params => params[paramName]).filter(v => v !== undefined);
      if (values.length === 0) {continue;}

      const min = Math.min(...values);
      const max = Math.max(...values);
      const paramRange = parameterDefs[paramName].max - parameterDefs[paramName].min;
      const coverage = (max - min) / paramRange;
      
      totalCoverage += Math.min(1, coverage);
    }

    return paramNames.length > 0 ? totalCoverage / paramNames.length : 0;
  }
}

module.exports = {
  ParameterConstraintEngine,
  STRATEGY_CONSTRAINTS,
  DIVERSITY_CALCULATION_WEIGHTS,
  CONSTRAINT_ENGINE_CONFIG
};