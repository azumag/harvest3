/**
 * テクニカル指標を計算するためのユーティリティ関数
 */

/**
 * 単純移動平均（SMA）を計算
 * @param {Array} prices - 価格データの配列
 * @param {Number} period - 期間
 * @returns {Array} - SMAの配列
 */
function calculateSMA(prices, period) {
  const result = [];
  
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      result.push(null);
      continue;
    }
    
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += prices[i - j];
    }
    
    result.push(sum / period);
  }
  
  return result;
}

/**
 * 指数移動平均（EMA）を計算
 * @param {Array} prices - 価格データの配列
 * @param {Number} period - 期間
 * @returns {Array} - EMAの配列
 */
function calculateEMA(prices, period) {
  const result = [];
  const multiplier = 2 / (period + 1);
  
  // 最初のEMAはSMAとして計算
  let ema = prices.slice(0, period).reduce((sum, price) => sum + price, 0) / period;
  
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      result.push(null);
      continue;
    }
    
    if (i === period - 1) {
      result.push(ema);
      continue;
    }
    
    // EMA = 前日のEMA + α × (今日の価格 - 前日のEMA)
    ema = (prices[i] - ema) * multiplier + ema;
    result.push(ema);
  }
  
  return result;
}

/**
 * MACDを計算
 * @param {Array} prices - 価格データの配列
 * @param {Number} fastPeriod - 短期EMAの期間（デフォルト12）
 * @param {Number} slowPeriod - 長期EMAの期間（デフォルト26）
 * @param {Number} signalPeriod - シグナルラインの期間（デフォルト9）
 * @returns {Object} - MACD、シグナル、ヒストグラムの配列
 */
function calculateMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const fastEMA = calculateEMA(prices, fastPeriod);
  const slowEMA = calculateEMA(prices, slowPeriod);
  const macdLine = [];
  
  // MACD = 短期EMA - 長期EMA
  for (let i = 0; i < prices.length; i++) {
    if (i < slowPeriod - 1) {
      macdLine.push(null);
      continue;
    }
    
    macdLine.push(fastEMA[i] - slowEMA[i]);
  }
  
  // シグナルラインはMACDのEMA
  const signalLine = calculateEMA(
    macdLine.filter(value => value !== null),
    signalPeriod
  );
  
  // シグナルラインの長さをMACDラインに合わせる
  const paddedSignalLine = Array(slowPeriod + signalPeriod - 2).fill(null).concat(signalLine);
  
  // ヒストグラム = MACD - シグナル
  const histogram = [];
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] === null || paddedSignalLine[i] === null) {
      histogram.push(null);
    } else {
      histogram.push(macdLine[i] - paddedSignalLine[i]);
    }
  }
  
  return {
    macd: macdLine,
    signal: paddedSignalLine,
    histogram: histogram
  };
}

/**
 * RSI（相対力指数）を計算
 * @param {Array} prices - 価格データの配列
 * @param {Number} period - 期間（デフォルト14）
 * @returns {Array} - RSIの配列
 */
function calculateRSI(prices, period = 14) {
  const result = [];
  const gains = [];
  const losses = [];
  
  // 価格変動を計算
  for (let i = 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? -change : 0);
  }
  
  // 最初のRSIを計算
  for (let i = 0; i < prices.length; i++) {
    if (i < period) {
      result.push(null);
      continue;
    }
    
    // 平均上昇幅と平均下落幅を計算
    let avgGain = 0;
    let avgLoss = 0;
    
    if (i === period) {
      // 最初の平均は単純平均
      for (let j = 0; j < period; j++) {
        avgGain += gains[j];
        avgLoss += losses[j];
      }
      avgGain /= period;
      avgLoss /= period;
    } else {
      // それ以降はスムージング
      avgGain = (result[i - 1].avgGain * (period - 1) + gains[i - 1]) / period;
      avgLoss = (result[i - 1].avgLoss * (period - 1) + losses[i - 1]) / period;
    }
    
    // RS = 平均上昇幅 / 平均下落幅
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    
    // RSI = 100 - (100 / (1 + RS))
    const rsi = 100 - (100 / (1 + rs));
    
    result.push({
      rsi: rsi,
      avgGain: avgGain,
      avgLoss: avgLoss
    });
  }
  
  // RSI値のみの配列を返す
  return result.map(item => item === null ? null : item.rsi);
}

