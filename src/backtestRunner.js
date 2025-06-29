// モジュールのインポート
const { config } = require('./config');
const { getSymbolsByExchange, getStrategyConfig, getMarketParametersByExchangeSymbol } = require('./database/manager');
const { backtestCreateLimitSellOrder,
  saveStrategyParameters,
  getStrategyParameters,
  initializeDB,
  fetchHistoricalOHLCVData,
  fetchOHLCVData,
  loadHistoricalOHLCVToBacktestRedis,
  fetchBacktestOHLCVData
 } = require('./database/manager'); // バックテストでは不要かもしれないが、bot.jsから一旦コピー

const { postErrorToDiscord, postResultToDiscord, discordBacktestURL } = require('./common/notifications');
const { OHLCVTimeFrames } = require('./common/const');
const { sleep, timeframeToMs } = require('./common/utils');
const { disableStrategy, clearPositionMarket } = require('./strategies/utils/common');
const { BacktestEnhancer } = require('./strategies/utils/backtestEnhancer');
const { WalkForwardAnalysis, TimeSeriesCrossValidator, FinancialTimeSeriesValidator } = require('./strategies/utils/walkForwardAnalysis');
const { TimeSeriesCrossValidator: TSCV, FinancialTimeSeriesValidator: FTSV } = require('./strategies/utils/timeSeriesCrossValidation');
const { MonteCarloBootstrapping } = require('./strategies/utils/monteCarloBootstrapping');

// コマンドライン引数を取得
const args = process.argv.slice(2);
const targetSymbol = args.find(arg => !arg.startsWith('--')); // ハイフンで始まらない引数はシンボルと見なす
const autoUpdate = args.includes('--auto-update'); // auto-update フラグを検出
const gridSearch = args.includes('--grid-search'); // grid-search フラグを検出
const enableMonteCarlo = args.includes('--monte-carlo'); // monte-carlo フラグを検出
const enableWalkForward = args.includes('--walk-forward'); // walk-forward フラグを検出
const enableTimeSeriesCV = args.includes('--timeseries-cv'); // timeseries-cv フラグを検出
const enableOverfittingDetection = args.includes('--overfitting-detection'); // オーバーフィッティング検出フラグ
const strategySpecify = args.find(arg => arg.startsWith('--strategy'))?.split('=')[1]; // --strategy=<戦略名> フラグを検出

// 引数の説明を表示
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
使用方法: node backtestRunner.js [シンボル] [オプション]

引数:
  シンボル       - バックテスト対象の通貨ペア (例: BTC/USDT)。省略すると全シンボルが対象。
  
