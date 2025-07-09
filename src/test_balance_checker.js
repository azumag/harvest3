/**
 * 残高チェッカーのテスト用スクリプト
 */
const { checkAllExchangeBalances } = require('./common/balanceChecker');

async function testBalanceChecker() {
  try {
    console.log('残高チェッカーテスト開始...');

    const results = await checkAllExchangeBalances();

    console.log('テスト結果:', JSON.stringify(results, null, 2));
    console.log('残高チェッカーテスト完了');

  } catch (error) {
    console.error('テストエラー:', error.message);
    console.error('スタックトレース:', error.stack);
  } finally {
    process.exit(0);
  }
}

testBalanceChecker();