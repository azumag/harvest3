/**
 * Backtest Enhancement Module
 * Monte Carlo Bootstrapping統合による高度バックテスト分析
 *
 * 機能：
 * - Monte Carlo Bootstrapping統計分析
 * - harvest3 backtestRunner.jsとの完全統合
 * - 統計的堅牢性検証
 * - リスク調整済みパフォーマンス評価
 *
 * 作成者: worker-claude
 * 日付: 2025-06-28
 */

const { MonteCarloBootstrapping } = require('./monteCarloBootstrapping');
const { RobustnessValidator } = require('./walkForwardAnalysis');
const { AdvancedPerformanceMetrics } = require('./advancedPerformanceMetrics');

/**
 * バックテスト拡張クラス
 */
class BacktestEnhancer {
  constructor(config = {}) {
    this.config = {
      enableBootstrapping: config.enableBootstrapping !== false,
      enableRobustnessTest: config.enableRobustnessTest !== false,
      iterations: config.iterations || 5000,
      confidenceLevel: config.confidenceLevel || 0.95,
      minTradesRequired: config.minTradesRequired || 10,
      riskFreeRate: config.riskFreeRate || 0,
      ...config
    };

    this.mcBootstrap = new MonteCarloBootstrapping({
      iterations: this.config.iterations,
      confidenceLevel: this.config.confidenceLevel,
      biasCorrection: true,
      acceleratedCorrection: true,
      method: 'traditional'
    });

    this.robustnessValidator = new RobustnessValidator({
      enableMonteCarloValidation: true,
      enableBootstrapValidation: true,
      iterations: Math.min(this.config.iterations, 1000)
    });

    this.advancedMetrics = new AdvancedPerformanceMetrics();
  }

  /**
   * バックテスト結果を拡張分析
   * @param {Array} backtestResults - バックテスト結果配列
   * @param {Object} options - 分析オプション
   * @returns {Object} 拡張分析結果
   */
  async enhanceBacktestResults(backtestResults, options = {}) {
    try {
      console.log('🔬 Monte Carlo Bootstrapping分析を開始...');

      if (!backtestResults || backtestResults.length === 0) {
        throw new Error('バックテスト結果が空です');
      }

      // リターン系列を計算
      const returns = this._calculateReturnsFromResults(backtestResults);

      if (returns.length < this.config.minTradesRequired) {
        console.warn(`⚠️ トレード数が不足しています (${returns.length} < ${this.config.minTradesRequired})`);
        return this._generateLimitedAnalysis(backtestResults, returns);
      }

      // 包括的Monte Carlo分析
      const mcAnalysis = await this.mcBootstrap.comprehensiveAnalysis(returns, {
        riskFreeRate: this.config.riskFreeRate,
        includeHigherMoments: true,
        includeTailRisk: true
      });

      // 堅牢性検証
      const robustnessResults = await this._performRobustnessValidation(backtestResults);

      // リスク調整済み指標
      const riskAdjustedMetrics = await this._calculateRiskAdjustedMetrics(returns, backtestResults);

      // パフォーマンス評価
      const performanceEvaluation = this._evaluatePerformance(mcAnalysis, robustnessResults);

      // 統合結果
      const enhancedResults = {
        timestamp: new Date().toISOString(),
        originalResults: backtestResults,
        returns,
        monteCarloAnalysis: mcAnalysis,
        robustnessValidation: robustnessResults,
        riskAdjustedMetrics,
        performanceEvaluation,
        recommendations: this._generateRecommendations(mcAnalysis, robustnessResults, performanceEvaluation),
        summary: this._generateSummary(mcAnalysis, robustnessResults, performanceEvaluation)
      };

      console.log('✅ Monte Carlo Bootstrapping分析が完了しました');
      return enhancedResults;

    } catch (error) {
      console.error('❌ バックテスト拡張分析エラー:', error.message);
      return {
        error: error.message,
        timestamp: new Date().toISOString(),
        originalResults: backtestResults
      };
    }
  }

