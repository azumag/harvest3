const { calculateATR, calculateVolatilityBasedPositionSize } = require('./indicators');

/**
 * 動的ポジションサイジング管理クラス
 */
class DynamicPositionSizing {
  constructor(config = {}) {
    this.config = {
      // デフォルト設定
      baseRiskPerTrade: 0.01, // 1%
      atrPeriod: 14,
      atrMultiplier: 2,
      maxPositionPercent: 0.1, // 10%
      minPositionPercent: 0.001, // 0.1%

      // Kelly基準設定
      kellyEnabled: false,
      kellyFraction: 0.25, // Kelly結果の25%を使用（安全係数）

      // パフォーマンス調整
      performanceAdjustment: true,
      lookbackDays: 30,

      ...config
    };

    this.performanceHistory = new Map(); // 戦略別パフォーマンス履歴
  }

  /**
   * ATRベースのポジションサイズを計算
   * @param {Object} params - パラメータ
   * @param {number} params.accountBalance - アカウント残高
   * @param {Array} params.ohlcData - OHLC データ
   * @param {number} params.currentPrice - 現在価格
   * @param {string} params.strategyKey - 戦略キー
   * @param {Object} params.marketData - マーケットデータ（オプション）
   * @returns {Object} - ポジションサイズ情報
   */
  calculateATRBasedPosition(params) {
    const { accountBalance, ohlcData, currentPrice, strategyKey, marketData } = params;

    if (!accountBalance || !ohlcData || !currentPrice) {
      return { positionSize: 0, reason: 'insufficient_data' };
    }

    try {
      // ATRを計算
      const atrValues = calculateATR(ohlcData, this.config.atrPeriod);
      const latestATR = atrValues[atrValues.length - 1];

      if (!latestATR || latestATR <= 0) {
        return { positionSize: 0, reason: 'invalid_atr' };
      }

      // 基本リスクを取得（パフォーマンスに基づく調整を適用）
      let adjustedRisk = this.config.baseRiskPerTrade;

      if (this.config.performanceAdjustment && strategyKey) {
        adjustedRisk = this.getPerformanceAdjustedRisk(strategyKey);
      }

      // ボラティリティベースのポジションサイズを計算
      let positionSize = calculateVolatilityBasedPositionSize(
        accountBalance,
        adjustedRisk,
        latestATR,
        this.config.atrMultiplier,
        currentPrice
      );

      // Kelly基準を適用（有効な場合）
      if (this.config.kellyEnabled && strategyKey) {
        const kellySize = this.calculateKellyPosition(accountBalance, strategyKey, currentPrice);
        if (kellySize > 0) {
          // Kelly結果とATR結果の平均を取る
          positionSize = (positionSize + kellySize) / 2;
        }
      }

      // 最大・最小制限を適用
      const maxPosition = accountBalance * this.config.maxPositionPercent / currentPrice;
      const minPosition = accountBalance * this.config.minPositionPercent / currentPrice;

      positionSize = Math.max(minPosition, Math.min(maxPosition, positionSize));

      return {
        positionSize,
        atr: latestATR,
        adjustedRisk,
        stopLossDistance: latestATR * this.config.atrMultiplier,
        maxPosition,
        minPosition,
        reason: 'success'
      };

    } catch (error) {
      console.error('ATRベースポジションサイズ計算エラー:', error.message);
      return { positionSize: 0, reason: 'calculation_error', error: error.message };
    }
  }

  /**
   * Kelly基準によるポジションサイズを計算
   * @param {number} accountBalance - アカウント残高
   * @param {string} strategyKey - 戦略キー
   * @param {number} currentPrice - 現在価格
   * @returns {number} - Kelly基準によるポジションサイズ
   */
  calculateKellyPosition(accountBalance, strategyKey, currentPrice) {
    const performance = this.performanceHistory.get(strategyKey);

    if (!performance || performance.trades < 10) {
      // 十分なトレード履歴がない場合は0を返す
      return 0;
    }

    const { winRate, avgWin, avgLoss } = performance;

    if (avgWin <= 0 || avgLoss <= 0) {
      return 0;
    }

    // Kelly % = (勝率 * 平均利益 - (1-勝率) * 平均損失) / 平均利益
    const kellyPercentage = (winRate * avgWin - (1 - winRate) * avgLoss) / avgWin;

    // 安全係数を適用（通常は25%程度）
    const adjustedKelly = Math.max(0, kellyPercentage * this.config.kellyFraction);

    // ポジションサイズを計算
    const positionValue = accountBalance * adjustedKelly;
    const positionSize = positionValue / currentPrice;

    return positionSize;
  }

