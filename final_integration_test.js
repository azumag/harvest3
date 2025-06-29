const { getMarketParameters } = require('./src/database/manager');
const { config } = require('./src/config');

async function finalIntegrationTest() {
  console.log('🚀 APE/JPY 最終統合テスト\n');
  
  const result = await getMarketParameters(config.exchanges.bitbank.instance, 'APE/JPY');
  
  if (result && !result.error) {
    console.log('✅ APE/JPY は正常に処理されます');
    console.log('パラメータ:', result);
    return true;
  } else {
    console.log('❌ APE/JPY の処理でエラー:', result);
    return false;
  }
}

if (require.main === module) {
  finalIntegrationTest()
    .then(success => {
      console.log(`\n統合テスト結果: ${success ? '成功' : '失敗'}`);
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('統合テストエラー:', error);
      process.exit(1);
    });
}