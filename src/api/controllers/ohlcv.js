const { config } = require('../../config');
const ccxt = require('ccxt'); // ccxtをインポート
const { fetchOHLCVData } = require('../../database/manager');

/**
 * ローソク足データを取得するコントローラー
 * @param {Object} req - Expressリクエストオブジェクト
 * @param {Object} res - Expressレスポンスオブジェクト
 */
async function getOhlcv(req, res) {
  const { exchange, symbol, timeframe, limit} = req.query;
  console.log(`[API /ohlcv] Request received:`, req.query); // リクエストログ追加

  try {
    if (!exchange || !symbol || !timeframe || !limit) {
      console.error('[API /ohlcv] Bad Request: Missing required parameters');
      return res.status(400).json({ error: 'exchange, symbol, and interval are required' });
    }

    const exchangeInstance = config.exchanges[exchange].instance;

    const ohlcv = await fetchOHLCVData(exchangeInstance, symbol, timeframe, limit);
   
    // 取得したOHLCVデータをJSONで返す
    res.json(ohlcv);
  } catch (error) {
    console.error(`[API /ohlcv] Error processing request for ${exchange} ${symbol}:`, error); // エラーログ強化
    // エラーオブジェクト全体をログに出力
    console.error(`[API /ohlcv] Full error object:`, error);
    if (error instanceof ccxt.BadSymbol) {
      return res.status(400).json({ error: `Invalid symbol: ${symbol} for exchange: ${exchange}` });
    }
    res.status(500).json({ error: error.message, stack: error.stack }); // スタックトレースも返す
  }
}

module.exports = {
  getOhlcv
};