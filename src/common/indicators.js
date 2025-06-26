/**
 * 共有テクニカル指標計算ユーティリティ
 * Consolidated technical indicator utilities
 * 
 * このファイルは strategies/utils/indicators.js と web/js/analysis.js の
 * 重複したコードを統合するために作成されました
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

// Node.js環境とブラウザ環境の両方に対応
if (typeof module !== 'undefined' && module.exports) {
  // Node.js環境
  module.exports = {
    calculateSMA,
    calculateEMA,
    calculateMACD,
    calculateBollingerBands
  };
} else {
  // ブラウザ環境 - グローバルスコープに追加
  window.TechnicalIndicators = {
    calculateSMA,
    calculateEMA,
    calculateMACD,
    calculateBollingerBands
  };
}