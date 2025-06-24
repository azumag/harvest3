/**
 * 戦略パフォーマンス分析モジュール
 * 動的urgency調整システムの構成要素
 */

const { getTradeSummary } = require('../../database/redisDatabase');

class PerformanceAnalyzer {
  constructor(options = {}) {
    this.defaultLookbackPeriod = options.lookbackPeriod || 30; // 30日間
    this.defaultTradeCount = options.defaultTradeCount || 10; // 直近10取引
    this.cacheTimeout = options.cacheTimeout || 60000; // 1分間キャッシュ
    this.cache = new Map();
    
    // パフォーマンス閾値
    this.thresholds = {
      excellent: 0.7,   // 70%以上
      good: 0.6,        // 60%以上
      average: 0.5,     // 50%以上
      poor: 0.4,        // 40%以上
      bad: 0.3          // 30%未満
    };
  }

  /**
   * 戦略別成績評価を取得
   * @param {string} strategyName - 戦略名
   * @param {string} exchange - 取引所ID
   * @param {number} lookbackDays - 遡り日数
   * @returns {Promise<Object>} パフォーマンス評価
   */
  async getStrategyPerformance(strategyName, exchange = 'bitbank', lookbackDays = this.defaultLookbackPeriod) {
    const cacheKey = `perf_${strategyName}_${exchange}_${lookbackDays}_${Math.floor(Date.now() / this.cacheTimeout)}`;
    
    // キャッシュチェック
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      // 戦略のサマリーデータを取得
      const summary = await getTradeSummary(exchange, 'ALL', strategyName);
      
      if (!summary) {
        console.warn(`[PerformanceAnalyzer] サマリーデータなし: ${strategyName}`);
        return this.getDefaultPerformance();
      }

      const performance = {
        strategy: strategyName,
        exchange,
        totalTrades: parseInt(summary.totalTrades) || 0,
        winTrades: parseInt(summary.winTrades) || 0,
        lossTrades: parseInt(summary.lossTrades) || 0,
        totalPnL: parseFloat(summary.totalPnL) || 0,
        totalValue: parseFloat(summary.totalValue) || 0,
        winRate: 0,
        profitFactor: 0,
        avgWin: 0,
        avgLoss: 0,
        sharpeRatio: 0,
        maxDrawdown: parseFloat(summary.maxDrawdown) || 0,
        lastUpdated: summary.lastUpdated || Date.now()
      };

      // 勝率計算
      if (performance.totalTrades > 0) {
        performance.winRate = performance.winTrades / performance.totalTrades;
      }

      // プロフィットファクター計算
      if (performance.lossTrades > 0 && summary.totalWinAmount && summary.totalLossAmount) {
        const totalWin = parseFloat(summary.totalWinAmount) || 0;
        const totalLoss = Math.abs(parseFloat(summary.totalLossAmount) || 0);
        if (totalLoss > 0) {
          performance.profitFactor = totalWin / totalLoss;
        }
      }

      // 平均損益計算
      if (performance.winTrades > 0 && summary.totalWinAmount) {
        performance.avgWin = parseFloat(summary.totalWinAmount) / performance.winTrades;
      }
      if (performance.lossTrades > 0 && summary.totalLossAmount) {
        performance.avgLoss = parseFloat(summary.totalLossAmount) / performance.lossTrades;
      }

      // 総合スコア計算
      performance.overallScore = this.calculateOverallScore(performance);
      performance.performanceLevel = this.getPerformanceLevel(performance.overallScore);

      this.cache.set(cacheKey, performance);
      
      console.log(`[PerformanceAnalyzer] ${strategyName}: 勝率=${(performance.winRate * 100).toFixed(1)}%, スコア=${performance.overallScore.toFixed(3)}`);
      
      return performance;

    } catch (error) {
      console.error(`[PerformanceAnalyzer] パフォーマンス取得エラー: ${strategyName} - ${error.message}`);
      return this.getDefaultPerformance();
    }
  }

  /**
   * 最近の成功率を計算
   * @param {string} strategyName - 戦略名
   * @param {string} exchange - 取引所ID
   * @param {number} tradeCount - 対象取引数
   * @returns {Promise<number>} 成功率（0-1）
   */
  async getRecentSuccessRate(strategyName, exchange = 'bitbank', tradeCount = this.defaultTradeCount) {
    try {
      const performance = await this.getStrategyPerformance(strategyName, exchange);
      
      // 十分な取引データがない場合はデフォルト値
      if (performance.totalTrades < tradeCount) {
        return 0.5; // 中間値
      }

      // 最近の成功率として勝率を使用（将来的にはより詳細な履歴分析を実装可能）
      return performance.winRate;

    } catch (error) {
      console.error(`[PerformanceAnalyzer] 成功率計算エラー: ${strategyName} - ${error.message}`);
      return 0.5;
    }
  }

  /**
   * パフォーマンスに基づくurgency調整係数を計算
   * @param {Object} performance - パフォーマンスデータ
   * @returns {number} 調整係数（負の値は慎重、正の値は積極的）
   */
  calculatePerformanceAdjustment(performance) {
    try {
      if (!performance || performance.totalTrades < 5) {
        return 0; // データ不足時は中立
      }

      const score = performance.overallScore || performance.winRate || 0.5;
      
      // スコアベースの調整
      if (score >= this.thresholds.excellent) {
        return 0.25; // 優秀なパフォーマンス：積極的
      } else if (score >= this.thresholds.good) {
        return 0.1;  // 良好なパフォーマンス：やや積極的
      } else if (score >= this.thresholds.average) {
        return 0;    // 平均的なパフォーマンス：中立
      } else if (score >= this.thresholds.poor) {
        return -0.15; // 不調なパフォーマンス：やや慎重
      } else {
        return -0.3;  // 悪いパフォーマンス：慎重
      }

    } catch (error) {
      console.error(`[PerformanceAnalyzer] 調整係数計算エラー: ${error.message}`);
      return 0;
    }
  }

  /**
   * 総合スコアを計算
   * @param {Object} performance - パフォーマンスデータ
   * @returns {number} 総合スコア（0-1）
   */
  calculateOverallScore(performance) {
    try {
      const weights = {
        winRate: 0.4,        // 勝率 40%
        profitFactor: 0.3,   // プロフィットファクター 30%
        totalPnL: 0.2,       // 総損益 20%
        tradeCount: 0.1      // 取引数 10%
      };

      let totalScore = 0;
      let totalWeight = 0;

      // 勝率スコア
      if (performance.winRate !== undefined) {
        totalScore += performance.winRate * weights.winRate;
        totalWeight += weights.winRate;
      }

      // プロフィットファクタースコア
      if (performance.profitFactor > 0) {
        const pfScore = Math.min(1, performance.profitFactor / 2); // 2.0を満点とする
        totalScore += pfScore * weights.profitFactor;
        totalWeight += weights.profitFactor;
      }

      // 総損益スコア（正の値を評価）
      if (performance.totalPnL !== undefined) {
        const pnlScore = performance.totalPnL > 0 ? Math.min(1, performance.totalPnL / 100000) : 0; // 10万円を満点とする
        totalScore += pnlScore * weights.totalPnL;
        totalWeight += weights.totalPnL;
      }

      // 取引数スコア（最低限の取引があることを評価）
      if (performance.totalTrades > 0) {
        const tradeScore = Math.min(1, performance.totalTrades / 50); // 50取引を満点とする
        totalScore += tradeScore * weights.tradeCount;
        totalWeight += weights.tradeCount;
      }

      return totalWeight > 0 ? totalScore / totalWeight : 0.5;

    } catch (error) {
      console.error(`[PerformanceAnalyzer] 総合スコア計算エラー: ${error.message}`);
      return 0.5;
    }
  }

  /**
   * パフォーマンスレベルを取得
   * @param {number} score - 総合スコア
   * @returns {string} パフォーマンスレベル
   */
  getPerformanceLevel(score) {
    if (score >= this.thresholds.excellent) return 'EXCELLENT';
    if (score >= this.thresholds.good) return 'GOOD';
    if (score >= this.thresholds.average) return 'AVERAGE';
    if (score >= this.thresholds.poor) return 'POOR';
    return 'BAD';
  }

  /**
   * デフォルトパフォーマンスデータを取得
   * @returns {Object} デフォルトパフォーマンス
   */
  getDefaultPerformance() {
    return {
      totalTrades: 0,
      winTrades: 0,
      lossTrades: 0,
      totalPnL: 0,
      winRate: 0.5,
      profitFactor: 1.0,
      overallScore: 0.5,
      performanceLevel: 'AVERAGE'
    };
  }

  /**
   * パフォーマンス分析レポートを生成
   * @param {string} strategyName - 戦略名
   * @param {string} exchange - 取引所ID
   * @returns {Promise<Object>} 分析レポート
   */
  async generatePerformanceReport(strategyName, exchange = 'bitbank') {
    try {
      const performance = await this.getStrategyPerformance(strategyName, exchange);
      const recentSuccessRate = await this.getRecentSuccessRate(strategyName, exchange);
      const adjustment = this.calculatePerformanceAdjustment(performance);

      return {
        strategy: strategyName,
        exchange,
        performance: {
          totalTrades: performance.totalTrades,
          winRate: {
            value: performance.winRate,
            percentage: (performance.winRate * 100).toFixed(1)
          },
          profitFactor: performance.profitFactor.toFixed(2),
          totalPnL: performance.totalPnL.toFixed(2),
          overallScore: {
            value: performance.overallScore,
            level: performance.performanceLevel
          }
        },
        recentSuccessRate: {
          value: recentSuccessRate,
          percentage: (recentSuccessRate * 100).toFixed(1)
        },
        urgencyAdjustment: {
          value: adjustment,
          direction: adjustment > 0 ? 'AGGRESSIVE' : adjustment < 0 ? 'CONSERVATIVE' : 'NEUTRAL'
        },
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error(`[PerformanceAnalyzer] レポート生成エラー: ${strategyName} - ${error.message}`);
      return null;
    }
  }

  /**
   * キャッシュをクリア
   */
  clearCache() {
    this.cache.clear();
  }
}

module.exports = { PerformanceAnalyzer };