  /**
   * バックテスト結果からリターン系列を計算
   * @param {Array} results - バックテスト結果
   * @returns {Array} リターン配列
   */
  _calculateReturnsFromResults(results) {
    if (results.length <= 1) {
      return [];
    }

    const returns = [];

    // finalBaseFundを使用してリターンを計算
    for (let i = 1; i < results.length; i++) {
      const currentValue = results[i].finalBaseFund;
      const previousValue = results[i - 1].finalBaseFund;

      if (previousValue > 0) {
        const returnValue = (currentValue - previousValue) / previousValue;
        returns.push(returnValue);
      }
    }

    // 結果が不十分な場合、finalBaseFundを正規化してリターンを生成
    if (returns.length === 0 && results.length > 0) {
      const initialValue = results[0].finalBaseFund || 10000;

      for (const result of results) {
        const returnValue = ((result.finalBaseFund || 10000) - initialValue) / initialValue;
        returns.push(returnValue);
      }
    }

    return returns;
  }

  /**
   * 堅牢性検証を実行
   * @param {Array} backtestResults - バックテスト結果
   * @returns {Object} 堅牢性検証結果
   */
  async _performRobustnessValidation(backtestResults) {
    try {
      if (!this.config.enableRobustnessTest) {
        return { enabled: false };
      }

      // パフォーマンス結果を構築
      const performanceResults = backtestResults.map(result => ({
        totalReturn: ((result.finalBaseFund || 10000) - 10000) / 10000,
        volatility: Math.abs(((result.finalBaseFund || 10000) - 10000) / 10000) * 0.1, // 簡易推定
        sharpeRatio: this._estimateSharpeRatio(result),
        maxDrawdown: Math.max(0, (10000 - (result.finalBaseFund || 10000)) / 10000)
      }));

      const validation = this.robustnessValidator.comprehensiveValidation(performanceResults);

      return {
        enabled: true,
        validation,
        stability: this.robustnessValidator.validateStability(performanceResults),
        performanceResults
      };

    } catch (error) {
      console.error('堅牢性検証エラー:', error.message);
      return {
        enabled: true,
        error: error.message,
        performanceResults: []
      };
    }
  }

  /**
   * リスク調整済み指標を計算
   * @param {Array} returns - リターン配列
   * @param {Array} backtestResults - バックテスト結果
   * @returns {Object} リスク調整済み指標
   */
  async _calculateRiskAdjustedMetrics(returns, backtestResults) {
    try {
      const metrics = {};

      // 基本統計
      const basicStats = this.mcBootstrap._calculateBasicStatistics(returns);

      // Sharpe比率とその信頼区間
      if (this.config.enableBootstrapping && returns.length >= this.config.minTradesRequired) {
        metrics.sharpeAnalysis = await this.mcBootstrap.calculateSharpeConfidenceInterval(
          returns,
          this.config.riskFreeRate
        );
      }

      // 最大ドローダウン分析
      if (returns.length >= this.config.minTradesRequired) {
        metrics.drawdownAnalysis = await this.mcBootstrap.calculateMaxDrawdownDistribution(returns);
      }

      // VaR分析
      if (returns.length >= this.config.minTradesRequired) {
        metrics.varAnalysis = await this.mcBootstrap.validateVaRRobustness(returns, 0.95);
      }

      // 勝率と利益率
      const profitableResults = backtestResults.filter(r => (r.finalBaseFund || 10000) > 10000);
      metrics.winRate = profitableResults.length / backtestResults.length;

      // プロフィットファクター
      const profits = backtestResults
        .map(r => (r.finalBaseFund || 10000) - 10000)
        .filter(p => p > 0)
        .reduce((sum, p) => sum + p, 0);

      const losses = Math.abs(backtestResults
        .map(r => (r.finalBaseFund || 10000) - 10000)
        .filter(p => p < 0)
        .reduce((sum, p) => sum + p, 0));

      metrics.profitFactor = losses > 0 ? profits / losses : profits > 0 ? Infinity : 0;

      return {
        basicStats,
        ...metrics,
        winRate: metrics.winRate,
        profitFactor: metrics.profitFactor
      };

    } catch (error) {
      console.error('リスク調整済み指標計算エラー:', error.message);
      return { error: error.message };
    }
  }

