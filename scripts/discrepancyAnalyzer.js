const { config } = require('../src/config');
const { initRedisClient } = require('../src/database/redisClient');
const { getStrategyPositionsRedis } = require('../src/database/redisDatabase');
// const { getTradeSummary, getTradeCurrentPosition } = require('../src/database/manager');

/**
 * 残高不整合の詳細調査ツール
 */
class DiscrepancyAnalyzer {
  constructor() {
    this.criticalIssues = [];
    this.patternAnalysis = {};
  }

  /**
   * 重要不整合の調査
   */
  async investigateCriticalDiscrepancies() {
    console.log('🔍 重要な残高不整合の詳細調査を開始...\n');

    // 調査対象の重要案件
    const criticalCases = [
      { exchange: 'bitbank', strategy: 'BOLLINGER_BANDS', symbol: 'LINK/JPY', issue: 'ポジション残存、実残高ゼロ' },
      { exchange: 'bitbank', strategy: 'OSCILLATOR', symbol: 'GALA/JPY', issue: '992%乖離 (実: 3.1458, ポジション: 34.3695)' },
      { exchange: 'bitbank', strategy: 'MUTUAL_INFO', symbol: 'XRP/JPY', issue: 'ポジション過多 (実: 0.6969, ポジション: 0.7133)' },
      { exchange: 'bitbank', strategy: 'RSI', symbol: 'XLM/JPY', issue: 'ポジション少なめ (実: 8.8554, ポジション: 7.5145)' },
      { exchange: 'bitbank', strategy: 'OSCILLATOR', symbol: 'APE/JPY', issue: '64%乖離 (実: 5.2437, ポジション: 1.8634)' }
    ];

    for (const caseInfo of criticalCases) {
      await this.analyzeSpecificCase(caseInfo);
    }

    await this.analyzePatterns();
    await this.generateInvestigationReport();
  }

  /**
   * 特定ケースの詳細分析
   */
  async analyzeSpecificCase(caseInfo) {
    console.log(`📊 詳細調査: ${caseInfo.symbol} (${caseInfo.strategy})`);
    console.log(`   問題: ${caseInfo.issue}\n`);

    try {
      const exchange = config.exchanges[caseInfo.exchange]?.instance;
      if (!exchange) {
        console.log(`❌ 取引所 ${caseInfo.exchange} が見つかりません\n`);
        return;
      }

      // 1. 現在の実残高
      const actualBalance = await exchange.fetchBalance();
      const baseAsset = caseInfo.symbol.split('/')[0];
      const actualData = {
        free: actualBalance.free[baseAsset] || 0,
        used: actualBalance.used[baseAsset] || 0,
        total: actualBalance.total[baseAsset] || 0
      };

      // 2. Redisポジション
      const positions = await getStrategyPositionsRedis(caseInfo.exchange, caseInfo.symbol, caseInfo.strategy);
      const openPositions = positions.filter(pos => pos.status === 'open' && pos.side === 'buy');

      // 3. 取引履歴（MongoDB）- スキップ
      const tradeSummary = null; // await getTradeSummary(caseInfo.exchange, caseInfo.symbol, caseInfo.strategy);

      // 4. 最近の注文履歴（取引所）
      let recentOrders = [];
      try {
        recentOrders = await exchange.fetchOrders(caseInfo.symbol, undefined, 50);
        recentOrders = recentOrders.filter(order => 
          order.timestamp > (Date.now() - 7 * 24 * 60 * 60 * 1000) // 過去7日
        ).sort((a, b) => b.timestamp - a.timestamp);
      } catch (error) {
        console.log(`⚠️ 注文履歴取得エラー: ${error.message}`);
      }

      const analysis = {
        symbol: caseInfo.symbol,
        strategy: caseInfo.strategy,
        issue: caseInfo.issue,
        actualBalance: actualData,
        redisPositions: {
          count: openPositions.length,
          total: openPositions.reduce((sum, pos) => sum + pos.amount, 0),
          positions: openPositions.map(pos => ({
            orderId: pos.orderId,
            amount: pos.amount,
            entryPrice: pos.entryPrice,
            createdAt: new Date(pos.createdAt).toLocaleString('ja-JP'),
            ageHours: ((Date.now() - pos.createdAt) / (1000 * 60 * 60)).toFixed(1)
          }))
        },
        tradeSummary: tradeSummary ? {
          totalTrades: tradeSummary.totalTrades || 0,
          totalVolume: tradeSummary.totalVolume || 0,
          averageProfit: tradeSummary.averageProfit || 0,
          lastTradeDate: tradeSummary.lastTradeDate ? new Date(tradeSummary.lastTradeDate).toLocaleString('ja-JP') : 'N/A'
        } : null,
        recentOrders: recentOrders.slice(0, 10).map(order => ({
          id: order.id,
          side: order.side,
          amount: order.amount,
          price: order.price || order.average || 'N/A',
          status: order.status,
          timestamp: new Date(order.timestamp).toLocaleString('ja-JP')
        }))
      };

      this.criticalIssues.push(analysis);
      await this.printDetailedAnalysis(analysis);

    } catch (error) {
      console.error(`❌ ${caseInfo.symbol} 調査エラー: ${error.message}\n`);
    }
  }