オプション:
  --auto-update  - 最適なパラメータで設定ファイルを自動更新する
  --grid-search  - グリッドサーチを実行する
  --monte-carlo  - Monte Carlo Bootstrapping統計分析を有効化する
  --walk-forward - Walk-Forward Analysis時系列分析を有効化する
  --timeseries-cv - Time Series Cross-Validation分析を有効化する
  --overfitting-detection - オーバーフィッティング検出アルゴリズムを有効化する
  --strategy <戦略名> - 特定の戦略を指定してバックテストを実行する
  --help, -h     - このヘルプを表示
  `);
  process.exit(0);
}

/**
 * バックテストを実行する関数
 * @param {string} targetSymbol - ターゲットとなるシンボル（通貨ペア）。未指定の場合は全シンボルを対象とする
 * @param {boolean} autoUpdate - 最適なパラメータで設定ファイルを自動更新するかどうか
 */
async function runBacktest(targetSymbol, autoUpdate = false) {
  try {
    // バックテストの主要なロジックをここに実装
    console.log('バックテストを開始します...');
    if (targetSymbol) {
      console.log(`対象シンボル: ${targetSymbol}`);
    } else {
      console.log('対象シンボル: すべて');
    }
    
    if (autoUpdate) {
      console.log('自動更新モード: 有効 (最適なパラメータで設定を更新します)');
    }

    initializeDB(); // データベースの初期化

    // marketParameter, symbolByExchange を一度だけ取得
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

    // バックテスト期間の設定 
    // const endDate = new Date('2025-04-20T00:00:00Z'); // UTCで指定
    const days = 7; // n日間のOHLCVデータを取得
    const endDate = new Date(); // 現在の日付を使用
    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - days); // n日間前の日付を設定

    // 設定された期間で、すべてのシンボルのOHLCVデータを取得して更新
    for (const exchange of Object.keys(symbolsByExchange)) {
      console.log(`=== ${exchange} のOHLCVデータを取得 ===`);
      const exchangeInstance = config.exchanges[exchange].instance;
      const symbols = symbolsByExchange[exchange].sort();
      for (const symbol of symbols) {
        // シンボルが指定されている場合、一致するもののみ処理
        if (targetSymbol && symbol !== targetSymbol) {
          continue;
        }

        // OHLCVデータを取得して保存
        for (const timeframe of OHLCVTimeFrames) {
          // 現状保存されているデータからの差分のみを取得するようにする
          const lastOhlcv = await fetchHistoricalOHLCVData(exchange, symbol, timeframe, 1);
          const lastTimestamp = lastOhlcv && lastOhlcv.length > 0 ? lastOhlcv[0].timestamp : null;
          const currentTimestamp = Date.now();
          let daysToFetch = days; // Default to the days variable defined earlier

          console.log(`Last data for ${symbol}/${timeframe} is from ${lastTimestamp ? new Date(lastTimestamp).toISOString() : 'N/A'}`);
            
          if (lastTimestamp) {
            // Calculate difference in milliseconds and convert to days
            const timeDiffInDays = (currentTimestamp - lastTimestamp) / (1000 * 60 * 60 * 24);
            daysToFetch = Math.ceil(timeDiffInDays);
            console.log(`fetching ${daysToFetch} days of data`);
          } 
          
          const limit = calculateLimit(timeframe, daysToFetch) + 20;
          await fetchOHLCVData(exchangeInstance, symbol, timeframe, limit, { forceUpdate: true });
        }
      }
    }

    // すべてのシンボルのOHLCVデータをREDISにロード
    for (const exchange of Object.keys(symbolsByExchange)) {
      console.log(`=== ${exchange} のOHLCVデータをREDISにロード ===`);
      const exchangeInstance = config.exchanges[exchange].instance;
      const symbols = symbolsByExchange[exchange].sort();
      for (const symbol of symbols) {
        // シンボルが指定されている場合、一致するもののみ処理
        if (targetSymbol && symbol !== targetSymbol) {
          continue;
        }
        for (const timeframe of OHLCVTimeFrames) {
          // バックテストに必要なローソク足の本数を計算する
          // バッファを持たせプラスする.
          // TODO: この値は戦略で使う period の最大値+bufferを設定したい
          const limit = calculateLimit(timeframe, days) + 200;
          await loadHistoricalOHLCVToBacktestRedis(exchangeInstance, symbol, timeframe, limit)
        }
      }
    }

    // runBacktest関数内の戦略処理部分
    for (const strategyKey of Object.keys(config.strategies)) {
      if (strategySpecify && strategySpecify !== strategyKey) {
        console.log(`戦略 ${strategyKey} はスキップされました`);
        continue; // 指定された戦略以外はスキップ
      }
      
      const strategy = config.strategies[strategyKey];
      // atomicExec指定の場合はスキップ
      if (strategy.atomicExec) {
        console.log(`戦略 ${strategyKey} は単一コンテナ実行指定戦略です: SKIP`);
        continue;
      }

      console.log(`戦略 ${strategyKey} の処理を開始します...`);
      
      for (const exchange of strategy.exchanges) {
        const exchangeId = exchange.id;
        let symbols = symbolsByExchange[exchangeId].sort();
        
        // シンボルが指定されている場合、一致するもののみ処理
        if (targetSymbol) {
          symbols = symbols.filter(symbol => symbol === targetSymbol);
        }

        // 並列処理するシンボルの数を制限
        const MAX_CONCURRENT_SYMBOLS = 3; // 同時に処理するシンボルの数を制限

        // シンボルを処理するための関数
        async function processSymbols(symbols, exchange, strategy, strategyKey, marketParametersByExchange, autoUpdate, gridSearch, startDate, endDate, allExchangeSymbolPairs) {
          // シンボルをMAX_CONCURRENT_SYMBOLS個ずつ処理
          for (let i = 0; i < symbols.length; i += MAX_CONCURRENT_SYMBOLS) {
            const currentBatch = symbols.slice(i, i + MAX_CONCURRENT_SYMBOLS);
            console.log(`${strategyKey}: バッチ ${i/MAX_CONCURRENT_SYMBOLS + 1}/${Math.ceil(symbols.length/MAX_CONCURRENT_SYMBOLS)} (${currentBatch.join(', ')}) の処理を開始`);
          
            const symbolPromises = currentBatch.map(symbol => {
              return (async () => {
                let shouldRetry = true;
                let retryCount = 0;
                while(shouldRetry) {
                  // 既存の処理
                  const result = await runBacktestForSymbol(
                    exchange,
                    symbol,
                    strategy,
                    strategyKey,
                    marketParametersByExchange,
                    autoUpdate,
                    gridSearch,
                    startDate,
                    endDate,
                    retryCount,
                    allExchangeSymbolPairs
                  );
                  shouldRetry = result.shouldRetry;
                  retryCount++;
                  if (retryCount > 5) {
                    console.log(`戦略 ${strategyKey} の ${symbol} のバックテストが5回失敗しました。処理を終了します`);
                    postResultToDiscord(`戦略 ${strategyKey} の ${symbol} のバックテストが5回失敗しました。処理を終了します`, discordBacktestURL);
                    try {
                      if (autoUpdate) {
                        postResultToDiscord(`戦略 ${strategyKey} の ${symbol} のポジションを解消, disable にします`, discordBacktestURL);
                        await disableStrategy(exchange, symbol, strategyKey, config);
                        await clearPositionMarket(exchange, symbol, strategyKey);
                      }
                    } catch (error) {
                      console.error(`戦略 ${strategyKey} の ${symbol} disabling エラーが発生しました: ${error.message}`);
                      postErrorToDiscord(`戦略 ${strategyKey} の ${symbol} disabling 中にエラーが発生しました: ${error.message}`);
                    } finally {
                      break;
                    }
                  }
                }
              })();
            });
            
            await Promise.all(symbolPromises);
            
            // 各バッチ処理後にガベージコレクションを促す
            if (global.gc) {
              console.log('メモリクリーンアップ実行中...');
              global.gc();
            }
          }
        }

        await processSymbols(symbols, exchange, strategy, strategyKey, marketParametersByExchange, autoUpdate, gridSearch, startDate, endDate, allExchangeSymbolPairs);
      }
      
      console.log(`戦略 ${strategyKey} の処理が完了しました`);
      // return { strategyKey, completed: true }; <- このreturnを削除
    }

    // 全ての戦略の処理を並列に実行
    // if (strategyPromises.length > 0) {
    //   // console.log(`${strategyPromises.length}個の戦略を並列処理中...`);
    //   // await Promise.all(strategyPromises)

    //   // 一時的に順次実行に変更
    //   // symbol処理の並列化をした
    //   for (const strategyPromise of strategyPromises) {
    //     await strategyPromise();
    //   }
    // } else {
    //   console.log('処理対象の戦略がありません');
    // }

    console.log('バックテストが完了しました。');
  } catch (error) {
    const errorMessage = `バックテスト実行中にエラーが発生しました: ${error.message}`;
    console.error(errorMessage, error);
    // await postErrorToDiscord(errorMessage);
  } finally {
    // バックテスト終了後の処理
    process.exit(0);
  }
}

/**
 * 特定のシンボル・戦略に対するバックテストを実行する
 * @param {Object} exchange - 取引所オブジェクト
 * @param {string} symbol - 通貨ペア
 * @param {string} strategy - 戦略Config
 * @param {string} strategyKey - 戦略キー
 * @param {Object} marketParametersByExchange - 市場パラメータ
 * @param {boolean} autoUpdate - 自動更新フラグ
 * @param {boolean} gridSearch - グリッドサーチフラグ
 * @param {Date} startDate - バックテスト開始日
 * @param {Date} endDate - バックテスト終了日
 * @param {number} retryCount - 再試行回数
 * @param {Array} allExchangeSymbolPairs - 全取引所とシンボルの組み合わせ
 * @returns {Object} バックテスト結果と再試行フラグ
 */
async function runBacktestForSymbol(exchange, symbol, strategy, strategyKey, marketParametersByExchange, autoUpdate, gridSearch, startDate, endDate, retryCount, allExchangeSymbolPairs) {
  const marketParametersBySymbol = marketParametersByExchange[exchange.id][symbol];

  console.log(`${symbol} のバックテストを開始...`);
  
  // 全タイムフレームの結果を保存する配列
  let allTimeframeResults = [];
  
  // タイムフレームでループ
  const timeframePromises = OHLCVTimeFrames.map(async (timeframe) => {
    // const timeframeMs = timeframeToMs(timeframe);
    // 注：BCH/JPYの特別なスキップロジックは不要（OHLCVTimeFramesでサポート対象のみ定義済み）
    const timeframeMs = timeframeToMs('1m'); // 常に1分刻みでバックテスト
    
    console.log(`  ${timeframe} タイムフレームのバックテストを開始...`);
    const _strategyConfig = await getStrategyConfig(exchange, symbol, strategyKey, config);
    const dbParams = await getStrategyParameters(exchange.id, symbol, strategyKey);
    
    // 数値パラメータのキーを抽出
    const numericParameterKeys = extractNumericParameterKeys(dbParams);
    console.log(`数値パラメータ: ${numericParameterKeys.join(', ')}`);
    
    let parameterCombinations = null;

    // パラメータの組み合わせを生成
    // リトライが多いほどパラメータの変動幅を広げる
    if (gridSearch) {
      // グリッドサーチを実行
      console.log(`${timeframe}: グリッドサーチを実行します...`);
      parameterCombinations = generateParameterCombinations(
        dbParams,
        numericParameterKeys,
        0.1 + (retryCount*0.1), // パラメータの変動幅
        10 // ステップ数
      );
    } else {
      console.log(`${timeframe}: 正規乱数を使ったランダムサーチを実行します`);
      parameterCombinations = generateRandomParameterCombinations(
        dbParams, numericParameterKeys,
        10 + (retryCount*10), // パラメータのパターン数
        0.1 + (retryCount*0.1) // 変動幅
      );
    }

    // 重複排除
    if (parameterCombinations) {
      const originalCount = parameterCombinations.length;
      const uniqueCombinationsMap = new Map();
      
      parameterCombinations.forEach(combo => {
        const keys = Object.keys(combo).sort();
        const sortedCombo = {};
        keys.forEach(key => sortedCombo[key] = combo[key]);
        
        const comboKey = JSON.stringify(sortedCombo);
        
        if (!uniqueCombinationsMap.has(comboKey)) {
          uniqueCombinationsMap.set(comboKey, combo);
        }
      });
      
      parameterCombinations = Array.from(uniqueCombinationsMap.values());
      console.log(`${timeframe}: 重複排除: ${originalCount} 組み合わせから ${parameterCombinations.length} 組み合わせに削減されました`);
    }
    
    console.log(`${timeframe}: テスト対象の組み合わせ数: ${parameterCombinations.length}`);
    
    // 各組み合わせの結果を保存する配列
    const testResults = [];
    
    // 各パラメータ組み合わせでバックテスト実行
    for (const paramCombination of parameterCombinations) {
      const strategyConfig = {
        ..._strategyConfig,
        hlcvInterval: timeframe,
        ...paramCombination,
        tradePercentage: config.global.tradePercentage,
      };
      
      console.log(`  ${timeframe}: パラメータ組み合わせをテスト: ${JSON.stringify(paramCombination)}`);
      
      const options = {
        backtest: {
          totalSellCost: 0,
          totalBuyCost: 0,
          baseFund: 10000, 
          ohlcvData: [],
          lastSignal: 'sell',
          currentAmount: 0,
          buySignalCount: 0,
          sellSignalCount: 0,
          buyOrderCount: 0,
          sellOrderCount: 0,
          timeframe,
        },
        postOrderToDiscord: async () => {},
        postErrorToDiscord: async () => {},
        allExchangeSymbolPairs,
        config,
      };

      // MUTUAL_INFO戦略の場合は、referenceSymbolsを設定
      if (strategyKey === 'MUTUAL_INFO' && allExchangeSymbolPairs) {
        // 同じ取引所のシンボルのみを抽出し、自分自身と除外シンボルを除外
        const sameExchangeSymbols = allExchangeSymbolPairs
          .filter(pair => 
            pair.exchangeId === exchange.id && 
            pair.symbol !== symbol &&
            !config.global.excludeSymbols.some(excludePattern => pair.symbol.startsWith(excludePattern))
          )
          .map(pair => pair.symbol);
        
        options.referenceSymbols = sameExchangeSymbols;
      }

      const totalIterations = Math.floor((endDate.getTime() - startDate.getTime()) / timeframeMs) + 1;
      let currentIteration = 0;

      for (let timestamp = startDate.getTime(); timestamp <= endDate.getTime(); timestamp += timeframeMs) {
        currentIteration++;
        options.backtest.timestamp = timestamp;

        try {
          await strategy.function(exchange, symbol, strategyKey, strategyConfig, marketParametersBySymbol, options);              
        } catch (error) {
          console.error(`${timeframe}: バックテスト中にエラーが発生しました: ${error.message}`);
          postErrorToDiscord(`[バックテスト] エラー: ${exchange.id} - ${symbol} - ${error.message}`);
        }
      }

      if (options.backtest.lastSignal === 'buy') {
        const sellResult = await backtestCreateLimitSellOrder(
          symbol,
          options.backtest.currentAmount,
          options.backtest.currentPrice,
          options
        );
        console.log(`  ${timeframe}: 最後のシグナルが買いでした。売り注文を実行: ${JSON.stringify(sellResult)}`);
      }

      console.log(`${timeframe}: バックテスト完了: 全${totalIterations}回の処理を実行しました`);

      const result = {
        parameters: paramCombination,
        finalBaseFund: options.backtest.baseFund,
        timeframe: timeframe,
      }

      console.log(`  ${timeframe}: 結果: ${options.backtest.baseFund}, buySignalCount: ${options.backtest.buySignalCount}, sellSignalCount: ${options.backtest.sellSignalCount} buyOrderCount: ${options.backtest.buyOrderCount}, sellOrderCount: ${options.backtest.sellOrderCount}`);
      testResults.push(result);
    }
    
    // 結果をbaseFundでランキング
    const rankedResults = rankResults(testResults);
    
    // ランキング結果を表示
    const rankingTitle = `===== ${symbol} (${timeframe}) ${strategyKey} パラメータ最適化結果 =====`;
    console.log(rankingTitle);

    // Discord用に整形した文字列を作成
    const resultSrtArr = [`## ${symbol} (${timeframe}) ${strategyKey} パラメータ最適化結果`];
    resultSrtArr.push('```');

    for (let index = 0; index < Math.min(rankedResults.length, 10); index++) {
      const result = rankedResults[index];
      console.log(`${index + 1}位: ${result.finalBaseFund.toFixed(2)} - パラメータ: ${JSON.stringify(result.parameters)}`);
      
      const paramStr = Object.entries(result.parameters)
        .map(([key, value]) => `${key}: ${value}`)
        .join(', ');
      
      resultSrtArr.push(`${(index + 1).toString().padStart(2)}位  ${result.finalBaseFund.toFixed(2).padStart(8)}  ${paramStr}`);
    }
    resultSrtArr.push('```');
    
    // このタイムフレームの結果を返す
    return rankedResults.map(result => ({ ...result, timeframe }));
  });

  // すべてのタイムフレームの処理を並列に実行
  const allTimeframeResultsArrays = await Promise.all(timeframePromises);

  // 結果を平坦化して一つの配列にする
  allTimeframeResults = allTimeframeResultsArrays.flat();
  
  // 全タイムフレームの結果をランキング
  const rankedAllTimeframeResults = rankResults(allTimeframeResults);
  
  // ランキング結果を表示
  const allTimeframeRankingTitle = `===== ${symbol} ${strategyKey} パラメータ最適化結果 =====`;
  console.log(allTimeframeRankingTitle);
  
  // Discord用に整形した文字列を作成
  const allResultsArr = [`## ${symbol} ${strategyKey} パラメータ最適化結果`];
  allResultsArr.push('```');
  
  for (let index = 0; index < Math.min(rankedAllTimeframeResults.length, 10); index++) {
    const result = rankedAllTimeframeResults[index];
    console.log(`${index + 1}位: ${result.finalBaseFund.toFixed(2)} - タイムフレーム: ${result.timeframe} - パラメータ: ${JSON.stringify(result.parameters)}`);
    
    const paramStr = Object.entries(result.parameters)
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ');
    
    allResultsArr.push(`${(index + 1).toString().padStart(2)}位  ${result.finalBaseFund.toFixed(2).padStart(8)}  ${result.timeframe.padEnd(10)}  ${paramStr}`);
  }
  
  allResultsArr.push('```');
  await postResultToDiscord(allResultsArr.join('\n'), discordBacktestURL);
  
  // Monte Carlo Bootstrapping分析（有効化されている場合）
  if (enableMonteCarlo && rankedAllTimeframeResults.length > 0) {
    console.log('🔬 Monte Carlo Bootstrapping分析を実行中...');
    try {
      const backtestEnhancer = new BacktestEnhancer({
        iterations: 2000, // バックテスト用に軽量化
        confidenceLevel: 0.95,
        minTradesRequired: 5
      });
      
      const enhancedResults = await backtestEnhancer.enhanceBacktestResults(rankedAllTimeframeResults);
      const mcReport = backtestEnhancer.generateDiscordReport(enhancedResults);
      
      console.log('✅ Monte Carlo分析完了');
      await postResultToDiscord(`\n${mcReport}`, discordBacktestURL);
      
    } catch (mcError) {
      console.error('❌ Monte Carlo分析エラー:', mcError.message);
      await postResultToDiscord(`❌ **Monte Carlo分析エラー**\n\`\`\`\n${mcError.message}\n\`\`\``, discordBacktestURL);
    }
  }
  
  // 自動更新が有効で、全タイムフレーム中から最適な結果を選択して更新
  if (autoUpdate && rankedAllTimeframeResults.length > 0) {
    const topScore = rankedAllTimeframeResults[0].finalBaseFund;
    const threshold = topScore * 0.999;
    const eligibleResults = rankedAllTimeframeResults.filter(result => 
      result.finalBaseFund >= threshold
    );
    
    // 最高スコアと最低スコアの差を計算
    const minScore = rankedAllTimeframeResults[rankedAllTimeframeResults.length - 1].finalBaseFund;
    const scoreDifference = (topScore - minScore) / topScore;
    
    // 初期資金値（options.backtest.baseFundの初期値と同じ）
    const initialBaseFund = 10000;
    
    // スコアの差が0.1%未満、または最高スコアが初期資金以下の場合はループをやり直す
    const shouldRetry = (scoreDifference < 0.001) || (topScore <= initialBaseFund);
    
    if (shouldRetry) {  
      if (topScore <= initialBaseFund) {
        console.log(`最高スコア(${topScore.toFixed(2)})が初期資金(${initialBaseFund})以下のため、より広いパラメータ範囲でループをやり直します`);
        await postResultToDiscord(`${strategyKey} の ${symbol} - (${retryCount}) すべての結果が利益を出せていないため、より広いパラメータ範囲で再試行します。`, discordBacktestURL);
      } else {
        console.log(`スコアの差が0.1%未満 (${(scoreDifference * 100).toFixed(4)}%) のため、より広いパラメータ範囲でループをやり直します`);
        await postResultToDiscord(`${strategyKey} の ${symbol} - (${retryCount}) すべての結果のスコア差が0.1%未満のため、より広いパラメータ範囲で再試行します。`, discordBacktestURL);
      }
      return { shouldRetry };
    }
    
    console.log(`トップスコア(${topScore.toFixed(2)})に近い${eligibleResults.length}個の結果から最適なタイムフレームを選択します`);

    // 単純に最高スコアの結果を選択（すでにrankedAllTimeframeResultsがスコア順にソートされているため）
    const selectedResult = eligibleResults[0];

    const dbParams = await getStrategyParameters(exchange.id, symbol, strategyKey, config);
    const paramsToUpdate = {
      ...dbParams,
      ohlcvInterval: selectedResult.timeframe,
      ...selectedResult.parameters,
    };
    paramsToUpdate.enabled = true; // 自動更新後は有効にする
    await saveStrategyParameters(exchange.id, symbol, strategyKey, paramsToUpdate);
    
    // 選択した結果がトップスコアと異なる場合はその旨を記録
    const isTopScore = selectedResult === rankedAllTimeframeResults[0];
    const selectionReason = isTopScore 
      ? "（最高スコア）" 
      : `（スコア差: ${(topScore - selectedResult.finalBaseFund).toFixed(2)}, より短いタイムフレームを優先）`;
    
    console.log(`${strategyKey} の ${symbol} 設定を更新しました: スコア: ${selectedResult.finalBaseFund.toFixed(2)} ${selectionReason} - タイムフレーム: ${selectedResult.timeframe}`);
    await postResultToDiscord(`設定を自動更新しました: ${strategyKey} の ${symbol} - スコア: ${selectedResult.finalBaseFund.toFixed(2)} ${selectionReason} - タイムフレーム: ${selectedResult.timeframe} - ${JSON.stringify(selectedResult.parameters)}`, discordBacktestURL);
  }
  
  console.log(`${symbol} のバックテスト完了`);
  return { shouldRetry: false };
}

