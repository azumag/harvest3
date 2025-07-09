const { fetchOHLCVDataAPI } = require('../src/database/exchangeAPI');
const { config } = require('../src/config');

/**
 * Bitbank APIエラーのDiscord通知テスト
 */
async function testBitbankErrorNotification() {
  console.log('=== Bitbank API Error Discord Notification Test ===');

  try {
    const exchange = config.exchanges.bitbank.instance;

    // 存在しない通貨ペアでエラーを発生させる
    console.log('存在しない通貨ペアでAPIエラーを発生させます...');
    const result = await fetchOHLCVDataAPI(exchange, 'INVALID/PAIR', '15m', 10);
    console.log('結果:', result);

  } catch (error) {
    console.log('期待通りエラーが発生しました:', error.message);
  }

  try {
    // 無効なtimeframeでエラーを発生させる
    console.log('\\n無効なtimeframeでAPIエラーを発生させます...');
    const result = await fetchOHLCVDataAPI(
      config.exchanges.bitbank.instance,
      'BTC/JPY',
      'invalid_timeframe',
      10
    );
    console.log('結果:', result);

  } catch (error) {
    console.log('期待通りエラーが発生しました:', error.message);
  }

  console.log('\\nテスト完了: Discord通知が送信されたかチェックしてください');
}

// テスト実行
if (require.main === module) {
  testBitbankErrorNotification();
}

module.exports = { testBitbankErrorNotification };