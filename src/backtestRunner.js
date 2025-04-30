// モジュールのインポート
const { config } = require('./config');
const { postErrorToDiscord } = require('./common/notifications');
const { sleep } = require('./common/utils');
const { getSymbolsByExchange, getStrategyConfig, getMarketParametersByExchangeSymbol } = require('./common/utils');
const { updateFilledTrades } = require('./database/manager'); // バックテストでは不要かもしれないが、bot.jsから一旦コピー
const { OHLCVTimeFrames } = require('./common/const');

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
 */
async function runBacktest() {
  try {
    // バックテストの主要なロジックをここに実装
    console.log('バックテストを開始します...');

    // marketParameter, symbolByExchange を一度だけ取得
    const symbolsByExchange = await getSymbolsByExchange(config);
    const marketParametersByExchange = await getMarketParametersByExchangeSymbol(symbolsByExchange, config);

    // バックテスト期間の設定 (例: 1年前から2025年4月29日まで)
    const endDate = new Date('2025-04-29T00:00:00Z'); // UTCで指定
    const startDate = new Date(endDate.getFullYear() - 1, endDate.getMonth(), endDate.getDate());

    // 各戦略・通貨ペアでループ
    for (const strategyKey of Object.keys(config.strategies)) {
      const strategy = config.strategies[strategyKey];
      if (strategy.enabled) { // 有効な戦略のみ実行
        for (const exchange of strategy.exchanges) {
          const symbols = symbolsByExchange[exchange.id];
          for (const symbol of symbols) {
            const marketParametersBySymbol = marketParametersByExchange[exchange.id][symbol];
            console.log(`${symbol} のバックテストを開始...`);
            
            // タイムフレームでループ
            for (const timeframe of OHLCVTimeFrames) {
              const timeframeMs = timeframeToMs(timeframe);
              
              console.log(`  ${timeframe} タイムフレームのバックテストを開始...`);
              const defaultConfig = config.strategies[strategyKey];
              
              // 数値パラメータのキーを抽出
              const numericParameterKeys = extractNumericParameterKeys(defaultConfig);
              console.log(`数値パラメータ: ${numericParameterKeys.join(', ')}`);
              
              // パラメータ最適化のために小さめのステップ値を使用（大量の組み合わせになるため）
              // 実際の範囲とステップはストラテジーに合わせて調整してください
              const paramMin = 1;
              const paramMax = 100;
              const paramStep = 1; // ステップを大きくして組み合わせ数を減らす
              
              // 全ての組み合わせを生成
              const parameterCombinations = generateParameterCombinations(
                defaultConfig, 
                numericParameterKeys,
                paramMin,
                paramMax,
                paramStep
              );
              
              console.log(`テスト対象の組み合わせ数: ${parameterCombinations.length}`);
              
              // 各組み合わせの結果を保存する配列
              const testResults = [];
              
              // 各パラメータ組み合わせでバックテスト実行
              for (const paramCombination of parameterCombinations) {
                // 基本設定にパラメータの組み合わせを適用
                const strategyConfig = {
                  ...defaultConfig,
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
                    timeframe,
                  },
                  // Discord通知の無効化
                  postOrderToDiscord: async () => {},
                  postErrorToDiscord: async () => {},
                };

                // タイムスタンプを生成してループ
                for (let timestamp = startDate.getTime(); timestamp <= endDate.getTime(); timestamp += timeframeMs) {
                  // 詳細ログは無効化し、処理を高速化
                  // console.log(`    Processing ${symbol} (${timeframe}) at: ${new Date(timestamp).toISOString()}`);
                  
                  // 現在のタイムスタンプを options.backtest に設定
                  options.backtest.timestamp = timestamp;

                  try {
                    await strategy.function(exchange, symbol, strategyKey, strategyConfig, marketParametersBySymbol, options);              
                  } catch (error) {
                    console.error(`バックテスト中にエラーが発生しました: ${error.message}`);
                  }
                }

                const result = {
                  parameters: paramCombination,
                  finalBaseFund: options.backtest.baseFund,
                }

                console.log(`  結果: ${JSON.stringify(result)}`);
                
                // この組み合わせの結果を保存
                testResults.push(result);
              }
              
              // 結果をbaseFundでランキング
              const rankedResults = rankResults(testResults);
              
              // ランキング結果を表示
              console.log(`\n===== ${symbol} (${timeframe}) パラメータ最適化結果 =====`);
              rankedResults.slice(0, 10).forEach((result, index) => {
                console.log(`${index + 1}位: 最終資金 ${result.finalBaseFund.toFixed(2)} - パラメータ: ${JSON.stringify(result.parameters)}`);
              });
              
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
  
  if (defaultValue <= 5) {
    // stdDev など小さい値のパラメータ（1,2,3程度）は 1~5 の範囲
    paramMin = 1;
    paramMax = 5;
    paramStep = 1;
  } else {
    // period など大きい値のパラメータ（20程度）は 元の値の±50%程度の範囲
    paramMin = Math.max(1, Math.floor(defaultValue * 0.75));
    paramMax = Math.ceil(defaultValue * 1.5);
    paramStep = Math.max(1, Math.floor((paramMax - paramMin) / 10)); // 10段階程度に分割
  }
  
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
runBacktest();