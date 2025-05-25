/**
 * MARKETとつく戦略をすべてクローズし、パラメータを削除するスクリプト
 */

// モジュールのインポート
const { exchangeBB, exchangeBF } = require('../src/config');
const { getMarketParameters, deleteTradeSummary } = require('../src/database/manager');
const { postErrorToDiscord, postOrderToDiscord } = require('../src/common/notifications');
const { sleep } = require('../src/common/utils');
const { 
  getAllStrategyParametersRedis, 
  deleteStrategyParametersRedis,
  getStrategyParametersRedis,
  initialize,
  getTradeSummary
} = require('../src/database/redisDatabase');

/**
 * 指定された取引所のMARKET戦略のポジションを成行で売却する関数
 * @param {Object} exchange - ccxtの取引所オブジェクト
 */
async function closeMarketPositions(exchange) {
  try {
    console.log(`取引所 ${exchange.id} のMARKET戦略のポジションを解消します...`);
    await postOrderToDiscord(`[INFO] 取引所 ${exchange.id} のMARKET戦略のポジションを解消します...`);

    // 利用可能な通貨ペアを取得
    const markets = await exchange.loadMarkets();
    
    // すべての戦略パラメータを取得
    const allParams = await getAllStrategyParametersRedis();
    
    // 売却した通貨の数をカウント
    let soldCount = 0;
    
    // MARKETパラメータを持つ各戦略について処理
    for (const key in allParams) {
      // キーの形式: params:exchangeId:symbol:strategyKey
      const parts = key.split(':');
      if (parts.length < 4) continue;
      
      const keyExchangeId = parts[1];
      const symbol = parts[2];
      const strategyKey = parts[3];
      
      // この取引所のMARKET戦略のみを処理
      if (keyExchangeId !== exchange.id || !strategyKey.includes('_MARKET')) {
        continue;
      }
      
      // 通貨ペアが存在するか確認
      if (!markets[symbol]) {
        console.log(`通貨ペア ${symbol} は利用できません。スキップします。`);
        continue;
      }

      // tradeSummaryからポジションを取得
      const summary = await getTradeSummary({
        exchangeId: exchange.id,
        symbol,
        strategyKey
      });
      
      // ポジションがない場合はスキップ
      if (!summary || !summary.netPosition || summary.netPosition <= 0) {
        console.log(`${symbol} のMARKET戦略 (${strategyKey}) にポジションがありません。スキップします。`);
        continue;
      }
      
      const params = await getMarketParameters(exchange, symbol);
      if (!params) continue;
      
      const { minTradeAmount, pricePrecision, amountPrecision } = params;
      
      try {
        // マーケット情報を取得
        const market = markets[symbol];
        
        // 最小取引量を取得
        const minAmount = market.limits?.amount?.min || 0.0001;
        
        // ポジション量を取得
        const amount = summary.netPosition;
        
        // 取引量が最小取引量より小さい場合はスキップ
        if (amount < minAmount) {
          console.log(`${symbol} のポジション (${amount}) が最小取引量 (${minAmount}) より小さいためスキップします。`);
          continue;
        }
        
        // 精度を考慮して取引量を調整
        const formattedAmount = parseFloat(amount.toFixed(amountPrecision));
        
        console.log(`MARKET戦略 - ${symbol} (${strategyKey}) を成行で売却します。数量: ${formattedAmount}`);
        await postOrderToDiscord(`[INFO] MARKET戦略 - ${exchange.id}: ${symbol} (${strategyKey}) を成行で売却します。数量: ${formattedAmount}`);
        
        // 成行売り注文を作成
        const order = await exchange.createMarketSellOrder(symbol, formattedAmount);
        
        // 約定情報を取得して実際の約定価格を取得
        let executedPrice;
        try {
          const orderDetails = await exchange.fetchOrder(order.id, symbol);
          executedPrice = orderDetails.price || orderDetails.average;
          
          // 約定価格が取得できない場合は現在の価格を取得
          if (!executedPrice) {
            const ticker = await exchange.fetchTicker(symbol);
            executedPrice = ticker.last;
          }
        } catch (fetchError) {
          console.error(`約定情報の取得に失敗しました: ${symbol}`, fetchError);
          // 約定価格が取得できない場合は現在の価格を取得
          const ticker = await exchange.fetchTicker(symbol);
          executedPrice = ticker.last;
        }
        
        console.log(`MARKET戦略 - ${symbol} (${strategyKey}) の売却が完了しました。数量: ${formattedAmount}, 約定価格: ${executedPrice}`);
        await postOrderToDiscord(`[SUCCESS] MARKET戦略 - ${exchange.id}: ${symbol} (${strategyKey}) の売却が完了しました。数量: ${formattedAmount}, 約定価格: ${executedPrice}`);
        
        // tradeSummaryを削除
        const deleted = await deleteTradeSummary(exchange.id, symbol, strategyKey);
        if (deleted) {
          console.log(`${symbol} (${strategyKey}) のトレードサマリーを削除しました。`);
          await postOrderToDiscord(`[INFO] ${exchange.id}: ${symbol} (${strategyKey}) のトレードサマリーを削除しました。`);
        } else {
          console.log(`${symbol} (${strategyKey}) のトレードサマリー削除に失敗しました。`);
          await postOrderToDiscord(`[WARNING] ${exchange.id}: ${symbol} (${strategyKey}) のトレードサマリー削除に失敗しました。`);
        }
        
        soldCount++;
      } catch (error) {
        console.error(`${symbol} (${strategyKey}) の売却中にエラーが発生しました:`, error);
        await postErrorToDiscord(`[ERROR] MARKET戦略 - ${exchange.id}: ${symbol} (${strategyKey}) の売却中にエラーが発生しました: ${error.message}`);
      }
      
      // APIレート制限を考慮して少し待機
      await sleep(1000);
    }
    
    if (soldCount === 0) {
      console.log(`取引所 ${exchange.id} に売却可能なMARKET戦略のポジションはありませんでした。`);
      await postOrderToDiscord(`[INFO] 取引所 ${exchange.id} に売却可能なMARKET戦略のポジションはありませんでした。`);
    } else {
      console.log(`取引所 ${exchange.id} の ${soldCount} 通貨のMARKET戦略のポジションを解消しました。`);
      await postOrderToDiscord(`[INFO] 取引所 ${exchange.id} の ${soldCount} 通貨のMARKET戦略のポジションを解消しました。`);
    }
    
    return soldCount;
  } catch (error) {
    console.error(`取引所 ${exchange.id} のMARKET戦略のポジション解消中にエラーが発生しました:`, error);
    await postErrorToDiscord(`[ERROR] 取引所 ${exchange.id} のMARKET戦略のポジション解消中にエラーが発生しました: ${error.message}`);
    return 0;
  }
}

