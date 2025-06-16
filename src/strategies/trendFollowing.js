/**
 * トレンドフォロー戦略
 */
const {
  calculateSMA,
  calculateEMA,
  calculateMACD,
  calculateRSI,
  calculateBollingerBands,
} = require('./utils/indicators');

const { 
  fetchAndValidateOHLCVData, 
  handleStrategySignals, 
  executeBuyOrder, 
  executeSellOrder 
} = require('./utils/common');

const { addSignal, fetchTicker } = require('../database/manager');
const { postErrorToDiscord } = require('../common/notifications');

/**
 * 移動平均線クロス戦略
 * 短期移動平均線が長期移動平均線を上抜けたら買い、下抜けたら売り
 */
async function maStrategy(exchange, symbol, strategyKey, config, marketParameters, options = {}) {
  const { shortPeriod = 5, longPeriod = 20, ohlcvInterval } = config;

  try {
    // OHLCVデータを取得して検証
    const validatedData = await fetchAndValidateOHLCVData(
      exchange, 
      symbol, 
      ohlcvInterval, 
      longPeriod, 
      postErrorToDiscord,
      'MA',
      options
    );
    if (!validatedData) return;
    
    const { closes, ohlcv } = validatedData;
    if (options.backtest) {
      // バックテストモードの場合、OHLCVデータを保存
      options.backtest.ohlcvData = ohlcv;
    }

    // シグナル計算
    const signalResult = await calculateMACrossSignals(
      closes,
      shortPeriod,
      longPeriod,
      exchange,
      symbol,
      strategyKey,
      options
    );
    
    if (!signalResult) return;
    
    // シグナル処理
    return await handleStrategySignals(
      exchange,
      symbol,
      strategyKey,
      config,
      marketParameters,
      signalResult,
      'MA戦略',
      'MA Cross',
      formatMACrossLogInfo,
      options,
      options.config
    );
  } catch (error) {
    console.error(`移動平均線戦略でエラーが発生しました: ${symbol}`, error);
    if (postErrorToDiscord) {
      await postErrorToDiscord(`[MA戦略] エラー: ${exchange.id} - ${symbol} - ${error.message}`);
    }
    return {
      strategy: 'MA Cross',
      symbol,
      error: error.message
    };
  }
}

/**
 * 移動平均線クロス戦略のシグナルを計算する
 * @param {Array} closes 終値の配列
 * @param {number} shortPeriod 短期期間
 * @param {number} longPeriod 長期期間
 * @param {Object} exchange 取引所オブジェクト
 * @param {string} symbol 通貨ペア
 * @param {string} strategyKey 戦略キー
 * @returns {Object} シグナル計算結果
 */
async function calculateMACrossSignals(closes, shortPeriod, longPeriod, exchange, symbol, strategyKey, options = {}) {
  // 短期と長期の移動平均線を計算
  const shortMA = calculateSMA(closes, shortPeriod);
  const longMA = calculateSMA(closes, longPeriod);
  
  // 最新と1つ前の値を取得
  const currentShortMA = shortMA[shortMA.length - 1];
  const previousShortMA = shortMA[shortMA.length - 2];
  const currentLongMA = longMA[longMA.length - 1];
  const previousLongMA = longMA[longMA.length - 2];
  
  // 現在の価格を取得
  const ticker = await fetchTicker(exchange, symbol, options);
  const currentPrice = ticker.last;
  
  // クロスを検出
  const crossUp = previousShortMA < previousLongMA && currentShortMA > currentLongMA;
  const crossDown = previousShortMA > previousLongMA && currentShortMA < currentLongMA;

  // シグナルタイプを決定
  const signalType = crossUp ? 'buy' : (crossDown ? 'sell' : 'none');
  
  // 戦略固有の計算結果
  const strategyResults = {
    shortMA: currentShortMA,
    longMA: currentLongMA
  };
  
  // シグナルがある場合のみ保存
  if (signalType !== 'none') {
    addSignal(
      exchange,
      symbol,
      strategyKey,
      signalType,
      currentPrice,
      strategyResults,
      options // optionsを追加
    );
  }
  
  return {
    currentPrice,
    currentShortMA,
    currentLongMA,
    signalType,
    buySignal: crossUp,
    sellSignal: crossDown,
    strategyResults
  };
}

