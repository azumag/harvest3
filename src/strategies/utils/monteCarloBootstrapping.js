/**
 * Monte Carlo Bootstrapping System
 *
 * 機能：
 * - 統計的ブートストラップ手法の完全実装
 * - 信頼区間計算、バイアス修正、分散推定
 * - 金融指標の分布推定（Sharpe比率、最大ドローダウン、VaR等）
 * - harvest3システムとの完全統合
 *
 * 作成者: worker-claude
 * 日付: 2025-06-28
 */

const { AdvancedPerformanceMetrics } = require('./advancedPerformanceMetrics');

/**
 * Monte Carlo Bootstrapping メインクラス
 */
class MonteCarloBootstrapping {
  constructor(config = {}) {
    this.config = {
      iterations: config.iterations || 10000,
      confidenceLevel: config.confidenceLevel || 0.95,
      blockSize: config.blockSize || 1, // ブロックブートストラップ用
      seed: config.seed || null, // 再現性のためのシード
      biasCorrection: config.biasCorrection || true,
      acceleratedCorrection: config.acceleratedCorrection || true,
      method: config.method || 'traditional', // 'traditional', 'block', 'stationary'
      ...config
    };

    this.advancedMetrics = new AdvancedPerformanceMetrics();
    this._initializeRandomSeed();
  }

  _initializeRandomSeed() {
    if (this.config.seed) {
      // シンプルなシード対応（実際の実装では高品質なPRNGを使用）
      this._randomSeed = this.config.seed;
    }
  }

  _seededRandom() {
    if (this._randomSeed) {
      // Linear Congruential Generator (簡易版)
      this._randomSeed = (this._randomSeed * 1664525 + 1013904223) % Math.pow(2, 32);
      return this._randomSeed / Math.pow(2, 32);
    }
    return Math.random();
  }

  /**
   * パフォーマンス指標の分布推定
   * @param {Array} returns - リターンデータ
   * @param {string} metric - 指標名 ('sharpe', 'maxDrawdown', 'var', 'calmar', etc.)
   * @returns {Object} 分布統計
   */
  async estimateMetricDistribution(returns, metric = 'sharpe') {
    if (!returns || returns.length === 0) {
      throw new Error('リターンデータが必要です');
    }

    const bootstrapResults = [];
    const originalValue = this._calculateMetric(returns, metric);

    for (let i = 0; i < this.config.iterations; i++) {
      const bootstrapSample = this._generateBootstrapSample(returns);
      const bootstrapValue = this._calculateMetric(bootstrapSample, metric);
      bootstrapResults.push(bootstrapValue);
    }

    const distribution = this._analyzeDistribution(bootstrapResults);
    const confidenceInterval = this._calculateConfidenceInterval(bootstrapResults);
    const biasCorrection = this._calculateBiasCorrection(originalValue, bootstrapResults);

    return {
      metric,
      originalValue,
      distribution,
      confidenceInterval,
      biasCorrection,
      standardError: distribution.standardDeviation,
      iterations: this.config.iterations
    };
  }

  /**
   * Sharpe比率の信頼区間計算
   * @param {Array} returns - リターンデータ
   * @param {number} riskFreeRate - リスクフリーレート
   * @returns {Object} Sharpe比率統計
   */
  async calculateSharpeConfidenceInterval(returns, riskFreeRate = 0) {
    const sharpeBootstraps = [];
    const originalSharpe = this._calculateSharpeRatio(returns, riskFreeRate);

    for (let i = 0; i < this.config.iterations; i++) {
      const bootstrapSample = this._generateBootstrapSample(returns);
      const bootstrapSharpe = this._calculateSharpeRatio(bootstrapSample, riskFreeRate);

      // 有効な値のみを保存
      if (isFinite(bootstrapSharpe) && !isNaN(bootstrapSharpe)) {
        sharpeBootstraps.push(bootstrapSharpe);
      }
    }

    if (sharpeBootstraps.length === 0) {
      throw new Error('有効なSharpe比率を計算できませんでした');
    }

    const distribution = this._analyzeDistribution(sharpeBootstraps);
    const confidenceInterval = this._calculateConfidenceInterval(sharpeBootstraps);
    const biasCorrection = this._calculateBiasCorrection(originalSharpe, sharpeBootstraps);

    // BCa信頼区間の計算（Bias-Corrected and Accelerated）
    const bcaInterval = this.config.acceleratedCorrection ?
      this._calculateBCaInterval(returns, sharpeBootstraps, originalSharpe, 'sharpe', riskFreeRate) :
      confidenceInterval;

    return {
      originalSharpe,
      biasCorrection,
      standardError: distribution.standardDeviation,
      confidenceInterval,
      bcaInterval,
      distribution,
      validIterations: sharpeBootstraps.length
    };
  }