/**
 * すべての取引所のMARKET戦略のポジションを成行で売却する関数
 */
async function closeAllMarketPositionsOnAllExchanges() {
  try {
    console.log('すべての取引所のMARKET戦略のポジションを解消します...');
    await postOrderToDiscord('[INFO] すべての取引所のMARKET戦略のポジションを解消します...');
    
    // 各取引所のポジションを解消
    const exchanges = [exchangeBB, exchangeBF];
    let totalSoldCount = 0;
    
    for (const exchange of exchanges) {
      const soldCount = await closeMarketPositions(exchange);
      totalSoldCount += soldCount;
      
      // 取引所間の処理の間に少し待機
      await sleep(2000);
    }
    
    if (totalSoldCount === 0) {
      console.log('すべての取引所に売却可能なMARKET戦略のポジションはありませんでした。');
      await postOrderToDiscord('[INFO] すべての取引所に売却可能なMARKET戦略のポジションはありませんでした。');
    } else {
      console.log(`合計 ${totalSoldCount} 通貨のMARKET戦略のポジションを解消しました。`);
      await postOrderToDiscord(`[INFO] 合計 ${totalSoldCount} 通貨のMARKET戦略のポジションを解消しました。`);
    }
    
    return totalSoldCount;
  } catch (error) {
    console.error('MARKET戦略のポジション解消中にエラーが発生しました:', error);
    await postErrorToDiscord(`[ERROR] MARKET戦略のポジション解消中にエラーが発生しました: ${error.message}`);
    return 0;
  }
}