  /**
   * 詳細分析結果の表示
   */
  async printDetailedAnalysis(analysis) {
    console.log(`📈 ${analysis.symbol} (${analysis.strategy}) 詳細分析結果:`);
    console.log(`   問題: ${analysis.issue}`);
    
    console.log(`\n💰 実残高:`);
    console.log(`   Free: ${analysis.actualBalance.free}`);
    console.log(`   Used: ${analysis.actualBalance.used}`);
    console.log(`   Total: ${analysis.actualBalance.total}`);

    console.log(`\n📊 Redisポジション (${analysis.redisPositions.count}件):`);
    console.log(`   合計: ${analysis.redisPositions.total}`);
    if (analysis.redisPositions.positions.length > 0) {
      console.log(`   詳細:`);
      for (const pos of analysis.redisPositions.positions) {
        console.log(`     - 注文ID ${pos.orderId}: ${pos.amount} @ ${pos.entryPrice} (作成: ${pos.createdAt}, 経過: ${pos.ageHours}時間)`);
      }
    }

    if (analysis.tradeSummary) {
      console.log(`\n📋 取引サマリー:`);
      console.log(`   総取引数: ${analysis.tradeSummary.totalTrades}`);
      console.log(`   総取引量: ${analysis.tradeSummary.totalVolume}`);
      console.log(`   平均利益: ${analysis.tradeSummary.averageProfit}%`);
      console.log(`   最終取引: ${analysis.tradeSummary.lastTradeDate}`);
    }

    console.log(`\n📝 最近の注文履歴 (上位10件):`);
    if (analysis.recentOrders.length > 0) {
      for (const order of analysis.recentOrders) {
        console.log(`   - [${order.timestamp}] ${order.side.toUpperCase()} ${order.amount} @ ${order.price} (${order.status})`);
      }
    } else {
      console.log(`   注文履歴なし`);
    }

    // 原因推定
    const causes = this.estimateCauses(analysis);
    console.log(`\n🔍 推定原因:`);
    for (const cause of causes) {
      console.log(`   • ${cause}`);
    }

    console.log('\n' + '-'.repeat(80) + '\n');
  }

  /**
   * 原因推定ロジック
   */
  estimateCauses(analysis) {
    const causes = [];
    const discrepancy = Math.abs(analysis.actualBalance.used - analysis.redisPositions.total);
    const discrepancyPercent = analysis.actualBalance.used > 0 ? 
      (discrepancy / analysis.actualBalance.used) * 100 : 0;

    // ポジション残存、実残高ゼロ
    if (analysis.actualBalance.total === 0 && analysis.redisPositions.total > 0) {
      causes.push('手動売却またはストップロス実行済みだがRedisポジションが残存');
      causes.push('他システム・戦略による決済');
      causes.push('取引所での強制ロスカット');
      
      // ポジション経過時間チェック
      if (analysis.redisPositions.positions.length > 0) {
        const oldestAge = Math.max(...analysis.redisPositions.positions.map(p => parseFloat(p.ageHours)));
        if (oldestAge > 48) {
          causes.push(`古いポジション (${oldestAge.toFixed(1)}時間経過) - 決済漏れの可能性`);
        }
      }
    }

    // 実残高過多（ポジション記録不足）
    else if (analysis.actualBalance.used > analysis.redisPositions.total && discrepancyPercent > 50) {
      causes.push('手動購入または他戦略の購入がRedisに未記録');
      causes.push('ポジション保存失敗 (Redis接続エラー等)');
      causes.push('部分約定の記録漏れ');
    }

    // ポジション過多（実残高不足）
    else if (analysis.redisPositions.total > analysis.actualBalance.used && discrepancyPercent > 10) {
      causes.push('部分決済がRedisに未反映');
      causes.push('取引所での約定とRedis更新のタイミング差');
      causes.push('決済注文の失敗・タイムアウト');
    }

    // 最近の取引活動チェック
    if (analysis.recentOrders.length === 0) {
      causes.push('最近7日間の取引活動なし - 古い不整合の可能性');
    } else {
      const recentSells = analysis.recentOrders.filter(o => o.side === 'sell');
      const recentBuys = analysis.recentOrders.filter(o => o.side === 'buy');
      
      if (recentSells.length > recentBuys.length) {
        causes.push('最近の売却活動が活発 - 決済による不整合');
      }
      if (recentBuys.length > recentSells.length) {
        causes.push('最近の購入活動が活発 - 新規ポジション記録漏れ');
      }
    }

    return causes.length > 0 ? causes : ['不明 - さらなる調査が必要'];
  }

