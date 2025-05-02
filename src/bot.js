// モジュールのインポート
const { config } = require('./config');
const { postErrorToDiscord } = require('./common/notifications');
const { sleep } = require('./common/utils');
const { updateFilledTrades } = require('./database/manager');
const { initializeDB } = require('./database/manager');
const { getSymbolsByExchange, getStrategyConfig, getMarketParametersByExchangeSymbol } = require('./common/utils');
const { pro } = require('ccxt');

const args = process.argv.slice(2);
// 通貨ペア（シンボル）の取得
let targetSymbol = null;
const symbolArgIndex = args.findIndex(arg => arg === '--symbol' || arg === '-s');
if (symbolArgIndex !== -1 && symbolArgIndex + 1 < args.length) {
  targetSymbol = args[symbolArgIndex + 1];
  // 引数リストから削除（後続の処理に影響しないように）
  args.splice(symbolArgIndex, 2);
}

if (args.includes('--help') || args.includes('-h')) {
  console.log('オプション:');
  console.log('  --xxxxx(戦略名）で atomicExec が指定されている戦略を単一実行');
  console.log('  --symbol, -s [シンボル]  特定の通貨ペア（例：BTC/JPY）のみを処理');
  console.log('  --help, -h        このヘルプメッセージを表示');
  console.log('オプションなしで実行すると、atomicExec 以外の戦略全てを実行');
  process.exit(0);
}

/**
 * ボットを起動する関数
 */
async function startBot() {
  initializeDB();
  try {
    // コマンドライン引数があるかどうかをチェック
    const hasArgs = args.length > 0;
    console.log(`コマンドライン引数: ${hasArgs ? '指定あり' : '指定なし'}`);
    if (targetSymbol) {
      console.log(`指定された通貨ペア: ${targetSymbol}`);
    }
  
    while (true) {
      const symbolsByExchange = await getSymbolsByExchange(config);
      const marketParametersByExchange = await getMarketParametersByExchangeSymbol(symbolsByExchange, config, { targetSymbol });
      
      for (const strategyKey of Object.keys(config.strategies)) {
        const strategy = config.strategies[strategyKey];
        if (hasArgs && !args.includes(`--${strategyKey}`)) {
          // console.log(`指定された戦略 ${strategyKey} 以外は無視されます`);
          continue;
        }
        if (strategy.enabled) {
          console.log(`戦略 ${strategyKey} が有効です`);
          if (strategy.atomicExec && (!hasArgs || !args.includes(`--${strategyKey}`))) {
            console.log(`戦略 ${strategyKey} は単一コンテナ実行指定戦略です: SKIP`);
            continue;
          }
          
          try {
            for (const exchange of strategy.exchanges) {
              const symbols = symbolsByExchange[exchange.id];
              
              for (const symbol of symbols) {
                const marketParametersBySymbol = marketParametersByExchange[exchange.id][symbol];
                // シンボルが指定されている場合、一致するもののみ処理
                if (targetSymbol && symbol !== targetSymbol) {
                  continue;
                }
                
                try {
                  await updateFilledTrades(exchange, symbol);
                  await runStrategy(strategy, exchange, symbol, strategyKey, marketParametersBySymbol);
                } catch (error) {
                  console.error(`戦略 ${strategyKey}、通貨ペア ${symbol} の実行中にエラーが発生しました: ${error.message}`);
                  await postErrorToDiscord(`戦略 ${strategyKey}、通貨ペア ${symbol} でエラー: ${error.message}`).catch(() => {});
                }
              }
              
            }
          } catch (error) {
            console.error(`戦略 ${strategyKey} の実行中にエラーが発生しました: ${error.message}`);
            await postErrorToDiscord(`戦略 ${strategyKey} でエラー: ${error.message}`).catch(() => {});
          }
        } else {
          console.log(`戦略 ${strategyKey} が無効です`);
        }
      }
      
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
 * @param {Object} options - オプションオブジェクト
 */
async function runStrategy(strategy, exchange, symbol, strategyKey, marketParametersBySymbol, options) {
  try {

    // TODO: ループの最初で取得してメモリから復元するようにする (performance向上)
    const strategyConfig = await getStrategyConfig(exchange, symbol, strategyKey, config);

    if (strategyConfig.enabled === false) {
      console.log(`戦略 ${strategyKey}:${symbol} は個別に無効化されています`);
      return null;
    }

    return strategy.function(exchange, symbol, strategyKey, strategyConfig, marketParametersBySymbol, options)
  } catch (error) {
    console.error(`戦略の実行中にエラーが発生しました: ${strategyKey} - ${symbol}`, error);
    if (postErrorToDiscord) {
      await postErrorToDiscord(`戦略の実行中にエラーが発生しました: ${strategyKey} - ${exchange.id} - ${symbol} - ${error.message}`);
    }
    return null;
  } finally {
    process.exit(0);
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