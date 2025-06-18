const { getTradeSummary, updateTradeSummary } = require('../../database/redisDatabase');

/**
 * 戦略別パフォーマンス追跡システム
 */
class PerformanceTracker {
  constructor() {
    this.performanceCache = new Map(); // メモリキャッシュ
    this.updateIntervals = new Map(); // 定期更新用
  }
  
  /**
   * トレード結果を記録
   * @param {string} exchangeId - 取引所ID
   * @param {string} symbol - シンボル
   * @param {string} strategyKey - 戦略キー
   * @param {Object} tradeData - トレードデータ
   */
  async recordTrade(exchangeId, symbol, strategyKey, tradeData) {
    const {
      side, // 'buy' or 'sell'
      amount,
      price,
      pnl = null, // sell注文の場合のみ
      timestamp = Date.now()
    } = tradeData;
    
    try {
      const key = `${exchangeId}:${symbol}:${strategyKey}`;
      let performance = await this.getPerformance(exchangeId, symbol, strategyKey);
      
      if (!performance) {
        performance = this.initializePerformance();
      }
      
      // トレード記録を更新
      if (side === 'buy') {
        performance.totalTrades++;
        performance.totalBuy += amount;
        performance.totalBuyValue += amount * price;
        performance.lastBuyPrice = price;
        performance.lastTradeTime = timestamp;
      } else if (side === 'sell') {
        performance.totalSell += amount;
        performance.totalSellValue += amount * price;
        performance.lastSellPrice = price;
        performance.lastTradeTime = timestamp;
        
        // 損益を記録（提供された場合）
        if (pnl !== null) {
          performance.totalPnL += pnl;
          performance.trades.push({
            timestamp,
            pnl,
            amount,
            price,
            isWin: pnl > 0
          });
          
          if (pnl > 0) {
            performance.winningTrades++;
            performance.totalWinPnL += pnl;
          } else {
            performance.losingTrades++;
            performance.totalLossPnL += Math.abs(pnl);
          }
          
          // パフォーマンス指標を再計算
          this.recalculateMetrics(performance);
        }
      }
      
      // ネットポジションを更新
      performance.netPosition = performance.totalBuy - performance.totalSell;
      performance.lastUpdated = timestamp;
      
      // パフォーマンスを保存
      await this.savePerformance(exchangeId, symbol, strategyKey, performance);
      
      // キャッシュを更新
      this.performanceCache.set(key, performance);
      
    } catch (error) {
      console.error(`パフォーマンス記録エラー: ${exchangeId}:${symbol}:${strategyKey}`, error.message);
    }
  }
  
  /**
   * パフォーマンス指標を再計算
   * @param {Object} performance - パフォーマンスオブジェクト
   */
  recalculateMetrics(performance) {
    const completedTrades = performance.winningTrades + performance.losingTrades;
    
    if (completedTrades === 0) {
      return;
    }
    
    // 勝率
    performance.winRate = performance.winningTrades / completedTrades;
    
    // 平均損益
    performance.avgWin = performance.winningTrades > 0 ? 
      performance.totalWinPnL / performance.winningTrades : 0;
    performance.avgLoss = performance.losingTrades > 0 ? 
      performance.totalLossPnL / performance.losingTrades : 0;
    
    // プロフィットファクター
    performance.profitFactor = performance.totalLossPnL > 0 ? 
      performance.totalWinPnL / performance.totalLossPnL : 0;
    
    // 最大ドローダウンを計算
    this.calculateMaxDrawdown(performance);
    
    // Sharpe比率を計算（簡易版）
    this.calculateSharpeRatio(performance);
    
    // 最近のパフォーマンストレンドを計算
    this.calculateRecentTrend(performance);
  }
  
  /**
   * 最大ドローダウンを計算
   * @param {Object} performance - パフォーマンスオブジェクト
   */
  calculateMaxDrawdown(performance) {
    if (performance.trades.length < 2) {
      performance.maxDrawdown = 0;
      return;
    }
    
    let peak = 0;
    let maxDrawdown = 0;
    let runningTotal = 0;
    
    for (const trade of performance.trades) {
      runningTotal += trade.pnl;
      
      if (runningTotal > peak) {
        peak = runningTotal;
      }
      
      const drawdown = (peak - runningTotal) / Math.abs(peak);
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }
    
    performance.maxDrawdown = maxDrawdown;
  }
  
