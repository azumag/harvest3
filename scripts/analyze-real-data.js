#!/usr/bin/env node

/**
 * 実データ分析システム
 * 理論値と実測値の乖離を分析し、閾値の調整を提案
 */

const fs = require('fs');
const path = require('path');

class RealDataAnalyzer {
  constructor(dataFile = null) {
    this.dataFile = dataFile || path.join(__dirname, '../data/real-performance-data.json');
    this.theoreticalFile = path.join(__dirname, '../docs/throttle-threshold-analysis.json');
    this.outputFile = path.join(__dirname, '../docs/real-data-analysis.json');
    this.recommendationsFile = path.join(__dirname, '../docs/threshold-recommendations.json');

    this.data = null;
    this.theoreticalData = null;
  }

  /**
     * データ読み込み
     */
  loadData() {
    try {
      // 実データ読み込み
      if (!fs.existsSync(this.dataFile)) {
        throw new Error('実データファイルが見つかりません: ' + this.dataFile);
      }

      const rawData = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
      this.data = rawData.measurements || [];

      console.log(`📊 実データ読み込み: ${this.data.length}件`);

      // 理論値データ読み込み
      if (fs.existsSync(this.theoreticalFile)) {
        this.theoreticalData = JSON.parse(fs.readFileSync(this.theoreticalFile, 'utf8'));
        console.log('🔬 理論値データ読み込み完了');
      }

      return true;

    } catch (error) {
      console.error('❌ データ読み込みエラー:', error.message);
      return false;
    }
  }

  /**
     * 基本統計の算出
     */
  calculateBasicStats() {
    if (!this.data || this.data.length === 0) {
      return null;
    }

    const stats = {
      totalDataPoints: this.data.length,
      timespan: {
        start: new Date(this.data[0].timestamp).toISOString(),
        end: new Date(this.data[this.data.length - 1].timestamp).toISOString(),
        durationDays: (this.data[this.data.length - 1].timestamp - this.data[0].timestamp) / (24 * 60 * 60 * 1000)
      },
      exchanges: {},
      systemMetrics: {
        memoryUsage: [],
        cpuUsage: [],
        uptime: []
      }
    };

    // 取引所ごとの統計
    this.data.forEach(point => {
      // システムメトリクス
      if (point.systemMetrics) {
        stats.systemMetrics.memoryUsage.push(point.systemMetrics.memory.heapUsed);
        stats.systemMetrics.uptime.push(point.systemMetrics.uptime);
      }

      // 取引所メトリクス
      Object.entries(point.exchanges || {}).forEach(([exchangeId, metrics]) => {
        if (!stats.exchanges[exchangeId]) {
          stats.exchanges[exchangeId] = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            responseTimes: [],
            queueSizes: [],
            errors: []
          };
        }

        const exchangeStats = stats.exchanges[exchangeId];
        exchangeStats.totalRequests++;

        if (metrics.api) {
          if (metrics.api.success) {
            exchangeStats.successfulRequests++;
            if (metrics.api.responseTime) {
              exchangeStats.responseTimes.push(metrics.api.responseTime);
            }
          } else {
            exchangeStats.failedRequests++;
            if (metrics.api.error) {
              exchangeStats.errors.push(metrics.api.error);
            }
          }
        }

        if (metrics.throttle && metrics.throttle.queueSize !== undefined) {
          exchangeStats.queueSizes.push(metrics.throttle.queueSize);
        }
      });
    });

