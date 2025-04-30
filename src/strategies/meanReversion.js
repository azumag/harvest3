/**
 * 逆張り戦略
 */
const {
  calculateSMA,
  calculateRSI,
} = require('./utils/indicators');

const { 
  fetchAndValidateOHLCVData, 
  handleStrategySignals, 
} = require('./utils/common');

const { addSignal, fetchTicker } = require('../database/manager');
const { postErrorToDiscord } = require('../common/notifications');

/**
 * 平均回帰戦略
 * 価格が移動平均線から大きく乖離した場合に、平均に戻ると予測して取引
 */
async function meanReversionStrategy(exchange, symbol, strategyKey, config, marketParameters, options = {}) {

  const { period = 20, deviationThreshold = 3, ohlcvInterval } = config;

  try {
    // OHLCVデータを取得して検証
    const closes = await fetchAndValidateOHLCVData(exchange, symbol, ohlcvInterval, period, postErrorToDiscord);
    if (!closes) return;

    // シグナル計算
    const signalResult = calculateMeanReversionSignals(
      closes, 
      period, 
      deviationThreshold, 
      exchange, 
      symbol, 
      strategyKey,
      options
    );
    
    if (!signalResult) return;
    
    // シグナルによって売買
    return await handleStrategySignals(
      exchange,
      symbol,
      strategyKey,
      config,
      marketParameters,
      signalResult,
      '平均回帰戦略',
      'Mean Reversion',
      formatMeanReversionLogInfo
    );
    
  } catch (error) {
    console.error(`平均回帰戦略でエラーが発生しました: ${symbol}`, error);
    if (postErrorToDiscord) {
      postErrorToDiscord(`[平均回帰戦略] エラー: ${exchange.id} - ${symbol} - ${error.message}`);
    }
    return {
      strategy: 'Mean Reversion',
      symbol,
      error: error.message
    };
  }
}

/**
 * オシレーター系指標を利用した逆張り戦略
 * RSIが極端な値を示した場合に、反転を予測して取引
 */
async function oscillatorStrategy(exchange, symbol, strategyKey, config, marketParameters, options = {}) {
  
  const { period = 14, oversoldThreshold = 20, overboughtThreshold = 80, ohlcvInterval } = config;

  try {
    // OHLCVデータを取得して検証
    const closes = await fetchAndValidateOHLCVData(exchange, symbol, ohlcvInterval, period, postErrorToDiscord);
    if (!closes) return;

    // RSIシグナル計算
    try {
      const signalResult = await calculateOscillatorSignals(
        closes,
        period,
        oversoldThreshold,
        overboughtThreshold,
        exchange,
        symbol,
        strategyKey,
        options
      );

      // シグナル計算でエラーが発生した場合や無効な結果の場合は終了
      if (!signalResult) return;

      // シグナル処理
      return await handleStrategySignals(
        exchange,
        symbol,
        strategyKey,
        config,
        marketParameters,
        signalResult,
        'オシレーター戦略',
        'Oscillator',
        formatOscillatorLogInfo
      );

    } catch (error) {
      console.error(`オシレーター戦略でエラーが発生しました: ${symbol}`, error);
      if (postErrorToDiscord) {
        await postErrorToDiscord(`[オシレーター戦略] エラー: ${exchange.id} - ${symbol} - ${error.message}`);
      }
      return {
        strategy: 'Oscillator',
        symbol,
        error: error.message
      };
    }
  } catch (error) {
    console.error(`オシレーター戦略でエラーが発生しました: ${symbol}`, error);
    if (postErrorToDiscord) {
      await postErrorToDiscord(`[オシレーター戦略] エラー: ${exchange.id} - ${symbol} - ${error.message}`);
    }
    return {
      strategy: 'Oscillator',
      symbol,
      error: error.message
    };
  }
}

/**
 * オシレーター戦略のシグナルを計算する
 * @param {Array} closes 終値の配列
 * @param {number} period 期間
 * @param {number} oversoldThreshold 売られすぎ閾値
 * @param {number} overboughtThreshold 買われすぎ閾値
 * @param {Object} exchange 取引所オブジェクト
 * @param {string} symbol 通貨ペア
 * @param {string} strategyKey 戦略キー
 * @returns {Object|null} シグナル計算結果、エラー時はnull
 */
