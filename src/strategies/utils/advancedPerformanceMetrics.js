/**
 * 高度パフォーマンス指標計算モジュール
 * Calmar Ratio, Sortino Ratio, VaR (Value at Risk) を実装
 */

/**
 * Calmar Ratioを計算する
 * @param {number} annualizedReturn - 年換算リターン
 * @param {number} maxDrawdown - 最大ドローダウン
 * @returns {number} Calmar Ratio
 */
function calculateCalmarRatio(annualizedReturn, maxDrawdown) {
  // 入力値の検証
  if (typeof annualizedReturn !== 'number' || typeof maxDrawdown !== 'number') {
    return 0;
  }

  if (!isFinite(annualizedReturn) || !isFinite(maxDrawdown) || isNaN(annualizedReturn) || isNaN(maxDrawdown)) {
    return 0;
  }

  // ゼロ除算対策 - 最大値を設定
  if (Math.abs(maxDrawdown) < 1e-10) {
    // ドローダウンが非常に小さい場合、固定値を返す
    return annualizedReturn >= 0 ? 100 : -100;
  }

  const calmarRatio = annualizedReturn / Math.abs(maxDrawdown);

  // 結果の妥当性チェック
  if (!isFinite(calmarRatio) || isNaN(calmarRatio)) {
    return 0;
  }

  // 極端な値を制限
  return Math.max(-1000, Math.min(1000, calmarRatio));
}

/**
 * ダウンサイド偏差を計算する
 * @param {number[]} returns - リターン系列
 * @param {number} targetReturn - ターゲットリターン (デフォルト: 0)
 * @returns {number} ダウンサイド偏差
 */
function calculateDownsideDeviation(returns, targetReturn = 0) {
  if (!Array.isArray(returns) || returns.length === 0) {
    return 0;
  }

  // 負のリターン（ターゲット以下）のみを抽出
  const downsideReturns = returns
    .filter(r => typeof r === 'number' && !isNaN(r))
    .filter(r => r < targetReturn)
    .map(r => r - targetReturn);

  if (downsideReturns.length === 0) {
    return 0;
  }

  // ダウンサイド分散を計算
  const downsideVariance = downsideReturns
    .reduce((sum, r) => sum + (r * r), 0) / downsideReturns.length;

  return Math.sqrt(downsideVariance);
}

/**
 * Sortino Ratioを計算する
 * @param {number[]} returns - リターン系列
 * @param {number} riskFreeRate - リスクフリーレート (年率)
 * @returns {number} Sortino Ratio
 */
function calculateSortinoRatio(returns, riskFreeRate = 0.02) {
  if (!Array.isArray(returns) || returns.length === 0) {
    return 0;
  }

  const validReturns = returns.filter(r => typeof r === 'number' && !isNaN(r));

  if (validReturns.length === 0) {
    return 0;
  }

  // 年換算リターンを計算
  const annualizedReturn = calculateAnnualizedReturn(validReturns);

  // 日次リスクフリーレートに変換
  const dailyRiskFreeRate = riskFreeRate / 365;

  // ダウンサイド偏差を計算
  const downsideDeviation = calculateDownsideDeviation(validReturns, dailyRiskFreeRate);

  if (Math.abs(downsideDeviation) < 1e-10) {
    // ダウンサイド偏差が非常に小さい場合、固定値を返す
    return annualizedReturn > riskFreeRate ? 100 : 0;
  }

  // 年換算ダウンサイド偏差
  const annualizedDownsideDeviation = downsideDeviation * Math.sqrt(365);

  if (!isFinite(annualizedDownsideDeviation) || annualizedDownsideDeviation <= 0) {
    return 0;
  }

  const sortinoRatio = (annualizedReturn - riskFreeRate) / annualizedDownsideDeviation;

  // 結果の妥当性チェックと制限
  if (!isFinite(sortinoRatio) || isNaN(sortinoRatio)) {
    return 0;
  }

  return Math.max(-1000, Math.min(1000, sortinoRatio));
}

