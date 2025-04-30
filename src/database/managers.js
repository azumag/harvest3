const { fetchOHLCVData: fetchHistoricalOHLCVData } = require('./mongoDatabase');

async function fetchOHLCVData(exchange, symbol, timeframe, limit, options = {}) {
  try {
    // バックテストモードの場合
    if (options.backtest) {
      const timestamp = options.backtest.timestamp;
      // mongoDBから過去データを取得
      const historicalData = await fetchHistoricalOHLCVData(exchange.id, symbol, timeframe, limit, timestamp);
      
      // 取得したデータをCCXTフォーマットに変換して返す
      // CCXTフォーマット: [timestamp, open, high, low, close, volume]
      return historicalData.map(candle => {
        return [
          candle.timestamp,
          candle.open,
          candle.high,
          candle.low,
          candle.close,
          candle.volume
        ];
      });
    }
    
    // 通常モード（リアルタイムデータ取得）
    return await exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
  } catch (error) {
    console.error(`Error fetching OHLCV data: ${error.message}`);
    throw error;
  }
}

module.exports = {
  fetchOHLCVData,
};