/**
 * 移動平均線クロス戦略のログ情報をフォーマットする
 * @param {Object} signalResult シグナル計算結果
 * @returns {Object} フォーマットされたログ情報
 */
function formatMACrossLogInfo(signalResult) {
  const { currentPrice, currentShortMA, currentLongMA } = signalResult;
  
  return {
    buy: `短期MA: ${currentShortMA}, 長期MA: ${currentLongMA}`,
    sell: `短期MA: ${currentShortMA}, 長期MA: ${currentLongMA}`,
    none: `短期MA: ${currentShortMA}, 長期MA: ${currentLongMA}`,
    orderInfo: { shortMA: currentShortMA, longMA: currentLongMA },
    result: { shortMA: currentShortMA, longMA: currentLongMA, currentPrice }
  };
}

// MACD戦略
async function macdStrategy(exchange, symbol, strategyKey, config, marketParameters, options = {}) {
  const { tradePercentage } = config;
  const { fastPeriod = 12, slowPeriod = 26, signalPeriod = 9, amount, ohlcvInterval } = config;
  const { pricePrecision, amountPrecision, minTradeAmount, } = marketParameters;

  try {
    // OHLCVデータを取得して検証
    const validatedData = await fetchAndValidateOHLCVData(
      exchange, 
      symbol, 
      ohlcvInterval, 
      slowPeriod + signalPeriod, 
      postErrorToDiscord,
      'MACD',
      options,
    );
    if (!validatedData) return;
    
    const { closes, ohlcv } = validatedData;
    if (options.backtest) {
      // バックテストモードの場合、OHLCVデータを保存
      options.backtest.ohlcvData = ohlcv;
    }

    // MACDを計算
    const macdData = calculateMACD(closes, fastPeriod, slowPeriod, signalPeriod);
    
    // 最新と1つ前の値を取得
    const currentMACD = macdData.macd[macdData.macd.length - 1];
    const previousMACD = macdData.macd[macdData.macd.length - 2];
    const currentSignal = macdData.signal[macdData.signal.length - 1];
    const previousSignal = macdData.signal[macdData.signal.length - 2];
    
    // 現在の価格を取得
    const ticker = await fetchTicker(exchange, symbol, options);
    const currentPrice = ticker.last;
    
    // クロスを検出
    const crossUp = previousMACD < previousSignal && currentMACD > currentSignal;
    const crossDown = previousMACD > previousSignal && currentMACD < currentSignal;
    
    // シグナルタイプを決定
    const signalType = crossUp ? 'buy' : (crossDown ? 'sell' : 'none');
    
    // 戦略固有の計算結果
    const strategyResults = {
      macd: currentMACD,
      signal: currentSignal
    };
    
    // シグナルがある場合のみ保存
    if (signalType !== 'none') {
      addSignal(
        exchange,
        symbol,
        strategyKey,
        signalType,
        currentPrice,
        strategyResults,
        options // optionsを追加
      );
    }
    
    // シグナル結果をまとめる
    const signalResult = {
      currentPrice,
      currentMACD,
      currentSignal,
      signalType,
      buySignal: crossUp,
      sellSignal: crossDown,
      strategyResults
    };
    
    // シグナル処理を共通関数で行う
    return await handleStrategySignals(
      exchange,
      symbol,
      strategyKey,
      config,
      marketParameters,
      signalResult,
      'MACD戦略',
      'MACD',
      formatMACDLogInfo,
      options,
      options.config
    );
  } catch (error) {
    console.error(`MACD戦略でエラーが発生しました: ${symbol}`, error);
    if (postErrorToDiscord) {
      await postErrorToDiscord(`[MACD戦略] エラー: ${exchange.id} - ${symbol} - ${error.message}`);
    }
    return {
      strategy: 'MACD',
      symbol,
      error: error.message
    };
  }
}

/**
 * MACD戦略のログ情報をフォーマットする
 * @param {Object} signalResult シグナル計算結果
 * @returns {Object} フォーマットされたログ情報
 */
