// モジュールのインポート
const { config } = require('./config');
const { postErrorToDiscord, postResultToDiscord, discordBacktestURL } = require('./common/notifications');
const { sleep, timeframeToMs } = require('./common/utils');
const { getSymbolsByExchange, getStrategyConfig, getMarketParametersByExchangeSymbol } = require('./database/manager');
const { backtestCreateLimitSellOrder, saveStrategyParameters, getStrategyParameters, initializeDB } = require('./database/manager'); // バックテストでは不要かもしれないが、bot.jsから一旦コピー
const { OHLCVTimeFrames } = require('./common/const');


// コマンドライン引数を取得
const args = process.argv.slice(2);
const targetSymbol = args.find(arg => !arg.startsWith('--')); // ハイフンで始まらない引数はシンボルと見なす
const autoUpdate = args.includes('--auto-update'); // auto-update フラグを検出
const gridSearch = args.includes('--grid-search'); // grid-search フラグを検出
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
    const marketParametersByExchange = await getMarketParametersByExchangeSymbol(symbolsByExchange, config, options = { targetSymbol });

    // バックテスト期間の設定 
    // const endDate = new Date('2025-04-29T00:00:00Z'); // UTCで指定
    const endDate = new Date(); // 現在の日付を使用
    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - 7); // n日間前の日付を設定

    // 各戦略・通貨ペアでループ
    for (const strategyKey of Object.keys(config.strategies)) {
      if (strategySpecify && strategySpecify !== strategyKey) {
        console.log(`戦略 ${strategyKey} はスキップされました`);
        continue; // 指定された戦略以外はスキップ
      }
      const strategy = config.strategies[strategyKey];
      if (strategy.enabled) { // 有効な戦略のみ実行
        for (const exchange of strategy.exchanges) {
          const symbols = symbolsByExchange[exchange.id];

          for (const symbol of symbols) {
            // シンボルが指定されている場合、一致するもののみ処理
            if (targetSymbol && symbol !== targetSymbol) {
              continue;
            }

            let shouldRetry = false;
            let retryCount = 0;
            while(!shouldRetry) {
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
                retryCount
              );
              shouldRetry = result.shouldRetry;
              retryCount++;
            }
          }
        }
      }
    }

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
 * @returns {Object} バックテスト結果と再試行フラグ
 */
