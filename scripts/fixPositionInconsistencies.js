#!/usr/bin/env node

/**
 * ポジション不整合修正スクリプト
 * 
 * 機能:
 * - checkPositionConsistency.jsで検出された不整合を分析
 * - 必要に応じて修正案を提示
 * - 安全な修正操作の実行
 */

const { getAllTradeSummaries, initialize, deleteKey } = require('../src/database/redisDatabase');
const { config } = require('../src/config');
const { aggregateNetPositionsBySymbol, analyzeConsistency, extractCurrency } = require('./checkPositionConsistency');

/**
 * 取引所の残高情報を取得
 * @param {Object} exchange - 取引所インスタンス
 * @returns {Promise<Object>} 残高情報
 */
async function getExchangeBalances(exchange) {
  try {
    const balance = await exchange.fetchBalance();
    return balance;
  } catch (error) {
    console.error(`✗ ${exchange.id}の残高取得に失敗:`, error.message);
    return null;
  }
}

/**
 * 修正候補を分析する
 * @param {Object} inconsistentItem - 不整合データ
 * @returns {Object} 修正提案
 */
function analyzeInconsistency(inconsistentItem) {
  const { exchangeId, currency, exchangeTotal, redisTotal, difference, strategies } = inconsistentItem;
  
  const suggestions = [];
  const actions = [];
  
  // 極端に大きな差の場合
  if (difference > exchangeTotal * 5) {
    suggestions.push(`❗ 極端に大きな差: Redisに古いポジション記録が残っている可能性`);
    
    // 0ポジションの戦略を特定
    const zeroStrategies = strategies.filter(s => s.netPosition === 0);
    const activeStrategies = strategies.filter(s => s.netPosition > 0);
    
    if (zeroStrategies.length > 0) {
      suggestions.push(`🔹 削除候補: ${zeroStrategies.length}個の0ポジション戦略記録`);
      zeroStrategies.forEach(strategy => {
        actions.push({
          type: 'delete_zero_position',
          key: `summary:trade:${exchangeId}:${strategy.symbol}:${strategy.strategyKey}`,
          description: `${strategy.symbol} [${strategy.strategyKey}] (${strategy.netPosition})`
        });
      });
    }
    
    if (activeStrategies.length > 0) {
      suggestions.push(`⚠️  要確認: ${activeStrategies.length}個のアクティブ戦略記録`);
    }
  }
  
  // 中程度の差の場合
  else if (difference > exchangeTotal * 0.1) {
    suggestions.push(`⚠️  中程度の差: 取引進行中または外部取引の可能性`);
    suggestions.push(`🔹 推奨: しばらく待ってから再チェック`);
  }
  
  // 小さな差の場合
  else {
    suggestions.push(`ℹ️  小さな差: 取引進行中の可能性が高い`);
    suggestions.push(`🔹 推奨: 自動修正は行わず、経過観察`);
  }
  
  return {
    suggestions,
    actions,
    severity: difference > exchangeTotal * 5 ? 'high' : difference > exchangeTotal * 0.1 ? 'medium' : 'low'
  };
}

/**
 * 修正提案を表示する
 * @param {Array} inconsistentItems - 不整合データの配列
 * @returns {Object} 修正提案の集計
 */
function generateFixProposals(inconsistentItems) {
  console.log('\n' + '='.repeat(80));
  console.log('🔧 ポジション不整合修正提案');
  console.log('='.repeat(80));
  
  const allActions = [];
  
  inconsistentItems
    .sort((a, b) => b.difference - a.difference)
    .forEach((item, index) => {
      console.log(`\n${index + 1}. 🏦 ${item.exchangeId} - ${item.currency}:`);
      console.log(`   差分: ${item.difference.toFixed(8)} (${item.differencePercentage.toFixed(2)}%)`);
      console.log(`   取引所: ${item.exchangeTotal.toFixed(8)}, Redis: ${item.redisTotal.toFixed(8)}`);
      
      const analysis = analyzeInconsistency(item);
      
      console.log(`   重要度: ${analysis.severity.toUpperCase()}`);
      
      if (analysis.suggestions.length > 0) {
        console.log('   提案:');
        analysis.suggestions.forEach(suggestion => {
          console.log(`     ${suggestion}`);
        });
      }
      
      if (analysis.actions.length > 0) {
        console.log('   実行可能な修正:');
        analysis.actions.forEach((action, actionIndex) => {
          console.log(`     ${actionIndex + 1}) ${action.description}`);
          allActions.push(action);
        });
      }
    });
  
  return {
    totalActions: allActions.length,
    deleteActions: allActions.filter(a => a.type === 'delete_zero_position').length,
    actions: allActions
  };
}

/**
 * 修正アクションを実行する
 * @param {Array} actions - 実行するアクション配列
 * @param {boolean} dryRun - ドライランモード
 * @returns {Promise<Object>} 実行結果
 */