/**
 * 指定された取引所の通貨ペアにMARKET戦略が存在するか確認する関数
 * @param {String} exchangeId - 取引所ID
 * @param {String} symbol - 通貨ペア
 * @returns {Promise<Boolean>} MARKET戦略が存在するかどうか
 */
async function hasMarketStrategyForSymbol(exchangeId, symbol) {
  try {
    // すべての戦略パラメータを取得
    const allParams = await getAllStrategyParametersRedis();
    
    // この通貨ペアにMARKET戦略があるか検索
    for (const key in allParams) {
      // キーの形式: params:exchangeId:symbol:strategyKey
      const parts = key.split(':');
      if (parts.length < 4) continue;
      
      const keyExchangeId = parts[1];
      const keySymbol = parts[2];
      const strategyKey = parts[3];
      
      if (keyExchangeId === exchangeId && keySymbol === symbol && strategyKey.includes('_MARKET')) {
        console.log(`MARKET戦略が見つかりました: ${key}`);
        return true;
      }
    }
    
    return false;
  } catch (error) {
    console.error(`MARKET戦略の検索中にエラーが発生しました: ${exchangeId}, ${symbol}`, error);
    // エラーが発生した場合は安全側に倒して true を返す（ポジションを閉じる）
    return true;
  }
}

/**
 * すべてのMARKET戦略のパラメータをRedisから削除する関数
 * @returns {Promise<Number>} 削除したパラメータの数
 */
async function deleteAllMarketStrategyParameters() {
  try {
    console.log('すべてのMARKET戦略のパラメータを削除します...');
    await postOrderToDiscord('[INFO] すべてのMARKET戦略のパラメータを削除します...');
    
    // すべての戦略パラメータを取得
    const allParams = await getAllStrategyParametersRedis();
    let deletedCount = 0;
    let errorCount = 0;
    
    if (!allParams || Object.keys(allParams).length === 0) {
      console.log('戦略パラメータが見つかりませんでした。');
      await postOrderToDiscord('[INFO] 戦略パラメータが見つかりませんでした。');
      return 0;
    }
    
    // MARKET戦略を検索して削除
    for (const key in allParams) {
      // キーの形式: params:exchangeId:symbol:strategyKey
      const parts = key.split(':');
      if (parts.length < 4) {
        console.log(`無効なキー形式をスキップします: ${key}`);
        continue;
      }
      
      const exchangeId = parts[1];
      const symbol = parts[2];
      const strategyKey = parts[3];
      
      if (strategyKey.includes('_MARKET')) {
        try {
          const success = await deleteStrategyParametersRedis(exchangeId, symbol, strategyKey);
          if (success) {
            console.log(`MARKET戦略パラメータを削除しました: ${key}`);
            deletedCount++;
          } else {
            console.error(`MARKET戦略パラメータの削除に失敗しました: ${key}`);
            errorCount++;
          }
        } catch (deleteError) {
          console.error(`MARKET戦略パラメータの削除中に例外が発生しました: ${key}`, deleteError);
          errorCount++;
          // 個々の削除エラーは全体のプロセスを停止させない
        }
          try {
            const success = await deleteTradeSummary(exchange.id, symbol, strategyKey);
            if (success) {
              console.log(`MARKET戦略Summaryを削除しました: ${key}`);
              deletedCount++;
            } else {
              console.error(`MARKET戦略Summaryの削除に失敗しました: ${key}`);
              errorCount++;
            }
          } catch (deleteError) {
            console.error(`MARKET戦略Summaryの削除中に例外が発生しました: ${key}`, deleteError);
            errorCount++;
            // 個々の削除エラーは全体のプロセスを停止させない
          }
      }
    }
    
    if (deletedCount === 0 && errorCount === 0) {
      console.log('削除すべきMARKET戦略パラメータはありませんでした。');
      await postOrderToDiscord('[INFO] 削除すべきMARKET戦略パラメータはありませんでした。');
    } else {
      const message = `合計 ${deletedCount} 個のMARKET戦略パラメータを削除しました。${errorCount > 0 ? `(${errorCount}個の削除に失敗)` : ''}`;
      console.log(message);
      await postOrderToDiscord(`[INFO] ${message}`);
    }
    
    return deletedCount;
  } catch (error) {
    console.error('MARKET戦略パラメータの削除中にエラーが発生しました:', error);
    await postErrorToDiscord(`[ERROR] MARKET戦略パラメータの削除中にエラーが発生しました: ${error.message}`);
    return 0;
  }
}

