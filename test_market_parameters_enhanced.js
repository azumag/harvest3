const { 
  getMarketParametersByExchangeSymbol,
  getMarketParameters
} = require('./src/database/manager');
const { config } = require('./src/config');

/**
 * 改善されたmarketParametersエラーハンドリングのテスト
 */
async function testEnhancedErrorHandling() {
  console.log('=== 改善されたmarketParametersエラーハンドリングテスト ===\n');
  
  // Test 1: APE/JPY (サポート済みペア)
  console.log('Test 1: APE/JPY (サポート済みペア)');
  try {
    const symbolByExchange = {
      bitbank: ['APE/JPY']
    };
    
    const result = await getMarketParametersByExchangeSymbol(symbolByExchange, config);
    console.log('APE/JPY 結果:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('APE/JPY テストエラー:', error.message);
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Test 2: 未対応ペア
  console.log('Test 2: 未対応通貨ペア (TEST/JPY)');
  try {
    const symbolByExchange = {
      bitbank: ['TEST/JPY']
    };
    
    const result = await getMarketParametersByExchangeSymbol(symbolByExchange, config);
    console.log('TEST/JPY 結果:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('TEST/JPY テストエラー:', error.message);
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Test 3: 混在ケース
  console.log('Test 3: 混在ケース (APE/JPY, TEST/JPY, BTC/JPY)');
  try {
    const symbolByExchange = {
      bitbank: ['APE/JPY', 'TEST/JPY', 'BTC/JPY']
    };
    
    const result = await getMarketParametersByExchangeSymbol(symbolByExchange, config);
    console.log('混在ケース結果:', JSON.stringify(result, null, 2));
    
    // 結果のサマリー
    if (result && result.bitbank) {
      const symbols = Object.keys(result.bitbank);
      console.log('\n処理サマリー:');
      symbols.forEach(symbol => {
        const params = result.bitbank[symbol];
        console.log(`  ${symbol}: ${params.success ? '成功' : 'エラー'} ${params.errorType ? `(${params.errorType})` : ''}`);
      });
    }
    
  } catch (error) {
    console.error('混在ケーステストエラー:', error.message);
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Test 4: 直接getMarketParameters関数のテスト
  console.log('Test 4: 直接getMarketParameters関数のテスト');
  
  try {
    console.log('4-1: APE/JPY (正常ケース)');
    const apeResult = await getMarketParameters(config.exchanges.bitbank.instance, 'APE/JPY');
    console.log('APE/JPY 直接取得結果:', apeResult);
    
    console.log('\n4-2: TEST/JPY (エラーケース)');
    const testResult = await getMarketParameters(config.exchanges.bitbank.instance, 'TEST/JPY');
    console.log('TEST/JPY 直接取得結果:', testResult);
    
  } catch (error) {
    console.error('直接テストエラー:', error.message);
  }
}

// テスト実行
if (require.main === module) {
  testEnhancedErrorHandling()
    .then(() => {
      console.log('\n=== テスト完了 ===');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n=== テスト中にエラーが発生しました ===');
      console.error(error);
      process.exit(1);
    });
}

module.exports = {
  testEnhancedErrorHandling
};