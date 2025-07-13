/**
 * 適応的パラメータ範囲調整システム
 * 過去の最適化結果に基づいてパラメータ範囲を動的に調整
 */

const { ParameterConstraintEngine } = require('./constraintManager');

/**
 * 適応的パラメータ管理システム
 */
class AdaptiveParameterManager {
  constructor(strategy, historicalResults = []) {
    this.strategy = strategy;
    this.history = historicalResults;
    this.constraintEngine = new ParameterConstraintEngine();
    this.sensitivity = this.calculateParameterSensitivity();
  }

  /**
   * パラメータ感度を計算
   * 各パラメータの変化が結果に与える影響度を分析
   * @returns {Object} パラメータ感度マップ
   */
  calculateParameterSensitivity() {
    if (this.history.length < 3) {
      return {}; // 履歴が少ない場合はデフォルト感度
    }

    const sensitivity = {};
    const constraint = this.constraintEngine.getStrategyConstraints(this.strategy);
    
    if (!constraint) {
      return {};
    }

    const paramNames = Object.keys(constraint.parameters);

    for (const paramName of paramNames) {
      sensitivity[paramName] = this.calculateSingleParameterSensitivity(paramName);
    }

    return sensitivity;
  }

  /**
   * 単一パラメータの感度を計算
   * @param {string} paramName パラメータ名
   * @returns {number} 感度スコア (0-1)
   */
  calculateSingleParameterSensitivity(paramName) {
    const validHistory = this.history.filter(result => 
      result.parameters && result.parameters[paramName] !== undefined && 
      result.performance !== undefined
    );

    if (validHistory.length < 3) {
      return 0.5; // デフォルト感度
    }

    // パラメータ値と性能の相関を計算
    const paramValues = validHistory.map(h => h.parameters[paramName]);
    const performances = validHistory.map(h => h.performance);

    const correlation = this.calculateCorrelation(paramValues, performances);
    
    // 相関の絶対値を感度とする（高い相関 = 高い感度）
    return Math.min(1, Math.abs(correlation));
  }

  /**
   * 相関係数を計算
   * @param {Array} x X値配列
   * @param {Array} y Y値配列
   * @returns {number} 相関係数
   */
  calculateCorrelation(x, y) {
    // 入力検証を強化
    if (!Array.isArray(x) || !Array.isArray(y) || 
        x.length !== y.length || x.length === 0) {
      return 0;
    }

    // 数値以外の値をフィルタリング
    const validPairs = [];
    for (let i = 0; i < x.length; i++) {
      if (typeof x[i] === 'number' && typeof y[i] === 'number' && 
          !isNaN(x[i]) && !isNaN(y[i]) && 
          isFinite(x[i]) && isFinite(y[i])) {
        validPairs.push([x[i], y[i]]);
      }
    }

    if (validPairs.length < 2) {
      return 0; // 相関計算には少なくとも2つのデータポイントが必要
    }

    const n = validPairs.length;
    const xValues = validPairs.map(pair => pair[0]);
    const yValues = validPairs.map(pair => pair[1]);
    
    const xMean = xValues.reduce((sum, val) => sum + val, 0) / n;
    const yMean = yValues.reduce((sum, val) => sum + val, 0) / n;

    let numerator = 0;
    let xSumSquares = 0;
    let ySumSquares = 0;

    for (let i = 0; i < n; i++) {
      const xDiff = xValues[i] - xMean;
      const yDiff = yValues[i] - yMean;
      
      numerator += xDiff * yDiff;
      xSumSquares += xDiff * xDiff;
      ySumSquares += yDiff * yDiff;
    }

    // より厳密なゼロ除算チェック
    const epsilon = 1e-10; // 計算精度の閾値
    const denominator = Math.sqrt(xSumSquares * ySumSquares);
    
    if (denominator < epsilon || !isFinite(denominator)) {
      return 0; // 分散がゼロまたは無限大の場合
    }
    
    const correlation = numerator / denominator;
    
    // 相関係数は[-1, 1]の範囲内であることを保証
    return Math.max(-1, Math.min(1, correlation));
  }