/**
 * VaR (Value at Risk)を計算する (ヒストリカル法)
 * @param {number[]} returns - リターン系列
 * @param {number} confidenceLevel - 信頼区間 (デフォルト: 0.95)
 * @returns {number} VaR値
 */
function calculateVaR(returns, confidenceLevel = 0.95) {
  if (!Array.isArray(returns) || returns.length === 0) {
    return 0;
  }

  const validReturns = returns
    .filter(r => typeof r === 'number' && isFinite(r) && !isNaN(r))
    .sort((a, b) => a - b);

  if (validReturns.length === 0) {
    return 0;
  }

  // 信頼区間の妥当性チェック
  if (confidenceLevel <= 0 || confidenceLevel >= 1) {
    confidenceLevel = 0.95;
  }

  // パーセンタイルインデックスを計算
  const percentileIndex = Math.floor((1 - confidenceLevel) * validReturns.length);
  const adjustedIndex = Math.max(0, Math.min(percentileIndex, validReturns.length - 1));

  const varValue = validReturns[adjustedIndex];

  if (!isFinite(varValue) || isNaN(varValue)) {
    return 0;
  }

  return varValue;
}

/**
 * 年換算リターンを計算する
 * @param {number[]} returns - 日次リターン系列
 * @returns {number} 年換算リターン
 */
function calculateAnnualizedReturn(returns) {
  if (!Array.isArray(returns) || returns.length === 0) {
    return 0;
  }

  const validReturns = returns.filter(r => typeof r === 'number' && isFinite(r) && !isNaN(r));

  if (validReturns.length === 0) {
    return 0;
  }

  const averageDailyReturn = validReturns.reduce((sum, r) => sum + r, 0) / validReturns.length;

  if (!isFinite(averageDailyReturn) || isNaN(averageDailyReturn)) {
    return 0;
  }

  // 365日で年換算
  const annualizedReturn = averageDailyReturn * 365;

  if (!isFinite(annualizedReturn) || isNaN(annualizedReturn)) {
    return 0;
  }

  // 極端な値を制限（年率-10000%から+10000%まで）
  return Math.max(-100, Math.min(100, annualizedReturn));
}

/**
 * 高度パフォーマンス指標を統合管理するクラス
 */
class AdvancedPerformanceMetrics {
  constructor(options = {}) {
    this.riskFreeRate = options.riskFreeRate || 0.02; // デフォルト年率2%
    this.confidenceLevels = options.confidenceLevels || [0.95, 0.99];
    this.minimumTrades = options.minimumTrades || 10;
  }

  /**
   * 取引データからリターン系列を抽出
   * @param {Object[]} trades - 取引データ配列
   * @returns {number[]} リターン系列
   */
  extractReturns(trades) {
    if (!Array.isArray(trades) || trades.length === 0) {
      return [];
    }

    // PnLを元本で正規化してリターンに変換
    // 簡易実装: PnLをそのままリターンとして使用
    return trades
      .filter(trade => trade && typeof trade.pnl === 'number' && !isNaN(trade.pnl))
      .map(trade => trade.pnl / 100000) // 仮定: 10万円を基準とした正規化
      .filter(r => !isNaN(r));
  }

  /**
   * 最大ドローダウンを計算
   * @param {Object[]} trades - 取引データ配列
   * @returns {number} 最大ドローダウン
   */
  calculateMaxDrawdown(trades) {
    if (!Array.isArray(trades) || trades.length === 0) {
      return 0;
    }

    let peak = 0;
    let maxDrawdown = 0;
    let runningTotal = 0;

    const sortedTrades = trades
      .filter(trade => trade && typeof trade.pnl === 'number' && trade.timestamp)
      .sort((a, b) => a.timestamp - b.timestamp);

    for (const trade of sortedTrades) {
      runningTotal += trade.pnl;

      if (runningTotal > peak) {
        peak = runningTotal;
      }

      if (Math.abs(peak) > 1e-10) {
        const drawdown = (peak - runningTotal) / Math.abs(peak);
        if (isFinite(drawdown) && !isNaN(drawdown) && drawdown >= 0) {
          maxDrawdown = Math.max(maxDrawdown, drawdown);
        }
      }
    }

    return maxDrawdown;
  }

