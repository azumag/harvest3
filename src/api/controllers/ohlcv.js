const { config } = require('../../config');
const ccxt = require('ccxt'); // ccxtをインポート

/**
 * ローソク足データを取得するコントローラー
 * @param {Object} req - Expressリクエストオブジェクト
 * @param {Object} res - Expressレスポンスオブジェクト
 */
async function getOhlcv(req, res) {
  const { exchange, symbol, interval, limit, startTime, endTime } = req.query;
  console.log(`[API /ohlcv] Request received:`, req.query); // リクエストログ追加

  try {
    if (!exchange || !symbol || !interval) {
      console.error('[API /ohlcv] Bad Request: Missing required parameters');
      return res.status(400).json({ error: 'exchange, symbol, and interval are required' });
    }

    const exchangeConfig = config.exchanges[exchange];
    if (!exchangeConfig) {
      console.error(`[API /ohlcv] Bad Request: Exchange "${exchange}" not found in config`);
      return res.status(400).json({ error: `Exchange "${exchange}" not found in config` });
    }

    // ccxtでサポートされている取引所か確認
    if (!ccxt.exchanges.includes(exchange)) {
      console.warn(`[API /ohlcv] Exchange "${exchange}" is not a valid ccxt exchange, but it is defined in config.js. Proceeding with caution.`);
      //return res.status(400).json({ error: `Exchange "${exchange}" is not supported by ccxt` });
    }

    // ccxtを使って取引所インスタンスを生成
    const exchangeClass = ccxt[exchange];
    if (!exchangeClass) {
        console.error(`[API /ohlcv] Internal Server Error: ccxt does not support exchange "${exchange}"`);
        return res.status(500).json({ error: `ccxt does not support exchange "${exchange}"` });
    }
    const exchangeInstance = new exchangeClass({
        apiKey: exchangeConfig.apiKey,
        secret: exchangeConfig.secret,
        // 必要に応じて他の設定を追加
    });

    // fetchOHLCVをサポートしているか確認
    if (!exchangeInstance.has['fetchOHLCV']) {
      console.warn(`[API /ohlcv] Exchange "${exchange}" does not support fetchOHLCV. Returning empty array.`);
      return res.json([]); // サポートしていない場合は空配列を返す
    }

    // startTime と endTime が指定されていればミリ秒単位の数値に変換
    const startTimeMs = startTime ? parseInt(startTime, 10) : undefined;
    const endTimeMs = endTime ? parseInt(endTime, 10) : undefined; // endTimeMsはccxt標準では使わないことが多い
    const limitInt = limit === '' ? undefined : parseInt(limit, 10);

    console.log(`[API /ohlcv] Fetching OHLCV for ${exchange} ${symbol} ${interval} limit=${limitInt} startTime=${startTimeMs}`); // endTimeMsを除去
    // OHLCVデータを取得
    console.log(`[API /ohlcv] Calling fetchOHLCV with symbol=${symbol}, interval=${interval}, startTime=${startTimeMs}, limit=${limitInt}`);
    const ohlcv = await exchangeInstance.fetchOHLCV(symbol, interval, startTimeMs, limitInt); // endTimeMsを除去

    console.log(`[API /ohlcv] fetchOHLCV returned:`, ohlcv);
    console.log(`[API /ohlcv] Successfully fetched ${ohlcv.length} OHLCV data points.`);
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