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
  // Handle null/undefined inputs
  if (!prices || !Array.isArray(prices)) {
    return [];
  }
  
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
  // Handle null/undefined inputs
  if (!prices || !Array.isArray(prices)) {
    return [];
  }
  
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
  // Handle null/undefined inputs
  if (!prices || !Array.isArray(prices)) {
    return { macd: [], signal: [], histogram: [] };
  }
  
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
  // Handle null/undefined inputs
  if (!prices || !Array.isArray(prices)) {
    return { upper: [], middle: [], lower: [] };
  }
  
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
 * 相互情報量を計算
 * @param {Array} series1 - 第1の時系列データ
 * @param {Array} series2 - 第2の時系列データ
 * @param {Number} bins - ヒストグラムのビン数（デフォルト10）
 * @returns {Number} - 相互情報量
 */
function calculateMutualInformation(series1, series2, bins = 10) {
  if (!series1 || !series2 || series1.length !== series2.length || series1.length === 0) {
    return 0;
  }

  // データの正規化（0-1の範囲に）
  const normalize = (data) => {
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min;
    if (range === 0) return data.map(() => 0.5);
    return data.map(x => (x - min) / range);
  };

  const norm1 = normalize(series1);
  const norm2 = normalize(series2);
  
  // ヒストグラムの作成
  const getBin = (value, bins) => Math.min(Math.floor(value * bins), bins - 1);
  
  // 結合確率分布を計算
  const jointCounts = Array(bins).fill().map(() => Array(bins).fill(0));
  const marginal1 = Array(bins).fill(0);
  const marginal2 = Array(bins).fill(0);
  
  for (let i = 0; i < norm1.length; i++) {
    const bin1 = getBin(norm1[i], bins);
    const bin2 = getBin(norm2[i], bins);
    jointCounts[bin1][bin2]++;
    marginal1[bin1]++;
    marginal2[bin2]++;
  }
  
  const n = norm1.length;
  let mutualInfo = 0;
  
  // 相互情報量の計算: MI(X,Y) = Σ p(x,y) * log(p(x,y) / (p(x) * p(y)))
  for (let i = 0; i < bins; i++) {
    for (let j = 0; j < bins; j++) {
      const jointProb = jointCounts[i][j] / n;
      const marginalProb1 = marginal1[i] / n;
      const marginalProb2 = marginal2[j] / n;
      
      if (jointProb > 0 && marginalProb1 > 0 && marginalProb2 > 0) {
        mutualInfo += jointProb * Math.log2(jointProb / (marginalProb1 * marginalProb2));
      }
    }
  }
  
  return mutualInfo;
}

/**
 * 複数時系列間の相互情報量マトリックスを計算
 * @param {Array} seriesArray - 時系列データの配列
 * @param {Number} bins - ヒストグラムのビン数（デフォルト10）
 * @returns {Array} - 相互情報量マトリックス
 */
function calculateMutualInformationMatrix(seriesArray, bins = 10) {
  if (!seriesArray || seriesArray.length < 1) {
    return [];
  }
  
  const n = seriesArray.length;
  const matrix = Array(n).fill().map(() => Array(n).fill(0));
  
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) {
        matrix[i][j] = 1; // 自分自身との相互情報量は最大値として1を設定
      } else {
        matrix[i][j] = calculateMutualInformation(seriesArray[i], seriesArray[j], bins);
      }
    }
  }
  
  return matrix;
}

/**
 * 価格変化率を計算
 * @param {Array} prices - 価格データの配列
 * @returns {Array} - 価格変化率の配列
 */
function calculateReturns(prices) {
  if (!prices || prices.length < 2) {
    return [];
  }
  
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    const returnValue = (prices[i] - prices[i - 1]) / prices[i - 1];
    returns.push(returnValue);
  }
  
  return returns;
}

/**
 * ATR（Average True Range）を計算
 * @param {Array} ohlcData - OHLC データの配列 [{high, low, close}, ...]
 * @param {Number} period - 期間（デフォルト14）
 * @returns {Array} - ATRの配列
 */
function calculateATR(ohlcData, period = 14) {
  if (!ohlcData || ohlcData.length < period + 1) {
    return [];
  }
  
  const trueRanges = [];
  const result = [];
  
  // True Range を計算
  for (let i = 1; i < ohlcData.length; i++) {
    const current = ohlcData[i];
    const previous = ohlcData[i - 1];
    
    // True Range = max(H-L, H-C_prev, C_prev-L)
    const highLow = current.high - current.low;
    const highClosePrev = Math.abs(current.high - previous.close);
    const lowClosePrev = Math.abs(current.low - previous.close);
    
    const trueRange = Math.max(highLow, highClosePrev, lowClosePrev);
    trueRanges.push(trueRange);
  }
  
  // 最初のperiod分はnullで埋める
  for (let i = 0; i < period; i++) {
    result.push(null);
  }
  
  // 最初のATRは単純平均
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += trueRanges[i];
  }
  let atr = sum / period;
  result.push(atr);
  
  // 以降はSmoothed Moving Average (Wilder's smoothing)
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
    result.push(atr);
  }
  
  return result;
}

/**
 * ボラティリティベースのポジションサイズを計算
 * @param {number} accountBalance - アカウント残高
 * @param {number} riskPerTrade - 1取引あたりのリスク (0.01 = 1%)
 * @param {number} atr - ATR値
 * @param {number} atrMultiplier - ATR乗数（デフォルト2）
 * @param {number} currentPrice - 現在価格
 * @returns {number} - 推奨ポジションサイズ
 */