  /**
   * 最大ドローダウンの確率分布
   * @param {Array} returns - リターンデータ
   * @returns {Object} 最大ドローダウン統計
   */
  async calculateMaxDrawdownDistribution(returns) {
    const drawdownBootstraps = [];
    const originalDrawdown = this._calculateMaxDrawdown(returns);

    for (let i = 0; i < this.config.iterations; i++) {
      const bootstrapSample = this._generateBootstrapSample(returns);
      const bootstrapDrawdown = this._calculateMaxDrawdown(bootstrapSample);
      drawdownBootstraps.push(bootstrapDrawdown);
    }

    const distribution = this._analyzeDistribution(drawdownBootstraps);
    const confidenceInterval = this._calculateConfidenceInterval(drawdownBootstraps);

    // ドローダウンのリスク指標
    const worstCaseDrawdown = Math.max(...drawdownBootstraps);
    const expectedDrawdown = distribution.mean;
    const drawdownVolatility = distribution.standardDeviation;

    return {
      originalDrawdown,
      expectedDrawdown,
      worstCaseDrawdown,
      drawdownVolatility,
      confidenceInterval,
      distribution,
      riskMetrics: {
        var95: this._calculatePercentile(drawdownBootstraps, 0.95),
        var99: this._calculatePercentile(drawdownBootstraps, 0.99),
        cvar95: this._calculateConditionalVaR(drawdownBootstraps, 0.95),
        cvar99: this._calculateConditionalVaR(drawdownBootstraps, 0.99)
      }
    };
  }

  /**
   * VaRの統計的堅牢性検証
   * @param {Array} returns - リターンデータ
   * @param {number} confidenceLevel - 信頼水準 (0.95, 0.99等)
   * @returns {Object} VaR統計
   */
  async validateVaRRobustness(returns, confidenceLevel = 0.95) {
    const varBootstraps = [];
    const originalVaR = this._calculateVaR(returns, confidenceLevel);

    for (let i = 0; i < this.config.iterations; i++) {
      const bootstrapSample = this._generateBootstrapSample(returns);
      const bootstrapVaR = this._calculateVaR(bootstrapSample, confidenceLevel);
      varBootstraps.push(bootstrapVaR);
    }

    const distribution = this._analyzeDistribution(varBootstraps);
    const varConfidenceInterval = this._calculateConfidenceInterval(varBootstraps);

    // バックテスト統計
    const backtestResults = this._performVaRBacktest(returns, originalVaR, confidenceLevel);

    return {
      originalVaR,
      expectedVaR: distribution.mean,
      varVolatility: distribution.standardDeviation,
      confidenceInterval: varConfidenceInterval,
      distribution,
      backtestResults,
      robustnessScore: this._calculateVaRRobustnessScore(varBootstraps, originalVaR)
    };
  }

  /**
   * 包括的パフォーマンス分析
   * @param {Array} returns - リターンデータ
   * @param {Object} options - オプション設定
   * @returns {Object} 包括的統計
   */
  async comprehensiveAnalysis(returns, options = {}) {
    const {
      riskFreeRate = 0,
      benchmark = null,
      includeHigherMoments = true,
      includeTailRisk = true
    } = options;

    const results = {
      timestamp: new Date().toISOString(),
      sampleSize: returns.length,
      iterations: this.config.iterations
    };

    // 基本統計
    results.basicStats = this._calculateBasicStatistics(returns);

    // Sharpe比率分析
    results.sharpeAnalysis = await this.calculateSharpeConfidenceInterval(returns, riskFreeRate);

    // 最大ドローダウン分析
    results.drawdownAnalysis = await this.calculateMaxDrawdownDistribution(returns);

    // VaR分析
    results.varAnalysis = await this.validateVaRRobustness(returns, 0.95);
    results.var99Analysis = await this.validateVaRRobustness(returns, 0.99);

    // 高次モーメント分析
    if (includeHigherMoments) {
      results.higherMoments = await this._analyzeHigherMoments(returns);
    }

    // テールリスク分析
    if (includeTailRisk) {
      results.tailRisk = await this._analyzeTailRisk(returns);
    }

    // ベンチマーク分析
    if (benchmark) {
      results.benchmarkAnalysis = await this._analyzeBenchmarkPerformance(returns, benchmark);
    }

    return results;
  }