async function executeActions(actions, dryRun = true) {
  console.log('\n' + '='.repeat(80));
  console.log(`🚀 修正アクション実行 ${dryRun ? '(ドライランモード)' : '(実行モード)'}`);
  console.log('='.repeat(80));
  
  const results = {
    total: actions.length,
    success: 0,
    failed: 0,
    errors: []
  };
  
  for (const action of actions) {
    try {
      console.log(`\n🔄 処理中: ${action.description}`);
      console.log(`   キー: ${action.key}`);
      
      if (!dryRun) {
        if (action.type === 'delete_zero_position') {
          const deleted = await deleteKey(action.key);
          if (deleted) {
            console.log(`   ✅ 削除成功`);
            results.success++;
          } else {
            console.log(`   ⚠️  キーが見つかりません（既に削除済み）`);
            results.success++;
          }
        }
      } else {
        console.log(`   🔍 ドライラン: 削除予定`);
        results.success++;
      }
    } catch (error) {
      console.log(`   ❌ エラー: ${error.message}`);
      results.failed++;
      results.errors.push({
        action,
        error: error.message
      });
    }
  }
  
  console.log(`\n📊 実行結果:`);
  console.log(`   総数: ${results.total}`);
  console.log(`   成功: ${results.success}`);
  console.log(`   失敗: ${results.failed}`);
  
  return results;
}

/**
 * インタラクティブな修正モード
 * @param {Array} actions - 修正アクション配列
 */
async function interactiveMode(actions) {
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  const question = (prompt) => new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
  
  console.log('\n🤔 修正を実行しますか？');
  console.log('選択肢:');
  console.log('  1) ドライラン実行（変更なし）');
  console.log('  2) 修正実行');
  console.log('  3) キャンセル');
  
  const choice = await question('\n選択してください (1-3): ');
  
  switch (choice.trim()) {
    case '1':
      await executeActions(actions, true);
      break;
    case '2':
      console.log('\n⚠️  実際に修正を実行します。よろしいですか？');
      const confirm = await question('y/N で答えてください: ');
      if (confirm.toLowerCase() === 'y') {
        await executeActions(actions, false);
      } else {
        console.log('キャンセルしました。');
      }
      break;
    case '3':
    default:
      console.log('キャンセルしました。');
      break;
  }
  
  rl.close();
}

/**
 * メイン実行関数
 */
async function main() {
  // コマンドライン引数をチェック
  const args = process.argv.slice(2);
  const dryRunMode = args.includes('--dry-run');
  const executeMode = args.includes('--execute');
  const autoMode = dryRunMode || executeMode;
  try {
    console.log('🔧 ポジション不整合修正ツールを開始します...\n');
    
    // Redis接続を初期化
    console.log('🔗 Redis接続を初期化中...');
    await initialize();
    console.log('✓ Redis接続が初期化されました\n');
    
    // 取引サマリーを取得
    console.log('📊 Redis上の取引サマリーを取得中...');
    const summaries = await getAllTradeSummaries();
    console.log(`✓ ${summaries.length}件の取引サマリーを取得しました\n`);
    
    // 銘柄ごとに集計
    console.log('🔄 銘柄ごとにnetPositionを集計中...');
    const redisAggregates = aggregateNetPositionsBySymbol(summaries);
    console.log('✓ 集計完了\n');
    
    // 取引所の残高を取得
    console.log('🏦 取引所の残高情報を取得中...');
    const exchangeBalances = {};
    
    for (const [exchangeId, exchangeConfig] of Object.entries(config.exchanges)) {
      if (exchangeConfig.instance) {
        const balance = await getExchangeBalances(exchangeConfig.instance);
        if (balance) {
          exchangeBalances[exchangeId] = balance;
        }
      }
    }
    console.log('✓ 残高取得完了\n');
    
    // 整合性チェック
    console.log('🔍 整合性をチェック中...');
    const results = analyzeConsistency(redisAggregates, exchangeBalances);
    
    if (results.inconsistent.length === 0) {
      console.log('✅ 不整合は検出されませんでした。修正は不要です。');
      process.exit(0);
    }
    
    // 修正提案を生成
    const proposals = generateFixProposals(results.inconsistent);
    
    if (proposals.totalActions === 0) {
      console.log('\n📋 自動修正可能な項目はありません。手動での確認・修正が必要です。');
      process.exit(0);
    }
    
    console.log(`\n📋 修正可能な項目: ${proposals.totalActions}件`);
    console.log(`   削除可能な0ポジション記録: ${proposals.deleteActions}件`);
    
    // モードに応じた実行
    if (autoMode) {
      if (dryRunMode) {
        console.log('\n🔍 ドライランモードで実行します...');
        await executeActions(proposals.actions, true);
      } else if (executeMode) {
        console.log('\n🚀 修正を実行します...');
        await executeActions(proposals.actions, false);
      }
    } else {
      // インタラクティブモード
      await interactiveMode(proposals.actions);
    }
    
  } catch (error) {
    console.error('❌ エラーが発生しました:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// スクリプトが直接実行された場合のみmain関数を実行
if (require.main === module) {
  main();
}

module.exports = {
  main,
  analyzeInconsistency,
  generateFixProposals,
  executeActions
};