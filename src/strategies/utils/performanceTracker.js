const { getTradeSummary, updateTradeSummary } = require('../../database/redisDatabase');
const { AdvancedPerformanceMetrics } = require('./advancedPerformanceMetrics');
const { MonteCarloBootstrapping } = require('./monteCarloBootstrapping');

/**
 * 戦略別パフォーマンス追跡システム
 */
class PerformanceTracker {
  constructor() {
    this.performanceCache = new Map(); // メモリキャッシュ
    this.updateIntervals = new Map(); // 定期更新用
    this.advancedMetrics = new AdvancedPerformanceMetrics(); // 高度パフォーマンス指標
    this.mcBootstrap = new MonteCarloBootstrapping({ // Monte Carlo Bootstrapping
      iterations: 1000,
      confidenceLevel: 0.95,
      biasCorrection: true
    });
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
    
    // 高度パフォーマンス指標を計算
    this.calculateAdvancedMetrics(performance);
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
   * 高度パフォーマンス指標を計算
   * @param {Object} performance - パフォーマンスオブジェクト
   */
  calculateAdvancedMetrics(performance) {
    if (performance.trades.length < 10) {
      // データが不十分な場合はデフォルト値を設定
      performance.calmarRatio = 0;
      performance.sortinoRatio = 0;
      performance.var95 = 0;
      performance.var99 = 0;
      performance.annualizedReturn = 0;
      performance.downsideDeviation = 0;
      return;
    }

    try {
      // 高度パフォーマンス指標を計算
      const advancedMetrics = this.advancedMetrics.calculateAllMetrics(performance.trades);
      
      // パフォーマンスオブジェクトに結果を追加
      performance.calmarRatio = advancedMetrics.calmarRatio;
      performance.sortinoRatio = advancedMetrics.sortinoRatio;
      performance.var95 = advancedMetrics.var95;
      performance.var99 = advancedMetrics.var99;
      performance.annualizedReturn = advancedMetrics.annualizedReturn;
      performance.downsideDeviation = advancedMetrics.downsideDeviation;
      
    } catch (error) {
      console.error('高度パフォーマンス指標計算エラー:', error.message);
      // エラー時はデフォルト値を設定
      performance.calmarRatio = 0;
      performance.sortinoRatio = 0;
      performance.var95 = 0;
      performance.var99 = 0;
      performance.annualizedReturn = 0;
      performance.downsideDeviation = 0;
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
      // 高度パフォーマンス指標
      calmarRatio: 0,
      sortinoRatio: 0,
      var95: 0,
      var99: 0,
      annualizedReturn: 0,
      downsideDeviation: 0,
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
        recentTrend: performance.recentTrend,
        // 高度パフォーマンス指標
        calmarRatio: performance.calmarRatio !== null && performance.calmarRatio !== undefined ? performance.calmarRatio.toFixed(3) : '0.000',
        sortinoRatio: performance.sortinoRatio !== null && performance.sortinoRatio !== undefined ? performance.sortinoRatio.toFixed(3) : '0.000',
        var95: performance.var95 !== null && performance.var95 !== undefined ? (performance.var95 * 100).toFixed(2) + '%' : '0.00%',
        var99: performance.var99 !== null && performance.var99 !== undefined ? (performance.var99 * 100).toFixed(2) + '%' : '0.00%',
        annualizedReturn: performance.annualizedReturn !== null && performance.annualizedReturn !== undefined ? (performance.annualizedReturn * 100).toFixed(2) + '%' : '0.00%',
        downsideDeviation: performance.downsideDeviation !== null && performance.downsideDeviation !== undefined ? (performance.downsideDeviation * 100).toFixed(2) + '%' : '0.00%'
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
        // 高度パフォーマンス指標
        calmarRatio: performance.calmarRatio || 0,
        sortinoRatio: performance.sortinoRatio || 0,
        var95: performance.var95 || 0,
        var99: performance.var99 || 0,
        annualizedReturn: performance.annualizedReturn || 0,
        downsideDeviation: performance.downsideDeviation || 0,
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
  
  /**
   * Monte Carlo Bootstrapping統計分析を実行
   * @param {string} exchangeId - 取引所ID
   * @param {string} symbol - シンボル
   * @param {string} strategyKey - 戦略キー
   * @returns {Object} Monte Carlo分析結果
   */
  async performMonteCarloAnalysis(exchangeId, symbol, strategyKey) {
    try {
      const performance = await this.getPerformance(exchangeId, symbol, strategyKey);
      
      if (!performance || performance.trades.length < 10) {
        return {
          error: 'トレードデータが不足しています（最低10取引必要）',
          tradeCount: performance?.trades.length || 0,
          minRequired: 10
        };
      }
      
      // PnL配列からリターン系列を計算
      const returns = this._calculateReturnsFromTrades(performance.trades);
      
      if (returns.length < 5) {
        return {
          error: 'リターンデータが不足しています',
          returnCount: returns.length,
          minRequired: 5
        };
      }
      
      console.log(`🔬 Monte Carlo分析開始: ${exchangeId}:${symbol}:${strategyKey}`);
      
      // 包括的Monte Carlo分析
      const mcAnalysis = await this.mcBootstrap.comprehensiveAnalysis(returns, {
        riskFreeRate: 0,
        includeHigherMoments: true,
        includeTailRisk: true
      });
      
      // 戦略固有の分析を追加
      const strategySpecificAnalysis = this._analyzeStrategySpecificMetrics(performance, mcAnalysis);
      
      const result = {
        timestamp: new Date().toISOString(),
        exchangeId,
        symbol,
        strategyKey,
        tradeCount: performance.trades.length,
        analysisData: {
          ...mcAnalysis,
          strategySpecific: strategySpecificAnalysis
        },
        summary: this._generateMCAnalysisSummary(mcAnalysis, strategySpecificAnalysis),
        recommendations: this._generateMCRecommendations(mcAnalysis, performance)
      };
      
      console.log(`✅ Monte Carlo分析完了: ${exchangeId}:${symbol}:${strategyKey}`);
      return result;
      
    } catch (error) {
      console.error(`❌ Monte Carlo分析エラー: ${exchangeId}:${symbol}:${strategyKey}`, error.message);
      return {
        error: error.message,
        timestamp: new Date().toISOString(),
        exchangeId,
        symbol,
        strategyKey
      };
    }
  }
  
  /**
   * 複数戦略のMonte Carlo比較分析
   * @param {Array} strategies - 戦略リスト [{exchangeId, symbol, strategyKey}]
   * @returns {Object} 比較分析結果
   */
  async compareStrategiesWithMonteCarlo(strategies) {
    try {
      const analyses = [];
      
      for (const strategy of strategies) {
        const analysis = await this.performMonteCarloAnalysis(
          strategy.exchangeId, 
          strategy.symbol, 
          strategy.strategyKey
        );
        
        if (!analysis.error) {
          analyses.push({
            ...strategy,
            analysis
          });
        }
      }
      
      if (analyses.length < 2) {
        return {
          error: '比較に十分な戦略データがありません',
          validAnalyses: analyses.length,
          minRequired: 2
        };
      }
      
      // 戦略間比較
      const comparison = this._compareMonteCarloResults(analyses);
      
      return {
        timestamp: new Date().toISOString(),
        strategies: analyses,
        comparison,
        ranking: this._rankStrategiesByMonteCarlo(analyses)
      };
      
    } catch (error) {
      console.error('戦略比較Monte Carlo分析エラー:', error.message);
      return { error: error.message };
    }
  }
  
  /**
   * トレードからリターン系列を計算
   * @param {Array} trades - トレード配列
   * @returns {Array} リターン配列
   */
  _calculateReturnsFromTrades(trades) {
    if (trades.length <= 1) return [];
    
    // PnLを累積してからリターンレートを計算
    let cumulative = 0;
    const returns = [];
    
    for (const trade of trades) {
      const prevCumulative = cumulative;
      cumulative += trade.pnl;
      
      if (prevCumulative !== 0) {
        const returnRate = trade.pnl / Math.abs(prevCumulative);
        returns.push(returnRate);
      } else {
        // 最初のトレードは固定リターンとして扱う
        returns.push(trade.pnl / 1000); // 基準金額で正規化
      }
    }
    
    return returns;
  }
  
  /**
   * 戦略固有の分析指標
   * @param {Object} performance - パフォーマンス情報
   * @param {Object} mcAnalysis - Monte Carlo分析結果
   * @returns {Object} 戦略固有分析
   */
  _analyzeStrategySpecificMetrics(performance, mcAnalysis) {
    return {
      tradingFrequency: {
        totalTrades: performance.totalTrades,
        completedTrades: performance.winningTrades + performance.losingTrades,
        avgTradesPerPeriod: this._calculateTradingFrequency(performance)
      },
      winLossAnalysis: {
        winRate: performance.winRate,
        avgWin: performance.avgWin,
        avgLoss: performance.avgLoss,
        winLossRatio: performance.avgLoss > 0 ? performance.avgWin / performance.avgLoss : 0
      },
      riskMetrics: {
        maxDrawdown: performance.maxDrawdown,
        profitFactor: performance.profitFactor,
        currentSharpe: performance.sharpeRatio,
        mcSharpe: mcAnalysis.sharpeAnalysis?.originalSharpe || 0
      },
      consistency: {
        recentTrend: performance.recentTrend,
        volatility: mcAnalysis.basicStats?.volatility || 0,
        skewness: mcAnalysis.basicStats?.skewness || 0,
        kurtosis: mcAnalysis.basicStats?.kurtosis || 0
      }
    };
  }
  
  /**
   * Monte Carlo分析サマリーを生成
   * @param {Object} mcAnalysis - Monte Carlo分析結果
   * @param {Object} strategySpecific - 戦略固有分析
   * @returns {Object} サマリー
   */
  _generateMCAnalysisSummary(mcAnalysis, strategySpecific) {
    const summary = {
      performance: 'unknown',
      risk: 'unknown',
      consistency: 'unknown',
      recommendation: 'analysis_needed'
    };
    
    try {
      // パフォーマンス評価
      const sharpe = mcAnalysis.sharpeAnalysis?.originalSharpe || 0;
      if (sharpe > 1.5) {
        summary.performance = 'excellent';
      } else if (sharpe > 1.0) {
        summary.performance = 'good';
      } else if (sharpe > 0.5) {
        summary.performance = 'average';
      } else {
        summary.performance = 'poor';
      }
      
      // リスク評価
      const maxDrawdown = mcAnalysis.drawdownAnalysis?.originalDrawdown || 0;
      const varRobustness = mcAnalysis.varAnalysis?.robustnessScore || 0;
      
      if (maxDrawdown > 0.2 || varRobustness < 0.5) {
        summary.risk = 'high';
      } else if (maxDrawdown > 0.1 || varRobustness < 0.7) {
        summary.risk = 'medium';
      } else {
        summary.risk = 'low';
      }
      
      // 一貫性評価
      const volatility = mcAnalysis.basicStats?.volatility || 0;
      const winRate = strategySpecific.winLossAnalysis?.winRate || 0;
      
      if (volatility < 0.1 && winRate > 0.6) {
        summary.consistency = 'high';
      } else if (volatility < 0.2 && winRate > 0.5) {
        summary.consistency = 'medium';
      } else {
        summary.consistency = 'low';
      }
      
      // 総合推奨
      if (summary.performance === 'excellent' && summary.risk === 'low') {
        summary.recommendation = 'deploy';
      } else if (summary.performance === 'good' && summary.risk !== 'high') {
        summary.recommendation = 'monitor';
      } else if (summary.performance === 'poor' || summary.risk === 'high') {
        summary.recommendation = 'optimize';
      } else {
        summary.recommendation = 'review';
      }
      
    } catch (error) {
      console.error('Monte Carlo サマリー生成エラー:', error.message);
      summary.error = error.message;
    }
    
    return summary;
  }
  
  /**
   * Monte Carlo分析ベースの推奨事項生成
   * @param {Object} mcAnalysis - Monte Carlo分析結果
   * @param {Object} performance - パフォーマンス情報
   * @returns {Array} 推奨事項配列
   */
  _generateMCRecommendations(mcAnalysis, performance) {
    const recommendations = [];
    
    try {
      // Sharpe比率ベースの推奨
      if (mcAnalysis.sharpeAnalysis?.originalSharpe < 0.5) {
        recommendations.push({
          type: 'performance_improvement',
          priority: 'high',
          message: 'Sharpe比率が低いため、リターン最適化またはリスク削減を検討してください',
          metric: 'sharpe_ratio',
          value: mcAnalysis.sharpeAnalysis.originalSharpe,
          action: 'parameter_optimization'
        });
      }
      
      // 最大ドローダウンベースの推奨
      if (mcAnalysis.drawdownAnalysis?.originalDrawdown > 0.15) {
        recommendations.push({
          type: 'risk_management',
          priority: 'high',
          message: '最大ドローダウンが大きいため、ポジションサイズ調整を推奨します',
          metric: 'max_drawdown',
          value: mcAnalysis.drawdownAnalysis.originalDrawdown,
          action: 'position_sizing_review'
        });
      }
      
      // 勝率ベースの推奨
      if (performance.winRate < 0.4) {
        recommendations.push({
          type: 'strategy_tuning',
          priority: 'medium',
          message: '勝率が低いため、エントリー・エグジット条件の見直しを推奨します',
          metric: 'win_rate',
          value: performance.winRate,
          action: 'entry_exit_optimization'
        });
      }
      
      // VaR堅牢性ベースの推奨
      if (mcAnalysis.varAnalysis?.robustnessScore < 0.6) {
        recommendations.push({
          type: 'stability_improvement',
          priority: 'medium',
          message: 'リスク指標の安定性が低いため、より保守的なパラメータを検討してください',
          metric: 'var_robustness',
          value: mcAnalysis.varAnalysis.robustnessScore,
          action: 'conservative_tuning'
        });
      }
      
      // データ品質の推奨
      if (performance.trades.length < 50) {
        recommendations.push({
          type: 'data_collection',
          priority: 'low',
          message: 'より信頼性の高い分析のため、追加のトレードデータ収集を推奨します',
          metric: 'trade_count',
          value: performance.trades.length,
          action: 'extend_backtest_period'
        });
      }
      
    } catch (error) {
      console.error('Monte Carlo推奨事項生成エラー:', error.message);
      recommendations.push({
        type: 'error',
        priority: 'high',
        message: `推奨事項生成中にエラーが発生しました: ${error.message}`,
        error: true
      });
    }
    
    return recommendations;
  }
  
  /**
   * 取引頻度を計算
   * @param {Object} performance - パフォーマンス情報
   * @returns {number} 期間あたりの取引頻度
   */
  _calculateTradingFrequency(performance) {
    if (performance.trades.length < 2) return 0;
    
    const firstTrade = performance.trades[0];
    const lastTrade = performance.trades[performance.trades.length - 1];
    const periodDays = (lastTrade.timestamp - firstTrade.timestamp) / (1000 * 60 * 60 * 24);
    
    return periodDays > 0 ? performance.trades.length / periodDays : 0;
  }
  
  /**
   * Monte Carlo結果を比較
   * @param {Array} analyses - 分析結果配列
   * @returns {Object} 比較結果
   */
  _compareMonteCarloResults(analyses) {
    const comparison = {
      sharpeComparison: {},
      drawdownComparison: {},
      riskAdjustedReturns: {},
      overallWinner: null
    };
    
    try {
      const sharpeRatios = analyses.map(a => ({
        strategy: `${a.exchangeId}:${a.symbol}:${a.strategyKey}`,
        value: a.analysis.analysisData.sharpeAnalysis?.originalSharpe || 0
      }));
      
      comparison.sharpeComparison = {
        best: sharpeRatios.reduce((prev, curr) => prev.value > curr.value ? prev : curr),
        worst: sharpeRatios.reduce((prev, curr) => prev.value < curr.value ? prev : curr),
        average: sharpeRatios.reduce((sum, s) => sum + s.value, 0) / sharpeRatios.length
      };
      
      const drawdowns = analyses.map(a => ({
        strategy: `${a.exchangeId}:${a.symbol}:${a.strategyKey}`,
        value: a.analysis.analysisData.drawdownAnalysis?.originalDrawdown || 0
      }));
      
      comparison.drawdownComparison = {
        best: drawdowns.reduce((prev, curr) => prev.value < curr.value ? prev : curr),
        worst: drawdowns.reduce((prev, curr) => prev.value > curr.value ? prev : curr),
        average: drawdowns.reduce((sum, d) => sum + d.value, 0) / drawdowns.length
      };
      
      // 総合評価（リスク調整済みリターン）
      const riskAdjustedScores = analyses.map(a => {
        const sharpe = a.analysis.analysisData.sharpeAnalysis?.originalSharpe || 0;
        const drawdown = a.analysis.analysisData.drawdownAnalysis?.originalDrawdown || 0;
        const varRobustness = a.analysis.analysisData.varAnalysis?.robustnessScore || 0;
        
        const score = sharpe * 0.4 + (1 - drawdown) * 0.3 + varRobustness * 0.3;
        
        return {
          strategy: `${a.exchangeId}:${a.symbol}:${a.strategyKey}`,
          score,
          components: { sharpe, drawdown, varRobustness }
        };
      });
      
      comparison.overallWinner = riskAdjustedScores.reduce((prev, curr) => 
        prev.score > curr.score ? prev : curr
      );
      
      comparison.riskAdjustedReturns = riskAdjustedScores;
      
    } catch (error) {
      console.error('Monte Carlo比較エラー:', error.message);
      comparison.error = error.message;
    }
    
    return comparison;
  }
  
  /**
   * Monte Carlo分析で戦略をランキング
   * @param {Array} analyses - 分析結果配列
   * @returns {Array} ランキング結果
   */
  _rankStrategiesByMonteCarlo(analyses) {
    try {
      return analyses
        .map(a => {
          const sharpe = a.analysis.analysisData.sharpeAnalysis?.originalSharpe || 0;
          const drawdown = a.analysis.analysisData.drawdownAnalysis?.originalDrawdown || 0;
          const varRobustness = a.analysis.analysisData.varAnalysis?.robustnessScore || 0;
          const winRate = a.analysis.analysisData.strategySpecific?.winLossAnalysis?.winRate || 0;
          
          // 複合スコア計算
          const score = (
            sharpe * 0.3 +
            (1 - drawdown) * 0.25 +
            varRobustness * 0.25 +
            winRate * 0.2
          );
          
          return {
            rank: 0, // 後で設定
            strategy: `${a.exchangeId}:${a.symbol}:${a.strategyKey}`,
            score,
            metrics: {
              sharpe,
              drawdown,
              varRobustness,
              winRate
            },
            recommendation: a.analysis.summary?.recommendation || 'unknown'
          };
        })
        .sort((a, b) => b.score - a.score)
        .map((item, index) => ({ ...item, rank: index + 1 }));
        
    } catch (error) {
      console.error('Monte Carloランキングエラー:', error.message);
      return [];
    }
  }
}

// シングルトンインスタンスを作成
const performanceTracker = new PerformanceTracker();

module.exports = {
  PerformanceTracker,
  performanceTracker
};