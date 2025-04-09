// モジュールのインポート
const { exchangeBB, exchangeBF, bitflyerMinTradeAmounts } = require('./config');
const { config } = require('./config');
const { postErrorToDiscord, postOrderToDiscord } = require('./notifications');
const { postReport, postStrategyProfitReport } = require('./reports');
const { runStrategy } = require('./strategyRunner');
const { getMarketParameters, sleep } = require('./utils');

/**
 * マーケットメイキングボットを起動する関数
 */
async function startMarketMakingBot() {
  try {
    // const exchanges = [exchangeBB, exchangeBF];
    const exchanges = [exchangeBB];
    
    // マーケットメイキング戦略を実行
    if (config.strategies.MARKET_MAKING.enabled) {
      console.log('レンジ相場向け受動的マーケットメイキング戦略を起動します...');
      for (const exchange of exchanges) {
        const markets = await exchange.loadMarkets();
        const symbols = Object.keys(markets).filter(symbol => 
          symbol.endsWith('/JPY') && !symbol.startsWith('ELF/')
        );
        
        for (const symbol of symbols) {
          // マーケットパラメータを取得
          const params = await getMarketParameters(exchange, symbol);
          if (!params) continue;
          
          const { minTradeAmount, pricePrecision, amountPrecision } = params;
          
          // マーケットメイキング戦略を別スレッドで実行
          runStrategy('MARKET_MAKING', exchange, symbol, {
            pricePrecision,
            amountPrecision,
            // minTradeAmount,
            minTradeAmount: 0.001,
            postOrderToDiscord,
            postErrorToDiscord,
            bitflyerMinTradeAmounts,
            rangePeriod: config.strategies.MARKET_MAKING.rangePeriod,
            rangeThreshold: config.strategies.MARKET_MAKING.rangeThreshold,
            spreadWidth: config.strategies.MARKET_MAKING.spreadWidth,
            reorderInterval: config.strategies.MARKET_MAKING.reorderInterval,
            maxPositionCount: config.strategies.MARKET_MAKING.maxPositionCount,
            adjustmentValue: config.strategies.MARKET_MAKING.adjustmentValue,
            tradePercentage: config.tradePercentage
          });
        }
      }
      console.log('レンジ相場向け受動的マーケットメイキング戦略の起動が完了しました。');
    } else {
      console.log('レンジ相場向け受動的マーケットメイキング戦略は設定で無効になっています。');
    }
  } catch (error) {
    const errorMessage = `エラーが発生しました: ${error.message}`;
    console.error(errorMessage, error);
    await postErrorToDiscord(errorMessage);
  }
}

// レポートを投稿するためのタイマー設定
setInterval(() => {
  const now = new Date();
  if (now.getMinutes() === 0) { // 時間ごと
    
    // 戦略と銘柄ごとの損益レポート
    postStrategyProfitReport(exchangeBB);
    postStrategyProfitReport(exchangeBF);
  }
}, 60000); // 1分ごとにチェック


// ボットを起動
console.log('マーケットメイキングボットを起動します...');
startMarketMakingBot();