/**
 * _MARKETとつくtradesummaryをすべて削除するスクリプト
 */

// モジュールのインポート
const { exchangeBB, exchangeBF } = require('../src/config');
const { deleteTradeSummary } = require('../src/database/manager');
const { postErrorToDiscord, postOrderToDiscord } = require('../src/common/notifications');
const { sleep } = require('../src/common/utils');
const { 
  initialize,
  getAllTradeSummaries
} = require('../src/database/redisDatabase');

/**
 * すべてのMARKET戦略のtradesummaryを削除する関数
 * @returns {Promise<Number>} 削除したtradesummaryの数
 */
async function deleteAllMarketTradeSummaries() {
  try {
    console.log('すべての_MARKET戦略のtradesummaryを削除します...');
    await postOrderToDiscord('[INFO] すべての_MARKET戦略のtradesummaryを削除します...');
    
    // すべてのtradesummaryを取得
    const allSummaries = await getAllTradeSummaries();
    let deletedCount = 0;
    let errorCount = 0;
    
    if (!allSummaries || allSummaries.length === 0) {
      console.log('tradesummaryが見つかりませんでした。');
      await postOrderToDiscord('[INFO] tradesummaryが見つかりませんでした。');
      return 0;
    }
    
    // MARKET戦略のtradesummaryを検索して削除
    for (const summary of allSummaries) {
      try {
        const { exchangeId, symbol, strategyKey } = summary;
        
        if (strategyKey && strategyKey.includes('_MARKET')) {
          console.log(`MARKET戦略tradesummaryを処理中: ${exchangeId}:${symbol}:${strategyKey}`);
          
          const success = await deleteTradeSummary(exchangeId, symbol, strategyKey);
          if (success) {
            console.log(`MARKET戦略tradesummaryを削除しました: ${exchangeId}:${symbol}:${strategyKey}`);
            deletedCount++;
            await postOrderToDiscord(`[INFO] MARKET戦略tradesummaryを削除しました: ${exchangeId}:${symbol}:${strategyKey}`);
          } else {
            console.error(`MARKET戦略tradesummaryの削除に失敗しました: ${exchangeId}:${symbol}:${strategyKey}`);
            errorCount++;
            await postErrorToDiscord(`[ERROR] MARKET戦略tradesummaryの削除に失敗しました: ${exchangeId}:${symbol}:${strategyKey}`);
          }
          
          // APIレート制限を考慮して少し待機
          await sleep(500);
        }
      } catch (deleteError) {
        console.error(`tradesummaryの削除中に例外が発生しました:`, deleteError);
        errorCount++;
        await postErrorToDiscord(`[ERROR] tradesummaryの削除中に例外が発生しました: ${deleteError.message}`);
        // 個々の削除エラーは全体のプロセスを停止させない
      }
    }
    
    if (deletedCount === 0 && errorCount === 0) {
      console.log('削除すべきMARKET戦略tradesummaryはありませんでした。');
      await postOrderToDiscord('[INFO] 削除すべきMARKET戦略tradesummaryはありませんでした。');
    } else {
      const message = `合計 ${deletedCount} 個のMARKET戦略tradesummaryを削除しました。${errorCount > 0 ? `(${errorCount}個の削除に失敗)` : ''}`;
      console.log(message);
      await postOrderToDiscord(`[INFO] ${message}`);
    }
    
    return deletedCount;
  } catch (error) {
    console.error('MARKET戦略tradesummaryの削除中にエラーが発生しました:', error);
    await postErrorToDiscord(`[ERROR] MARKET戦略tradesummaryの削除中にエラーが発生しました: ${error.message}`);
    return 0;
  }
}

/**
 * 特定の取引所のMARKET戦略のtradesummaryを削除する関数
 * @param {String} exchangeId - 取引所ID
 * @returns {Promise<Number>} 削除したtradesummaryの数
 */
