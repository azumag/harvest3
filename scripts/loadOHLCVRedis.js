const { config } = require('../src/config');
const { getSymbolsByExchange, getStrategyConfig, getMarketParametersByExchangeSymbol } = require('../src/database/manager');
const { backtestCreateLimitSellOrder,
  saveStrategyParameters,
  getStrategyParameters,
  initializeDB,
  fetchHistoricalOHLCVData,
  fetchOHLCVData,
  loadHistoricalOHLCVToBacktestRedis,
  fetchBacktestOHLCVData
} = require('../src/database/manager');

const { getBacktestOHLCVRedisBeforeTimestamp } = require('../src/database/redisDatabase');

const { OHLCVTimeFrames } = require('../src/common/const');

/**
 * タイムフレームと日数からlimitを計算する関数
 * @param {string} timeframe - タイムフレーム ('1m', '5m', '15m', '30m', '1h', '4h', '8h', '12h', '1d', '1w')
 * @param {number} days - 取得したい日数
 * @returns {number} 指定されたタイムフレームと日数に対応するlimit値
 */
function calculateLimit(timeframe, days) {
  switch (timeframe) {
  case '1m': return days * 24 * 60;     // 1日 = 1440ポイント
  case '5m': return days * 24 * 12;     // 1日 = 288ポイント
  case '15m': return days * 24 * 4;     // 1日 = 96ポイント
  case '30m': return days * 24 * 2;     // 1日 = 48ポイント
  case '1h': return days * 24;          // 1日 = 24ポイント
  case '4h': return days * 6;           // 1日 = 6ポイント
  case '8h': return days * 3;           // 1日 = 3ポイント
  case '12h': return days * 2;          // 1日 = 2ポイント
  case '1d': return days;               // 1日 = 1ポイント
  case '1w':
    // 週単位の場合、日数を7で割って切り上げ
    return Math.ceil(days / 7);
  default:
    console.warn(`未知のタイムフレーム: ${timeframe}`);
    return 0;
  }
}


async function main() {
  initializeDB();
  const exchangeInstance = config.exchanges.bitbank.instance;
  // const symbol = 'QTUM/JPY';
  const symbol = 'BTC/JPY';
  const days = 7; // 取得したい日数
  for (const timeframe of OHLCVTimeFrames) {
    // バックテストに必要なローソク足の本数を計算する
    const limit = calculateLimit(timeframe, days) + 200;
    await loadHistoricalOHLCVToBacktestRedis(exchangeInstance, symbol, timeframe, limit);
  }

  // await fetchHistoricalOHLCVData(exchangeInstance.id, symbol, '1m', 10280);
  // const a = await getBacktestOHLCVRedisBeforeTimestamp(exchangeInstance.id, symbol, '1m', Date.now(), 100);

}

main().catch(console.error).finally(() => {
  console.log('スクリプトが完了しました。');
  process.exit(0);
});