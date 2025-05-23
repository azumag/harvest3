/**
 * clearPositionMarket関数の修正テスト
 */
const { exchangeBB } = require('../src/config');
const { clearPositionMarket } = require('../src/strategies/utils/common');

async function testClearPositionMarket() {
  // 有効な通貨ペア（DOT/JPY）と無効な通貨ペア（BNB/JPY）でテスト
  const validSymbol = 'BTC/JPY'; 
  const invalidSymbol = 'BNB/JPY';
  
  console.log('修正されたclearPositionMarket関数のテスト');
  console.log('='.repeat(50));

  try {
    // 有効なシンボルでのテスト
    console.log(`有効なシンボル ${validSymbol} でテスト中...`);
    const result1 = await clearPositionMarket(exchangeBB, validSymbol, 'TEST_STRATEGY');
    console.log('結果:', result1);
  } catch (error) {
    console.error(`有効なシンボルテストでエラー: ${error.message}`);
  }

  try {
    // 無効なシンボルでのテスト
    console.log(`\n無効なシンボル ${invalidSymbol} でテスト中...`);
    const result2 = await clearPositionMarket(exchangeBB, invalidSymbol, 'TEST_STRATEGY');
    console.log('結果:', result2);
  } catch (error) {
    console.error(`無効なシンボルテストでエラー: ${error.message}`);
  }
}

// テスト実行
testClearPositionMarket();