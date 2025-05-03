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
function calculateRSI(prices, period) {
  // console.log(`calculateRSI called with prices.length: ${prices ? prices.length : 'null'}, period: ${period}`);
  
  // 最低限、period分のデータがあれば計算可能に修正（+1の条件を削除）
  if (!prices || prices.length < period) {
    // console.log('calculateRSI: Not enough data');
    return [];
  }
  
  try {
    const result = [];
    const gains = [];
    const losses = [];
    
    // 価格変動を計算
    for (let i = 1; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? -change : 0);
    }
    
    // 最初のperiod日分はnullを追加
    for (let i = 0; i < period; i++) {
      result.push(null);
    }
    
    // 初回のRSI計算（period日目）
    let avgGain = 0;
    let avgLoss = 0;
    
    // 最初のperiod日間の平均を計算
    for (let i = 0; i < period; i++) {
      avgGain += gains[i];
      avgLoss += losses[i];
    }
    avgGain /= period;
    avgLoss /= period;
    // console.log(`calculateRSI: Initial avgGain: ${avgGain}, avgLoss: ${avgLoss}`);

    // 初回のRSIを計算して追加
    const firstRs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const firstRsi = 100 - (100 / (1 + firstRs));
    // console.log(`calculateRSI: First RSI calculated: ${firstRsi}, avgGain: ${avgGain}, avgLoss: ${avgLoss}. result length before push: ${result.length}`);
    result.push({
      rsi: firstRsi,
      avgGain: avgGain,
      avgLoss: avgLoss
    });
    
    // 残りの日数分のRSIを計算
    for (let i = period + 1; i < prices.length; i++) {
      // console.log(`calculateRSI: Smoothing loop i: ${i}`);
      // スムージング計算（現在処理中のインデックスに対応する値）
      const currentGain = gains[i - 1];
      const currentLoss = losses[i - 1];
      
      // 前のインデックスの結果が存在することを確認
      const prevIndex = result.length - 1;
      if (prevIndex < 0 || !result[prevIndex]) {
        // console.log(`calculateRSI: Skipping calculation at i=${i} because previous result is not available.`);
        continue;
      }
      
      // console.log(`calculateRSI: Smoothing calculation at i=${i}, prevIndex=${prevIndex}. result[prevIndex]: ${JSON.stringify(result[prevIndex])}, currentGain: ${currentGain}, currentLoss: ${currentLoss}`);

      avgGain = (result[prevIndex].avgGain * (period - 1) + currentGain) / period;
      avgLoss = (result[prevIndex].avgLoss * (period - 1) + currentLoss) / period;
      
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      const rsi = 100 - (100 / (1 + rs));
      
      result.push({
        rsi: rsi,
        avgGain: avgGain,
        avgLoss: avgLoss
      });
    }
    
    // RSI値のみの配列を返す
    // console.log(`calculateRSI: Final result length: ${result.length}`);
    return result.map(item => item === null ? null : item.rsi);
  } catch (error) {
    // console.error('RSI計算エラー:', error);
    return [];  // エラー時は空の配列を返す
  }
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

module.exports = {
  calculateSMA,
  calculateEMA,
  calculateMACD,
  calculateRSI,
  calculateBollingerBands
};