    // 統計値の計算
    Object.keys(stats.exchanges).forEach(exchangeId => {
      const exchange = stats.exchanges[exchangeId];

      // 成功率
      exchange.successRate = exchange.totalRequests > 0 ?
        exchange.successfulRequests / exchange.totalRequests : 0;

      // 平均応答時間
      if (exchange.responseTimes.length > 0) {
        exchange.avgResponseTime = exchange.responseTimes.reduce((a, b) => a + b, 0) / exchange.responseTimes.length;
        exchange.maxResponseTime = Math.max(...exchange.responseTimes);
        exchange.minResponseTime = Math.min(...exchange.responseTimes);

        // パーセンタイル計算
        const sortedTimes = exchange.responseTimes.sort((a, b) => a - b);
        exchange.responseTimePercentiles = {
          p50: sortedTimes[Math.floor(sortedTimes.length * 0.5)],
          p90: sortedTimes[Math.floor(sortedTimes.length * 0.9)],
          p95: sortedTimes[Math.floor(sortedTimes.length * 0.95)],
          p99: sortedTimes[Math.floor(sortedTimes.length * 0.99)]
        };
      }

      // 平均キューサイズ
      if (exchange.queueSizes.length > 0) {
        exchange.avgQueueSize = exchange.queueSizes.reduce((a, b) => a + b, 0) / exchange.queueSizes.length;
        exchange.maxQueueSize = Math.max(...exchange.queueSizes);

        // キューサイズパーセンタイル
        const sortedQueues = exchange.queueSizes.sort((a, b) => a - b);
        exchange.queueSizePercentiles = {
          p50: sortedQueues[Math.floor(sortedQueues.length * 0.5)],
          p90: sortedQueues[Math.floor(sortedQueues.length * 0.9)],
          p95: sortedQueues[Math.floor(sortedQueues.length * 0.95)],
          p99: sortedQueues[Math.floor(sortedQueues.length * 0.99)]
        };
      }

      // エラー分析
      if (exchange.errors.length > 0) {
        exchange.errorAnalysis = this.analyzeErrors(exchange.errors);
      }
    });