/**
 * ボリンジャーバンドを計算
 * @param {Array} prices - 価格データの配列
 * @param {Number} period - 期間（デフォルト20）
 * @param {Number} multiplier - 標準偏差の乗数（デフォルト2）
 * @returns {Object} - 上限、中央、下限の配列
 */
function calculateBollingerBands(prices, period = 20, multiplier = 2) {
  const middle = calculateSMA(prices, period);
  const upper = [];
  const lower = [];
  
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      upper.push(null);
      lower.push(null);
      continue;
    }
    
    // 標準偏差を計算
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += Math.pow(prices[i - j] - middle[i], 2);
    }
    const stdDev = Math.sqrt(sum / period);
    
    // 上限と下限を計算
    upper.push(middle[i] + (multiplier * stdDev));
    lower.push(middle[i] - (multiplier * stdDev));
  }
  
  return {
    upper: upper,
    middle: middle,
    lower: lower
  };
}

/**
 * 取引記録から買った量を取得
 * @param {Object} tradeRecords - 取引記録
 * @param {Object} exchange - 取引所
 * @param {string} symbol - シンボル
 * @param {Function} updateTradeRecord - 取引記録更新関数
 * @param {string} strategyKey - 戦略キー（オプション）
 * @returns {number} - 買い量
 */
function getBuyAmount(tradeRecords, exchange, symbol, updateTradeRecord, strategyKey = null) {
  let buyAmount = 0;
  if (updateTradeRecord) {
    // tradeRecordsから該当する取引所とシンボルの買い量を取得
    const exchangeRecords = tradeRecords[exchange.id];
    if (exchangeRecords && exchangeRecords[symbol]) {
      if (strategyKey && exchangeRecords[symbol][strategyKey]) {
        // 特定の戦略の買い量を取得（MMなど）
        buyAmount = exchangeRecords[symbol][strategyKey].buyAmount || 0;
      } else {
        // 通常の買い量を取得（全戦略の合計）
        buyAmount = exchangeRecords[symbol].buyAmount - exchangeRecords[symbol].sellAmount;
      }
      if (Number.isNaN(buyAmount)) buyAmount = 0; // NaNの場合は0にする (Number.isNaNを使用)
      if (buyAmount < 0) buyAmount = 0; // 負の値にならないように
    }
  }
  return buyAmount;
}

/**
 * MMで買った量を取得する便利関数
 * @param {Object} tradeRecords - 取引記録
 * @param {Object} exchange - 取引所
 * @param {string} symbol - シンボル
 * @param {Function} updateTradeRecord - 取引記録更新関数
 * @returns {number} - MMで買った量
 */
function getInyoBuyAmount(tradeRecords, exchange, symbol, updateTradeRecord) {
  // データベースからの最新の取引量を取得
  const { getLatestTradeAmount } = require('../src/database');
  const latestAmount = getLatestTradeAmount(exchange.id, symbol, 'MARKET_MAKING');
  
  // 最新の取引があれば、その量を返す
  if (latestAmount > 0) {
    return latestAmount;
  }
  
  // なければ 0 を返す
  return 0;
  // return getBuyAmount(tradeRecords, exchange, symbol, updateTradeRecord, 'MARKET_MAKING');
}

module.exports = {
  calculateSMA,
  calculateEMA,
  calculateMACD,
  calculateRSI,
  calculateBollingerBands,
  getBuyAmount,
  getInyoBuyAmount
};