async function deleteExchangeMarketTradeSummaries(exchangeId) {
  try {
    console.log(`取引所 ${exchangeId} のMARKET戦略tradesummaryを削除します...`);
    await postOrderToDiscord(`[INFO] 取引所 ${exchangeId} のMARKET戦略tradesummaryを削除します...`);
    
    // すべてのtradesummaryを取得
    const allSummaries = await getAllTradeSummaries();
    let deletedCount = 0;
    let errorCount = 0;
    
    if (!allSummaries || allSummaries.length === 0) {
      console.log('tradesummaryが見つかりませんでした。');
      return 0;
    }
    
    // この取引所のMARKET戦略のtradesummaryを検索して削除
    for (const summary of allSummaries) {
      try {
        const { exchangeId: summaryExchangeId, symbol, strategyKey } = summary;
        
        if (summaryExchangeId === exchangeId && strategyKey && strategyKey.includes('_MARKET')) {
          console.log(`MARKET戦略tradesummaryを処理中: ${exchangeId}:${symbol}:${strategyKey}`);
          
          const success = await deleteTradeSummary(exchangeId, symbol, strategyKey);
          if (success) {
            console.log(`MARKET戦略tradesummaryを削除しました: ${exchangeId}:${symbol}:${strategyKey}`);
            deletedCount++;
          } else {
            console.error(`MARKET戦略tradesummaryの削除に失敗しました: ${exchangeId}:${symbol}:${strategyKey}`);
            errorCount++;
          }
          
          // APIレート制限を考慮して少し待機
          await sleep(500);
        }
      } catch (deleteError) {
        console.error(`tradesummaryの削除中に例外が発生しました:`, deleteError);
        errorCount++;
        // 個々の削除エラーは全体のプロセスを停止させない
      }
    }
    
    if (deletedCount === 0 && errorCount === 0) {
      console.log(`取引所 ${exchangeId} に削除すべきMARKET戦略tradesummaryはありませんでした。`);
      await postOrderToDiscord(`[INFO] 取引所 ${exchangeId} に削除すべきMARKET戦略tradesummaryはありませんでした。`);
    } else {
      const message = `取引所 ${exchangeId} の ${deletedCount} 個のMARKET戦略tradesummaryを削除しました。${errorCount > 0 ? `(${errorCount}個の削除に失敗)` : ''}`;
      console.log(message);
      await postOrderToDiscord(`[INFO] ${message}`);
    }
    
    return deletedCount;
  } catch (error) {
    console.error(`取引所 ${exchangeId} のMARKET戦略tradesummaryの削除中にエラーが発生しました:`, error);
    await postErrorToDiscord(`[ERROR] 取引所 ${exchangeId} のMARKET戦略tradesummaryの削除中にエラーが発生しました: ${error.message}`);
    return 0;
  }
}

// コマンドライン引数をチェック
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('使用方法: node scripts/deleteMarketTradeSummaries.js [オプション]');
  console.log('オプション:');
  console.log('  --bitbank, -bb   BitBankのMARKET戦略のtradesummaryのみを削除');
  console.log('  --bitflyer, -bf  BitFlyerのMARKET戦略のtradesummaryのみを削除');
  console.log('  --dry-run        実際の変更を行わずに何が行われるかを表示する');
  console.log('  --help, -h       このヘルプメッセージを表示');
  console.log('オプションなしで実行すると、すべての取引所のMARKET戦略のtradesummaryを削除します。');
  process.exit(0);
}

// メイン処理
async function main() {
  try {
    // Redis初期化
    console.log('Redisデータベースに接続しています...');
    try {
      await initialize();
      console.log('Redisデータベースに接続しました');
    } catch (redisError) {
      console.error('Redisデータベースへの接続中にエラーが発生しました:', redisError);
      await postErrorToDiscord(`[ERROR] Redisデータベースへの接続中にエラーが発生しました: ${redisError.message}`);
      process.exit(1);
    }
    
    const dryRun = args.includes('--dry-run');
    
    if (dryRun) {
      console.log('=============================================');
      console.log('ドライラン: 実際の変更は行われません');
      console.log('=============================================');
      await postOrderToDiscord('[INFO] ドライラン: 実際の変更は行われません');
      
      // すべてのtradesummaryを取得
      const allSummaries = await getAllTradeSummaries();
      let count = 0;
      
      console.log('[ドライラン] 削除対象のMARKET戦略tradesummaryを確認します');
      
      for (const summary of allSummaries) {
        const { exchangeId, symbol, strategyKey } = summary;
        
        if (strategyKey && strategyKey.includes('_MARKET')) {
          if (args.includes('--bitbank') || args.includes('-bb')) {
            if (exchangeId === exchangeBB.id) {
              console.log(`[ドライラン] 削除対象: ${exchangeId}:${symbol}:${strategyKey}`);
              count++;
            }
          } else if (args.includes('--bitflyer') || args.includes('-bf')) {
            if (exchangeId === exchangeBF.id) {
              console.log(`[ドライラン] 削除対象: ${exchangeId}:${symbol}:${strategyKey}`);
              count++;
            }
          } else {
            console.log(`[ドライラン] 削除対象: ${exchangeId}:${symbol}:${strategyKey}`);
            count++;
          }
        }
      }
      
      console.log(`[ドライラン] 合計 ${count} 個のMARKET戦略tradesummaryが削除対象です`);
    } else {
      if (args.includes('--bitbank') || args.includes('-bb')) {
        console.log('BitBankのMARKET戦略のtradesummaryのみを削除します...');
        await deleteExchangeMarketTradeSummaries(exchangeBB.id);
      } else if (args.includes('--bitflyer') || args.includes('-bf')) {
        console.log('BitFlyerのMARKET戦略のtradesummaryのみを削除します...');
        await deleteExchangeMarketTradeSummaries(exchangeBF.id);
      } else {
        await deleteAllMarketTradeSummaries();
      }
    }
    
    console.log('処理が完了しました。');
    process.exit(0);
  } catch (error) {
    console.error('エラーが発生しました:', error);
    await postErrorToDiscord(`[ERROR] エラーが発生しました: ${error.message}`);
    process.exit(1);
  }
}

// スクリプトが直接実行された場合のみメイン処理を実行
if (require.main === module) {
  main();
}

module.exports = {
  deleteAllMarketTradeSummaries,
  deleteExchangeMarketTradeSummaries
};