  /**
   * Sharpe比率を計算（簡易版）
   * @param {Object} performance - パフォーマンスオブジェクト
   */
  calculateSharpeRatio(performance) {
    if (performance.trades.length < 2) {
      performance.sharpeRatio = 0;
      return;
    }
    
    const returns = performance.trades.map(trade => trade.pnl);
    const avgReturn = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
    
    const variance = returns.reduce((sum, ret) => {
      return sum + Math.pow(ret - avgReturn, 2);
    }, 0) / returns.length;
    
    const stdDev = Math.sqrt(variance);
    performance.sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0;
  }
  
  /**
   * 最近のパフォーマンストレンドを計算
   * @param {Object} performance - パフォーマンスオブジェクト
   */
  calculateRecentTrend(performance) {
    const recentTrades = performance.trades.slice(-10); // 最近10取引
    
    if (recentTrades.length < 2) {
      performance.recentTrend = 'neutral';
      return;
    }
    
    const recentPnL = recentTrades.reduce((sum, trade) => sum + trade.pnl, 0);
    const recentWinRate = recentTrades.filter(trade => trade.isWin).length / recentTrades.length;
    
    if (recentPnL > 0 && recentWinRate > 0.6) {
      performance.recentTrend = 'improving';
    } else if (recentPnL < 0 && recentWinRate < 0.4) {
      performance.recentTrend = 'declining';
    } else {
      performance.recentTrend = 'neutral';
    }
  }
  
  /**
   * パフォーマンスを取得
   * @param {string} exchangeId - 取引所ID
   * @param {string} symbol - シンボル
   * @param {string} strategyKey - 戦略キー
   * @returns {Object} - パフォーマンスデータ
   */
  async getPerformance(exchangeId, symbol, strategyKey) {
    const key = `${exchangeId}:${symbol}:${strategyKey}`;
    
    // キャッシュから取得を試行
    if (this.performanceCache.has(key)) {
      return this.performanceCache.get(key);
    }
    
    try {
      // Redisから取得
      const summary = await getTradeSummary({ exchangeId, symbol, strategyKey });
      
      if (summary && summary.performance) {
        this.performanceCache.set(key, summary.performance);
        return summary.performance;
      }
      
      return null;
    } catch (error) {
      console.error(`パフォーマンス取得エラー: ${key}`, error.message);
      return null;
    }
  }
  
  /**
   * パフォーマンスを保存
   * @param {string} exchangeId - 取引所ID
   * @param {string} symbol - シンボル
   * @param {string} strategyKey - 戦略キー
   * @param {Object} performance - パフォーマンスデータ
   */
  async savePerformance(exchangeId, symbol, strategyKey, performance) {
    try {
      // 既存のサマリーを取得
      let summary = await getTradeSummary({ exchangeId, symbol, strategyKey });
      
      if (!summary) {
        summary = {
          exchangeId,
          symbol,
          strategyKey,
          totalBuy: 0,
          totalSell: 0,
          netPosition: 0,
          createdAt: Date.now()
        };
      }
      
      // パフォーマンスデータを追加/更新
      summary.performance = performance;
      summary.lastUpdated = Date.now();
      
      // Redisに保存
      await updateTradeSummary({ exchangeId, symbol, strategyKey }, summary);
      
    } catch (error) {
      console.error(`パフォーマンス保存エラー: ${exchangeId}:${symbol}:${strategyKey}`, error.message);
    }
  }
  
