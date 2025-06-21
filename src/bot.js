// モジュールのインポート
const { config } = require('./config');
const { postErrorToDiscord } = require('./common/notifications');
const { checkAllExchangeBalances } = require('./common/balanceChecker');
const { errorHandler } = require('./common/errorHandler');
const { sleep } = require('./common/utils');
const { 
  initializeDB,
  updateFilledTrades,
  fetchTicker,
  getSymbolsByExchange,
  getStrategyConfig,
  getMarketParametersByExchangeSymbol,
  cleanupInvalidPendingOrders
} = require('./database/manager');
const { 
  checkStopLoss, 
  executeStopLoss, 
  checkPositionLimits, 
  checkDrawdown 
} = require('./strategies/utils/riskManagement');
const { getAllPositionsRedis } = require('./database/redisDatabase');
const { pro } = require('ccxt');

// 未約定注文クリーンアップの最終実行時間を記録
let lastCleanupTime = {}; // exchangeId -> timestamp

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
      // マーケットパラメータの更新
      const symbolsByExchange = await getSymbolsByExchange(config);
      const marketParametersByExchange = await getMarketParametersByExchangeSymbol(symbolsByExchange, config, { targetSymbol });
      
      // すべての取引所とシンボルの組み合わせを作成
      const allExchangeSymbolPairs = [];
      for (const exchangeId in symbolsByExchange) {
        for (const symbol of symbolsByExchange[exchangeId]) {
          // シンボルが指定されている場合、一致するもののみ処理
          if (targetSymbol && symbol !== targetSymbol) {
            continue;
          }
          allExchangeSymbolPairs.push({ 
            exchangeId, 
            symbol, 
            marketParameters: marketParametersByExchange[exchangeId][symbol] 
          });
        }
      }
      
      // 各取引所-シンボルの組み合わせに対して
      for (const { exchangeId, symbol, marketParameters } of allExchangeSymbolPairs) {
        // 取引所情報を取得
        const exchangeConfig = config.exchanges[exchangeId];
        if (!exchangeConfig) continue;

        const exchangeInstance = exchangeConfig.instance;

        console.log(`========== 取引所: ${exchangeId} - 通貨ペア: ${symbol} ==========`); 

        try {
          // 約定済み取引の更新
          await updateFilledTrades(exchangeInstance, symbol);

          // 未約定注文のクリーンアップ（5分間隔）
          const now = Date.now();
          const cleanupInterval = 5 * 60 * 1000; // 5分
          const lastTime = lastCleanupTime[exchangeId] || 0;
          
          if (now - lastTime >= cleanupInterval) {
            try {
              console.log(`[クリーンアップ] 開始: ${exchangeId}`);
              const cleanupResult = await cleanupInvalidPendingOrders(exchangeInstance);
              lastCleanupTime[exchangeId] = now;
              
              if (cleanupResult.deleted > 0) {
                console.log(`[クリーンアップ] 完了: ${exchangeId} - ${cleanupResult.deleted}件の無効注文を削除`);
              }
            } catch (cleanupError) {
              console.warn(`[クリーンアップ] エラー: ${exchangeId} - ${cleanupError.message}`);
            }
          }

          // Ticker情報を取得
          // 同時にキャッシュする効果もある
          const ticker = await fetchTicker(exchangeInstance, symbol);
          // console.log(`Ticker: ${exchangeId} - ${symbol} - ${JSON.stringify(ticker)}`);
          
          // 有効な戦略を適用
          for (const strategyKey of Object.keys(config.strategies)) {
            const strategy = config.strategies[strategyKey];
            
            // 戦略自体か、個別設定で戦略が無効の場合はスキップ
            const strategyConfig = await getStrategyConfig(exchangeInstance, symbol, strategyKey, config);
            if (!strategy.enabled || !strategyConfig.enabled) {
              console.log(`戦略 ${strategyKey} が無効です`);
              continue;
            }
            
            // コマンドライン引数で指定された戦略以外はスキップ
            if (hasArgs && !args.includes(`--${strategyKey}`)) {
              continue;
            }
            
            // atomicExec指定でコマンドライン引数なしの場合はスキップ
            if (strategy.atomicExec && (!hasArgs || !args.includes(`--${strategyKey}`))) {
              console.log(`戦略 ${strategyKey} は単一コンテナ実行指定戦略です: SKIP`);
              continue;
            }
            
            // 新しいHFT戦略 (WebSocketベース) の場合
            if (strategyKey === 'HFT') {
              // HFTは別コンテナで実行予定
              continue;
              // // HFT戦略は内部で通貨ペアのループとWebSocket接続を管理するため、
              // // ここでは戦略のエントリポイント関数を一度だけ呼び出す
              // console.log(`--- 戦略 ${strategyKey} を実行中...`);
              // try {
              //   await strategy.function(config); // startHFTStrategy(config) を呼び出し
              // } catch (error) {
              //   console.error(`戦略 ${strategyKey} の実行中にエラーが発生しました: ${error.message}`);
              //   await postErrorToDiscord(`戦略 ${strategyKey} でエラー: ${error.message}`).catch(() => {});
              // }
              // // HFT戦略は常駐するため、このループの他の通貨ペアでは実行しない
              // continue;
            }

            // この戦略が対象の取引所をサポートしているか確認 (HFT_BB_WS以外)
            const supportedExchange = strategy.exchanges.find(e => e.id === exchangeId);
            if (!supportedExchange) continue;

            try {
              await runStrategy(strategy, supportedExchange, symbol, strategyKey, marketParameters, { allExchangeSymbolPairs, config });
            } catch (error) {
              await errorHandler.handleError(error, `戦略 ${strategyKey}、通貨ペア ${symbol}`, false);
            }
          }
        } catch (error) {
          await errorHandler.handleError(error, `通貨ペア ${symbol}`, false);
        }
      }
      
      await sleep(1000);
    }
    
  } catch (error) {
    const errorMessage = `エラーが発生しました: ${error.message}`;
    console.error(errorMessage, error);
    await postErrorToDiscord(errorMessage);
  } finally {
    // DB接続をクローズ
    process.exit(0);
  }
}