  /**
   * 全ての高度パフォーマンス指標を計算
   * @param {Object[]} trades - 取引データ配列
   * @returns {Object} 全パフォーマンス指標
   */
  calculateAllMetrics(trades) {
    if (!Array.isArray(trades) || trades.length < this.minimumTrades) {
      return {
        calmarRatio: 0,
        sortinoRatio: 0,
        var95: 0,
        var99: 0,
        annualizedReturn: 0,
        downsideDeviation: 0,
        maxDrawdown: 0,
        sufficientData: false,
        tradeCount: Array.isArray(trades) ? trades.length : 0
      };
    }

    const returns = this.extractReturns(trades);
    const maxDrawdown = this.calculateMaxDrawdown(trades);
    const annualizedReturn = calculateAnnualizedReturn(returns);
    const downsideDeviation = calculateDownsideDeviation(returns);

    return {
      calmarRatio: calculateCalmarRatio(annualizedReturn, maxDrawdown),
      sortinoRatio: calculateSortinoRatio(returns, this.riskFreeRate),
      var95: calculateVaR(returns, 0.95),
      var99: calculateVaR(returns, 0.99),
      annualizedReturn,
      downsideDeviation: downsideDeviation * Math.sqrt(365), // 年換算
      maxDrawdown,
      sufficientData: true,
      tradeCount: trades.length
    };
  }

  /**
   * パフォーマンス指標の評価
   * @param {Object} metrics - 計算されたメトリクス
   * @returns {Object} 評価結果
   */
  evaluateMetrics(metrics) {
    const evaluation = {
      overall: 'AVERAGE',
      strengths: [],
      weaknesses: [],
      recommendations: []
    };

    // Calmar Ratio評価
    if (metrics.calmarRatio > 2.0) {
      evaluation.strengths.push('優秀なCalmar Ratio (>2.0)');
    } else if (metrics.calmarRatio < 1.0) {
      evaluation.weaknesses.push('低いCalmar Ratio (<1.0)');
      evaluation.recommendations.push('ドローダウン管理の改善');
    }

    // Sortino Ratio評価
    if (metrics.sortinoRatio > 1.5) {
      evaluation.strengths.push('優秀なSortino Ratio (>1.5)');
    } else if (metrics.sortinoRatio < 0.5) {
      evaluation.weaknesses.push('低いSortino Ratio (<0.5)');
      evaluation.recommendations.push('ダウンサイドリスク管理の強化');
    }

    // VaR評価
    if (Math.abs(metrics.var95) < 0.02) {
      evaluation.strengths.push('良好なVaR管理 (<2%)');
    } else if (Math.abs(metrics.var95) > 0.05) {
      evaluation.weaknesses.push('高いVaR (>5%)');
      evaluation.recommendations.push('リスク管理パラメータの見直し');
    }

    // 総合評価
    const strengthCount = evaluation.strengths.length;
    const weaknessCount = evaluation.weaknesses.length;

    if (strengthCount >= 2 && weaknessCount === 0) {
      evaluation.overall = 'EXCELLENT';
    } else if (strengthCount >= 1 && weaknessCount <= 1) {
      evaluation.overall = 'GOOD';
    } else if (weaknessCount >= 2) {
      evaluation.overall = 'POOR';
    }

    return evaluation;
  }
}

module.exports = {
  calculateCalmarRatio,
  calculateSortinoRatio,
  calculateVaR,
  calculateAnnualizedReturn,
  calculateDownsideDeviation,
  AdvancedPerformanceMetrics
};