  /**
   * パフォーマンスオブジェクトを初期化
   * @returns {Object} - 初期化されたパフォーマンスオブジェクト
   */
  initializePerformance() {
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      totalBuy: 0,
      totalSell: 0,
      totalBuyValue: 0,
      totalSellValue: 0,
      netPosition: 0,
      totalPnL: 0,
      totalWinPnL: 0,
      totalLossPnL: 0,
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0,
      maxDrawdown: 0,
      sharpeRatio: 0,
      recentTrend: 'neutral',
      lastBuyPrice: null,
      lastSellPrice: null,
      lastTradeTime: null,
      lastUpdated: Date.now(),
      trades: [] // 最近の取引履歴（最大100件）
    };
  }
  
  /**
   * 戦略のパフォーマンスレポートを生成
   * @param {string} exchangeId - 取引所ID
   * @param {string} symbol - シンボル
   * @param {string} strategyKey - 戦略キー
   * @returns {Object} - パフォーマンスレポート
   */
  async generatePerformanceReport(exchangeId, symbol, strategyKey) {
    const performance = await this.getPerformance(exchangeId, symbol, strategyKey);
    
    if (!performance) {
      return null;
    }
    
    const completedTrades = performance.winningTrades + performance.losingTrades;
    
    return {
      strategy: strategyKey,
      symbol,
      exchange: exchangeId,
      summary: {
        totalTrades: performance.totalTrades,
        completedTrades,
        winningTrades: performance.winningTrades,
        losingTrades: performance.losingTrades,
        winRate: (performance.winRate !== null && performance.winRate !== undefined ? (performance.winRate * 100).toFixed(2) : '0.00') + '%',
        totalPnL: performance.totalPnL !== null && performance.totalPnL !== undefined ? performance.totalPnL.toFixed(2) : '0.00',
        avgWin: performance.avgWin !== null && performance.avgWin !== undefined ? performance.avgWin.toFixed(2) : '0.00',
        avgLoss: performance.avgLoss !== null && performance.avgLoss !== undefined ? performance.avgLoss.toFixed(2) : '0.00',
        profitFactor: performance.profitFactor !== null && performance.profitFactor !== undefined ? performance.profitFactor.toFixed(2) : '0.00',
        maxDrawdown: (performance.maxDrawdown !== null && performance.maxDrawdown !== undefined ? (performance.maxDrawdown * 100).toFixed(2) : '0.00') + '%',
        sharpeRatio: performance.sharpeRatio !== null && performance.sharpeRatio !== undefined ? performance.sharpeRatio.toFixed(2) : '0.00',
        recentTrend: performance.recentTrend
      },
      positions: {
        netPosition: performance.netPosition,
        totalBuy: performance.totalBuy,
        totalSell: performance.totalSell,
        lastBuyPrice: performance.lastBuyPrice,
        lastSellPrice: performance.lastSellPrice
      },
      timing: {
        lastTradeTime: performance.lastTradeTime ? new Date(performance.lastTradeTime).toISOString() : null,
        lastUpdated: new Date(performance.lastUpdated).toISOString()
      }
    };
  }
  
  /**
   * 全戦略のパフォーマンス概要を取得
   * @param {string} exchangeId - 取引所ID（オプション）
   * @returns {Array} - パフォーマンス概要リスト
   */
  async getAllPerformanceSummary(exchangeId = null) {
    const summaries = [];
    
    for (const [key, performance] of this.performanceCache.entries()) {
      const [exId, symbol, strategyKey] = key.split(':');
      
      if (exchangeId && exId !== exchangeId) {
        continue;
      }
      
      const completedTrades = performance.winningTrades + performance.losingTrades;
      
      summaries.push({
        key,
        exchangeId: exId,
        symbol,
        strategy: strategyKey,
        completedTrades,
        winRate: performance.winRate,
        totalPnL: performance.totalPnL,
        sharpeRatio: performance.sharpeRatio,
        maxDrawdown: performance.maxDrawdown,
        recentTrend: performance.recentTrend,
        lastUpdated: performance.lastUpdated
      });
    }
    
    // パフォーマンスでソート（Sharpe比率降順）
    return summaries.sort((a, b) => b.sharpeRatio - a.sharpeRatio);
  }
  
  /**
   * パフォーマンスキャッシュをクリア
   * @param {string} key - 特定のキー（オプション）
   */
  clearCache(key = null) {
    if (key) {
      this.performanceCache.delete(key);
    } else {
      this.performanceCache.clear();
    }
  }
  
  /**
   * 定期更新を開始
   * @param {number} intervalMs - 更新間隔（ミリ秒）
   */
  startPeriodicUpdate(intervalMs = 300000) { // 5分間隔
    const interval = setInterval(async () => {
      try {
        // 全キャッシュのパフォーマンスを再計算
        for (const [key, performance] of this.performanceCache.entries()) {
          this.recalculateMetrics(performance);
          
          const [exchangeId, symbol, strategyKey] = key.split(':');
          await this.savePerformance(exchangeId, symbol, strategyKey, performance);
        }
      } catch (error) {
        console.error('定期パフォーマンス更新エラー:', error.message);
      }
    }, intervalMs);
    
    this.updateIntervals.set('periodic', interval);
  }
  
  /**
   * 定期更新を停止
   */
  stopPeriodicUpdate() {
    for (const [name, interval] of this.updateIntervals.entries()) {
      clearInterval(interval);
    }
    this.updateIntervals.clear();
  }
}

// シングルトンインスタンスを作成
const performanceTracker = new PerformanceTracker();

module.exports = {
  PerformanceTracker,
  performanceTracker
};