function calculateVolatilityBasedPositionSize(accountBalance, riskPerTrade, atr, atrMultiplier = 2, currentPrice) {
  if (!accountBalance || !riskPerTrade || !atr || !currentPrice) {
    return 0;
  }
  
  // リスク金額を計算
  const riskAmount = accountBalance * riskPerTrade;
  
  // ATRベースのストップロス距離
  const stopLossDistance = atr * atrMultiplier;
  
  // ポジションサイズ = リスク金額 / ストップロス距離
  const positionSize = riskAmount / stopLossDistance;
  
  return positionSize;
}

/**
 * ADX（Average Directional Index）を計算
 * @param {Array} ohlcData - OHLC データの配列 [{high, low, close}, ...]
 * @param {Number} period - 期間（デフォルト14）
 * @returns {Object} - ADX、+DI、-DIの配列を含むオブジェクト
 */
function calculateADX(ohlcData, period = 14) {
  if (!ohlcData || ohlcData.length < period + 1) {
    return { adx: [], plusDI: [], minusDI: [] };
  }

  const result = {
    adx: [],
    plusDI: [],
    minusDI: []
  };

  // DM（Directional Movement）とTR（True Range）を計算
  const plusDMs = [];
  const minusDMs = [];
  const trueRanges = [];

  for (let i = 1; i < ohlcData.length; i++) {
    const current = ohlcData[i];
    const previous = ohlcData[i - 1];

    // +DM = High - High_prev (if positive and > Low_prev - Low)
    // -DM = Low_prev - Low (if positive and > High - High_prev)
    const highDiff = current.high - previous.high;
    const lowDiff = previous.low - current.low;

    let plusDM = 0;
    let minusDM = 0;

    if (highDiff > lowDiff && highDiff > 0) {
      plusDM = highDiff;
    }
    if (lowDiff > highDiff && lowDiff > 0) {
      minusDM = lowDiff;
    }

    plusDMs.push(plusDM);
    minusDMs.push(minusDM);

    // True Range = max(H-L, H-C_prev, C_prev-L)
    const highLow = current.high - current.low;
    const highClosePrev = Math.abs(current.high - previous.close);
    const lowClosePrev = Math.abs(current.low - previous.close);
    const trueRange = Math.max(highLow, highClosePrev, lowClosePrev);
    trueRanges.push(trueRange);
  }

  // Smoothed +DM, -DM, TR を計算
  const smoothedPlusDM = [];
  const smoothedMinusDM = [];
  const smoothedTR = [];

  // 最初のperiod分はnullで埋める
  for (let i = 0; i < period; i++) {
    result.plusDI.push(null);
    result.minusDI.push(null);
    result.adx.push(null);
  }

  // 初期値を計算（最初のperiodの平均）
  let sumPlusDM = 0;
  let sumMinusDM = 0;
  let sumTR = 0;

  for (let i = 0; i < period; i++) {
    sumPlusDM += plusDMs[i];
    sumMinusDM += minusDMs[i];
    sumTR += trueRanges[i];
  }

  smoothedPlusDM.push(sumPlusDM);
  smoothedMinusDM.push(sumMinusDM);
  smoothedTR.push(sumTR);

  // Wilder's smoothing を適用
  for (let i = period; i < plusDMs.length; i++) {
    const prevSmoothedPlusDM = smoothedPlusDM[smoothedPlusDM.length - 1];
    const prevSmoothedMinusDM = smoothedMinusDM[smoothedMinusDM.length - 1];
    const prevSmoothedTR = smoothedTR[smoothedTR.length - 1];

    smoothedPlusDM.push(prevSmoothedPlusDM - (prevSmoothedPlusDM / period) + plusDMs[i]);
    smoothedMinusDM.push(prevSmoothedMinusDM - (prevSmoothedMinusDM / period) + minusDMs[i]);
    smoothedTR.push(prevSmoothedTR - (prevSmoothedTR / period) + trueRanges[i]);
  }

  // +DI と -DI を計算
  const dxValues = [];

  for (let i = 0; i < smoothedPlusDM.length; i++) {
    if (smoothedTR[i] !== 0) {
      const plusDI = (smoothedPlusDM[i] / smoothedTR[i]) * 100;
      const minusDI = (smoothedMinusDM[i] / smoothedTR[i]) * 100;
      
      result.plusDI.push(plusDI);
      result.minusDI.push(minusDI);

      // DX = |+DI - -DI| / (+DI + -DI) * 100
      const diSum = plusDI + minusDI;
      if (diSum !== 0) {
        const dx = Math.abs(plusDI - minusDI) / diSum * 100;
        dxValues.push(dx);
      } else {
        dxValues.push(0);
      }
    } else {
      result.plusDI.push(0);
      result.minusDI.push(0);
      dxValues.push(0);
    }
  }

  // ADX を計算（DXの移動平均）
  // ADX計算用にperiod分null追加
  for (let i = 0; i < period - 1; i++) {
    result.adx.push(null);
  }

  // 最初のADXはDXの単純平均
  let sumDX = 0;
  for (let i = 0; i < period && i < dxValues.length; i++) {
    sumDX += dxValues[i];
  }
  let adx = sumDX / period;
  result.adx.push(adx);

  // 以降はSmoothed Moving Average
  for (let i = period; i < dxValues.length; i++) {
    adx = (adx * (period - 1) + dxValues[i]) / period;
    result.adx.push(adx);
  }

  return result;
}

module.exports = {
  calculateSMA,
  calculateEMA,
  calculateMACD,
  calculateRSI,
  calculateBollingerBands,
  calculateMutualInformation,
  calculateMutualInformationMatrix,
  calculateReturns,
  calculateATR,
  calculateVolatilityBasedPositionSize,
  calculateADX
};