  /**
   * ブートストラップサンプルを生成
   * @param {Array} data - 元データ
   * @returns {Array} ブートストラップサンプル
   */
  _generateBootstrapSample(data) {
    switch (this.config.method) {
    case 'block':
      return this._generateBlockBootstrapSample(data);
    case 'stationary':
      return this._generateStationaryBootstrapSample(data);
    default:
      return this._generateTraditionalBootstrapSample(data);
    }
  }

  /**
   * 伝統的ブートストラップサンプル生成
   * @param {Array} data - 元データ
   * @returns {Array} ブートストラップサンプル
   */
  _generateTraditionalBootstrapSample(data) {
    const sample = [];
    for (let i = 0; i < data.length; i++) {
      const randomIndex = Math.floor(this._seededRandom() * data.length);
      sample.push(data[randomIndex]);
    }
    return sample;
  }

  /**
   * ブロックブートストラップサンプル生成
   * @param {Array} data - 元データ
   * @returns {Array} ブロックブートストラップサンプル
   */
  _generateBlockBootstrapSample(data) {
    const sample = [];
    const blockSize = this.config.blockSize;
    const numBlocks = Math.ceil(data.length / blockSize);

    for (let i = 0; i < numBlocks; i++) {
      const startIndex = Math.floor(this._seededRandom() * (data.length - blockSize + 1));
      for (let j = 0; j < blockSize && sample.length < data.length; j++) {
        sample.push(data[startIndex + j]);
      }
    }

    return sample.slice(0, data.length);
  }

  /**
   * 定常ブートストラップサンプル生成
   * @param {Array} data - 元データ
   * @returns {Array} 定常ブートストラップサンプル
   */
  _generateStationaryBootstrapSample(data) {
    const sample = [];
    const p = 1 / this.config.blockSize; // 幾何分布のパラメータ

    while (sample.length < data.length) {
      const startIndex = Math.floor(this._seededRandom() * data.length);
      let blockLength = 1;

      // 幾何分布に従ってブロック長を決定
      while (this._seededRandom() > p && blockLength < data.length) {
        blockLength++;
      }

      for (let i = 0; i < blockLength && sample.length < data.length; i++) {
        const index = (startIndex + i) % data.length;
        sample.push(data[index]);
      }
    }

    return sample.slice(0, data.length);
  }

  /**
   * 指標を計算
   * @param {Array} returns - リターンデータ
   * @param {string} metric - 指標名
   * @returns {number} 指標値
   */
  _calculateMetric(returns, metric) {
    switch (metric) {
    case 'sharpe':
      return this._calculateSharpeRatio(returns);
    case 'maxDrawdown':
      return this._calculateMaxDrawdown(returns);
    case 'var95':
      return this._calculateVaR(returns, 0.95);
    case 'var99':
      return this._calculateVaR(returns, 0.99);
    case 'calmar':
      return this._calculateCalmarRatio(returns);
    case 'sortino':
      return this._calculateSortinoRatio(returns);
    case 'omega':
      return this._calculateOmegaRatio(returns);
    default:
      throw new Error(`未対応の指標: ${metric}`);
    }
  }

  /**
   * Sharpe比率計算
   * @param {Array} returns - リターンデータ
   * @param {number} riskFreeRate - リスクフリーレート
   * @returns {number} Sharpe比率
   */
  _calculateSharpeRatio(returns, riskFreeRate = 0) {
    if (returns.length === 0) {
      return 0;
    }

    const excessReturns = returns.map(r => r - riskFreeRate);
    const meanExcess = excessReturns.reduce((sum, r) => sum + r, 0) / excessReturns.length;
    const variance = excessReturns.reduce((sum, r) => sum + Math.pow(r - meanExcess, 2), 0) / (excessReturns.length - 1);
    const volatility = Math.sqrt(variance);

    return volatility > 0 ? meanExcess / volatility : 0;
  }