// コマンドライン引数をチェック
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('使用方法: node scripts/closeMarketStrategies.js [オプション]');
  console.log('オプション:');
  console.log('  --close-only     ポジションを閉じるだけで、パラメータは削除しない');
  console.log('  --delete-only    パラメータを削除するだけで、ポジションは閉じない');
  console.log('  --bitbank, -bb   BitBankのMARKET戦略のみを対象にする');
  console.log('  --bitflyer, -bf  BitFlyerのMARKET戦略のみを対象にする');
  console.log('  --dry-run        実際の変更を行わずに何が行われるかを表示する');
  console.log('  --help, -h       このヘルプメッセージを表示');
  console.log('オプションなしで実行すると、すべての取引所のMARKET戦略のポジションを閉じ、パラメータを削除します。');
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
    
    const closeOnly = args.includes('--close-only');
    const deleteOnly = args.includes('--delete-only');
    const dryRun = args.includes('--dry-run');
    
    if (dryRun) {
      console.log('=============================================');
      console.log('ドライラン: 実際の変更は行われません');
      console.log('=============================================');
      await postOrderToDiscord('[INFO] ドライラン: 実際の変更は行われません');
    }
    
    // ポジションを閉じる
    if (!deleteOnly) {
      try {
        if (dryRun) {
          console.log('[ドライラン] MARKET戦略のポジションを解消する対象を確認します');
          // ドライランの場合は実際の取引を行わない
          // 対象となる戦略のパラメータのみを表示
          const allParams = await getAllStrategyParametersRedis();
          for (const key in allParams) {
            const parts = key.split(':');
            if (parts.length < 4) continue;
            
            const exchangeId = parts[1];
            const symbol = parts[2];
            const strategyKey = parts[3];
            
            if (strategyKey.includes('_MARKET')) {
              console.log(`[ドライラン] ポジション解消対象: ${exchangeId} - ${symbol} - ${strategyKey}`);
            }
          }
        } else {
          if (args.includes('--bitbank') || args.includes('-bb')) {
            console.log('BitBankのMARKET戦略のポジションのみを解消します...');
            await closeMarketPositions(exchangeBB);
          } else if (args.includes('--bitflyer') || args.includes('-bf')) {
            console.log('BitFlyerのMARKET戦略のポジションのみを解消します...');
            await closeMarketPositions(exchangeBF);
          } else {
            await closeAllMarketPositionsOnAllExchanges();
          }
        }
      } catch (closeError) {
        console.error('ポジション解消中にエラーが発生しました:', closeError);
        await postErrorToDiscord(`[ERROR] ポジション解消中にエラーが発生しました: ${closeError.message}`);
        // ポジション解消に失敗してもパラメータ削除は続行
      }
    }
    
    // パラメータを削除
    if (!closeOnly) {
      try {
        if (dryRun) {
          console.log('[ドライラン] 削除対象のMARKET戦略パラメータを確認します');
          // ドライランの場合は実際の削除を行わない
          // 削除対象となるパラメータのみを表示
          const allParams = await getAllStrategyParametersRedis();
          let count = 0;
          for (const key in allParams) {
            const parts = key.split(':');
            if (parts.length < 4) continue;
            
            const exchangeId = parts[1];
            const symbol = parts[2];
            const strategyKey = parts[3];
            
            if (strategyKey.includes('_MARKET')) {
              console.log(`[ドライラン] 削除対象: ${key}`);
              count++;
            }
          }
          console.log(`[ドライラン] 合計 ${count} 個のMARKET戦略パラメータが削除対象です`);
        } else {
          await deleteAllMarketStrategyParameters();
        }
      } catch (deleteError) {
        console.error('パラメータ削除中にエラーが発生しました:', deleteError);
        await postErrorToDiscord(`[ERROR] パラメータ削除中にエラーが発生しました: ${deleteError.message}`);
        process.exit(1);
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
  closeMarketPositions,
  closeAllMarketPositionsOnAllExchanges,
  deleteAllMarketStrategyParameters
};