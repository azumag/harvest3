// モジュールのインポート
const { exchangeBB, exchangeBF, bitflyerMinTradeAmounts } = require('./config');
const { config } = require('./config');
const { postErrorToDiscord, postOrderToDiscord } = require('./notifications');
const { postReport, postStrategyProfitReport } = require('./reports');
const { runStrategy, runArbitrageStrategy, runStrategies } = require('./strategyRunner');
const { getMarketParameters, sleep } = require('./utils');
const strategies = require('../strategies');

/**
 * ボットを起動する関数
 */
async function startBot() {
  try {
    const exchanges = [exchangeBB, exchangeBF];
    
    // 高頻度取引戦略（HFT）を実行
    if (config.strategies.HFT.enabled) {
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
    }
    
    // アービトラージ戦略を実行
    if (config.strategies.INTER_EXCHANGE_ARBITRAGE.enabled) {
      // 共通の通貨ペアを見つける
      const bbMarkets = await exchangeBB.loadMarkets();
      const bfMarkets = await exchangeBF.loadMarkets();
      
      const bbSymbols = Object.keys(bbMarkets).filter(symbol => symbol.endsWith('/JPY'));
      const bfSymbols = Object.keys(bfMarkets).filter(symbol => symbol.endsWith('/JPY'));
      
      // 両方の取引所に存在する通貨ペアを見つける
      const commonSymbols = bbSymbols.filter(symbol => bfSymbols.includes(symbol));
      
      // 定期的にアービトラージ機会を確認
      setInterval(async () => {
        for (const symbol of commonSymbols) {
          await runArbitrageStrategy(exchanges, symbol, {
            postOrderToDiscord,
            postErrorToDiscord,
            tradePercentage: config.tradePercentage
          });
        }
      }, 10000); // 10秒ごとに確認
    }
    
    // その他の戦略を実行
    const spreadHistory = {};
    
    while (true) {
      for (const exchange of exchanges) {
        const markets = await exchange.loadMarkets();
        const symbols = Object.keys(markets).filter(symbol => 
          symbol.endsWith('/JPY') && !symbol.startsWith('ELF/') && symbol !== 'BTC/JPY' // ELFとBTC/JPYを除外
        );
        
        for (const symbol of symbols) {
          await runStrategies(exchange, symbol, { spreadHistory });
          await sleep(1000); // 1秒待機
        }
      }
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
    // 全体資産計算レポート
    postReport(exchangeBB);
    postReport(exchangeBF);
    
    // 戦略と銘柄ごとの損益レポート
    postStrategyProfitReport(exchangeBB);
    postStrategyProfitReport(exchangeBF);
  }
}, 60000); // 1分ごとにチェック

// 初期レポートを投稿
postReport(exchangeBB);
postReport(exchangeBF);

// 利用可能な戦略を表示
console.log('利用可能な戦略:');
console.log(strategies.getAvailableStrategies());

// ボットを起動
startBot();