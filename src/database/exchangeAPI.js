const https = require('https');

// Bitbank API関連の定数
const BITBANK_PUBLIC_API_URL = 'https://public.bitbank.cc';

// ccxtのtimeframeとbitbankのcandle-typeのマッピング
const TIMEFRAME_TO_CANDLE_TYPE = {
  '4h': '4hour',
  '8h': '8hour',
  '12h': '12hour',
  '1d': '1day',
  '1w': '1week',
  '1M': '1month' // ccxtでは1Mと表記されることがある
}

/**
 * API制限のための待機処理
 * @param {Number} waitTime - 待機時間（ミリ秒）
 * @returns {Promise<void>}
 */
async function waitForAPILimit(waitTime = 200) {
  return new Promise(resolve => setTimeout(resolve, waitTime));
}

// Bitbankの専用APIを呼び出す関数
async function fetchBitbankOHLCV(pair, candleType, year, limit) {
  return new Promise((resolve, reject) => {
    const url = `${BITBANK_PUBLIC_API_URL}/${pair}/candlestick/${candleType}/${year}`;
    
    https.get(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.success === 1) {
            // BitbankのOHLCVデータをccxtの形式に変換
            const candles = response.data.candlestick[0].ohlcv.map(candle => [
              new Date(candle[5]).getTime(), // timestamp
              parseFloat(candle[0]),         // open
              parseFloat(candle[1]),         // high
              parseFloat(candle[2]),         // low
              parseFloat(candle[3]),         // close
              parseFloat(candle[4])          // volume
            ]);
            resolve(candles);
          } else {
            reject(new Error(`Bitbank API error: ${response.data.code}`));
          }
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Bitbank専用の複数年にわたるOHLCVデータ取得
 * @param {String} pair - 通貨ペア（bitbank形式: btc_jpy）
 * @param {String} candleType - ローソク足タイプ
 * @param {Number} limit - 取得データ数
 * @returns {Promise<Array>} - OHLCV配列
 */
async function fetchBitbankHistoricalOHLCVData(pair, candleType, limit) {
  const now = new Date();
  let currentYear = now.getFullYear().toString();
  
  // 現在の年からデータを取得
  let allData = [];
  try {
    const yearData = await fetchBitbankOHLCV(pair, candleType, currentYear, limit);
    allData = [...yearData];
  } catch (error) {
    console.error(`Bitbank APIエラー (${pair} ${candleType} ${currentYear}):`, error);
  }
  
  // limitに達するまで前の年のデータを取得
  let year = parseInt(currentYear);
  while (allData.length < limit && year > 2015) { // 2015年より前のデータは取得しない
    year--;
    const prevYear = year.toString();
    
    try {
      const prevYearData = await fetchBitbankOHLCV(pair, candleType, prevYear, limit - allData.length);
      
      // データが取得できなかった場合はループ終了
      if (prevYearData.length === 0) {
        console.log(`Bitbank API: これ以上の過去データが取得できません: ${pair} ${candleType}`);
        break;
      }
      
      // 新しいデータを時系列順に結合
      allData = [...prevYearData, ...allData];
      console.log(`Bitbank API: ${prevYear}年のデータを取得: ${pair} ${candleType} ${allData.length}`);
      
      // API制限を考慮して少し待機
      await waitForAPILimit();
    } catch (error) {
      console.error(`Bitbank APIエラー (${pair} ${candleType} ${prevYear}):`, error);
      break;
    }
  }
  
  // 必要なデータ数を超える場合は、新しいデータを優先して上限まで返す
  return allData.slice(-limit);
}

/**
 * 標準的な取引所からのOHLCVデータ取得
 * @param {Object} exchange - ccxtの取引所オブジェクト
 * @param {String} symbol - 通貨ペア
 * @param {String} timeframe - 時間枠
 * @param {Number} limit - 取得データ数
 * @returns {Promise<Array>} - OHLCV配列
 */
async function fetchStandardHistoricalOHLCVData(exchange, symbol, timeframe, limit) {
  // TODO: ここも bitbank 専用になっているので汎用化する
  // 1日のデータを取得ようになっている他、sinceなどの指定方法も違うので

  const now = new Date();
  const hour = now.getHours();
  let targetDate = new Date(now);
  
  // 現在時刻が9時より前なら前日の日付を設定
  if (hour < 9) {
    targetDate.setDate(targetDate.getDate() - 1);
  }
  
  // targetDateを当日の0:00に設定
  targetDate.setHours(0, 0, 0, 0);
  let since = targetDate.getTime();
  
  // まず現在の日付でデータを取得
  let ohlcv = await exchange.fetchOHLCV(symbol, timeframe, since, limit);
  let allData = [...ohlcv];
  let remainingLimit = limit - allData.length;
  
  // limitに達するまで過去に遡ってデータを取得
  while (remainingLimit > 0) {
    // 前日の日付に設定
    targetDate.setDate(targetDate.getDate() - 1);
    since = targetDate.getTime();
    
    // 残りの必要データ数分を取得
    const prevData = await exchange.fetchOHLCV(symbol, timeframe, since, remainingLimit);
    
    // データが取得できなかった場合はループ終了
    if (prevData.length === 0) {
      console.log(`fetchOHLCVData: これ以上の過去データが取得できません: ${symbol} ${timeframe}`);
      break;
    }
    
    console.log(`fetchOHLCVData: ${targetDate.toISOString().split('T')[0]}のデータを取得: ${symbol} ${timeframe} ${prevData.length}件`);
    
    // 新しいデータを先頭に追加
    allData = prevData.concat(allData);
    
    // 残りの必要データ数を更新
    remainingLimit = limit - allData.length;
    
    // API制限を考慮して少し待機
    await waitForAPILimit();
  }
  
  // 必要なデータ数を超える場合は、新しいデータを優先して上限まで返す
  return allData.slice(-limit);
}

/**
 * OHLCVデータ取得の共通関数
 * @param {Object} exchange - ccxtの取引所オブジェクト
 * @param {String} symbol - 通貨ペア
 * @param {String} timeframe - 例: '15m'
 * @param {Number} limit - データ数
 * @returns {Promise<Array>} OHLCV配列
 */
async function fetchOHLCVData(exchange, symbol, timeframe = '15m', limit = 100) {
  // Bitbankの特定のtimeframeの場合は専用APIを使用
  if (exchange.id === 'bitbank' && TIMEFRAME_TO_CANDLE_TYPE[timeframe]) {
    // シンボルをBitbank APIで使用する形式に変換（BTC/JPY → btc_jpy）
    const pair = symbol.toLowerCase().replace('/', '_');
    const candleType = TIMEFRAME_TO_CANDLE_TYPE[timeframe];
    
    return await fetchBitbankHistoricalOHLCVData(pair, candleType, limit);
  } 
  // それ以外のケースは標準実装を使用
  else {
    return await fetchStandardHistoricalOHLCVData(exchange, symbol, timeframe, limit);
  }
}

module.exports = {
  fetchOHLCVData,
};