async function runBacktestForSymbol(exchange, symbol, strategy, strategyKey, marketParametersByExchange, autoUpdate, gridSearch, startDate, endDate, retryCount) {
  const marketParametersBySymbol = marketParametersByExchange[exchange.id][symbol];

  console.log(`${symbol} のバックテストを開始...`);
  
  // 全タイムフレームの結果を保存する配列
  const allTimeframeResults = [];
  
  // タイムフレームでループ
  for (const timeframe of OHLCVTimeFrames) {
    // const timeframeMs = timeframeToMs(timeframe);
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
      console.log('グリッドサーチを実行します...');
      parameterCombinations = generateParameterCombinations(
        dbParams,
        numericParameterKeys,
        0.1 + (retryCount*0.1), // パラメータの変動幅
        10 // ステップ数
      );
    } else {
      console.log('パラメータ数が多いため正規乱数を使ったランダムサーチを実行します');
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
      console.log(`重複排除: ${originalCount} 組み合わせから ${parameterCombinations.length} 組み合わせに削減されました`);
    }
    
    console.log(`テスト対象の組み合わせ数: ${parameterCombinations.length}`);
    
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
      
      console.log(`  パラメータ組み合わせをテスト: ${JSON.stringify(paramCombination)}`);
      
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
      };

      const totalIterations = Math.floor((endDate.getTime() - startDate.getTime()) / timeframeMs) + 1;
      let currentIteration = 0;

      for (let timestamp = startDate.getTime(); timestamp <= endDate.getTime(); timestamp += timeframeMs) {
        currentIteration++;
        
        if (currentIteration % Math.ceil(totalIterations / 10) === 0 || currentIteration === 1 || currentIteration === totalIterations) {
          const progressPercent = (currentIteration / totalIterations * 100).toFixed(1);
          console.log(`バックテスト進捗: ${currentIteration}/${totalIterations} (${progressPercent}%)`);
        }
        
        options.backtest.timestamp = timestamp;

        try {
          await strategy.function(exchange, symbol, strategyKey, strategyConfig, marketParametersBySymbol, options);              
        } catch (error) {
          console.error(`バックテスト中にエラーが発生しました: ${error.message}`);
        }
      }

      if (options.backtest.lastSignal === 'buy') {
        const sellResult = await backtestCreateLimitSellOrder(
          symbol,
          options.backtest.currentAmount,
          options.backtest.currentPrice,
          options
        );
        console.log(`  最後のシグナルが買いでした。売り注文を実行: ${JSON.stringify(sellResult)}`);
      }

      console.log(`バックテスト完了: 全${totalIterations}回の処理を実行しました`);

      const result = {
        parameters: paramCombination,
        finalBaseFund: options.backtest.baseFund,
        timeframe: timeframe,
      }

      console.log(`  結果: ${options.backtest.baseFund}, buySignalCount: ${options.backtest.buySignalCount}, sellSignalCount: ${options.backtest.sellSignalCount} buyOrderCount: ${options.backtest.buyOrderCount}, sellOrderCount: ${options.backtest.sellOrderCount}`);
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
    
    // 現在のタイムフレームの結果を全タイムフレーム結果配列に追加
    allTimeframeResults.push(...rankedResults.map(result => ({ ...result, timeframe })));
  }
  
  // 全タイムフレームの結果をランキング
  const rankedAllTimeframeResults = rankResults(allTimeframeResults);
  
  // ランキング結果を表示
  const allTimeframeRankingTitle = `===== ${symbol} (全タイムフレーム) ${strategyKey} パラメータ最適化結果 =====`;
  console.log(allTimeframeRankingTitle);
  
  // Discord用に整形した文字列を作成
  const allResultsArr = [`## ${symbol} (全タイムフレーム) ${strategyKey} パラメータ最適化結果`];
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
  
  // 自動更新が有効で、全タイムフレーム中から最適な結果を選択して更新
  if (autoUpdate && rankedAllTimeframeResults.length > 0) {
    const topScore = rankedAllTimeframeResults[0].finalBaseFund;
    const threshold = topScore * 0.999;
    const eligibleResults = rankedAllTimeframeResults.filter(result => 
      result.finalBaseFund >= threshold
    );
    
    // スコアの差が非常に小さいかどうかをチェック
    const minScore = rankedAllTimeframeResults[rankedAllTimeframeResults.length - 1].finalBaseFund;
    const scoreDifference = (topScore - minScore) / topScore;
    
    // スコアの差が0.1%未満の場合はループをやり直す
    const shouldRetry = (scoreDifference < 0.001) 
    
    if (shouldRetry) {  
      console.log(`全スコアの差が非常に小さい (${(scoreDifference * 100).toFixed(4)}%) ため、より広いパラメータ範囲でループをやり直します`);
      await postResultToDiscord(`${strategyKey} の ${symbol} - すべての結果のスコア差が小さすぎるため、より広いパラメータ範囲で再試行します。`, discordBacktestURL);
      return { shouldRetry };
    }
    
    console.log(`トップスコア(${topScore.toFixed(2)})に近い${eligibleResults.length}個の結果から最適なタイムフレームを選択します`);
    
    // 対象の結果から最も短いタイムフレームを選択
    const selectedResult = eligibleResults.reduce((shortest, current) => {
      const shortestMs = timeframeToMs(shortest.timeframe);
      const currentMs = timeframeToMs(current.timeframe);
      return currentMs < shortestMs ? current : shortest;
    }, eligibleResults[0]);
    
    const dbParams = await getStrategyParameters(exchange.id, symbol, strategyKey, config);
    const paramsToUpdate = {
      ...dbParams,
      ohlcvInterval: selectedResult.timeframe,
      ...selectedResult.parameters,
    };
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


// バックテストを開始
runBacktest(targetSymbol, autoUpdate);