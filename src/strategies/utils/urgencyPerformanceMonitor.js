/**
 * 動的urgency調整の効果測定・監視システム
 * リアルタイムでurgency調整の効果を追跡し、最適化のための洞察を提供
 */

const { getTradeSummary, getStrategyPositionsRedis } = require('../../database/redisDatabase');

class UrgencyPerformanceMonitor {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.measurementWindow = options.measurementWindow || 86400000; // 24時間
    this.minSampleSize = options.minSampleSize || 10;
    
    // パフォーマンス追跡データ
    this.urgencyHistory = new Map(); // urgencyレベル別の成果追跡
    this.adjustmentImpacts = new Map(); // 調整要因別の効果測定
    this.timeBasedEffects = new Map(); // 時間帯別効果
    
    // A/Bテスト用のコントロール群
    this.controlGroup = new Map(); // 静的urgencyでの結果
    this.testGroup = new Map();    // 動的urgencyでの結果
    
    console.log('[UrgencyPerformanceMonitor] 初期化完了');
  }

  /**
   * 注文実行結果を記録
   * @param {Object} orderData - 注文データ
   * @param {Object} urgencyData - urgency調整データ
   * @param {Object} result - 実行結果
   */
  recordOrderExecution(orderData, urgencyData, result) {
    if (!this.enabled) return;

    try {
      const timestamp = Date.now();
      const recordId = `${orderData.symbol}_${orderData.side}_${timestamp}`;

      // 基本記録データ
      const record = {
        id: recordId,
        timestamp,
        symbol: orderData.symbol,
        side: orderData.side,
        amount: orderData.amount,
        baseUrgency: urgencyData.base,
        finalUrgency: urgencyData.final,
        adjustmentFactor: urgencyData.adjustmentFactor,
        factors: urgencyData.factors,
        
        // 実行結果
        success: result.success,
        executionTime: result.executionTime,
        slippage: result.slippage,
        fillRate: result.fillRate,
        avgPrice: result.avgPrice,
        
        // 市場状況
        marketCondition: {
          volatility: urgencyData.factors?.volatility || 0,
          risk: urgencyData.factors?.portfolioRisk || 0,
          timezone: urgencyData.factors?.timezone || 0,
          performance: urgencyData.factors?.performance || 0
        }
      };

      // urgencyレベル別統計
      this.updateUrgencyStats(urgencyData.final, record);
      
      // 調整要因別効果測定
      this.updateAdjustmentImpacts(urgencyData, record);
      
      // 時間帯別効果
      this.updateTimeBasedEffects(timestamp, record);
      
      // A/Bテスト記録
      this.updateABTestData(urgencyData, record);

      console.log(`[UrgencyMonitor] 記録完了: ${recordId} urgency=${urgencyData.base}→${urgencyData.final}`);

    } catch (error) {
      console.error('[UrgencyMonitor] 記録エラー:', error.message);
    }
  }

  /**
   * urgencyレベル別統計を更新
   */
  updateUrgencyStats(urgencyLevel, record) {
    if (!this.urgencyHistory.has(urgencyLevel)) {
      this.urgencyHistory.set(urgencyLevel, {
        count: 0,
        successRate: 0,
        avgExecutionTime: 0,
        avgSlippage: 0,
        avgFillRate: 0,
        totalSlippage: 0,
        totalExecutionTime: 0,
        totalFillRate: 0,
        successCount: 0
      });
    }

    const stats = this.urgencyHistory.get(urgencyLevel);
    stats.count++;
    
    if (record.success) {
      stats.successCount++;
      stats.totalExecutionTime += record.executionTime || 0;
      stats.totalSlippage += Math.abs(record.slippage || 0);
      stats.totalFillRate += record.fillRate || 0;
    }

    // 平均値更新
    stats.successRate = stats.successCount / stats.count;
    stats.avgExecutionTime = stats.successCount > 0 ? stats.totalExecutionTime / stats.successCount : 0;
    stats.avgSlippage = stats.successCount > 0 ? stats.totalSlippage / stats.successCount : 0;
    stats.avgFillRate = stats.successCount > 0 ? stats.totalFillRate / stats.successCount : 0;
  }

  /**
   * 調整要因別効果を測定
   */
  updateAdjustmentImpacts(urgencyData, record) {
    const factors = ['volatility', 'portfolioRisk', 'timezone', 'performance'];
    
    factors.forEach(factor => {
      const factorValue = urgencyData.factors?.[factor] || 0;
      const impactCategory = this.categorizeImpact(factorValue);
      const key = `${factor}_${impactCategory}`;

      if (!this.adjustmentImpacts.has(key)) {
        this.adjustmentImpacts.set(key, {
          factor,
          category: impactCategory,
          count: 0,
          avgAdjustment: 0,
          totalAdjustment: 0,
          successRate: 0,
          successCount: 0,
          performanceScore: 0
        });
      }

      const impact = this.adjustmentImpacts.get(key);
      impact.count++;
      impact.totalAdjustment += Math.abs(factorValue);
      
      if (record.success) {
        impact.successCount++;
        // パフォーマンススコア：実行時間とスリッページの逆数
        const executionScore = record.executionTime ? 1000 / record.executionTime : 0;
        const slippageScore = record.slippage ? 1 / (1 + Math.abs(record.slippage)) : 1;
        impact.performanceScore += (executionScore + slippageScore) / 2;
      }

      impact.avgAdjustment = impact.totalAdjustment / impact.count;
      impact.successRate = impact.successCount / impact.count;
    });
  }

  /**
   * 時間帯別効果を更新
   */
  updateTimeBasedEffects(timestamp, record) {
    const hour = new Date(timestamp).getHours();
    const timeSlot = `${Math.floor(hour / 4) * 4}-${Math.floor(hour / 4) * 4 + 3}h`; // 4時間スロット

    if (!this.timeBasedEffects.has(timeSlot)) {
      this.timeBasedEffects.set(timeSlot, {
        timeSlot,
        count: 0,
        successRate: 0,
        avgAdjustmentMagnitude: 0,
        totalAdjustmentMagnitude: 0,
        successCount: 0,
        optimalUrgency: new Map() // 最適urgencyの分析
      });
    }

    const timeEffect = this.timeBasedEffects.get(timeSlot);
    timeEffect.count++;
    timeEffect.totalAdjustmentMagnitude += Math.abs(record.adjustmentFactor || 0);
    
    if (record.success) {
      timeEffect.successCount++;
      
      // 最適urgency分析
      const urgency = record.finalUrgency;
      if (!timeEffect.optimalUrgency.has(urgency)) {
        timeEffect.optimalUrgency.set(urgency, { count: 0, successCount: 0 });
      }
      timeEffect.optimalUrgency.get(urgency).count++;
      timeEffect.optimalUrgency.get(urgency).successCount++;
    }

    timeEffect.successRate = timeEffect.successCount / timeEffect.count;
    timeEffect.avgAdjustmentMagnitude = timeEffect.totalAdjustmentMagnitude / timeEffect.count;
  }

  /**
   * A/Bテストデータを更新
   */
  updateABTestData(urgencyData, record) {
    const group = urgencyData.base === urgencyData.final ? 'control' : 'test';
    const groupData = group === 'control' ? this.controlGroup : this.testGroup;

    const key = `${record.symbol}_${record.side}`;
    if (!groupData.has(key)) {
      groupData.set(key, {
        symbol: record.symbol,
        side: record.side,
        count: 0,
        successRate: 0,
        avgExecutionTime: 0,
        avgSlippage: 0,
        successCount: 0,
        totalExecutionTime: 0,
        totalSlippage: 0
      });
    }

    const data = groupData.get(key);
    data.count++;
    
    if (record.success) {
      data.successCount++;
      data.totalExecutionTime += record.executionTime || 0;
      data.totalSlippage += Math.abs(record.slippage || 0);
    }

    data.successRate = data.successCount / data.count;
    data.avgExecutionTime = data.successCount > 0 ? data.totalExecutionTime / data.successCount : 0;
    data.avgSlippage = data.successCount > 0 ? data.totalSlippage / data.successCount : 0;
  }

  /**
   * 調整影響をカテゴリ化
   */
  categorizeImpact(value) {
    if (value > 0.3) return 'strong_positive';
    if (value > 0.1) return 'moderate_positive';
    if (value > -0.1) return 'neutral';
    if (value > -0.3) return 'moderate_negative';
    return 'strong_negative';
  }

  /**
   * 包括的なパフォーマンスレポートを生成
   */
  generatePerformanceReport() {
    try {
      const report = {
        timestamp: new Date().toISOString(),
        summary: this.generateSummaryStats(),
        urgencyAnalysis: this.generateUrgencyAnalysis(),
        factorEffectiveness: this.generateFactorEffectiveness(),
        timeBasedInsights: this.generateTimeBasedInsights(),
        abTestResults: this.generateABTestResults(),
        recommendations: this.generateRecommendations()
      };

      return report;
    } catch (error) {
      console.error('[UrgencyMonitor] レポート生成エラー:', error.message);
      return null;
    }
  }

  /**
   * サマリー統計を生成
   */
  generateSummaryStats() {
    let totalOrders = 0;
    let totalSuccess = 0;
    let totalAdjustments = 0;

    for (const [urgency, stats] of this.urgencyHistory) {
      totalOrders += stats.count;
      totalSuccess += stats.successCount;
    }

    for (const [key, impact] of this.adjustmentImpacts) {
      if (impact.category !== 'neutral') {
        totalAdjustments += impact.count;
      }
    }

    return {
      totalOrders,
      overallSuccessRate: totalOrders > 0 ? totalSuccess / totalOrders : 0,
      adjustmentRate: totalOrders > 0 ? totalAdjustments / totalOrders : 0,
      monitoringPeriod: this.measurementWindow / 3600000 // 時間単位
    };
  }

  /**
   * urgency別分析を生成
   */
  generateUrgencyAnalysis() {
    const analysis = {};
    
    for (const [urgency, stats] of this.urgencyHistory) {
      if (stats.count >= this.minSampleSize) {
        analysis[urgency] = {
          sampleSize: stats.count,
          successRate: (stats.successRate * 100).toFixed(2) + '%',
          avgExecutionTime: stats.avgExecutionTime.toFixed(2) + 'ms',
          avgSlippage: (stats.avgSlippage * 100).toFixed(4) + '%',
          avgFillRate: (stats.avgFillRate * 100).toFixed(2) + '%'
        };
      }
    }

    return analysis;
  }

  /**
   * 要因効果分析を生成
   */
  generateFactorEffectiveness() {
    const effectiveness = {};
    
    for (const [key, impact] of this.adjustmentImpacts) {
      if (impact.count >= this.minSampleSize) {
        effectiveness[key] = {
          sampleSize: impact.count,
          avgAdjustment: impact.avgAdjustment.toFixed(3),
          successRate: (impact.successRate * 100).toFixed(2) + '%',
          performanceScore: impact.performanceScore.toFixed(2),
          effectiveness: this.calculateEffectiveness(impact)
        };
      }
    }

    return effectiveness;
  }

  /**
   * 時間帯別インサイトを生成
   */
  generateTimeBasedInsights() {
    const insights = {};
    
    for (const [timeSlot, effect] of this.timeBasedEffects) {
      if (effect.count >= this.minSampleSize) {
        insights[timeSlot] = {
          sampleSize: effect.count,
          successRate: (effect.successRate * 100).toFixed(2) + '%',
          avgAdjustmentMagnitude: effect.avgAdjustmentMagnitude.toFixed(3),
          optimalUrgency: this.findOptimalUrgencyForTime(effect.optimalUrgency)
        };
      }
    }

    return insights;
  }

  /**
   * A/Bテスト結果を生成
   */
  generateABTestResults() {
    const results = {
      control: {},
      test: {},
      comparison: {}
    };

    // コントロール群とテスト群のデータを整理
    for (const [key, data] of this.controlGroup) {
      if (data.count >= this.minSampleSize) {
        results.control[key] = {
          successRate: (data.successRate * 100).toFixed(2) + '%',
          avgExecutionTime: data.avgExecutionTime.toFixed(2) + 'ms',
          avgSlippage: (data.avgSlippage * 100).toFixed(4) + '%'
        };
      }
    }

    for (const [key, data] of this.testGroup) {
      if (data.count >= this.minSampleSize) {
        results.test[key] = {
          successRate: (data.successRate * 100).toFixed(2) + '%',
          avgExecutionTime: data.avgExecutionTime.toFixed(2) + 'ms',
          avgSlippage: (data.avgSlippage * 100).toFixed(4) + '%'
        };

        // 比較分析
        const controlData = this.controlGroup.get(key);
        if (controlData && controlData.count >= this.minSampleSize) {
          results.comparison[key] = this.compareABGroups(controlData, data);
        }
      }
    }

    return results;
  }

  /**
   * 効果度を計算
   */
  calculateEffectiveness(impact) {
    const successWeight = 0.4;
    const performanceWeight = 0.6;
    
    const successScore = impact.successRate;
    const performanceScore = Math.min(impact.performanceScore / 100, 1); // 正規化
    
    const effectiveness = (successScore * successWeight) + (performanceScore * performanceWeight);
    
    if (effectiveness > 0.8) return 'excellent';
    if (effectiveness > 0.6) return 'good';
    if (effectiveness > 0.4) return 'moderate';
    return 'poor';
  }

  /**
   * 時間帯別最適urgencyを特定
   */
  findOptimalUrgencyForTime(optimalUrgencyMap) {
    let bestUrgency = 'medium';
    let bestScore = 0;

    for (const [urgency, data] of optimalUrgencyMap) {
      const successRate = data.count > 0 ? data.successCount / data.count : 0;
      if (successRate > bestScore && data.count >= 3) {
        bestScore = successRate;
        bestUrgency = urgency;
      }
    }

    return {
      urgency: bestUrgency,
      successRate: (bestScore * 100).toFixed(2) + '%'
    };
  }

  /**
   * A/B群比較
   */
  compareABGroups(controlData, testData) {
    const successRateImprovement = testData.successRate - controlData.successRate;
    const executionTimeImprovement = controlData.avgExecutionTime - testData.avgExecutionTime;
    const slippageImprovement = controlData.avgSlippage - testData.avgSlippage;

    return {
      successRateImprovement: (successRateImprovement * 100).toFixed(2) + '%',
      executionTimeImprovement: executionTimeImprovement.toFixed(2) + 'ms',
      slippageImprovement: (slippageImprovement * 100).toFixed(4) + '%',
      overallImprovement: this.calculateOverallImprovement(successRateImprovement, executionTimeImprovement, slippageImprovement)
    };
  }

  /**
   * 総合改善度を計算
   */
  calculateOverallImprovement(successRate, executionTime, slippage) {
    const weights = { successRate: 0.5, executionTime: 0.3, slippage: 0.2 };
    
    // 正規化スコア（-1 to 1）
    const successScore = Math.max(-1, Math.min(1, successRate / 0.1)); // 10%改善で満点
    const executionScore = Math.max(-1, Math.min(1, executionTime / 1000)); // 1秒改善で満点
    const slippageScore = Math.max(-1, Math.min(1, slippage / 0.001)); // 0.1%改善で満点

    const totalScore = (successScore * weights.successRate) + 
                      (executionScore * weights.executionTime) + 
                      (slippageScore * weights.slippage);

    if (totalScore > 0.5) return 'significant_improvement';
    if (totalScore > 0.2) return 'moderate_improvement';
    if (totalScore > -0.2) return 'neutral';
    if (totalScore > -0.5) return 'moderate_degradation';
    return 'significant_degradation';
  }

  /**
   * 推奨事項を生成
   */
  generateRecommendations() {
    const recommendations = [];

    // urgency別パフォーマンス分析に基づく推奨
    let bestUrgency = 'medium';
    let bestPerformance = 0;
    
    for (const [urgency, stats] of this.urgencyHistory) {
      if (stats.count >= this.minSampleSize) {
        const performance = stats.successRate * 0.6 + (1 - stats.avgSlippage) * 0.4;
        if (performance > bestPerformance) {
          bestPerformance = performance;
          bestUrgency = urgency;
        }
      }
    }

    recommendations.push({
      type: 'optimal_urgency',
      message: `最高パフォーマンス: ${bestUrgency} (スコア: ${bestPerformance.toFixed(3)})`,
      priority: 'high'
    });

    // 要因効果に基づく推奨
    for (const [key, impact] of this.adjustmentImpacts) {
      if (impact.count >= this.minSampleSize) {
        const effectiveness = this.calculateEffectiveness(impact);
        if (effectiveness === 'poor') {
          recommendations.push({
            type: 'factor_adjustment',
            message: `${impact.factor}要因の重み調整を検討 (効果: ${effectiveness})`,
            priority: 'medium'
          });
        }
      }
    }

    // A/Bテスト結果に基づく推奨
    let significantImprovements = 0;
    for (const [key, data] of this.testGroup) {
      const controlData = this.controlGroup.get(key);
      if (controlData && controlData.count >= this.minSampleSize && data.count >= this.minSampleSize) {
        const comparison = this.compareABGroups(controlData, data);
        if (comparison.overallImprovement === 'significant_improvement') {
          significantImprovements++;
        }
      }
    }

    if (significantImprovements > 0) {
      recommendations.push({
        type: 'system_validation',
        message: `動的urgency調整により${significantImprovements}通貨ペアで有意な改善を確認`,
        priority: 'high'
      });
    }

    return recommendations;
  }

  /**
   * キャッシュクリア
   */
  clearCache() {
    const currentTime = Date.now();
    const cutoffTime = currentTime - this.measurementWindow;

    // 古いデータを削除（メモリ使用量制限）
    // 実装は簡略化、実際にはタイムスタンプベースでの削除が必要
    if (this.urgencyHistory.size > 1000) {
      this.urgencyHistory.clear();
    }
    if (this.adjustmentImpacts.size > 1000) {
      this.adjustmentImpacts.clear();
    }
  }
}

module.exports = { UrgencyPerformanceMonitor };