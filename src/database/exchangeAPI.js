const https = require('https');
const { postErrorToDiscord } = require('../common/notifications');
const { recordError } = require('../api/controllers/errorStats');

// Bitbank API関連の定数
const BITBANK_PUBLIC_API_URL = 'https://public.bitbank.cc';

// ccxtのtimeframeとbitbankのcandle-typeのマッピング
const TIMEFRAME_TO_CANDLE_TYPE = {
  '1h': '1hour',
  '4h': '4hour',
  '8h': '8hour',
  '12h': '12hour',
  '1d': '1day',
  '1w': '1week',
  '1M': '1month' // ccxtでは1Mと表記されることがある
}

/**
 * API制限のための待機処理
 * Bitbank API制限: 取得系 10回/秒、更新系 6回/秒
 * @param {Number} waitTime - 待機時間（ミリ秒）
 * @returns {Promise<void>}
 */
async function waitForAPILimit(waitTime = 100) {
  return new Promise(resolve => setTimeout(resolve, waitTime));
}

// Bitbankの専用APIを呼び出す関数
async function fetchBitbankOHLCV(pair, candleType, year, limit) {
  const options = {
    hostname: 'public.bitbank.cc',
    path: `/${pair}/candlestick/${candleType}/${year}?limit=${limit}`,
    method: 'GET'
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.success && parsed.data && parsed.data.candlestick) {
            resolve(parsed.data.candlestick[0].ohlcv);
          } else {
            reject(new Error(`Invalid response from Bitbank API: ${data}`));
          }
        } catch (error) {
          reject(error);
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.end();
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
  const currentYear = new Date().getFullYear();
  const allData = [];
  
  console.log(`[Bitbank API] 複数年データ取得開始: ${pair} ${candleType} ${limit}件`);
  
  // 必要な年数を計算（1年で最大約8760時間）
  const yearsNeeded = Math.ceil(limit / 8760) + 1;
  
  for (let i = 0; i < yearsNeeded && allData.length < limit; i++) {
    const year = currentYear - i;
    try {
      console.log(`[Bitbank API] ${year}年のデータ取得中...`);
      const yearData = await fetchBitbankOHLCV(pair, candleType, year, limit - allData.length);
      
      // データを新しい順から古い順に結合
      allData.push(...yearData);
      
      // API制限対策: Bitbank制限 10回/秒 = 100ms間隔
      await waitForAPILimit(150);
    } catch (error) {
      console.error(`[Bitbank API] ${year}年のデータ取得エラー:`, error.message);
      if (i === 0) {
        // 最新年でエラーの場合は中断
        throw error;
      }
      // 過去年のエラーは無視して続行
      break;
    }
  }
  
  // 必要な件数だけ返す（最新のデータから）
  const result = allData.slice(0, limit);
  console.log(`[Bitbank API] データ取得完了: ${result.length}件`);
  
  return result;
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
  console.log(`[標準API] fetchStandardHistoricalOHLCVData開始: ${exchange.id} ${symbol} ${timeframe} ${limit}`);
  
  try {
    console.log(`[標準API] ${exchange.id}のCCXT標準APIを使用`);
    
    // 標準CCXT API呼び出し
    const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
    console.log(`[標準API] データ取得完了: ${ohlcv.length}件`);
    
    return ohlcv;
  } catch (error) {
    const errorMessage = `fetchStandardHistoricalOHLCVDataエラー (${symbol} ${timeframe}): ${error.message}`;
    console.error(errorMessage, error);
    recordError(exchange.id, 'fetchOHLCV', error.message);
    postErrorToDiscord(errorMessage).catch(console.error);
    return [];
  }
}

/**
 * OHLCVデータ取得の共通関数
 * @param {Object} exchange - ccxtの取引所オブジェクト
 * @param {String} symbol - 通貨ペア
 * @param {String} timeframe - 例: '15m'
 * @param {Number} limit - データ数
 * @returns {Promise<Array>} OHLCV配列
 */
async function fetchOHLCVDataAPI(exchange, symbol, timeframe = '15m', limit = 100) {
  console.log(`[BACKTEST] fetchOHLCVDataAPI呼び出し: ${exchange.id} ${symbol} ${timeframe} ${limit}`);
  
  // Bitbankの特定のtimeframeの場合は専用APIを使用（エラー時は標準APIにフォールバック）
  if (exchange.id === 'bitbank' && TIMEFRAME_TO_CANDLE_TYPE[timeframe]) {
    try {
      console.log('[BACKTEST] Bitbank専用API使用');
      // シンボルをBitbank APIで使用する形式に変換（BTC/JPY → btc_jpy）
      const pair = symbol.toLowerCase().replace('/', '_');
      const candleType = TIMEFRAME_TO_CANDLE_TYPE[timeframe];
      
      return await fetchBitbankHistoricalOHLCVData(pair, candleType, limit);
    } catch (error) {
      console.log('[BACKTEST] Bitbank専用APIエラー、標準APIにフォールバック:', error.message);
      return await fetchStandardHistoricalOHLCVData(exchange, symbol, timeframe, limit);
    }
  } 
  // それ以外のケースは標準実装を使用
  else {
    console.log('[BACKTEST] 標準API使用');
    return await fetchStandardHistoricalOHLCVData(exchange, symbol, timeframe, limit);
  }
}

module.exports = {
  fetchOHLCVDataAPI,
};