    return stats;
  }

  /**
     * エラー分析
     */
  analyzeErrors(errors) {
    const errorCounts = {};
    const throttleErrors = [];

    errors.forEach(error => {
      errorCounts[error] = (errorCounts[error] || 0) + 1;

      if (error.toLowerCase().includes('throttle') ||
                error.toLowerCase().includes('rate limit') ||
                error.toLowerCase().includes('queue')) {
        throttleErrors.push(error);
      }
    });

    return {
      totalErrors: errors.length,
      uniqueErrors: Object.keys(errorCounts).length,
      errorCounts,
      throttleRelatedErrors: throttleErrors.length,
      throttleErrorRate: throttleErrors.length / errors.length
    };
  }

  /**
     * 理論値と実測値の比較
     */
  compareWithTheoretical(realStats) {
    if (!this.theoreticalData) {
      return null;
    }

    const comparison = {
      thresholdComparison: {},
      recommendations: [],
      criticalFindings: []
    };

    // 閾値比較
    const theoretical = this.theoreticalData;

    Object.keys(realStats.exchanges).forEach(exchangeId => {
      const exchange = realStats.exchanges[exchangeId];

      // 理論値の閾値での実際の性能
      const warningThreshold = theoretical.warningThreshold || 0.4;
      const criticalThreshold = theoretical.criticalThreshold || 0.65;

      // 実測値での性能評価
      const actualPerformance = this.evaluatePerformanceAtThresholds(exchange, warningThreshold, criticalThreshold);

      comparison.thresholdComparison[exchangeId] = {
        theoreticalWarning: warningThreshold,
        theoreticalCritical: criticalThreshold,
        actualPerformance,
        deviation: this.calculateDeviation(theoretical, actualPerformance)
      };

      // 推奨事項の生成
      const recommendations = this.generateRecommendations(exchangeId, exchange, actualPerformance);
      comparison.recommendations.push(...recommendations);

      // 重要な発見
      const criticalFindings = this.identifyCriticalFindings(exchangeId, exchange, actualPerformance);
      comparison.criticalFindings.push(...criticalFindings);
    });

    return comparison;
  }

  /**
     * 閾値での性能評価
     */
  evaluatePerformanceAtThresholds(exchange, warningThreshold, criticalThreshold) {
    const maxQueue = exchange.maxQueueSize || 0;
    const avgQueue = exchange.avgQueueSize || 0;
    const successRate = exchange.successRate || 0;
    const avgResponseTime = exchange.avgResponseTime || 0;

    return {
      atWarningThreshold: {
        expectedQueueSize: maxQueue * warningThreshold,
        actualSuccessRate: successRate,
        actualAvgResponseTime: avgResponseTime,
        queueUtilization: avgQueue / maxQueue
      },
      atCriticalThreshold: {
        expectedQueueSize: maxQueue * criticalThreshold,
        actualSuccessRate: successRate,
        actualAvgResponseTime: avgResponseTime,
        queueUtilization: avgQueue / maxQueue
      },
      optimalThreshold: this.calculateOptimalThreshold(exchange)
    };
  }

  /**
     * 最適閾値の計算
     */
  calculateOptimalThreshold(exchange) {
    // 成功率が95%以上を維持する閾値を求める
    const targetSuccessRate = 0.95;
    const targetResponseTime = 1000; // 1秒以内

    let optimalWarning = 0.5;
    let optimalCritical = 0.7;

    // 実データに基づく調整
    if (exchange.successRate < targetSuccessRate) {
      optimalWarning = Math.max(0.3, optimalWarning - 0.1);
      optimalCritical = Math.max(0.5, optimalCritical - 0.1);
    }

    if (exchange.avgResponseTime > targetResponseTime) {
      optimalWarning = Math.max(0.3, optimalWarning - 0.1);
      optimalCritical = Math.max(0.5, optimalCritical - 0.1);
    }

    return {
      warning: optimalWarning,
      critical: optimalCritical,
      reasoning: this.generateThresholdReasoning(exchange, optimalWarning, optimalCritical)
    };
  }

  /**
     * 閾値理由の生成
     */
  generateThresholdReasoning(exchange, warning, critical) {
    const reasons = [];

    if (exchange.successRate < 0.95) {
      reasons.push(`成功率${(exchange.successRate * 100).toFixed(1)}%のため閾値を下げました`);
    }

    if (exchange.avgResponseTime > 1000) {
      reasons.push(`平均応答時間${exchange.avgResponseTime}msのため閾値を下げました`);
    }

    if (exchange.maxQueueSize > 1000) {
      reasons.push(`最大キューサイズ${exchange.maxQueueSize}のため調整しました`);
    }

    return reasons.length > 0 ? reasons : ['実データに基づく標準設定'];
  }

  /**
     * 推奨事項の生成
     */
  generateRecommendations(exchangeId, exchange, performance) {
    const recommendations = [];

    // 成功率が低い場合
    if (exchange.successRate < 0.9) {
      recommendations.push({
        type: 'critical',
        exchange: exchangeId,
        issue: 'Low success rate',
        current: `${(exchange.successRate * 100).toFixed(1)}%`,
        recommendation: 'Reduce throttle thresholds and increase rate limits',
        priority: 'high'
      });
    }

    // 応答時間が長い場合
    if (exchange.avgResponseTime > 2000) {
      recommendations.push({
        type: 'warning',
        exchange: exchangeId,
        issue: 'High response time',
        current: `${exchange.avgResponseTime}ms`,
        recommendation: 'Optimize API calls and reduce queue size thresholds',
        priority: 'medium'
      });
    }

    // キューサイズが大きい場合
    if (exchange.maxQueueSize > 1500) {
      recommendations.push({
        type: 'info',
        exchange: exchangeId,
        issue: 'Large queue size',
        current: `${exchange.maxQueueSize}`,
        recommendation: 'Consider reducing MAX_THROTTLE_QUEUE_SIZE',
        priority: 'low'
      });
    }

    return recommendations;
  }

  /**
     * 重要な発見の識別
     */
  identifyCriticalFindings(exchangeId, exchange, performance) {
    const findings = [];

    // スロットルエラーの分析
    if (exchange.errorAnalysis && exchange.errorAnalysis.throttleErrorRate > 0.1) {
      findings.push({
        type: 'throttling_issues',
        exchange: exchangeId,
        finding: 'High throttle error rate detected',
        impact: 'critical',
        data: {
          errorRate: exchange.errorAnalysis.throttleErrorRate,
          totalErrors: exchange.errorAnalysis.totalErrors,
          throttleErrors: exchange.errorAnalysis.throttleRelatedErrors
        }
      });
    }

    // 設定値と実測値の乖離
    if (exchange.maxQueueSize > 1000 && exchange.successRate < 0.9) {
      findings.push({
        type: 'configuration_mismatch',
        exchange: exchangeId,
        finding: 'Queue size configuration may be too high',
        impact: 'high',
        data: {
          maxQueueSize: exchange.maxQueueSize,
          successRate: exchange.successRate,
          recommendedMaxQueue: 1000
        }
      });
    }

    return findings;
  }

  /**
     * 乖離の計算
     */
  calculateDeviation(theoretical, actual) {
    return {
      warningDeviation: Math.abs(theoretical.warningThreshold - actual.optimalThreshold.warning),
      criticalDeviation: Math.abs(theoretical.criticalThreshold - actual.optimalThreshold.critical),
      significantDeviation: Math.abs(theoretical.warningThreshold - actual.optimalThreshold.warning) > 0.1
    };
  }

  /**
     * 完全な分析実行
     */
  async runFullAnalysis() {
    console.log('🔍 実データ分析開始...\n');

    // データ読み込み
    if (!this.loadData()) {
      return false;
    }

    // 最低限のデータ確認
    const minimumDataPoints = 60; // 1時間分
    if (this.data.length < minimumDataPoints) {
      console.log(`⚠️ データが不足しています: ${this.data.length}件 (最低${minimumDataPoints}件必要)`);
      console.log('   より多くのデータを収集してから分析を実行してください');
      return false;
    }

    // 基本統計の計算
    console.log('1. 基本統計の計算中...');
    const basicStats = this.calculateBasicStats();
    console.log(`   ✅ ${basicStats.timespan.durationDays.toFixed(1)}日間のデータを分析`);

    // 理論値との比較
    console.log('2. 理論値との比較実行中...');
    const comparison = this.compareWithTheoretical(basicStats);
    console.log('   ✅ 理論値と実測値の乖離を分析');

    // 結果の保存
    const analysisResult = {
      metadata: {
        analysisDate: new Date().toISOString(),
        dataSource: this.dataFile,
        theoreticalSource: this.theoreticalFile,
        dataPoints: this.data.length,
        timespan: basicStats.timespan
      },
      basicStats,
      comparison,
      summary: this.generateSummary(basicStats, comparison)
    };

    // 結果保存
    fs.writeFileSync(this.outputFile, JSON.stringify(analysisResult, null, 2));
    console.log(`   📝 分析結果を保存: ${this.outputFile}`);

    // 推奨事項の保存
    if (comparison && comparison.recommendations.length > 0) {
      fs.writeFileSync(this.recommendationsFile, JSON.stringify({
        generatedAt: new Date().toISOString(),
        recommendations: comparison.recommendations,
        criticalFindings: comparison.criticalFindings
      }, null, 2));
      console.log(`   📝 推奨事項を保存: ${this.recommendationsFile}`);
    }

    // 結果表示
    this.displayResults(analysisResult);

    return true;
  }

  /**
     * サマリーの生成
     */
  generateSummary(basicStats, comparison) {
    const summary = {
      overallHealth: 'good',
      keyFindings: [],
      urgentActions: [],
      dataQuality: 'good'
    };

    // データ品質の評価
    if (basicStats.timespan.durationDays < 1) {
      summary.dataQuality = 'insufficient';
      summary.keyFindings.push('データ期間が短すぎます（1日未満）');
    } else if (basicStats.timespan.durationDays < 7) {
      summary.dataQuality = 'limited';
      summary.keyFindings.push('データ期間が限定的です（7日未満）');
    } else if (basicStats.timespan.durationDays >= 30) {
      summary.dataQuality = 'excellent';
      summary.keyFindings.push('十分なデータが蓄積されています');
    }

    // 全体的な健全性の評価
    const exchanges = Object.values(basicStats.exchanges);
    const avgSuccessRate = exchanges.reduce((sum, ex) => sum + ex.successRate, 0) / exchanges.length;

    if (avgSuccessRate < 0.9) {
      summary.overallHealth = 'critical';
      summary.urgentActions.push('API成功率が低すぎます - 閾値の調整が必要');
    } else if (avgSuccessRate < 0.95) {
      summary.overallHealth = 'warning';
      summary.keyFindings.push('API成功率の改善が推奨されます');
    }

    // 重要な発見の追加
    if (comparison && comparison.criticalFindings.length > 0) {
      summary.overallHealth = 'critical';
      summary.urgentActions.push(`${comparison.criticalFindings.length}件の重要な問題が発見されました`);
    }

    return summary;
  }

  /**
     * 結果の表示
     */
  displayResults(result) {
    console.log('\n📊 分析結果サマリー');
    console.log('=================');

    const summary = result.summary;
    console.log(`データ品質: ${summary.dataQuality}`);
    console.log(`システム健全性: ${summary.overallHealth}`);
    console.log(`分析期間: ${result.basicStats.timespan.durationDays.toFixed(1)}日`);
    console.log(`総データポイント: ${result.basicStats.totalDataPoints}件`);

    // 取引所別結果
    console.log('\n📈 取引所別結果');
    Object.entries(result.basicStats.exchanges).forEach(([exchangeId, stats]) => {
      console.log(`\n${exchangeId}:`);
      console.log(`  成功率: ${(stats.successRate * 100).toFixed(1)}%`);
      console.log(`  平均応答時間: ${stats.avgResponseTime ? Math.round(stats.avgResponseTime) : 'N/A'}ms`);
      console.log(`  最大キューサイズ: ${stats.maxQueueSize || 'N/A'}`);

      if (stats.errorAnalysis) {
        console.log(`  エラー率: ${((1 - stats.successRate) * 100).toFixed(1)}%`);
        console.log(`  スロットルエラー: ${stats.errorAnalysis.throttleRelatedErrors}件`);
      }
    });

    // 推奨事項
    if (result.comparison && result.comparison.recommendations.length > 0) {
      console.log('\n🔧 推奨事項');
      result.comparison.recommendations.forEach((rec, index) => {
        console.log(`${index + 1}. [${rec.priority.toUpperCase()}] ${rec.exchange}: ${rec.issue}`);
        console.log(`   現在値: ${rec.current}`);
        console.log(`   推奨: ${rec.recommendation}`);
      });
    }

    // 緊急対応
    if (summary.urgentActions.length > 0) {
      console.log('\n🚨 緊急対応が必要');
      summary.urgentActions.forEach((action, index) => {
        console.log(`${index + 1}. ${action}`);
      });
    }

    console.log('\n✅ 分析完了');
  }
}

// スクリプト実行
if (require.main === module) {
  const analyzer = new RealDataAnalyzer();

  analyzer.runFullAnalysis().then(success => {
    if (success) {
      console.log('\n🎯 次のステップ:');
      console.log('1. 推奨事項に基づく設定調整');
      console.log('2. 調整後の効果測定');
      console.log('3. 継続的な監視');
    } else {
      console.log('\n❌ 分析が完了しませんでした');
    }
  }).catch(error => {
    console.error('❌ 分析エラー:', error.message);
    process.exit(1);
  });
}

module.exports = RealDataAnalyzer;