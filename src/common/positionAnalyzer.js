/**
 * 共通ポジション分析ユーティリティ
 * similarity-ts分析で86%+の類似度を持つポジション分析機能を統合
 */

const { getAllTradeSummaries } = require('../database/redisDatabase');

class PositionAnalyzer {
  constructor(options = {}) {
    this.options = {
      toleranceThreshold: 0.0001, // 許容誤差
      logLevel: options.logLevel || 'info',
      includeZeroPositions: options.includeZeroPositions || false,
      ...options
    };
    this.inconsistencies = [];
    this.analysisResults = {};
  }

  /**
   * ログレベルに応じてメッセージを出力
   */
  log(level, message, ...args) {
    const levels = { error: 0, warn: 1, info: 2, debug: 3 };
    const currentLevel = levels[this.options.logLevel] || 2;

    if (levels[level] <= currentLevel) {
      const prefix = { error: '❌', warn: '⚠️', info: 'ℹ️', debug: '🔍' }[level] || '';
      console.log(`${prefix} ${message}`, ...args);
    }
  }

  /**
   * 取引所の残高情報を取得
   */
  async getExchangeBalances(exchange) {
    try {
      const balance = await exchange.fetchBalance();
      this.log('info', `✓ ${exchange.id}の残高を取得しました`);
      return balance;
    } catch (error) {
      this.log('error', `✗ ${exchange.id}の残高取得に失敗:`, error.message);
      return null;
    }
  }

  /**
   * Redis trade summaryから銘柄別netPositionを集計
   */
  async aggregateNetPositionsBySymbol(exchangeId) {
    try {
      const tradeSummaries = await getAllTradeSummaries();
      const positionsBySymbol = {};

      for (const [key, summary] of Object.entries(tradeSummaries)) {
        if (!key.startsWith(`summary:trade:${exchangeId}:`)) {
          continue;
        }

        const parts = key.split(':');
        if (parts.length !== 5) {
          continue;
        }

        const symbol = parts[3];
        const strategy = parts[4];
        const netPosition = parseFloat(summary.netPosition || 0);

        if (!this.options.includeZeroPositions && Math.abs(netPosition) < this.options.toleranceThreshold) {
          continue;
        }

        if (!positionsBySymbol[symbol]) {
          positionsBySymbol[symbol] = {
            totalNetPosition: 0,
            strategies: {}
          };
        }

        positionsBySymbol[symbol].totalNetPosition += netPosition;
        positionsBySymbol[symbol].strategies[strategy] = netPosition;
      }

      this.log('info', `✓ ${exchangeId}のポジション集計完了: ${Object.keys(positionsBySymbol).length}銘柄`);
      return positionsBySymbol;
    } catch (error) {
      this.log('error', `✗ ${exchangeId}のポジション集計失敗:`, error.message);
      return {};
    }
  }

  /**
   * 不整合を分析
   */
  async analyzeInconsistencies(exchanges) {
    this.log('info', '🔍 ポジション整合性分析を開始...');

    const results = {};

    for (const [exchangeId, exchangeConfig] of Object.entries(exchanges)) {
      this.log('info', `\n🏦 ${exchangeId} の分析中...`);

      const exchange = exchangeConfig.instance;
      const positionsBySymbol = await this.aggregateNetPositionsBySymbol(exchangeId);
      const exchangeBalances = await this.getExchangeBalances(exchange);

      if (!exchangeBalances) {
        this.log('warn', `${exchangeId}の残高取得失敗のため分析をスキップ`);
        continue;
      }

      const exchangeResults = {
        totalSymbols: Object.keys(positionsBySymbol).length,
        inconsistencies: [],
        consistent: [],
        summary: {
          criticalInconsistencies: 0,
          minorInconsistencies: 0,
          consistentSymbols: 0,
          totalDifference: 0
        }
      };

      // 銘柄ごとの整合性チェック
      for (const [symbol, positionData] of Object.entries(positionsBySymbol)) {
        const baseAsset = symbol.split('/')[0];
        const totalExchangeBalance = (exchangeBalances.total[baseAsset] || 0);
        const netPosition = positionData.totalNetPosition;
        const difference = Math.abs(netPosition - totalExchangeBalance);

        const inconsistency = {
          symbol,
          baseAsset,
          netPosition: parseFloat(netPosition.toFixed(8)),
          exchangeBalance: parseFloat(totalExchangeBalance.toFixed(8)),
          difference: parseFloat(difference.toFixed(8)),
          strategies: positionData.strategies,
          severity: this.categorizeInconsistency(difference, Math.max(netPosition, totalExchangeBalance))
        };

        if (difference > this.options.toleranceThreshold) {
          exchangeResults.inconsistencies.push(inconsistency);
          this.inconsistencies.push({ exchangeId, ...inconsistency });

          if (inconsistency.severity === 'critical') {
            exchangeResults.summary.criticalInconsistencies++;
          } else {
            exchangeResults.summary.minorInconsistencies++;
          }

          this.log('warn', `不整合検出: ${symbol} - Net: ${netPosition}, Exchange: ${totalExchangeBalance}, 差分: ${difference}`);
        } else {
          exchangeResults.consistent.push(inconsistency);
          exchangeResults.summary.consistentSymbols++;
        }

        exchangeResults.summary.totalDifference += difference;
      }

      results[exchangeId] = exchangeResults;

      this.log('info', `${exchangeId} 分析完了:`);
      this.log('info', `  - 重大な不整合: ${exchangeResults.summary.criticalInconsistencies}件`);
      this.log('info', `  - 軽微な不整合: ${exchangeResults.summary.minorInconsistencies}件`);
      this.log('info', `  - 整合性OK: ${exchangeResults.summary.consistentSymbols}件`);
    }

    this.analysisResults = results;
    return results;
  }

