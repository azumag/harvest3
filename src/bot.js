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
    const exchanges = [exchangeBB, exchangeBF]; // TODO: 取引所の配列だが、hftとmmでは別で定義されているので一元化したい
    
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
        // 一度に処理する通貨ペアの数を制限（最大3つ）
        const symbolsToProcess = commonSymbols.slice(0, 3);
        
        // 各通貨ペアの処理の間に待機時間を入れる
        for (const symbol of symbolsToProcess) {
          try {
            await runArbitrageStrategy(exchanges, symbol, {
              postOrderToDiscord,
              postErrorToDiscord,
              tradePercentage: config.tradePercentage
            });
            // 各通貨ペアの処理の間に3秒待機
            await sleep(3000);
          } catch (error) {
            console.error(`アービトラージ戦略の実行中にエラーが発生しました: ${symbol}`, error);
            await postErrorToDiscord(`アービトラージ戦略の実行中にエラーが発生しました: ${symbol} - ${error.message}`);
          }
        }
        
        // 通貨ペアのローテーション（次回は別の通貨ペアを処理）
        commonSymbols.push(commonSymbols.shift());
      }, 30000); // 30秒ごとに確認（10秒から30秒に延長）
    }
    
    // その他の戦略を実行
    const spreadHistory = {};
    
    while (true) {
      for (const exchange of exchanges) {
        try {
          const markets = await exchange.loadMarkets();
          const symbols = Object.keys(markets).filter(symbol =>
            symbol.endsWith('/JPY') && !symbol.startsWith('ELF/') // ELF 除外
              // && symbol !== 'BTC/JPY' // BTC/JPYを除外
          );
          
          // 一度に処理する通貨ペアの数を制限（最大5つ）
          const symbolsToProcess = symbols.slice(0, 5);
          
          for (const symbol of symbolsToProcess) {
            try {
              await runStrategies(exchange, symbol, { spreadHistory });
              await sleep(2000); // 1秒から2秒に延長
            } catch (error) {
              console.error(`戦略の実行中にエラーが発生しました: ${symbol} ${exchange.id}`, error);
              await postErrorToDiscord(`戦略の実行中にエラーが発生しました: ${symbol} ${exchange.id} - ${error.message}`);
            }
          }
          
          // 通貨ペアのローテーション（次回は別の通貨ペアを処理）
          symbols.push(symbols.shift());
          
          // 各取引所の処理の間に5秒待機
          await sleep(5000);
        } catch (error) {
          console.error(`取引所の処理中にエラーが発生しました: ${exchange.id}`, error);
          await postErrorToDiscord(`取引所の処理中にエラーが発生しました: ${exchange.id} - ${error.message}`);
          await sleep(10000); // エラー発生時は10秒待機
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