/**
 * リスク管理チェックを実行する関数
 * ストップロス、トレーリングストップ、タイムストップの処理を行う
 */
async function executeRiskManagementCheck() {
  try {
    // 全ポジションを取得
    const allPositions = await getAllPositionsRedis();
    
    if (allPositions.length === 0) {
      console.log('[リスク管理] チェック対象のポジションがありません');
      return;
    }
    
    console.log(`[リスク管理] ${allPositions.length}個のポジションをチェック中...`);
    
    // 取引所ごとにグループ化
    const positionsByExchange = {};
    for (const position of allPositions) {
      if (!positionsByExchange[position.exchangeId]) {
        positionsByExchange[position.exchangeId] = [];
      }
      positionsByExchange[position.exchangeId].push(position);
    }
    
    let totalProcessed = 0;
    let totalStopLossExecuted = 0;
    
    // 各取引所のポジションを処理
    for (const [exchangeId, positions] of Object.entries(positionsByExchange)) {
      try {
        // 取引所インスタンスを取得
        const exchangeConfig = config.exchanges[exchangeId];
        if (!exchangeConfig) {
          console.warn(`[リスク管理] 取引所設定が見つかりません: ${exchangeId}`);
          continue;
        }
        
        const exchangeInstance = exchangeConfig.instance;
        
        // シンボルごとにグループ化
        const positionsBySymbol = {};
        for (const position of positions) {
          if (!positionsBySymbol[position.symbol]) {
            positionsBySymbol[position.symbol] = [];
          }
          positionsBySymbol[position.symbol].push(position);
        }
        
        // 各シンボルのポジションを処理
        for (const [symbol, symbolPositions] of Object.entries(positionsBySymbol)) {
          try {
            // リスク管理設定を取得
            const riskSettings = {
              fixedStopLossPercent: 0.03, // 3%のストップロス（より積極的）
              trailingStopTriggerPercent: 0.02, // 2%の利益でトレーリング発動
              trailingStopDistancePercent: 0.02, // 最高値から2%下でトレーリング
              timeBasedStopHours: 24, // 24時間でタイムストップ（より短縮）
            };
            
            // ストップロスチェック
            const stopLossPositions = await checkStopLoss(exchangeInstance, symbol, symbolPositions, riskSettings);
            
            if (stopLossPositions.length > 0) {
              console.log(`[リスク管理] ${symbol}: ${stopLossPositions.length}個のポジションでストップロス発動`);
              
              // ストップロス実行
              for (const position of stopLossPositions) {
                try {
                  // マーケットパラメータを取得
                  const marketParams = await getMarketParametersByExchangeSymbol(
                    { [exchangeId]: [symbol] }, 
                    config,
                    {}
                  );
                  const marketParameters = marketParams[exchangeId][symbol];
                  
                  console.log(`[リスク管理] ストップロス実行: ${position.strategyKey} ${symbol} (理由: ${position.reason})`);
                  
                  const result = await executeStopLoss(
                    exchangeInstance, 
                    symbol, 
                    position.strategyKey, 
                    position, 
                    marketParameters
                  );
                  
                  if (result.success) {
                    totalStopLossExecuted++;
                    console.log(`[リスク管理] ストップロス成功: ${symbol} - ${result.soldAmount} ${symbol.split('/')[0]}`);
                  } else {
                    console.warn(`[リスク管理] ストップロス失敗: ${symbol} - ${result.error}`);
                  }
                } catch (stopLossError) {
                  console.error(`[リスク管理] ストップロス実行エラー: ${symbol} - ${stopLossError.message}`);
                }
              }
            }
            
            totalProcessed += symbolPositions.length;
          } catch (symbolError) {
            console.error(`[リスク管理] シンボル処理エラー: ${symbol} - ${symbolError.message}`);
          }
        }
      } catch (exchangeError) {
        console.error(`[リスク管理] 取引所処理エラー: ${exchangeId} - ${exchangeError.message}`);
      }
    }
    
    console.log(`[リスク管理] 処理完了: ${totalProcessed}個処理、${totalStopLossExecuted}個のストップロス実行`);
    
    if (totalStopLossExecuted > 0) {
      await postErrorToDiscord(`[リスク管理] ${totalStopLossExecuted}個のポジションでストップロスを実行しました`);
    }
    
  } catch (error) {
    console.error('[リスク管理] チェック処理エラー:', error.message);
    throw error;
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

    // MUTUAL_INFO戦略の場合は、referenceSymbolsを設定
    if (strategyKey === 'MUTUAL_INFO' && options.allExchangeSymbolPairs) {
      // 同じ取引所のシンボルのみを抽出し、自分自身と除外シンボルを除外
      const sameExchangeSymbols = options.allExchangeSymbolPairs
        .filter(pair => 
          pair.exchangeId === exchange.id && 
          pair.symbol !== symbol &&
          !config.global.excludeSymbols.some(excludePattern => pair.symbol.startsWith(excludePattern))
        )
        .map(pair => pair.symbol);
      
      options.referenceSymbols = sameExchangeSymbols;
    }

    console.log(`--- 戦略 ${strategyKey} を実行中...`);
    return strategy.function(exchange, symbol, strategyKey, strategyConfig, marketParametersBySymbol, options)
  } catch (error) {
    console.error(`戦略の実行中にエラーが発生しました: ${strategyKey} - ${symbol}`, error);
    if (postErrorToDiscord) {
      await postErrorToDiscord(`戦略の実行中にエラーが発生しました: ${strategyKey} - ${exchange.id} - ${symbol} - ${error.message}`);
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

// 残高チェックを1時間ごとに実行（完全一致チェック）
setInterval(async () => {
  const now = new Date();
  if (now.getMinutes() === 0) { // 毎時0分に実行
    try {
      console.log('=== 定期残高チェック開始 ===');
      await checkAllExchangeBalances();
      console.log('=== 定期残高チェック完了 ===');
    } catch (error) {
      console.error('定期残高チェックエラー:', error.message);
      await postErrorToDiscord(`定期残高チェック失敗: ${error.message}`);
    }
  }
}, 60000); // 1分ごとにチェック（毎時0分にのみ実行）

// リスク管理処理を5分ごとに実行
setInterval(async () => {
  try {
    console.log('=== 定期リスク管理チェック開始 ===');
    await executeRiskManagementCheck();
    console.log('=== 定期リスク管理チェック完了 ===');
  } catch (error) {
    console.error('定期リスク管理チェックエラー:', error.message);
    await postErrorToDiscord(`定期リスク管理チェック失敗: ${error.message}`);
  }
}, 5 * 60 * 1000); // 5分ごとに実行

// // 初期レポートを投稿
// postReport(exchangeBB);
// postReport(exchangeBF);

// 利用可能な戦略を表示
// console.log('利用可能な戦略:');
// console.log(strategies.getAvailableStrategies());

// ボットを起動
startBot();

// 初回リスク管理チェックを実行（起動から30秒後）
setTimeout(async () => {
  try {
    console.log('=== 初回リスク管理チェック開始 ===');
    await executeRiskManagementCheck();
    console.log('=== 初回リスク管理チェック完了 ===');
  } catch (error) {
    console.error('初回リスク管理チェックエラー:', error.message);
    await postErrorToDiscord(`初回リスク管理チェック失敗: ${error.message}`);
  }
}, 30000); // 30秒後に実行

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