/**
 * オブジェクトから数値型のプロパティキーを抽出する
 * @param {Object} config - 設定オブジェクト
 * @returns {Array} 数値型のプロパティキーの配列
 */
function extractNumericParameterKeys(config) {
  return Object.keys(config).filter(key => typeof config[key] === 'number');
}

/**
 * パラメータの全ての組み合わせを生成する
 * @param {Object} defaultConfig - デフォルト設定
 * @param {Array} numericKeys - 数値型のキーの配列
 * @param {number} n - パラメータの変動幅（デフォルト0.5）
 * @param {number} step - パラメータのステップ数（デフォルト10）
 * @returns {Array} 全ての組み合わせの配列
 */
function generateParameterCombinations(defaultConfig, numericKeys, n = 0.5, step = 10) {
  if (numericKeys.length === 0) {
    return [{}];
  }
  const [currentKey, ...remainingKeys] = numericKeys;
  const combinations = [];
  
  // パラメータのデフォルト値
  const defaultValue = defaultConfig[currentKey];
  
  // パラメータに応じた範囲を設定
  let paramMin, paramMax, paramStep;
  
  // パラメータは 元の値の±N*100%程度の範囲で組み合わせを考える
  paramMin = Math.max(1, Math.floor(defaultValue * (1 - n)));
  paramMax = Math.ceil(defaultValue * (1 + n));
  paramStep = Math.max(1, Math.floor((paramMax - paramMin) / step)); // 段階に分割
  // paramMin = Math.max(1, Math.floor(defaultValue * 0.9));
  // paramMax = Math.ceil(defaultValue * 1.1);
  // paramStep = Math.max(1, Math.floor((paramMax - paramMin) / 3)); // 3段階程度に分割

  for (let value = paramMin; value <= paramMax; value += paramStep) {
    const subCombinations = generateParameterCombinations(defaultConfig, remainingKeys, n, step);
    
    for (const subComb of subCombinations) {
      combinations.push({ ...subComb, [currentKey]: value });
    }
  }
  
  return combinations;
}

