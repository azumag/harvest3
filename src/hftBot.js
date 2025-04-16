// モジュールのインポート
const { exchangeBB, exchangeBF, bitflyerMinTradeAmounts } = require('./config');
const { config } = require('./config');
const { postErrorToDiscord, postOrderToDiscord } = require('./notifications');
const { postReport, postStrategyProfitReport } = require('./reports');
const { runStrategy } = require('./strategyRunner');
const { getMarketParameters, sleep } = require('./utils');

/**
 * 高頻度取引（HFT）ボットを起動する関数
 */
async function startHFTBot() {
  try {
    // const exchanges = [exchangeBB, exchangeBF];
    const exchanges = [exchangeBB];
    
    // 高頻度取引戦略（HFT）を実行
    if (config.strategies.HFT.enabled) {
      console.log('高頻度取引戦略（HFT）を起動します...');
      for (const exchange of exchanges) {
        const markets = await exchange.loadMarkets();
        const symbols = Object.keys(markets).filter(symbol => 
          symbol.endsWith('/JPY') && !symbol.startsWith('ELF/') && symbol !== 'BTC/JPY' // ELFとBTC/JPYを除外
        );
        
        for (const symbol of symbols) {
          // マーケットパラメータを取得
          const params = await getMarketParameters(exchange, symbol);
          if (!params) continue;
          
          const { minTradeAmount, pricePrecision, amountPrecision } = params;
          
          // HFT戦略を別スレッドで実行
          runStrategy('HFT', exchange, symbol, {
            pricePrecision,
            amountPrecision,
            minTradeAmount,
            postOrderToDiscord,
            postErrorToDiscord,
            bitflyerMinTradeAmounts,
            interval: config.strategies.HFT.interval,
            priceThreshold: config.strategies.HFT.priceThreshold,
            maxOrdersPerMinute: config.strategies.HFT.maxOrdersPerMinute,
            tradePercentage: config.tradePercentage
          });
        }
      }
      console.log('高頻度取引戦略（HFT）の起動が完了しました。');
    } else {
      console.log('高頻度取引戦略（HFT）は設定で無効になっています。');
    }
  } catch (error) {
    const errorMessage = `エラーが発生しました: ${error.message}`;
    console.error(errorMessage, error);
    await postErrorToDiscord(errorMessage);
  }
}

// // レポートを投稿するためのタイマー設定
// setInterval(() => {
//   const now = new Date();
//   if (now.getMinutes() === 0) { // 時間ごと
    
//     // 戦略と銘柄ごとの損益レポート
//     postStrategyProfitReport(exchangeBB);
//     postStrategyProfitReport(exchangeBF);
//   }
// }, 60000); // 1分ごとにチェック


// ボットを起動
console.log('高頻度取引（HFT）ボットを起動します...');
startHFTBot();