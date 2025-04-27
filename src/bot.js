// モジュールのインポート
const { config } = require('./config');
const { postErrorToDiscord } = require('./notifications');
const { sleep } = require('./utils');
const { updateFilledTrades } = require('./database/manager');
const { initializeDB } = require('./database/manager');
const { getSymbolsByExchange, getStrategyConfig, getMarketParametersByExchangeSymbol } = require('./utils');

/**
 * ボットを起動する関数
 */
async function startBot() {
  initializeDB();
  try {
    
    // アービトラージ戦略を実行
    // if (config.strategies.INTER_EXCHANGE_ARBITRAGE.enabled) {
    //   // 共通の通貨ペアを見つける
    //   const bbMarkets = await exchangeBB.loadMarkets();
    //   const bfMarkets = await exchangeBF.loadMarkets();
      
    //   const bbSymbols = Object.keys(bbMarkets).filter(symbol => symbol.endsWith('/JPY'));
    //   const bfSymbols = Object.keys(bfMarkets).filter(symbol => symbol.endsWith('/JPY'));
      
    //   // 両方の取引所に存在する通貨ペアを見つける
    //   const commonSymbols = bbSymbols.filter(symbol => bfSymbols.includes(symbol));
      
    //   // 定期的にアービトラージ機会を確認
    //   setInterval(async () => {
    //     // 一度に処理する通貨ペアの数を制限（最大3つ）
    //     const symbolsToProcess = commonSymbols.slice(0, 3);
        
    //     // 各通貨ペアの処理の間に待機時間を入れる
    //     for (const symbol of symbolsToProcess) {
    //       try {
    //         await runArbitrageStrategy(exchanges, symbol, {
    //           postOrderToDiscord,
    //           postErrorToDiscord,
    //           tradePercentage: config.tradePercentage
    //         });
    //         // 各通貨ペアの処理の間に3秒待機
    //         await sleep(3000);
    //       } catch (error) {
    //         console.error(`アービトラージ戦略の実行中にエラーが発生しました: ${symbol}`, error);
    //         await postErrorToDiscord(`アービトラージ戦略の実行中にエラーが発生しました: ${symbol} - ${error.message}`);
    //       }
    //     }
        
    //     // 通貨ペアのローテーション（次回は別の通貨ペアを処理）
    //     commonSymbols.push(commonSymbols.shift());
    //   }, 30000); // 30秒ごとに確認（10秒から30秒に延長）
    // }
  
    while (true) {
      const symbolsByExchange = await getSymbolsByExchange(config);
      const marketParametersByExchange = await getMarketParametersByExchangeSymbol(symbolsByExchange, config);
      
      // 戦略ごとに並列実行するための配列
      const strategyPromises = [];
      
      for (const strategyKey of Object.keys(config.strategies)) {
        const strategy = config.strategies[strategyKey];
        if (strategy.enabled) {
          console.log(`戦略 ${strategyKey} が有効です`);
          
          // 戦略ごとの処理をPromiseとして配列に追加
          strategyPromises.push((async () => {
            try {
              for (const exchange of strategy.exchanges) {
                const symbols = symbolsByExchange[exchange.id];
                const symbolPromises = [];
                
                for (const symbol of symbols) {
                  const marketParametersBySymbol = marketParametersByExchange[exchange.id][symbol];
                  
                  // シンボルごとの処理をPromiseに追加
                  symbolPromises.push((async () => {
                    try {
                      await updateFilledTrades(exchange, symbol);
                      return runStrategy(strategy, exchange, symbol, strategyKey, marketParametersBySymbol);
                    } catch (error) {
                      console.error(`戦略 ${strategyKey}、通貨ペア ${symbol} の実行中にエラーが発生しました: ${error.message}`);
                      await postErrorToDiscord(`戦略 ${strategyKey}、通貨ペア ${symbol} でエラー: ${error.message}`).catch(() => {});
                      return null;
                    }
                  })());
                }
                
                // この取引所の全シンボルを並列処理
                await Promise.all(symbolPromises);
              }
            } catch (error) {
              console.error(`戦略 ${strategyKey} の実行中にエラーが発生しました: ${error.message}`);
              await postErrorToDiscord(`戦略 ${strategyKey} でエラー: ${error.message}`).catch(() => {});
            }
          })());
        } else {
          console.log(`戦略 ${strategyKey} が無効です`);
        }
      }
      
      // すべての戦略を並列実行
      await Promise.all(strategyPromises);
      
      await sleep(1000);
    }
    
  } catch (error) {
    const errorMessage = `エラーが発生しました: ${error.message}`;
    console.error(errorMessage, error);
    await postErrorToDiscord(errorMessage);
  }
}

/**
 * 指定された戦略を実行する関数
 * @param {Object} exchange - 取引所オブジェクト
 * @param {String} symbol - 通貨ペア
 * @param {String} strategyKey - 戦略のキー
 * @param {Object} marketParametersBySymbol - 通貨ペアごとの市場パラメータ
 */
async function runStrategy(strategy, exchange, symbol, strategyKey, marketParametersBySymbol) {
  try {

    // TODO: ループの最初で取得してメモリから復元するようにする (performance向上)
    const strategyConfig = await getStrategyConfig(exchange, symbol, strategyKey, config);

    return strategy.function(exchange, symbol, strategyKey, strategyConfig, marketParametersBySymbol)
  } catch (error) {
    console.error(`戦略の実行中にエラーが発生しました: ${strategyKey} - ${symbol}`, error);
    if (options.postErrorToDiscord) {
      await options.postErrorToDiscord(`戦略の実行中にエラーが発生しました: ${strategyKey} - ${exchange.id} - ${symbol} - ${error.message}`);
    }
    return null;
  }
}

// レポートを投稿するためのタイマー設定
// setInterval(() => {
//   const now = new Date();
//   if (now.getMinutes() === 0) { // 時間ごと
//     // 全体資産計算レポート
//     postReport(exchangeBB);
//     postReport(exchangeBF);
    
//     // 戦略と銘柄ごとの損益レポート
//     postStrategyProfitReport(exchangeBB);
//     postStrategyProfitReport(exchangeBF);
//   }
// }, 60000); // 1分ごとにチェック

// // 初期レポートを投稿
// postReport(exchangeBB);
// postReport(exchangeBF);

// 利用可能な戦略を表示
// console.log('利用可能な戦略:');
// console.log(strategies.getAvailableStrategies());

// ボットを起動
startBot();