/**
 * バックテスト結果を比較してランキングする
 * @param {Array} results - バックテスト結果の配列
 * @returns {Array} ランク付けされた結果の配列
 */
function rankResults(results) {
  return results.sort((a, b) => b.finalBaseFund - a.finalBaseFund);
}

/**
 * 正規分布に従った乱数を生成する（Box-Mullerアルゴリズム）
 * @param {number} mean - 平均
 * @param {number} stdDev - 標準偏差
 * @returns {number} 正規分布に従った乱数
 */
function generateNormalRandom(mean, stdDev) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random(); // 0を回避
  while (v === 0) v = Math.random(); // 0を回避
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + z * stdDev;
}

/**
 * 正規乱数を使ったパラメータ組み合わせを生成する
 * @param {Object} defaultConfig - デフォルト設定
 * @param {Array} numericKeys - 数値型のキーの配列
 * @param {number} count - 生成する組み合わせの数（デフォルト60）
 * @param {number} n - パラメータの変動幅（デフォルト0.1）
 * @returns {Array} ランダムに生成されたパラメータ組合せの配列
 */
function generateRandomParameterCombinations(defaultConfig, numericKeys, count = 60, n = 0.1) {
  if (numericKeys.length === 0) {
    return [{}];
  }
  
  const combinations = [];
  
  // デフォルト設定を最初に追加
  const defaultCombo = {};
  for (const key of numericKeys) {
    defaultCombo[key] = defaultConfig[key];
  }
  combinations.push(defaultCombo);
  
  // 残りのランダム組み合わせを生成
  for (let i = 0; i < count - 1; i++) {
    const combo = {};
    for (const key of numericKeys) {
      const defaultValue = defaultConfig[key];
      // 標準偏差はデフォルト値のn%程度に設定
      const stdDev = Math.max(1, defaultValue * n);
      // 正規分布に従ったランダム値を生成し、整数に丸める
      let value = Math.round(generateNormalRandom(defaultValue, stdDev));
      // 最小値を1に制限
      value = Math.max(1, value);
      
      combo[key] = value;
    }
    combinations.push(combo);
  }
  
  return combinations;
}