  /**
   * パフォーマンス評価を実行
   * @param {Object} mcAnalysis - Monte Carlo分析結果
   * @param {Object} robustnessResults - 堅牢性検証結果
   * @returns {Object} パフォーマンス評価
   */
  _evaluatePerformance(mcAnalysis, robustnessResults) {
    const evaluation = {
      overall: 'unknown',
      scores: {},
      risks: {},
      strengths: [],
      weaknesses: []
    };

    try {
      // Sharpe比率評価
      if (mcAnalysis.sharpeAnalysis) {
        const sharpe = mcAnalysis.sharpeAnalysis.originalSharpe;
        evaluation.scores.sharpe = sharpe;

        if (sharpe > 1.5) {
          evaluation.strengths.push('優秀なSharpe比率');
        } else if (sharpe < 0.5) {
          evaluation.weaknesses.push('低いSharpe比率');
        }
      }

      // 最大ドローダウン評価
      if (mcAnalysis.drawdownAnalysis) {
        const drawdown = mcAnalysis.drawdownAnalysis.originalDrawdown;
        evaluation.risks.maxDrawdown = drawdown;

        if (drawdown > 0.2) {
          evaluation.weaknesses.push('大きな最大ドローダウン');
        } else if (drawdown < 0.05) {
          evaluation.strengths.push('安定したドローダウン');
        }
      }

      // VaR評価
      if (mcAnalysis.varAnalysis) {
        const robustnessScore = mcAnalysis.varAnalysis.robustnessScore;
        evaluation.scores.varRobustness = robustnessScore;

        if (robustnessScore > 0.8) {
          evaluation.strengths.push('堅牢なVaR');
        } else if (robustnessScore < 0.5) {
          evaluation.weaknesses.push('不安定なVaR');
        }
      }

      // 堅牢性評価
      if (robustnessResults.enabled && robustnessResults.stability) {
        const stabilityScore = robustnessResults.stability.stabilityScore;
        evaluation.scores.stability = stabilityScore;

        if (stabilityScore > 0.7) {
          evaluation.strengths.push('高い安定性');
        } else if (stabilityScore < 0.3) {
          evaluation.weaknesses.push('低い安定性');
        }
      }

      // 総合評価
      const scores = Object.values(evaluation.scores).filter(s => typeof s === 'number' && !isNaN(s));
      if (scores.length > 0) {
        const averageScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;

        if (averageScore > 0.8) {
          evaluation.overall = 'excellent';
        } else if (averageScore > 0.6) {
          evaluation.overall = 'good';
        } else if (averageScore > 0.4) {
          evaluation.overall = 'average';
        } else {
          evaluation.overall = 'poor';
        }
      }

    } catch (error) {
      console.error('パフォーマンス評価エラー:', error.message);
      evaluation.error = error.message;
    }

    return evaluation;
  }

