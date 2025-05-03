// モジュールのインポート
const { config } = require('./config');
const { postErrorToDiscord, postResultToDiscord, discordBacktestURL } = require('./common/notifications');
const { sleep, timeframeToMs } = require('./common/utils');
const { getSymbolsByExchange, getStrategyConfig, getMarketParametersByExchangeSymbol } = require('./common/utils');
const { backtestCreateLimitSellOrder, saveStrategyParameters, getStrategyParameters, initializeDB } = require('./database/manager'); // バックテストでは不要かもしれないが、bot.jsから一旦コピー
const { OHLCVTimeFrames } = require('./common/const');


// コマンドライン引数を取得
const args = process.argv.slice(2);
const targetSymbol = args.find(arg => !arg.startsWith('--')); // ハイフンで始まらない引数はシンボルと見なす
const autoUpdate = args.includes('--auto-update'); // auto-update フラグを検出
const gridSearch = args.includes('--grid-search'); // grid-search フラグを検出

// 引数の説明を表示
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
使用方法: node backtestRunner.js [シンボル] [オプション]

引数:
  シンボル       - バックテスト対象の通貨ペア (例: BTC/USDT)。省略すると全シンボルが対象。
  
オプション:
  --auto-update  - 最適なパラメータで設定ファイルを自動更新する
  --grid-search  - グリッドサーチを実行する
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
    const endDate = new Date('2025-04-29T00:00:00Z'); // UTCで指定
    const startDate = new Date(endDate);
    startDate.setMonth(endDate.getMonth() - 1); // 1ヶ月前の日付を設定
    // startDate.setDate(endDate.getDate() - 1); // 1日前の日付を設定

    // 各戦略・通貨ペアでループ
    for (const strategyKey of Object.keys(config.strategies)) {
      const strategy = config.strategies[strategyKey];
      if (strategy.enabled) { // 有効な戦略のみ実行
        for (const exchange of strategy.exchanges) {
          const symbols = symbolsByExchange[exchange.id];
          for (const symbol of symbols) {
            // シンボルが指定されている場合、一致するもののみ処理
            if (targetSymbol && symbol !== targetSymbol) {
              continue;
            }
            
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
              // config.strategies[strategyKey];
              
              // 数値パラメータのキーを抽出
              const numericParameterKeys = extractNumericParameterKeys(dbParams);
              console.log(`数値パラメータ: ${numericParameterKeys.join(', ')}`);
              
              // パラメータ最適化のために小さめのステップ値を使用（大量の組み合わせになるため）
              // 実際の範囲とステップはストラテジーに合わせて調整してください
              const paramMin = 1;
              const paramMax = 100;
              const paramStep = 1; // ステップを大きくして組み合わせ数を減らす
              
              let parameterCombinations = null;
              if (gridSearch) {
                // グリッドサーチを実行
                console.log('グリッドサーチを実行します...');
                // 全ての組み合わせを生成
                parameterCombinations = generateParameterCombinations(
                  dbParams,
                  numericParameterKeys,
                  paramMin,
                  paramMax,
                  paramStep
                );
              } else {
                console.log('正規乱数を使ったランダムサーチを実行します');
                parameterCombinations = generateRandomParameterCombinations(
                  dbParams, numericParameterKeys, 30 // 30個の組み合わせを生成
                );
              }

              // parameterCombinations を生成した後、重複を排除する処理を追加します
              if (parameterCombinations) {
                // 重複排除前の数を保存
                const originalCount = parameterCombinations.length;
                
                // パラメータの組み合わせを文字列化してキーにするマップを作成
                const uniqueCombinationsMap = new Map();
                
                parameterCombinations.forEach(combo => {
                  // オブジェクトをソートしてからJSON文字列化することで一貫性を確保
                  const keys = Object.keys(combo).sort();
                  const sortedCombo = {};
                  keys.forEach(key => sortedCombo[key] = combo[key]);
                  
                  const comboKey = JSON.stringify(sortedCombo);
                  
                  // まだ追加されていない組み合わせの場合のみマップに追加
                  if (!uniqueCombinationsMap.has(comboKey)) {
                    uniqueCombinationsMap.set(comboKey, combo);
                  }
                });
                
                // 一意の組み合わせだけを含む新しい配列を作成
                parameterCombinations = Array.from(uniqueCombinationsMap.values());
                
                console.log(`重複排除: ${originalCount} 組み合わせから ${parameterCombinations.length} 組み合わせに削減されました`);
              }
              
              console.log(`テスト対象の組み合わせ数: ${parameterCombinations.length}`);
              
              // 各組み合わせの結果を保存する配列
              const testResults = [];

              // const parameterCombinations = [defaultConfig]; // デフォルト設定のみでテスト
              
              // 各パラメータ組み合わせでバックテスト実行
              for (const paramCombination of parameterCombinations) {
                // 基本設定にパラメータの組み合わせを適用
                const strategyConfig = {
                  ..._strategyConfig,
                  hlcvInterval: timeframe,
                  ...paramCombination,
                  tradePercentage: config.global.tradePercentage,
                };
                
                console.log(`  パラメータ組み合わせをテスト: ${JSON.stringify(paramCombination)}`);
                
                // バックテスト結果を蓄積するためのoptionsオブジェクト
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
                  // Discord通知の無効化
                  postOrderToDiscord: async () => {},
                  postErrorToDiscord: async () => {},
                };

                // ループの総数を計算
                const totalIterations = Math.floor((endDate.getTime() - startDate.getTime()) / timeframeMs) + 1;
                let currentIteration = 0;

                // タイムスタンプを生成してループ
                for (let timestamp = startDate.getTime(); timestamp <= endDate.getTime(); timestamp += timeframeMs) {
                  // 現在の進行状況を更新
                  currentIteration++;
                  
                  // 10%ごとまたは一定間隔で進捗を表示
                  if (currentIteration % Math.ceil(totalIterations / 10) === 0 || currentIteration === 1 || currentIteration === totalIterations) {
                    const progressPercent = (currentIteration / totalIterations * 100).toFixed(1);
                    console.log(`バックテスト進捗: ${currentIteration}/${totalIterations} (${progressPercent}%)`);
                  }
                  
                  // 現在のタイムスタンプを options.backtest に設定
                  options.backtest.timestamp = timestamp;

                  try {
                    await strategy.function(exchange, symbol, strategyKey, strategyConfig, marketParametersBySymbol, options);              
                  } catch (error) {
                    console.error(`バックテスト中にエラーが発生しました: ${error.message}`);
                  }
                }

                if (options.backtest.lastSignal === 'buy') {
                  // 最後のシグナルが買いの場合、売り注文を実行
                  const sellResult = await backtestCreateLimitSellOrder(
                    symbol,
                    options.backtest.currentAmount,
                    options.backtest.currentPrice,
                    options
                  );
                  console.log(`  最後のシグナルが買いでした。売り注文を実行: ${JSON.stringify(sellResult)}`);
                }

                // ループ終了後、完了メッセージを表示
                console.log(`バックテスト完了: 全${totalIterations}回の処理を実行しました`);

                const result = {
                  parameters: paramCombination,
                  finalBaseFund: options.backtest.baseFund,
                  timeframe: timeframe, // タイムフレーム情報を追加
                }

                console.log(`  結果: ${options.backtest.baseFund}, buySignalCount: ${options.backtest.buySignalCount}, sellSignalCount: ${options.backtest.sellSignalCount} buyOrderCount: ${options.backtest.buyOrderCount}, sellOrderCount: ${options.backtest.sellOrderCount}`);
                // await postResultToDiscord(`バックテスト結果: ${exchange.id} ${symbol} ${strategyKey} ${timeframe} ${options.backtest.baseFund} ${JSON.stringify(result)}`);            
                // この組み合わせの結果を保存
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
                
                // パラメータを整形
                const paramStr = Object.entries(result.parameters)
                  .map(([key, value]) => `${key}: ${value}`)
                  .join(', ');
                
                // 整形した行を追加（桁揃えのためにパディングを使用）
                resultSrtArr.push(`${(index + 1).toString().padStart(2)}位  ${result.finalBaseFund.toFixed(2).padStart(8)}  ${paramStr}`);
              }
              resultSrtArr.push('```');

              await postResultToDiscord(resultSrtArr.join('\n'), discordBacktestURL);
              
              // 現在のタイムフレームの結果を全タイムフレーム結果配列に追加
              allTimeframeResults.push(...rankedResults.map(result => ({ ...result, timeframe })));
            }
            // alltimframeResults は全てのタイムフレームの結果を含む
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
              
              // パラメータを整形
              const paramStr = Object.entries(result.parameters)
                .map(([key, value]) => `${key}: ${value}`)
                .join(', ');
              
              // 整形した行を追加（桁揃えのためにパディングを使用）
              allResultsArr.push(`${(index + 1).toString().padStart(2)}位  ${result.finalBaseFund.toFixed(2).padStart(8)}  ${result.timeframe.padEnd(10)}  ${paramStr}`);
            }
            allResultsArr.push('```');
            await postResultToDiscord(allResultsArr.join('\n'), discordBacktestURL);
            // 自動更新が有効で、全タイムフレーム中で最も高いスコア（1位）の結果の場合のみ更新
            if (autoUpdate && rankedAllTimeframeResults.length > 0) {
              // スコアが最高の結果を使用する（すでにfinalBaseFundでソート済み）
              const topResult = rankedAllTimeframeResults[0];
              const dbParams = await getStrategyParameters(exchange.id, symbol, strategyKey, config);
              const paramsToUpdate = {
                ...dbParams,
                ohlcvInterval: topResult.timeframe, // 最適なタイムフレームを設定
                ...topResult.parameters,
              };
              await saveStrategyParameters(exchange.id, symbol, strategyKey, paramsToUpdate);
              console.log(`全タイムフレーム中で最高スコア（${topResult.finalBaseFund.toFixed(2)}）を持つパラメータで ${strategyKey} の ${symbol} 設定を更新しました（タイムフレーム: ${topResult.timeframe}）`);
              await postResultToDiscord(`設定を自動更新しました: ${strategyKey} の ${symbol} - 最高スコア: ${topResult.finalBaseFund.toFixed(2)} - タイムフレーム: ${topResult.timeframe} - ${JSON.stringify(topResult.parameters)}`, discordBacktestURL);
            }
            console.log(`${symbol} のバックテスト完了`);
            // 1秒待機（API制限を避けるため）
            await sleep(1000);
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
 * @param {number} min - パラメータの最小値（デフォルト値を使わない場合）
 * @param {number} max - パラメータの最大値（デフォルト値を使わない場合）
 * @param {number} step - パラメータの増分（デフォルト値を使わない場合）
 * @returns {Array} 全ての組み合わせの配列
 */
function generateParameterCombinations(defaultConfig, numericKeys, min = 1, max = 100, step = 1) {
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
  const N = 0.1;
  const STEP = 10;
  paramMin = Math.max(1, Math.floor(defaultValue * (1 - N)));
  paramMax = Math.ceil(defaultValue * (1 + N));
  paramStep = Math.max(1, Math.floor((paramMax - paramMin) / STEP)); // 段階に分割
  // paramMin = Math.max(1, Math.floor(defaultValue * 0.9));
  // paramMax = Math.ceil(defaultValue * 1.1);
  // paramStep = Math.max(1, Math.floor((paramMax - paramMin) / 3)); // 3段階程度に分割

  for (let value = paramMin; value <= paramMax; value += paramStep) {
    const subCombinations = generateParameterCombinations(defaultConfig, remainingKeys, min, max, step);
    
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
 * @returns {Array} ランダムに生成されたパラメータ組合せの配列
 */
function generateRandomParameterCombinations(defaultConfig, numericKeys, count = 60) {
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
      // 標準偏差はデフォルト値の50%程度に設定
      const stdDev = Math.max(1, defaultValue * 0.1);
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