function formatMACDLogInfo(signalResult) {
  const { currentPrice, currentMACD, currentSignal } = signalResult;
  
  return {
    buy: `MACD: ${currentMACD.toFixed(6)}, シグナル: ${currentSignal.toFixed(6)}`,
    sell: `MACD: ${currentMACD.toFixed(6)}, シグナル: ${currentSignal.toFixed(6)}`,
    none: `MACD: ${currentMACD.toFixed(6)}, シグナル: ${currentSignal.toFixed(6)}`,
    orderInfo: { macd: currentMACD, signal: currentSignal },
    result: { macd: currentMACD, signal: currentSignal, currentPrice }
  };
}

// RSI戦略
async function rsiStrategy(exchange, symbol, strategyKey, config, marketParameters, options = {}) {
  const { tradePercentage } = config; 
  const { period = 14, oversoldThreshold = 30, overboughtThreshold = 70, amount, ohlcvInterval } = config;
  const { pricePrecision, amountPrecision, minTradeAmount } = marketParameters;
  try {
    // OHLCVデータを取得して検証
    const validatedData = await fetchAndValidateOHLCVData(  
      exchange, 
      symbol, 
      ohlcvInterval, 
      period, 
      postErrorToDiscord,
      'RSI',
      options
    );
    if (!validatedData) return;
    
    const { closes, ohlcv } = validatedData;
    if (options.backtest) {
      // バックテストモードの場合、OHLCVデータを保存
      options.backtest.ohlcvData = ohlcv;
    }

    // RSIを計算
    const rsiValues = calculateRSI(closes, period);
    
    // 最新のRSI値を取得
    const currentRSI = rsiValues[rsiValues.length - 1];
    const previousRSI = rsiValues[rsiValues.length - 2];
    
    // 現在の価格を取得
    const ticker = await fetchTicker(exchange, symbol, options);
    const currentPrice = ticker.last;
    
    // 買いシグナル: RSIが閾値を下回り、前回のRSIが閾値以上
    const buySignal = currentRSI < oversoldThreshold && previousRSI >= oversoldThreshold;
    
    // 売りシグナル: RSIが閾値を上回り、前回のRSIが閾値以下
    const sellSignal = currentRSI > overboughtThreshold && previousRSI <= overboughtThreshold;
    
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
      addSignal(
        exchange,
        symbol,
        strategyKey,
        signalType,
        currentPrice,
        strategyResults,
        options // optionsを追加
      );
    }
    
    // シグナル結果をまとめる
    const signalResult = {
      currentPrice,
      currentRSI,
      oversoldThreshold,
      overboughtThreshold,
      signalType,
      buySignal,
      sellSignal,
      strategyResults
    };
    
    // シグナル処理を共通関数で行う
    return await handleStrategySignals(
      exchange,
      symbol,
      strategyKey,
      config,
      marketParameters,
      signalResult,
      'RSI戦略',
      'RSI',
      formatRSILogInfo,
      options,
      options.config
    );
    
  } catch (error) {
    console.error(`RSI戦略でエラーが発生しました: ${symbol}`, error);
    if (postErrorToDiscord) {
      await postErrorToDiscord(`[RSI戦略] エラー: ${exchange.id} - ${symbol} - ${error.message}`);
    }
    return {
      strategy: 'RSI',
      symbol,
      error: error.message
    };
  }
}

/**
 * RSI戦略のログ情報をフォーマットする
 * @param {Object} signalResult シグナル計算結果
 * @returns {Object} フォーマットされたログ情報
 */
function formatRSILogInfo(signalResult) {
  const { currentPrice, currentRSI, oversoldThreshold, overboughtThreshold } = signalResult;
  
  return {
    buy: `RSI: ${currentRSI.toFixed(2)} (閾値: ${oversoldThreshold})`,
    sell: `RSI: ${currentRSI.toFixed(2)} (閾値: ${overboughtThreshold})`,
    none: `RSI: ${currentRSI.toFixed(2)}`,
    orderInfo: { rsi: currentRSI, oversoldThreshold, overboughtThreshold },
    result: { rsi: currentRSI, currentPrice }
  };
}

/**
 * ボリンジャーバンド戦略
 * 価格がバンドの上限に達したら売り、下限に達したら買い
 */