  /**
   * 最大ドローダウン計算
   * @param {Array} returns - リターンデータ
   * @returns {number} 最大ドローダウン
   */
  _calculateMaxDrawdown(returns) {
    if (returns.length === 0) {
      return 0;
    }

    let peak = 0;
    let maxDrawdown = 0;
    let cumulative = 0;

    for (const ret of returns) {
      cumulative += ret;
      peak = Math.max(peak, cumulative);
      const drawdown = peak - cumulative;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }

    return maxDrawdown;
  }

  /**
   * VaR計算
   * @param {Array} returns - リターンデータ
   * @param {number} confidenceLevel - 信頼水準
   * @returns {number} VaR値
   */
  _calculateVaR(returns, confidenceLevel) {
    if (returns.length === 0) {
      return 0;
    }

    const sorted = [...returns].sort((a, b) => a - b);
    const index = Math.floor((1 - confidenceLevel) * sorted.length);
    return -sorted[index]; // 負の値として返す（損失として）
  }

  /**
   * Calmar比率計算
   * @param {Array} returns - リターンデータ
   * @returns {number} Calmar比率
   */
  _calculateCalmarRatio(returns) {
    if (returns.length === 0) {
      return 0;
    }

    const totalReturn = returns.reduce((sum, r) => sum + r, 0);
    const maxDrawdown = this._calculateMaxDrawdown(returns);

    return maxDrawdown > 0 ? totalReturn / maxDrawdown : 0;
  }

  /**
   * Sortino比率計算
   * @param {Array} returns - リターンデータ
   * @param {number} targetReturn - 目標リターン
   * @returns {number} Sortino比率
   */
  _calculateSortinoRatio(returns, targetReturn = 0) {
    if (returns.length === 0) {
      return 0;
    }

    const excessReturns = returns.map(r => r - targetReturn);
    const meanExcess = excessReturns.reduce((sum, r) => sum + r, 0) / excessReturns.length;

    const downwardReturns = excessReturns.filter(r => r < 0);
    if (downwardReturns.length === 0) {
      return meanExcess > 0 ? Infinity : 0;
    }

    const downwardVariance = downwardReturns.reduce((sum, r) => sum + r * r, 0) / downwardReturns.length;
    const downwardVolatility = Math.sqrt(downwardVariance);

    return downwardVolatility > 0 ? meanExcess / downwardVolatility : 0;
  }

  /**
   * Omega比率計算
   * @param {Array} returns - リターンデータ
   * @param {number} threshold - 閾値
   * @returns {number} Omega比率
   */
  _calculateOmegaRatio(returns, threshold = 0) {
    if (returns.length === 0) {
      return 0;
    }

    const gains = returns.filter(r => r > threshold).reduce((sum, r) => sum + (r - threshold), 0);
    const losses = returns.filter(r => r <= threshold).reduce((sum, r) => sum + Math.abs(r - threshold), 0);

    return losses > 0 ? gains / losses : (gains > 0 ? Infinity : 1);
  }

  /**
   * 分布分析
   * @param {Array} data - データ
   * @returns {Object} 分布統計
   */
  _analyzeDistribution(data) {
    if (data.length === 0) {
      return {};
    }

    const sorted = [...data].sort((a, b) => a - b);
    const n = data.length;

    const mean = data.reduce((sum, val) => sum + val, 0) / n;
    const variance = data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (n - 1);
    const standardDeviation = Math.sqrt(variance);

    // 歪度と尖度
    const skewness = this._calculateSkewness(data, mean, standardDeviation);
    const kurtosis = this._calculateKurtosis(data, mean, standardDeviation);

    return {
      mean,
      variance,
      standardDeviation,
      skewness,
      kurtosis,
      min: sorted[0],
      max: sorted[n - 1],
      median: this._calculatePercentile(sorted, 0.5),
      q25: this._calculatePercentile(sorted, 0.25),
      q75: this._calculatePercentile(sorted, 0.75)
    };
  }

  /**
   * 信頼区間計算
   * @param {Array} data - データ
   * @returns {Object} 信頼区間
   */
  _calculateConfidenceInterval(data) {
    const alpha = 1 - this.config.confidenceLevel;
    const lowerPercentile = alpha / 2;
    const upperPercentile = 1 - alpha / 2;

    const sorted = [...data].sort((a, b) => a - b);

    return {
      lower: this._calculatePercentile(sorted, lowerPercentile),
      upper: this._calculatePercentile(sorted, upperPercentile),
      level: this.config.confidenceLevel
    };
  }