  /**
   * パターン分析
   */
  async analyzePatterns() {
    console.log('📊 不整合パターン分析...\n');

    // 戦略別パターン
    const strategyPatterns = {};
    for (const issue of this.criticalIssues) {
      if (!strategyPatterns[issue.strategy]) {
        strategyPatterns[issue.strategy] = {
          count: 0,
          zeroBalanceWithPositions: 0,
          positionDeficit: 0,
          positionSurplus: 0
        };
      }
      
      strategyPatterns[issue.strategy].count++;
      
      if (issue.actualBalance.total === 0 && issue.redisPositions.total > 0) {
        strategyPatterns[issue.strategy].zeroBalanceWithPositions++;
      } else if (issue.actualBalance.used > issue.redisPositions.total) {
        strategyPatterns[issue.strategy].positionDeficit++;
      } else if (issue.redisPositions.total > issue.actualBalance.used) {
        strategyPatterns[issue.strategy].positionSurplus++;
      }
    }

    console.log('🎯 戦略別不整合パターン:');
    for (const [strategy, pattern] of Object.entries(strategyPatterns)) {
      console.log(`\n${strategy}:`);
      console.log(`  総件数: ${pattern.count}`);
      console.log(`  実残高ゼロ・ポジション有: ${pattern.zeroBalanceWithPositions}`);
      console.log(`  ポジション不足: ${pattern.positionDeficit}`);
      console.log(`  ポジション過多: ${pattern.positionSurplus}`);
    }

    this.patternAnalysis = { strategyPatterns };
  }

  /**
   * 調査レポート生成
   */
  async generateInvestigationReport() {
    console.log('\n' + '='.repeat(100));
    console.log('📋 残高不整合調査レポート');
    console.log('='.repeat(100));

    console.log(`\n🔍 調査対象: ${this.criticalIssues.length}件の重要不整合`);
    console.log(`📅 調査日時: ${new Date().toLocaleString('ja-JP')}`);

    console.log('\n📊 主要な問題パターン:');
    
    const zeroBalanceCases = this.criticalIssues.filter(i => i.actualBalance.total === 0 && i.redisPositions.total > 0);
    const surplusCases = this.criticalIssues.filter(i => i.actualBalance.used > i.redisPositions.total);
    const deficitCases = this.criticalIssues.filter(i => i.redisPositions.total > i.actualBalance.used);

    console.log(`\n1️⃣ 実残高ゼロ・ポジション残存: ${zeroBalanceCases.length}件`);
    if (zeroBalanceCases.length > 0) {
      console.log('   主な原因: 手動決済、ストップロス実行済み、他システム決済');
      console.log('   対策: ポジション手動クリア、決済検出機能強化');
    }

    console.log(`\n2️⃣ 実残高過多・ポジション不足: ${surplusCases.length}件`);
    if (surplusCases.length > 0) {
      console.log('   主な原因: 手動購入、他戦略の影響、ポジション記録失敗');
      console.log('   対策: 定期的残高同期、ポジション記録強化');
    }

    console.log(`\n3️⃣ ポジション過多・実残高不足: ${deficitCases.length}件`);
    if (deficitCases.length > 0) {
      console.log('   主な原因: 部分決済未反映、決済タイミング差');
      console.log('   対策: 決済後の残高確認、ポジション更新強化');
    }

    console.log('\n🚨 緊急対応が必要な案件:');
    const urgentCases = this.criticalIssues.filter(i => 
      i.actualBalance.total === 0 && i.redisPositions.total > 0
    );
    for (const urgent of urgentCases) {
      console.log(`   • ${urgent.symbol} (${urgent.strategy}): ポジション${urgent.redisPositions.total} - 手動クリア推奨`);
    }

    console.log('\n💡 推奨改善策:');
    console.log('   1. リアルタイム残高同期機能の実装');
    console.log('   2. ポジション保存時のエラーハンドリング強化');
    console.log('   3. 定期的な残高整合性チェックの自動化');
    console.log('   4. 手動取引検出機能の追加');
    console.log('   5. 古いポジション自動クリア機能');

    console.log('\n' + '='.repeat(100));
  }
}

/**
 * メイン実行
 */
async function main() {
  const analyzer = new DiscrepancyAnalyzer();
  
  try {
    console.log('Redis接続を初期化中...');
    await initRedisClient();
    console.log('Redis接続完了\n');

    await analyzer.investigateCriticalDiscrepancies();
    
  } catch (error) {
    console.error('調査実行エラー:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { DiscrepancyAnalyzer };