

const ccxt = require('ccxt');
const { fetchOHLCVDataAPI } = require('../src/database/exchangeAPI');

async function testCyberJpyFetch() {
  const exchangeId = 'bitbank';
  const symbol = 'CYBER/JPY';
  const timeframe = '1h';
  const limit = 100;

  const exchange = new ccxt[exchangeId]();

  console.log(`テスト開始: ${exchangeId} - ${symbol} - ${timeframe}`);

  try {
    // 1. CCXT標準のfetchOHLCVでの取得
    console.log('\n1. CCXT標準のfetchOHLCVでの取得:');
    const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, undefined, 5);
    console.log('CCXT標準APIでの取得成功:', ohlcv.slice(-1)[0]);
  } catch (error) {
    console.error('CCXT標準APIでの取得エラー:', error.message);
  }

  try {
    // 2. fetchOHLCVDataAPI（内部API）での取得
    console.log('\n2. fetchOHLCVDataAPI (内部API) での取得:');
    const apiData = await fetchOHLCVDataAPI(exchange, symbol, timeframe, limit);
    if (apiData && apiData.length > 0) {
      console.log('fetchOHLCVDataAPIでの取得成功:', apiData.length, '件');
      console.log('最新のデータ:', apiData.slice(-1)[0]);
    } else {
      console.log('fetchOHLCVDataAPIでデータは取得できませんでしたが、エラーは発生しませんでした。');
    }
  } catch (error) {
    console.error('fetchOHLCVDataAPIでの取得エラー:', error.message);
    if (error.message.includes('10000')) {
        console.log('エラーコード10000を検出しました。これは、指定されたペアや期間のデータが存在しないことを示唆しています。');
    }
  }
}

testCyberJpyFetch();
