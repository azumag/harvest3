/**
 * すべてのポジションを成行で売却するスクリプト
 */

// モジュールのインポート
const { exchangeBB, exchangeBF } = require('../src/config');
const { getMarketParameters } = require('../src/database/manager');
const { postErrorToDiscord, postOrderToDiscord } = require('../src/common/notifications');
const { sleep } = require('../src/common/utils');

/**
 * 指定された取引所の全ポジションを成行で売却する関数
 * @param {Object} exchange - ccxtの取引所オブジェクト
 */
async function closeAllPositions(exchange) {
  try {
    console.log(`取引所 ${exchange.id} の全ポジションを解消します...`);
    await postOrderToDiscord(`[INFO] 取引所 ${exchange.id} の全ポジションを解消します...`);

    // 残高を取得
    const balance = await exchange.fetchBalance();
    
    // 利用可能な通貨ペアを取得
    const markets = await exchange.loadMarkets();
    
    // 売却した通貨の数をカウント
    let soldCount = 0;
    
    // 各通貨について処理
    for (const currency in balance.free) {
      // JPYは売却対象外
      if (currency === 'JPY') continue;
      
      // 残高が十分にある場合のみ処理
      const amount = balance.free[currency];
      if (amount <= 0) continue;
      
      // 通貨ペアを構築（例: BTC → BTC/JPY）
      const symbol = `${currency}/JPY`;
      
      // 通貨ペアが存在するか確認
      if (!markets[symbol]) {
        console.log(`通貨ペア ${symbol} は利用できません。スキップします。`);
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
        
        // 取引量が最小取引量より小さい場合はスキップ
        if (amount < minAmount) {
          console.log(`${currency} の残高 (${amount}) が最小取引量 (${minAmount}) より小さいためスキップします。`);
          continue;
        }
        
        // 精度を考慮して取引量を調整
        const formattedAmount = parseFloat(amount.toFixed(amountPrecision));
        
        console.log(`${symbol} を成行で売却します。数量: ${formattedAmount}`);
        postOrderToDiscord(`[INFO] ${exchange.id}: ${symbol} を成行で売却します。数量: ${formattedAmount}`);
        
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
        
        console.log(`${symbol} の売却が完了しました。数量: ${formattedAmount}, 約定価格: ${executedPrice}`);
        await postOrderToDiscord(`[SUCCESS] ${exchange.id}: ${symbol} の売却が完了しました。数量: ${formattedAmount}, 約定価格: ${executedPrice}`);
        
        soldCount++;
      } catch (error) {
        console.error(`${symbol} の売却中にエラーが発生しました:`, error);
        await postErrorToDiscord(`[ERROR] ${exchange.id}: ${symbol} の売却中にエラーが発生しました: ${error.message}`);
      }
      
      // APIレート制限を考慮して少し待機
      await sleep(1000);
    }
    
    if (soldCount === 0) {
      console.log(`取引所 ${exchange.id} に売却可能なポジションはありませんでした。`);
      await postOrderToDiscord(`[INFO] 取引所 ${exchange.id} に売却可能なポジションはありませんでした。`);
    } else {
      console.log(`取引所 ${exchange.id} の ${soldCount} 通貨のポジションを解消しました。`);
      await postOrderToDiscord(`[INFO] 取引所 ${exchange.id} の ${soldCount} 通貨のポジションを解消しました。`);
    }
    
    return soldCount;
  } catch (error) {
    console.error(`取引所 ${exchange.id} のポジション解消中にエラーが発生しました:`, error);
    await postErrorToDiscord(`[ERROR] 取引所 ${exchange.id} のポジション解消中にエラーが発生しました: ${error.message}`);
    return 0;
  }
}

/**
 * すべての取引所の全ポジションを成行で売却する関数
 */
async function closeAllPositionsOnAllExchanges() {
  try {
    console.log('すべての取引所の全ポジションを解消します...');
    await postOrderToDiscord('[INFO] すべての取引所の全ポジションを解消します...');
    
    // 各取引所のポジションを解消
    const exchanges = [exchangeBB, exchangeBF];
    let totalSoldCount = 0;
    
    for (const exchange of exchanges) {
      const soldCount = await closeAllPositions(exchange);
      totalSoldCount += soldCount;
      
      // 取引所間の処理の間に少し待機
      await sleep(2000);
    }
    
    if (totalSoldCount === 0) {
      console.log('すべての取引所に売却可能なポジションはありませんでした。');
      await postOrderToDiscord('[INFO] すべての取引所に売却可能なポジションはありませんでした。');
    } else {
      console.log(`合計 ${totalSoldCount} 通貨のポジションを解消しました。`);
      await postOrderToDiscord(`[INFO] 合計 ${totalSoldCount} 通貨のポジションを解消しました。`);
    }
    
    return totalSoldCount;
  } catch (error) {
    console.error('ポジション解消中にエラーが発生しました:', error);
    await postErrorToDiscord(`[ERROR] ポジション解消中にエラーが発生しました: ${error.message}`);
    return 0;
  }
}

// コマンドライン引数をチェック
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('使用方法: node src/closeAllPositions.js [オプション]');
  console.log('オプション:');
  console.log('  --bitbank, -bb    BitBankのポジションのみを解消');
  console.log('  --bitflyer, -bf   BitFlyerのポジションのみを解消');
  console.log('  --help, -h        このヘルプメッセージを表示');
  console.log('オプションなしで実行すると、すべての取引所のポジションを解消します。');
  process.exit(0);
}

// メイン処理
async function main() {
  try {
    
    if (args.includes('--bitbank') || args.includes('-bb')) {
      console.log('BitBankのポジションのみを解消します...');
      await closeAllPositions(exchangeBB);
    } else if (args.includes('--bitflyer') || args.includes('-bf')) {
      console.log('BitFlyerのポジションのみを解消します...');
      await closeAllPositions(exchangeBF);
    } else {
      await closeAllPositionsOnAllExchanges();
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
  closeAllPositions,
  closeAllPositionsOnAllExchanges
};