async function calculateOscillatorSignals(closes, period, oversoldThreshold, overboughtThreshold, exchange, symbol, strategyKey, options = {}) {
  // RSIを計算
  const rsiValues = calculateRSI(closes, period);
  
  // RSI値の検証
  if (!rsiValues || rsiValues.length === 0 || rsiValues[rsiValues.length - 1] === undefined) {
    console.log(`オシレーター戦略: ${symbol} - RSI計算結果が無効です`);
    if (postErrorToDiscord) {
      await postErrorToDiscord(`[オシレーター戦略] 警告: ${exchange.id} - ${symbol} - RSI計算結果が無効です`);
    }
    return null;
  }
  
  // 最新のRSI値を取得
  const currentRSI = rsiValues[rsiValues.length - 1];

  // 現在の価格を取得
  const ticker = await fetchTicker(exchange, symbol, options);
  const currentPrice = ticker.last;

  // 買いシグナル: RSIが極端に低い（売られすぎ）
  const buySignal = currentRSI <= oversoldThreshold;

  // 売りシグナル: RSIが極端に高い（買われすぎ）
  const sellSignal = currentRSI >= overboughtThreshold;

  // シグナルタイプを決定
  const signalType = buySignal ? 'buy' : (sellSignal ? 'sell' : 'none');
  
  // 戦略固有の計算結果
  const strategyResults = {
    rsi: currentRSI,
    oversoldThreshold,
    overboughtThreshold
  };
  
  // シグナルがある場合のみ保存
  if (signalType !== 'none') {
    // 戦略シグナルを保存
    addSignal(
      exchange,
      symbol,
      strategyKey,
      signalType,
      currentPrice,
      strategyResults
    );
  }
  
  return {
    currentPrice,
    currentRSI,
    signalType,
    buySignal,
    sellSignal,
    strategyResults
  };
}

/**
 * 平均回帰戦略のログ情報をフォーマットする
 * @param {Object} signalResult シグナル計算結果
 * @returns {Object} フォーマットされたログ情報
 */
function formatMeanReversionLogInfo(signalResult) {
  const { currentPrice, currentSMA, deviation } = signalResult;
  const deviationFormatted = deviation.toFixed(2);
  
  return {
    buy: `価格: ${currentPrice}, SMA: ${currentSMA}, 乖離率: ${deviationFormatted}%`,
    sell: `価格: ${currentPrice}, SMA: ${currentSMA}, 乖離率: ${deviationFormatted}%`,
    none: `価格: ${currentPrice}, SMA: ${currentSMA}, 乖離率: ${deviationFormatted}%`,
    orderInfo: { sma: currentSMA, deviation: deviationFormatted },
    result: { price: currentPrice, sma: currentSMA, deviation }
  };
}

/**
 * オシレーター戦略のログ情報をフォーマットする
 * @param {Object} signalResult シグナル計算結果
 * @returns {Object} フォーマットされたログ情報
 */
function formatOscillatorLogInfo(signalResult) {
  const { currentPrice, currentRSI, strategyResults } = signalResult;
  const { oversoldThreshold, overboughtThreshold } = strategyResults;
  
  return {
    buy: `RSI: ${currentRSI} (閾値: ${oversoldThreshold})`,
    sell: `RSI: ${currentRSI} (閾値: ${overboughtThreshold})`,
    none: `RSI: ${currentRSI}`,
    orderInfo: { rsi: currentRSI, threshold: currentRSI <= oversoldThreshold ? oversoldThreshold : overboughtThreshold },
    result: { rsi: currentRSI, currentPrice }
  };
}

/**
 * 平均回帰戦略のシグナルを計算する
 * @param {Array} closes 終値の配列
 * @param {number} period 期間
 * @param {number} deviationThreshold 乖離閾値
 * @param {Object} exchange 取引所オブジェクト
 * @param {string} symbol 通貨ペア
 * @param {string} strategyKey 戦略キー
 * @returns {Object} シグナル計算結果
 */
async function calculateMeanReversionSignals(closes, period, deviationThreshold, exchange, symbol, strategyKey, options = {}) {
  // 移動平均線を計算
  const sma = calculateSMA(closes, period);
  const currentSMA = sma[sma.length - 1];

  // 現在の価格を取得
  const ticker = await fetchTicker(exchange, symbol, options);
  const currentPrice = ticker.last;

  // 乖離率を計算（%）
  const deviation = ((currentPrice - currentSMA) / currentSMA) * 100;

  // 買いシグナル: 価格が移動平均線から下に大きく乖離
  const buySignal = deviation <= -deviationThreshold;

  // 売りシグナル: 価格が移動平均線から上に大きく乖離
  const sellSignal = deviation >= deviationThreshold;

  // シグナルタイプを決定
  const signalType = buySignal ? 'buy' : (sellSignal ? 'sell' : 'none');
  
  // 戦略固有の計算結果
  const strategyResults = {
    sma: currentSMA,
    deviation
  };
  
  // シグナルがある場合のみ保存
  if (signalType !== 'none') {
    // 戦略シグナルを保存
    addSignal(
      exchange,
      symbol,
      strategyKey,
      signalType,
      currentPrice,
      strategyResults
    );
  }
  
  return {
    currentPrice,
    currentSMA,
    deviation,
    signalType,
    buySignal,
    sellSignal,
    strategyResults
  };
}



module.exports = {
  meanReversionStrategy,
  oscillatorStrategy
};