  /**
   * パフォーマンスに基づくリスク調整
   * @param {string} strategyKey - 戦略キー
   * @returns {number} - 調整されたリスク
   */
  getPerformanceAdjustedRisk(strategyKey) {
    const performance = this.performanceHistory.get(strategyKey);

    if (!performance) {
      return this.config.baseRiskPerTrade;
    }

    const { winRate, sharpeRatio, maxDrawdown } = performance;

    // パフォーマンス指標に基づいてリスクを調整
    let adjustmentFactor = 1.0;

    // 勝率による調整
    if (winRate > 0.6) {
      adjustmentFactor *= 1.2; // 高勝率なら増加
    } else if (winRate < 0.4) {
      adjustmentFactor *= 0.8; // 低勝率なら減少
    }

    // Sharpe比率による調整
    if (sharpeRatio > 1.5) {
      adjustmentFactor *= 1.3;
    } else if (sharpeRatio < 0.5) {
      adjustmentFactor *= 0.7;
    }

    // 最大ドローダウンによる調整
    if (maxDrawdown > 0.1) { // 10%以上のドローダウン
      adjustmentFactor *= 0.6;
    }

    // 調整されたリスクを計算（最小0.005、最大0.05の範囲）
    const adjustedRisk = this.config.baseRiskPerTrade * adjustmentFactor;
    return Math.max(0.005, Math.min(0.05, adjustedRisk));
  }

  /**
   * 戦略のパフォーマンス履歴を更新
   * @param {string} strategyKey - 戦略キー
   * @param {Object} tradeResult - トレード結果
   */
  updatePerformanceHistory(strategyKey, tradeResult) {
    const { isWin, pnl, drawdown } = tradeResult;

    const performance = this.performanceHistory.get(strategyKey) || {
      trades: 0,
      wins: 0,
      losses: 0,
      totalPnL: 0,
      winPnL: 0,
      lossPnL: 0,
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      returns: []
    };

    // トレード結果を更新
    performance.trades++;
    performance.totalPnL += pnl;
    performance.returns.push(pnl);

    if (isWin) {
      performance.wins++;
      performance.winPnL += pnl;
    } else {
      performance.losses++;
      performance.lossPnL += Math.abs(pnl);
    }

    // 統計を再計算
    performance.winRate = performance.wins / performance.trades;
    performance.avgWin = performance.wins > 0 ? performance.winPnL / performance.wins : 0;
    performance.avgLoss = performance.losses > 0 ? performance.lossPnL / performance.losses : 0;
    performance.maxDrawdown = Math.max(performance.maxDrawdown, drawdown || 0);

    // Sharpe比率を計算（簡易版）
    if (performance.returns.length > 1) {
      const avgReturn = performance.returns.reduce((a, b) => a + b, 0) / performance.returns.length;
      const variance = performance.returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / performance.returns.length;
      const stdDev = Math.sqrt(variance);
      performance.sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0;
    }

    // 履歴を一定期間で制限（メモリ使用量を抑制）
    if (performance.returns.length > 100) {
      performance.returns = performance.returns.slice(-100);
    }

    this.performanceHistory.set(strategyKey, performance);
  }

  /**
   * 戦略のパフォーマンス情報を取得
   * @param {string} strategyKey - 戦略キー
   * @returns {Object} - パフォーマンス情報
   */
  getPerformanceInfo(strategyKey) {
    return this.performanceHistory.get(strategyKey) || null;
  }

  /**
   * 相関を考慮したポートフォリオ調整
   * @param {Array} positions - 現在のポジション
   * @param {number} newPositionSize - 新しいポジションサイズ
   * @param {string} newSymbol - 新しいシンボル
   * @param {Object} correlationMatrix - 相関マトリックス
   * @returns {number} - 調整されたポジションサイズ
   */
  adjustForCorrelation(positions, newPositionSize, newSymbol, correlationMatrix) {
    if (!correlationMatrix || positions.length === 0) {
      return newPositionSize;
    }

    let totalCorrelationAdjustment = 1.0;

    for (const position of positions) {
      const correlation = correlationMatrix[newSymbol]?.[position.symbol] || 0;

      // 高い相関（0.7以上）の場合はポジションサイズを調整
      if (Math.abs(correlation) > 0.7) {
        totalCorrelationAdjustment *= 0.6; // 40%削減
      } else if (Math.abs(correlation) > 0.5) {
        totalCorrelationAdjustment *= 0.8; // 20%削減
      }
    }

    return newPositionSize * totalCorrelationAdjustment;
  }

  /**
   * 設定を更新
   * @param {Object} newConfig - 新しい設定
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * パフォーマンス履歴をクリア
   * @param {string} strategyKey - 戦略キー（オプション）
   */
  clearPerformanceHistory(strategyKey = null) {
    if (strategyKey) {
      this.performanceHistory.delete(strategyKey);
    } else {
      this.performanceHistory.clear();
    }
  }
}

module.exports = {
  DynamicPositionSizing
};