  /**
   * 感度に基づいてパラメータ範囲を調整
   * @returns {Object} 調整されたパラメータ範囲
   */
  adjustRangesBasedOnSensitivity() {
    const constraint = this.constraintEngine.getStrategyConstraints(this.strategy);
    
    if (!constraint) {
      return {};
    }

    const adjustedRanges = {};

    for (const [paramName, paramConfig] of Object.entries(constraint.parameters)) {
      const sensitivity = this.sensitivity[paramName] || 0.5;
      
      // 感度が高いパラメータは細かく探索、低いパラメータは粗く探索
      const rangeFactor = this.calculateRangeFactor(sensitivity);
      
      adjustedRanges[paramName] = {
        ...paramConfig,
        adjustedMin: paramConfig.min,
        adjustedMax: paramConfig.max,
        rangeFactor,
        sensitivity
      };
    }

    return adjustedRanges;
  }

  /**
   * 感度に基づく範囲調整係数を計算
   * @param {number} sensitivity 感度スコア
   * @returns {number} 範囲調整係数
   */
  calculateRangeFactor(sensitivity) {
    // 高感度パラメータ: より細かい探索
    // 低感度パラメータ: より粗い探索
    return Math.max(0.1, Math.min(2.0, 1.0 + (sensitivity - 0.5)));
  }

  /**
   * 有望な領域を特定
   * @returns {Array} 有望な領域の配列
   */
  identifyPromisingRegions() {
    if (this.history.length < 5) {
      return [];
    }

    // 性能上位20%の結果を分析
    const sortedHistory = this.history
      .filter(h => h.performance !== undefined && h.parameters)
      .sort((a, b) => b.performance - a.performance);
    
    const topCount = Math.max(1, Math.floor(sortedHistory.length * 0.2));
    const topResults = sortedHistory.slice(0, topCount);

    const constraint = this.constraintEngine.getStrategyConstraints(this.strategy);
    if (!constraint) {
      return [];
    }

    const regions = [];
    const paramNames = Object.keys(constraint.parameters);

    // 各パラメータの有望な範囲を計算
    for (const paramName of paramNames) {
      const values = topResults
        .map(r => r.parameters[paramName])
        .filter(v => v !== undefined);
      
      if (values.length > 0) {
        const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
        const std = Math.sqrt(
          values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length
        );

        regions.push({
          parameter: paramName,
          center: mean,
          radius: std * 1.5, // 1.5標準偏差の範囲
          confidence: Math.min(1, values.length / 10) // 信頼度
        });
      }
    }

    return regions;
  }

  /**
   * スマートサンプリングでパラメータを生成
   * @param {number} count 生成数
   * @param {Object} options サンプリングオプション
   * @returns {Array} 生成されたパラメータ組み合わせ
   */
  generateSmartSamples(count = 50, options = {}) {
    const {
      method = 'adaptive_random',
      focusRegions = this.identifyPromisingRegions(),
      explorationRatio = 0.3 // 探索用サンプルの割合
    } = options;

    const samples = [];
    const explorationCount = Math.floor(count * explorationRatio);
    const exploitationCount = count - explorationCount;

    // 探索用サンプル: 全体からランダム
    for (let i = 0; i < explorationCount; i++) {
      const sample = this.constraintEngine.generateCandidate(
        this.constraintEngine.getStrategyConstraints(this.strategy)?.parameters || {}
      );
      
      if (this.constraintEngine.validateCombination(sample, this.strategy)) {
        samples.push(sample);
      }
    }

    // 活用用サンプル: 有望な領域から集中的に
    if (focusRegions.length > 0) {
      for (let i = 0; i < exploitationCount; i++) {
        const sample = this.generateFocusedSample(focusRegions);
        
        if (sample && this.constraintEngine.validateCombination(sample, this.strategy)) {
          samples.push(sample);
        }
      }
    } else {
      // 有望な領域がない場合は通常のランダム生成
      const additionalSamples = this.constraintEngine.generateValidCombinations(
        this.strategy, 
        exploitationCount
      );
      samples.push(...additionalSamples);
    }

    return samples.slice(0, count);
  }