  /**
   * 推奨事項を生成
   * @param {Object} mcAnalysis - Monte Carlo分析結果
   * @param {Object} robustnessResults - 堅牢性検証結果
   * @param {Object} performanceEvaluation - パフォーマンス評価
   * @returns {Array} 推奨事項配列
   */
  _generateRecommendations(mcAnalysis, robustnessResults, performanceEvaluation) {
    const recommendations = [];

    try {
      // Sharpe比率ベースの推奨
      if (mcAnalysis.sharpeAnalysis && mcAnalysis.sharpeAnalysis.originalSharpe < 0.5) {
        recommendations.push({
          type: 'risk_adjustment',
          priority: 'high',
          message: 'Sharpe比率が低いため、リスク調整またはパラメータ最適化を検討してください',
          metric: 'sharpe_ratio',
          value: mcAnalysis.sharpeAnalysis.originalSharpe
        });
      }

      // ドローダウンベースの推奨
      if (mcAnalysis.drawdownAnalysis && mcAnalysis.drawdownAnalysis.originalDrawdown > 0.15) {
        recommendations.push({
          type: 'risk_management',
          priority: 'high',
          message: '最大ドローダウンが大きいため、ポジションサイズの調整を検討してください',
          metric: 'max_drawdown',
          value: mcAnalysis.drawdownAnalysis.originalDrawdown
        });
      }

      // VaR堅牢性ベースの推奨
      if (mcAnalysis.varAnalysis && mcAnalysis.varAnalysis.robustnessScore < 0.6) {
        recommendations.push({
          type: 'parameter_tuning',
          priority: 'medium',
          message: 'VaRの堅牢性が低いため、より安定したパラメータを探索してください',
          metric: 'var_robustness',
          value: mcAnalysis.varAnalysis.robustnessScore
        });
      }

      // 安定性ベースの推奨
      if (robustnessResults.stability && robustnessResults.stability.stabilityScore < 0.5) {
        recommendations.push({
          type: 'stability_improvement',
          priority: 'medium',
          message: 'パフォーマンスの安定性が低いため、より長期間のバックテストを実行してください',
          metric: 'stability_score',
          value: robustnessResults.stability.stabilityScore
        });
      }

      // 全体的な推奨
      if (performanceEvaluation.overall === 'poor') {
        recommendations.push({
          type: 'strategy_review',
          priority: 'high',
          message: '戦略の根本的な見直しが必要です。別のアプローチを検討してください',
          metric: 'overall_performance',
          value: performanceEvaluation.overall
        });
      } else if (performanceEvaluation.overall === 'excellent') {
        recommendations.push({
          type: 'deployment_ready',
          priority: 'low',
          message: '優秀な結果です。本番環境での運用を検討できます',
          metric: 'overall_performance',
          value: performanceEvaluation.overall
        });
      }

    } catch (error) {
      console.error('推奨事項生成エラー:', error.message);
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
   * サマリーを生成
   * @param {Object} mcAnalysis - Monte Carlo分析結果
   * @param {Object} robustnessResults - 堅牢性検証結果
   * @param {Object} performanceEvaluation - パフォーマンス評価
   * @returns {Object} サマリー
   */
  _generateSummary(mcAnalysis, robustnessResults, performanceEvaluation) {
    const summary = {
      performance: performanceEvaluation.overall,
      keyMetrics: {},
      riskProfile: 'unknown',
      confidence: 'unknown'
    };

    try {
      // 主要指標
      if (mcAnalysis.sharpeAnalysis) {
        summary.keyMetrics.sharpeRatio = {
          value: mcAnalysis.sharpeAnalysis.originalSharpe,
          confidenceInterval: mcAnalysis.sharpeAnalysis.confidenceInterval
        };
      }

      if (mcAnalysis.drawdownAnalysis) {
        summary.keyMetrics.maxDrawdown = {
          value: mcAnalysis.drawdownAnalysis.originalDrawdown,
          expectedValue: mcAnalysis.drawdownAnalysis.expectedDrawdown
        };
      }

      if (mcAnalysis.varAnalysis) {
        summary.keyMetrics.var95 = {
          value: mcAnalysis.varAnalysis.originalVaR,
          robustnessScore: mcAnalysis.varAnalysis.robustnessScore
        };
      }

      // リスクプロファイル
      const drawdown = mcAnalysis.drawdownAnalysis?.originalDrawdown || 0;
      const varRobustness = mcAnalysis.varAnalysis?.robustnessScore || 0;

      if (drawdown > 0.2 || varRobustness < 0.5) {
        summary.riskProfile = 'high';
      } else if (drawdown > 0.1 || varRobustness < 0.7) {
        summary.riskProfile = 'medium';
      } else {
        summary.riskProfile = 'low';
      }

      // 信頼度
      const stabilityScore = robustnessResults.stability?.stabilityScore || 0;

      if (stabilityScore > 0.8 && varRobustness > 0.8) {
        summary.confidence = 'high';
      } else if (stabilityScore > 0.6 && varRobustness > 0.6) {
        summary.confidence = 'medium';
      } else {
        summary.confidence = 'low';
      }

    } catch (error) {
      console.error('サマリー生成エラー:', error.message);
      summary.error = error.message;
    }

    return summary;
  }

  /**
   * 限定分析を生成（データ不足時）
   * @param {Array} backtestResults - バックテスト結果
   * @param {Array} returns - リターン配列
   * @returns {Object} 限定分析結果
   */
  _generateLimitedAnalysis(backtestResults, returns) {
    return {
      timestamp: new Date().toISOString(),
      originalResults: backtestResults,
      returns,
      limited: true,
      reason: 'insufficient_data',
      dataCount: returns.length,
      minRequired: this.config.minTradesRequired,
      basicStats: returns.length > 0 ? this.mcBootstrap._calculateBasicStatistics(returns) : {},
      summary: {
        performance: 'insufficient_data',
        keyMetrics: {},
        riskProfile: 'unknown',
        confidence: 'low'
      },
      recommendations: [{
        type: 'data_collection',
        priority: 'high',
        message: `より多くのトレードデータが必要です (現在: ${returns.length}, 必要: ${this.config.minTradesRequired})`,
        metric: 'data_count',
        value: returns.length
      }]
    };
  }

  /**
   * Sharpe比率を推定（簡易版）
   * @param {Object} result - バックテスト結果
   * @returns {number} 推定Sharpe比率
   */
  _estimateSharpeRatio(result) {
    const returnValue = ((result.finalBaseFund || 10000) - 10000) / 10000;
    const estimatedVolatility = Math.abs(returnValue) * 0.5 + 0.01; // 簡易推定
    return estimatedVolatility > 0 ? returnValue / estimatedVolatility : 0;
  }

  /**
   * Discord用レポートを生成
   * @param {Object} enhancedResults - 拡張分析結果
   * @returns {string} Discord用レポート
   */
  generateDiscordReport(enhancedResults) {
    try {
      if (enhancedResults.error) {
        return `❌ **分析エラー**\n\`\`\`\n${enhancedResults.error}\n\`\`\``;
      }

      if (enhancedResults.limited) {
        return '⚠️ **データ不足による限定分析**\n' +
               `データ数: ${enhancedResults.dataCount}/${enhancedResults.minRequired}\n` +
               `\`\`\`\n${enhancedResults.recommendations[0].message}\n\`\`\``;
      }

      const report = [];
      report.push('📊 **Monte Carlo Bootstrapping 分析結果**');
      report.push('');

      // 総合評価
      const overallEmoji = {
        excellent: '🌟',
        good: '✅',
        average: '📊',
        poor: '⚠️',
        unknown: '❓'
      };

      report.push(`**総合評価:** ${overallEmoji[enhancedResults.summary.performance] || '❓'} ${enhancedResults.summary.performance.toUpperCase()}`);
      report.push(`**リスクプロファイル:** ${enhancedResults.summary.riskProfile.toUpperCase()}`);
      report.push(`**信頼度:** ${enhancedResults.summary.confidence.toUpperCase()}`);
      report.push('');

      // 主要指標
      report.push('**主要指標:**');
      report.push('```');

      if (enhancedResults.summary.keyMetrics.sharpeRatio) {
        const sharpe = enhancedResults.summary.keyMetrics.sharpeRatio;
        report.push(`Sharpe比率:    ${sharpe.value.toFixed(3)}`);
        if (sharpe.confidenceInterval) {
          report.push(`  信頼区間:    [${sharpe.confidenceInterval.lower.toFixed(3)}, ${sharpe.confidenceInterval.upper.toFixed(3)}]`);
        }
      }

      if (enhancedResults.summary.keyMetrics.maxDrawdown) {
        const dd = enhancedResults.summary.keyMetrics.maxDrawdown;
        report.push(`最大DD:       ${(dd.value * 100).toFixed(2)}%`);
        if (dd.expectedValue) {
          report.push(`  期待値:      ${(dd.expectedValue * 100).toFixed(2)}%`);
        }
      }

      if (enhancedResults.summary.keyMetrics.var95) {
        const var95 = enhancedResults.summary.keyMetrics.var95;
        report.push(`VaR(95%):     ${(var95.value * 100).toFixed(2)}%`);
        report.push(`  堅牢性:      ${(var95.robustnessScore * 100).toFixed(1)}%`);
      }

      report.push('```');

      // 推奨事項
      if (enhancedResults.recommendations && enhancedResults.recommendations.length > 0) {
        report.push('');
        report.push('**推奨事項:**');

        const highPriorityRecs = enhancedResults.recommendations.filter(r => r.priority === 'high');
        if (highPriorityRecs.length > 0) {
          report.push('🔴 **高優先度:**');
          highPriorityRecs.forEach(rec => {
            report.push(`• ${rec.message}`);
          });
        }

        const mediumPriorityRecs = enhancedResults.recommendations.filter(r => r.priority === 'medium');
        if (mediumPriorityRecs.length > 0) {
          report.push('🟡 **中優先度:**');
          mediumPriorityRecs.forEach(rec => {
            report.push(`• ${rec.message}`);
          });
        }
      }

      return report.join('\n');

    } catch (error) {
      return `❌ **レポート生成エラー**\n\`\`\`\n${error.message}\n\`\`\``;
    }
  }
}

module.exports = {
  BacktestEnhancer
};