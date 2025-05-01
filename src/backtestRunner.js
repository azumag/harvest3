// モジュールのインポート
const { config } = require('./config');
const { postErrorToDiscord, postResultToDiscord } = require('./common/notifications');
const { sleep } = require('./common/utils');
const { getSymbolsByExchange, getStrategyConfig, getMarketParametersByExchangeSymbol } = require('./common/utils');
const { backtestCreateLimitSellOrder, saveStrategyParameters } = require('./database/manager'); // バックテストでは不要かもしれないが、bot.jsから一旦コピー
const { OHLCVTimeFrames } = require('./common/const');

// コマンドライン引数を取得
const args = process.argv.slice(2);
const targetSymbol = args.find(arg => !arg.startsWith('--')); // ハイフンで始まらない引数はシンボルと見なす
const autoUpdate = args.includes('--auto-update'); // auto-update フラグを検出

// 引数の説明を表示
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
使用方法: node backtestRunner.js [シンボル] [オプション]

引数:
  シンボル       - バックテスト対象の通貨ペア (例: BTC/USDT)。省略すると全シンボルが対象。
  
オプション:
  --auto-update  - 最適なパラメータで設定ファイルを自動更新する
  --help, -h     - このヘルプを表示
  `);
  process.exit(0);
}

/**
 * タイムフレーム文字列をミリ秒に変換する関数
 * @param {string} timeframe - タイムフレーム文字列 (例: "1m", "1h", "1d")
 * @returns {number} ミリ秒
 */
function timeframeToMs(timeframe) {
  const value = parseInt(timeframe);
  const unit = timeframe.slice(value.toString().length);
  
  switch (unit) {
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    case 'w': return value * 7 * 24 * 60 * 60 * 1000;
    default: throw new Error(`Unknown timeframe unit: ${unit}`);
  }
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

    // marketParameter, symbolByExchange を一度だけ取得
    const symbolsByExchange = await getSymbolsByExchange(config);
    const marketParametersByExchange = await getMarketParametersByExchangeSymbol(symbolsByExchange, config, options = { targetSymbol });

    // バックテスト期間の設定 
    const endDate = new Date('2025-04-29T00:00:00Z'); // UTCで指定
    const startDate = new Date(endDate);
    startDate.setMonth(endDate.getMonth() - 3); // 3ヶ月前の日付を設定

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
            
            // タイムフレームでループ
            for (const timeframe of OHLCVTimeFrames) {
              const timeframeMs = timeframeToMs(timeframe);
              
              console.log(`  ${timeframe} タイムフレームのバックテストを開始...`);
              const _strategyConfig = await getStrategyConfig(exchange, symbol, strategyKey, config);
              // config.strategies[strategyKey];
              
              // 数値パラメータのキーを抽出
              const numericParameterKeys = extractNumericParameterKeys(_strategyConfig);
              console.log(`数値パラメータ: ${numericParameterKeys.join(', ')}`);
              
              // パラメータ最適化のために小さめのステップ値を使用（大量の組み合わせになるため）
              // 実際の範囲とステップはストラテジーに合わせて調整してください
              const paramMin = 1;
              const paramMax = 100;
              const paramStep = 1; // ステップを大きくして組み合わせ数を減らす
              
              // 全ての組み合わせを生成
              const parameterCombinations = generateParameterCombinations(
                _strategyConfig,
                numericParameterKeys,
                paramMin,
                paramMax,
                paramStep
              );
              
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
                }

                console.log(`  結果: ${options.backtest.baseFund}, buySignalCount: ${options.backtest.buySignalCount}, sellSignalCount: ${options.backtest.sellSignalCount} buyOrderCount: ${options.backtest.buyOrderCount}, sellOrderCount: ${options.backtest.sellOrderCount}`);
                await postResultToDiscord(`バックテスト結果: ${exchange.id} ${symbol} ${strategyKey} ${JSON.stringify(result)}`);
                
                // この組み合わせの結果を保存
                testResults.push(result);
              }
              
              // 結果をbaseFundでランキング
              const rankedResults = rankResults(testResults);
              
              // ランキング結果を表示
              console.log(`\n===== ${symbol} (${timeframe}) パラメータ最適化結果 =====`);
              await postResultToDiscord(`\n===== ${symbol} (${timeframe}) ${strategyKey} パラメータ最適化結果 =====`);
              for (let index = 0; index < Math.min(rankedResults.length, 10); index++) {
                const result = rankedResults[index];
                console.log(`${index + 1}位: 最終資金 ${result.finalBaseFund.toFixed(2)} - パラメータ: ${JSON.stringify(result.parameters)}`);
                await postResultToDiscord(`${index + 1}位: 最終資金 ${result.finalBaseFund.toFixed(2)} - パラメータ: ${JSON.stringify(result.parameters)}`);
                
                // 自動更新が有効で、1位の結果の場合
                if (autoUpdate && index === 0) {
                  await saveStrategyParameters(exchange.id, strategyKey, symbol, result.parameters);
                  console.log(`最適なパラメータで ${strategyKey} の ${symbol} 設定を更新しました`);
                  await postResultToDiscord(`設定を自動更新しました: ${strategyKey} の ${symbol} - ${JSON.stringify(result.parameters)}`);
                }
                
                await sleep(100);
              }
              
              console.log(`  ${timeframe} タイムフレームのバックテスト完了`);
            }
            
            console.log(`${symbol} のバックテスト完了`);
          }
        }
      }
    }

    console.log('バックテストが完了しました。');

    // TODO: バックテスト結果の集計とレポート生成
    console.log('バックテスト結果を集計しています...');
    // TODO: 集計ロジックとレポート出力
  } catch (error) {
    const errorMessage = `バックテスト実行中にエラーが発生しました: ${error.message}`;
    console.error(errorMessage, error);
    // await postErrorToDiscord(errorMessage);
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

// バックテストを開始
runBacktest(targetSymbol, autoUpdate);