  /**
   * 有望な領域に焦点を当てたサンプルを生成
   * @param {Array} focusRegions 有望な領域配列
   * @returns {Object|null} 生成されたサンプル
   */
  generateFocusedSample(focusRegions) {
    const constraint = this.constraintEngine.getStrategyConstraints(this.strategy);
    if (!constraint) {
      return null;
    }

    const sample = {};

    for (const region of focusRegions) {
      const paramConfig = constraint.parameters[region.parameter];
      if (!paramConfig) continue;

      // 正規分布に従ってサンプリング
      let value = this.generateNormalRandom(region.center, region.radius);
      
      // 型とレンジの制約を適用
      if (paramConfig.type === 'integer') {
        value = Math.round(value);
      }
      
      value = Math.max(paramConfig.min, Math.min(paramConfig.max, value));
      
      sample[region.parameter] = value;
    }

    return sample;
  }

  /**
   * 正規分布に従う乱数を生成（Box-Muller変換）
   * @param {number} mean 平均
   * @param {number} stdDev 標準偏差
   * @returns {number} 正規分布乱数
   */
  generateNormalRandom(mean, stdDev) {
    // より安全な実装：毎回新しいBox-Muller変換を実行
    // スペアノーマルの管理を避けて状態管理のリスクを排除
    let u1, u2;
    
    // ゼロ値を避けるため、有効な値が出るまでループ
    do {
      u1 = Math.random();
    } while (u1 === 0);
    
    do {
      u2 = Math.random();
    } while (u2 === 0);
    
    // Box-Muller変換
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    
    return z0 * stdDev + mean;
  }

  /**
   * パラメータの重要度を分析
   * @returns {Object} パラメータ重要度マップ
   */
  analyzeParameterImportance() {
    const importance = {};
    const constraint = this.constraintEngine.getStrategyConstraints(this.strategy);
    
    if (!constraint || this.history.length < 5) {
      return importance;
    }

    const paramNames = Object.keys(constraint.parameters);

    for (const paramName of paramNames) {
      // 感度と結果への影響を組み合わせて重要度を計算
      const sensitivity = this.sensitivity[paramName] || 0.5;
      const variabilityImpact = this.calculateVariabilityImpact(paramName);
      
      importance[paramName] = {
        sensitivity,
        variabilityImpact,
        overallImportance: (sensitivity + variabilityImpact) / 2
      };
    }

    return importance;
  }

  /**
   * パラメータの変動が結果に与える影響を計算
   * @param {string} paramName パラメータ名
   * @returns {number} 変動影響スコア
   */
  calculateVariabilityImpact(paramName) {
    const validHistory = this.history.filter(result => 
      result.parameters && result.parameters[paramName] !== undefined && 
      result.performance !== undefined
    );

    if (validHistory.length < 3) {
      return 0.5;
    }

    // パラメータ値の分散と性能の分散の関係を分析
    const paramValues = validHistory.map(h => h.parameters[paramName]);
    const performances = validHistory.map(h => h.performance);

    const paramVariance = this.calculateVariance(paramValues);
    const performanceVariance = this.calculateVariance(performances);

    // 正規化された影響スコア
    return Math.min(1, Math.sqrt(paramVariance) / Math.sqrt(performanceVariance + 1));
  }

  /**
   * 分散を計算
   * @param {Array} values 値配列
   * @returns {number} 分散
   */
  calculateVariance(values) {
    if (values.length === 0) return 0;
    
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    return values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  }
}

module.exports = {
  AdaptiveParameterManager
};