  /**
   * 不整合の重要度を分類
   */
  categorizeInconsistency(difference, maxAmount) {
    const relativeError = maxAmount > 0 ? (difference / maxAmount) : 0;

    if (difference > 0.1 || relativeError > 0.1) {
      return 'critical';
    } else if (difference > 0.01 || relativeError > 0.01) {
      return 'moderate';
    } else {
      return 'minor';
    }
  }

  /**
   * 修復提案を生成
   */
  generateFixProposals(analysisResults = null) {
    const results = analysisResults || this.analysisResults;
    const proposals = [];

    for (const [exchangeId, exchangeData] of Object.entries(results)) {
      for (const inconsistency of exchangeData.inconsistencies) {
        const proposal = this.createFixProposal(exchangeId, inconsistency);
        proposals.push(proposal);
      }
    }

    return proposals;
  }

  /**
   * 個別の修復提案を作成
   */
  createFixProposal(exchangeId, inconsistency) {
    const { symbol, netPosition, exchangeBalance, difference, severity } = inconsistency;

    const proposal = {
      exchangeId,
      symbol,
      severity,
      issue: {
        netPosition,
        exchangeBalance,
        difference
      },
      actions: []
    };

    // 修復アクションの提案
    if (netPosition > exchangeBalance) {
      // Redisのポジションが実際より多い場合
      proposal.actions.push({
        type: 'reduce_redis_position',
        description: `Redisのポジションを ${exchangeBalance} に調整`,
        targetValue: exchangeBalance,
        risk: severity === 'critical' ? 'high' : 'medium'
      });
    } else if (exchangeBalance > netPosition) {
      // 実際の残高がRedisより多い場合
      proposal.actions.push({
        type: 'investigate_missing_trades',
        description: `未記録取引の調査と補正 (差分: ${difference})`,
        targetValue: netPosition,
        risk: 'medium'
      });

      if (severity === 'critical') {
        proposal.actions.push({
          type: 'manual_position_sync',
          description: '手動でのポジション同期',
          targetValue: exchangeBalance,
          risk: 'high'
        });
      }
    }

    // バックアップ推奨
    if (severity === 'critical') {
      proposal.actions.unshift({
        type: 'backup_data',
        description: '修復前のデータバックアップ',
        risk: 'low'
      });
    }

    return proposal;
  }

  /**
   * 詳細レポートを生成
   */
  generateDetailedReport(analysisResults = null, proposals = null) {
    const results = analysisResults || this.analysisResults;
    const fixProposals = proposals || this.generateFixProposals(results);

    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalExchanges: Object.keys(results).length,
        totalInconsistencies: this.inconsistencies.length,
        criticalInconsistencies: this.inconsistencies.filter(i => i.severity === 'critical').length,
        proposedActions: fixProposals.length
      },
      exchangeDetails: results,
      inconsistencies: this.inconsistencies,
      fixProposals,
      recommendations: this.generateRecommendations()
    };

    return report;
  }

  /**
   * 推奨事項を生成
   */
  generateRecommendations() {
    const critical = this.inconsistencies.filter(i => i.severity === 'critical').length;
    const total = this.inconsistencies.length;

    const recommendations = [];

    if (critical > 0) {
      recommendations.push({
        priority: 'high',
        action: '重大な不整合の即座修復',
        description: `${critical}件の重大な不整合が検出されました。取引停止を検討してください。`
      });
    }

    if (total > 10) {
      recommendations.push({
        priority: 'medium',
        action: 'システム全体の見直し',
        description: '多数の不整合が検出されました。システム全体の見直しが必要です。'
      });
    }

    recommendations.push({
      priority: 'low',
      action: '定期的な整合性チェック',
      description: '予防のため定期的な整合性チェックを実装してください。'
    });

    return recommendations;
  }

  /**
   * コンソール用の整形されたレポートを出力
   */
  printFormattedReport(analysisResults = null) {
    const results = analysisResults || this.analysisResults;

    console.log('\n📊 ポジション整合性分析レポート');
    console.log('='.repeat(50));

    for (const [exchangeId, data] of Object.entries(results)) {
      console.log(`\n🏦 ${exchangeId.toUpperCase()}`);
      console.log(`   整合: ${data.summary.consistentSymbols}件`);
      console.log(`   不整合: ${data.summary.criticalInconsistencies + data.summary.minorInconsistencies}件`);
      console.log(`   うち重大: ${data.summary.criticalInconsistencies}件`);

      if (data.inconsistencies.length > 0) {
        console.log('\n   不整合詳細:');
        data.inconsistencies.forEach(inc => {
          const severity = { critical: '🚨', moderate: '⚠️', minor: '💡' }[inc.severity];
          console.log(`   ${severity} ${inc.symbol}: Net=${inc.netPosition}, Exchange=${inc.exchangeBalance}, 差分=${inc.difference}`);
        });
      }
    }

    const recommendations = this.generateRecommendations();
    if (recommendations.length > 0) {
      console.log('\n💡 推奨事項:');
      recommendations.forEach(rec => {
        const priority = { high: '🚨', medium: '⚠️', low: 'ℹ️' }[rec.priority];
        console.log(`   ${priority} ${rec.action}: ${rec.description}`);
      });
    }
  }
}

module.exports = { PositionAnalyzer };