  /**
   * パーセンタイル計算
   * @param {Array} sortedData - ソート済みデータ
   * @param {number} percentile - パーセンタイル (0-1)
   * @returns {number} パーセンタイル値
   */
  _calculatePercentile(sortedData, percentile) {
    if (sortedData.length === 0) {
      return 0;
    }

    const index = percentile * (sortedData.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;

    if (lower === upper) {
      return sortedData[lower];
    }

    return sortedData[lower] * (1 - weight) + sortedData[upper] * weight;
  }

  /**
   * バイアス修正計算
   * @param {number} originalValue - 元の値
   * @param {Array} bootstrapValues - ブートストラップ値
   * @returns {Object} バイアス修正情報
   */
  _calculateBiasCorrection(originalValue, bootstrapValues) {
    if (!this.config.biasCorrection || bootstrapValues.length === 0) {
      return { bias: 0, correctedValue: originalValue };
    }

    const bootstrapMean = bootstrapValues.reduce((sum, val) => sum + val, 0) / bootstrapValues.length;
    const bias = bootstrapMean - originalValue;
    const correctedValue = originalValue - bias;

    return { bias, correctedValue, originalValue, bootstrapMean };
  }

  /**
   * BCa信頼区間計算 (Bias-Corrected and Accelerated)
   * @param {Array} originalData - 元データ
   * @param {Array} bootstrapValues - ブートストラップ値
   * @param {number} originalStatistic - 元統計量
   * @param {string} metric - 指標名
   * @param {*} metricParams - 指標のパラメータ
   * @returns {Object} BCa信頼区間
   */
  _calculateBCaInterval(originalData, bootstrapValues, originalStatistic, metric, metricParams) {
    // バイアス修正値
    const proportionBelow = bootstrapValues.filter(val => val < originalStatistic).length / bootstrapValues.length;
    const z0 = this._normalInverse(proportionBelow);

    // 加速定数
    const acceleration = this._calculateAcceleration(originalData, metric, metricParams);

    // 修正されたパーセンタイル
    const alpha = 1 - this.config.confidenceLevel;
    const zAlpha2 = this._normalInverse(alpha / 2);
    const z1Alpha2 = this._normalInverse(1 - alpha / 2);

    const lowerPercentile = this._normalCDF(z0 + (z0 + zAlpha2) / (1 - acceleration * (z0 + zAlpha2)));
    const upperPercentile = this._normalCDF(z0 + (z0 + z1Alpha2) / (1 - acceleration * (z0 + z1Alpha2)));

    const sorted = [...bootstrapValues].sort((a, b) => a - b);

    return {
      lower: this._calculatePercentile(sorted, lowerPercentile),
      upper: this._calculatePercentile(sorted, upperPercentile),
      level: this.config.confidenceLevel,
      z0,
      acceleration
    };
  }

  /**
   * 加速定数計算
   * @param {Array} data - データ
   * @param {string} metric - 指標名
   * @param {*} metricParams - パラメータ
   * @returns {number} 加速定数
   */
  _calculateAcceleration(data, metric, metricParams) {
    const n = data.length;
    const jackknife = [];

    // ジャックナイフ統計量計算
    for (let i = 0; i < n; i++) {
      const jackknifeSample = [...data.slice(0, i), ...data.slice(i + 1)];
      const jackknifeStat = this._calculateMetric(jackknifeSample, metric);
      jackknife.push(jackknifeStat);
    }

    const jackknifeMean = jackknife.reduce((sum, val) => sum + val, 0) / jackknife.length;

    let numerator = 0;
    let denominator = 0;

    for (const val of jackknife) {
      const diff = jackknifeMean - val;
      numerator += Math.pow(diff, 3);
      denominator += Math.pow(diff, 2);
    }

    return denominator > 0 ? numerator / (6 * Math.pow(denominator, 1.5)) : 0;
  }

  /**
   * 正規分布の逆関数（簡易版）
   * @param {number} p - 確率
   * @returns {number} Z値
   */
  _normalInverse(p) {
    // Beasley-Springer-Moro algorithm の簡易版
    if (p <= 0) {
      return -Infinity;
    }
    if (p >= 1) {
      return Infinity;
    }
    if (p === 0.5) {
      return 0;
    }

    const sign = p < 0.5 ? -1 : 1;
    const x = p < 0.5 ? p : 1 - p;

    const a = [0, -3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [0, -5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];

    const t = Math.sqrt(-2 * Math.log(x));
    let num = a[6];
    let den = 1;

    for (let i = 5; i >= 0; i--) {
      num = num * t + a[i];
      if (i > 0) {
        den = den * t + b[i];
      }
    }

    return sign * (t - num / den);
  }

  /**
   * 正規分布のCDF（簡易版）
   * @param {number} x - Z値
   * @returns {number} 確率
   */
  _normalCDF(x) {
    return 0.5 * (1 + this._erf(x / Math.sqrt(2)));
  }

  /**
   * 誤差関数（簡易版）
   * @param {number} x - 値
   * @returns {number} erf(x)
   */
  _erf(x) {
    // Abramowitz and Stegun approximation
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);

    const t = 1 / (1 + p * x);
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

    return sign * y;
  }

  /**
   * 基本統計計算
   * @param {Array} returns - リターンデータ
   * @returns {Object} 基本統計
   */
  _calculateBasicStatistics(returns) {
    if (returns.length === 0) {
      return {};
    }

    const n = returns.length;
    const mean = returns.reduce((sum, r) => sum + r, 0) / n;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (n - 1);
    const volatility = Math.sqrt(variance);

    return {
      count: n,
      mean,
      variance,
      volatility,
      skewness: this._calculateSkewness(returns, mean, volatility),
      kurtosis: this._calculateKurtosis(returns, mean, volatility),
      min: Math.min(...returns),
      max: Math.max(...returns)
    };
  }

  /**
   * 歪度計算
   * @param {Array} values - 値
   * @param {number} mean - 平均
   * @param {number} std - 標準偏差
   * @returns {number} 歪度
   */
  _calculateSkewness(values, mean, std) {
    if (std === 0 || values.length === 0) {
      return 0;
    }

    const n = values.length;
    const skew = values.reduce((sum, val) => {
      return sum + Math.pow((val - mean) / std, 3);
    }, 0) / n;

    return skew;
  }

  /**
   * 尖度計算
   * @param {Array} values - 値
   * @param {number} mean - 平均
   * @param {number} std - 標準偏差
   * @returns {number} 尖度（excess kurtosis）
   */
  _calculateKurtosis(values, mean, std) {
    if (std === 0 || values.length === 0) {
      return 0;
    }

    const n = values.length;
    const kurt = values.reduce((sum, val) => {
      return sum + Math.pow((val - mean) / std, 4);
    }, 0) / n;

    return kurt - 3; // excess kurtosis
  }

  /**
   * Conditional VaR計算
   * @param {Array} sortedData - ソート済みデータ
   * @param {number} confidenceLevel - 信頼水準
   * @returns {number} CVaR値
   */
  _calculateConditionalVaR(sortedData, confidenceLevel) {
    if (sortedData.length === 0) {
      return 0;
    }

    const varIndex = Math.floor((1 - confidenceLevel) * sortedData.length);
    const tailValues = sortedData.slice(0, varIndex + 1);

    if (tailValues.length === 0) {
      return 0;
    }

    const cvar = tailValues.reduce((sum, val) => sum + val, 0) / tailValues.length;
    return -cvar; // 負の値として返す
  }

  /**
   * VaRバックテスト実行
   * @param {Array} returns - リターンデータ
   * @param {number} varValue - VaR値
   * @param {number} confidenceLevel - 信頼水準
   * @returns {Object} バックテスト結果
   */
  _performVaRBacktest(returns, varValue, confidenceLevel) {
    const violations = returns.filter(r => -r > varValue).length;
    const expectedViolations = returns.length * (1 - confidenceLevel);
    const violationRate = violations / returns.length;

    // Kupiec POF test
    const kupiecStat = this._calculateKupiecStatistic(violations, returns.length, 1 - confidenceLevel);

    return {
      violations,
      expectedViolations,
      violationRate,
      expectedViolationRate: 1 - confidenceLevel,
      kupiecStatistic: kupiecStat.statistic,
      kupiecPValue: kupiecStat.pValue,
      isAcceptable: kupiecStat.pValue > 0.05
    };
  }

  /**
   * Kupiec統計量計算
   * @param {number} violations - 違反数
   * @param {number} n - 総観測数
   * @param {number} p - 期待違反率
   * @returns {Object} Kupiec統計量
   */
  _calculateKupiecStatistic(violations, n, p) {
    if (violations === 0 || violations === n) {
      return { statistic: 0, pValue: 1 };
    }

    const pHat = violations / n;
    const statistic = -2 * (violations * Math.log(p) + (n - violations) * Math.log(1 - p) -
                           violations * Math.log(pHat) - (n - violations) * Math.log(1 - pHat));

    // Chi-square distribution with 1 df approximation
    const pValue = 1 - this._chiSquareCDF(statistic, 1);

    return { statistic, pValue };
  }

  /**
   * カイ二乗分布のCDF（簡易版）
   * @param {number} x - 値
   * @param {number} df - 自由度
   * @returns {number} 確率
   */
  _chiSquareCDF(x, df) {
    if (x <= 0) {
      return 0;
    }

    // Gamma function approximation for chi-square CDF
    // This is a simplified version - in production, use a proper implementation
    const gamma = this._gammaFunction(df / 2);
    const lowerGamma = this._lowerIncompleteGamma(df / 2, x / 2);

    return lowerGamma / gamma;
  }

  /**
   * ガンマ関数（簡易版）
   * @param {number} z - 値
   * @returns {number} Gamma(z)
   */
  _gammaFunction(z) {
    // Lanczos approximation (simplified)
    if (z < 0.5) {
      return Math.PI / (Math.sin(Math.PI * z) * this._gammaFunction(1 - z));
    }

    z -= 1;
    let x = 0.99999999999980993;
    const coefficients = [676.5203681218851, -1259.1392167224028, 771.32342877765313,
      -176.61502916214059, 12.507343278686905, -0.13857109526572012,
      9.9843695780195716e-6, 1.5056327351493116e-7];

    for (let i = 0; i < coefficients.length; i++) {
      x += coefficients[i] / (z + i + 1);
    }

    const t = z + coefficients.length - 0.5;
    return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
  }

  /**
   * 下側不完全ガンマ関数（簡易版）
   * @param {number} s - パラメータ
   * @param {number} x - 値
   * @returns {number} 下側不完全ガンマ
   */
  _lowerIncompleteGamma(s, x) {
    // Series expansion approximation
    if (x === 0) {
      return 0;
    }

    let sum = 1;
    let term = 1;

    for (let n = 1; n < 100; n++) {
      term *= x / (s + n - 1);
      sum += term;
      if (Math.abs(term) < 1e-15) {
        break;
      }
    }

    return Math.pow(x, s) * Math.exp(-x) * sum / s;
  }

  /**
   * VaR堅牢性スコア計算
   * @param {Array} varBootstraps - VaRブートストラップ値
   * @param {number} originalVaR - 元のVaR
   * @returns {number} 堅牢性スコア (0-1)
   */
  _calculateVaRRobustnessScore(varBootstraps, originalVaR) {
    const distribution = this._analyzeDistribution(varBootstraps);
    const cv = Math.abs(distribution.mean) > 0 ? distribution.standardDeviation / Math.abs(distribution.mean) : 0;

    // 堅牢性スコア: 変動係数が小さいほど高スコア
    return Math.max(0, 1 - cv);
  }

  /**
   * 高次モーメント分析
   * @param {Array} returns - リターンデータ
   * @returns {Object} 高次モーメント統計
   */
  async _analyzeHigherMoments(returns) {
    const skewnessBootstraps = [];
    const kurtosisBootstraps = [];

    for (let i = 0; i < this.config.iterations; i++) {
      const sample = this._generateBootstrapSample(returns);
      const stats = this._calculateBasicStatistics(sample);
      skewnessBootstraps.push(stats.skewness);
      kurtosisBootstraps.push(stats.kurtosis);
    }

    return {
      skewness: {
        distribution: this._analyzeDistribution(skewnessBootstraps),
        confidenceInterval: this._calculateConfidenceInterval(skewnessBootstraps)
      },
      kurtosis: {
        distribution: this._analyzeDistribution(kurtosisBootstraps),
        confidenceInterval: this._calculateConfidenceInterval(kurtosisBootstraps)
      }
    };
  }

  /**
   * テールリスク分析
   * @param {Array} returns - リターンデータ
   * @returns {Object} テールリスク統計
   */
  async _analyzeTailRisk(returns) {
    const extremeReturns = returns.filter(r => Math.abs(r) > 2 * this._calculateBasicStatistics(returns).volatility);

    return {
      extremeReturnCount: extremeReturns.length,
      extremeReturnRate: extremeReturns.length / returns.length,
      leftTailRisk: await this._analyzeLeftTail(returns),
      rightTailRisk: await this._analyzeRightTail(returns)
    };
  }

  /**
   * 左側テール分析
   * @param {Array} returns - リターンデータ
   * @returns {Object} 左側テール統計
   */
  async _analyzeLeftTail(returns) {
    const sorted = [...returns].sort((a, b) => a - b);
    const tailSize = Math.floor(returns.length * 0.05); // 下位5%
    const leftTail = sorted.slice(0, tailSize);

    if (leftTail.length === 0) {
      return {};
    }

    return {
      tailMean: leftTail.reduce((sum, r) => sum + r, 0) / leftTail.length,
      worstReturn: leftTail[0],
      tailVolatility: this._calculateBasicStatistics(leftTail).volatility
    };
  }

  /**
   * 右側テール分析
   * @param {Array} returns - リターンデータ
   * @returns {Object} 右側テール統計
   */
  async _analyzeRightTail(returns) {
    const sorted = [...returns].sort((a, b) => b - a);
    const tailSize = Math.floor(returns.length * 0.05); // 上位5%
    const rightTail = sorted.slice(0, tailSize);

    if (rightTail.length === 0) {
      return {};
    }

    return {
      tailMean: rightTail.reduce((sum, r) => sum + r, 0) / rightTail.length,
      bestReturn: rightTail[0],
      tailVolatility: this._calculateBasicStatistics(rightTail).volatility
    };
  }

  /**
   * ベンチマーク分析
   * @param {Array} returns - リターンデータ
   * @param {Array} benchmarkReturns - ベンチマークリターン
   * @returns {Object} ベンチマーク統計
   */
  async _analyzeBenchmarkPerformance(returns, benchmarkReturns) {
    if (returns.length !== benchmarkReturns.length) {
      throw new Error('リターンとベンチマークの長さが一致しません');
    }

    const excessReturns = returns.map((r, i) => r - benchmarkReturns[i]);
    const beta = this._calculateBeta(returns, benchmarkReturns);
    const alpha = this._calculateAlpha(returns, benchmarkReturns, beta);

    return {
      beta,
      alpha,
      excessReturns: this._calculateBasicStatistics(excessReturns),
      informationRatio: this._calculateInformationRatio(excessReturns),
      trackingError: this._calculateBasicStatistics(excessReturns).volatility
    };
  }

  /**
   * ベータ計算
   * @param {Array} returns - リターンデータ
   * @param {Array} benchmarkReturns - ベンチマークリターン
   * @returns {number} ベータ
   */
  _calculateBeta(returns, benchmarkReturns) {
    const n = returns.length;
    const meanReturn = returns.reduce((sum, r) => sum + r, 0) / n;
    const meanBenchmark = benchmarkReturns.reduce((sum, r) => sum + r, 0) / n;

    let covariance = 0;
    let benchmarkVariance = 0;

    for (let i = 0; i < n; i++) {
      const retDiff = returns[i] - meanReturn;
      const benchDiff = benchmarkReturns[i] - meanBenchmark;
      covariance += retDiff * benchDiff;
      benchmarkVariance += benchDiff * benchDiff;
    }

    return benchmarkVariance > 0 ? covariance / benchmarkVariance : 0;
  }

  /**
   * アルファ計算
   * @param {Array} returns - リターンデータ
   * @param {Array} benchmarkReturns - ベンチマークリターン
   * @param {number} beta - ベータ
   * @returns {number} アルファ
   */
  _calculateAlpha(returns, benchmarkReturns, beta) {
    const meanReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const meanBenchmark = benchmarkReturns.reduce((sum, r) => sum + r, 0) / benchmarkReturns.length;

    return meanReturn - beta * meanBenchmark;
  }

  /**
   * 情報比率計算
   * @param {Array} excessReturns - 超過リターン
   * @returns {number} 情報比率
   */
  _calculateInformationRatio(excessReturns) {
    const stats = this._calculateBasicStatistics(excessReturns);
    return stats.volatility > 0 ? stats.mean / stats.volatility : 0;
  }
}

module.exports = {
  MonteCarloBootstrapping
};