/**
 * タイムフレームと日数からlimitを計算する関数
 * @param {string} timeframe - タイムフレーム ('1m', '5m', '15m', '30m', '1h', '4h', '8h', '12h', '1d', '1w')
 * @param {number} days - 取得したい日数
 * @returns {number} 指定されたタイムフレームと日数に対応するlimit値
 */
function calculateLimit(timeframe, days) {
  switch (timeframe) {
    case '1m': return days * 24 * 60;     // 1日 = 1440ポイント
    case '5m': return days * 24 * 12;     // 1日 = 288ポイント
    case '15m': return days * 24 * 4;     // 1日 = 96ポイント
    case '30m': return days * 24 * 2;     // 1日 = 48ポイント
    case '1h': return days * 24;          // 1日 = 24ポイント
    case '4h': return days * 6;           // 1日 = 6ポイント
    case '8h': return days * 3;           // 1日 = 3ポイント
    case '12h': return days * 2;          // 1日 = 2ポイント
    case '1d': return days;               // 1日 = 1ポイント
    case '1w': 
      // 週単位の場合、日数を7で割って切り上げ
      return Math.ceil(days / 7);
    default:
      console.warn(`未知のタイムフレーム: ${timeframe}`);
      return 0;
  }
}

// バックテストを開始
runBacktest(targetSymbol, autoUpdate);