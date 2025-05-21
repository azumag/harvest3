/**
 * closeMarketStrategies.js のテスト用スクリプト
 */

const { deleteStrategyParametersRedis, saveStrategyParametersRedis, getAllStrategyParametersRedis, initialize } = require('../src/database/redisDatabase');

/**
 * テスト用のMARKET戦略パラメータを作成する関数
 */
async function createTestMarketStrategyParameters() {
  // Redis初期化
  await initialize();
  
  // テスト用のパラメータを作成
  const testParams = {
    enabled: true,
    period: 30,
    amount: 0.01,
    testParam: 'test value'
  };
  
  // テスト用のMARKET戦略パラメータを保存
  await saveStrategyParametersRedis('bitbank', 'BTC/JPY', 'TEST_MARKET', testParams);
  await saveStrategyParametersRedis('bitbank', 'ETH/JPY', 'ANOTHER_MARKET', testParams);
  await saveStrategyParametersRedis('bitflyer', 'BTC/JPY', 'THIRD_MARKET', testParams);
  
  // 比較用の通常戦略パラメータも保存
  await saveStrategyParametersRedis('bitbank', 'BTC/JPY', 'NORMAL_STRATEGY', testParams);
  
  console.log('テスト用の戦略パラメータを作成しました');
  
  // すべての戦略パラメータを取得して表示
  const allParams = await getAllStrategyParametersRedis();
  console.log('現在の戦略パラメータ:');
  for (const key in allParams) {
    console.log(`- ${key}`);
  }
}

/**
 * パラメータのクリーンアップ関数
 */
async function cleanupTestParameters() {
  await deleteStrategyParametersRedis('bitbank', 'BTC/JPY', 'TEST_MARKET');
  await deleteStrategyParametersRedis('bitbank', 'ETH/JPY', 'ANOTHER_MARKET');
  await deleteStrategyParametersRedis('bitflyer', 'BTC/JPY', 'THIRD_MARKET');
  await deleteStrategyParametersRedis('bitbank', 'BTC/JPY', 'NORMAL_STRATEGY');
  
  console.log('テスト用のパラメータをクリーンアップしました');
}

// メイン処理
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--create')) {
    await createTestMarketStrategyParameters();
  } else if (args.includes('--cleanup')) {
    await cleanupTestParameters();
  } else {
    console.log('使用方法: node testCloseMarketStrategies.js [オプション]');
    console.log('オプション:');
    console.log('  --create   テスト用のMARKET戦略パラメータを作成');
    console.log('  --cleanup  テスト用のパラメータをクリーンアップ');
  }
  
  process.exit(0);
}

main().catch(error => {
  console.error('テスト中にエラーが発生しました:', error);
  process.exit(1);
});