async function bollingerBandsStrategy(exchange, symbol, strategyKey, config, marketParameters, options = {}) {
  const { tradePercentage } = config;
  const { period = 20, stdDev = 2, amount, ohlcvInterval } = config;
  const { pricePrecision, amountPrecision, minTradeAmount, } = marketParameters;

  try {
    // OHLCVデータを取得して検証
    const validatedData = await fetchAndValidateOHLCVData(
      exchange, 
      symbol, 
      ohlcvInterval, 
      period, 
      postErrorToDiscord,
      'BB',
      options
    );
    if (!validatedData) return;
    
    const { closes, ohlcv } = validatedData;
    if (options.backtest) {
      // バックテストモードの場合、OHLCVデータを保存
      options.backtest.ohlcvData = ohlcv;
    }

    // ボリンジャーバンドを計算
    const bands = calculateBollingerBands(closes, period, stdDev);
    
    // 最新の値を取得
    const currentUpper = bands.upper[bands.upper.length - 1];
    const currentMiddle = bands.middle[bands.middle.length - 1];
    const currentLower = bands.lower[bands.lower.length - 1];
    
    // 現在の価格を取得
    const ticker = await fetchTicker(exchange, symbol, options);
    const currentPrice = ticker.last;
    
    // バンド幅を計算（ボラティリティの指標）
    const bandWidth = (currentUpper - currentLower) / currentMiddle;
    
    // 既存のシグナルロジック
    const buySignal = currentPrice <= currentLower;// * 1.01;
    const sellSignal = currentPrice >= currentUpper;// * 0.99;

    // シグナルタイプを決定
    const signalType = buySignal ? 'buy' : (sellSignal ? 'sell' : 'none');
    
    // 戦略固有の計算結果
    const strategyResults = {
      upper: currentUpper,
      middle: currentMiddle,
      lower: currentLower,
      bandWidth
    };
    
    // シグナルがある場合のみ保存
    if (signalType !== 'none') {
      addSignal(
        exchange,
        symbol,
        strategyKey,
        signalType,
        currentPrice,
        strategyResults,
        options // optionsを追加
      );
    }
    
    // シグナル結果をまとめる
    const signalResult = {
      currentPrice,
      currentUpper,
      currentMiddle,
      currentLower,
      bandWidth,
      signalType,
      buySignal,
      sellSignal,
      strategyResults
    };
    
    // シグナル処理を共通関数で行う
    return await handleStrategySignals(
      exchange,
      symbol,
      strategyKey,
      config,
      marketParameters,
      signalResult,
      'BB戦略',
      'Bollinger Bands',
      formatBollingerBandsLogInfo,
      options,
      options.config
    );
    
    
  } catch (error) {
    console.error(`ボリンジャーバンド戦略でエラーが発生しました: ${symbol}`, error);
    if (postErrorToDiscord) {
      await postErrorToDiscord(`[BB戦略] エラー: ${exchange.id} - ${symbol} - ${error.message}`);
    }
    return {
      strategy: 'Bollinger Bands',
      symbol,
      error: error.message
    };
  }
}

/**
 * ボリンジャーバンド戦略のログ情報をフォーマットする
 * @param {Object} signalResult シグナル計算結果
 * @returns {Object} フォーマットされたログ情報
 */
function formatBollingerBandsLogInfo(signalResult) {
  const { currentPrice, currentUpper, currentMiddle, currentLower, bandWidth } = signalResult;
  
  return {
    buy: `価格: ${currentPrice}, 下限: ${currentLower.toFixed(2)}`,
    sell: `価格: ${currentPrice}, 上限: ${currentUpper.toFixed(2)}`,
    none: `価格: ${currentPrice}, 上限: ${currentUpper.toFixed(2)}, 下限: ${currentLower.toFixed(2)}`,
    orderInfo: { upper: currentUpper, middle: currentMiddle, lower: currentLower, bandWidth },
    result: { price: currentPrice, upper: currentUpper, middle: currentMiddle, lower: currentLower, bandWidth }
  };
}

module.exports = {
  maStrategy,
  macdStrategy,
  rsiStrategy,
  bollingerBandsStrategy
};
