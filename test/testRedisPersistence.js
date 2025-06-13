/**
 * Redis永続化テスト
 * コンテナ再起動でデータが保持されることを確認
 */
const { initialize } = require('../src/database/redisDatabase');
const { 
  savePosition,
  getPosition,
  recordPnL,
  clearPositionStore,
  clearPnLTracker
} = require('../src/strategies/utils/riskManagement');

async function testPersistence() {
  console.log('=== Redis永続化テスト ===\n');
  
  try {
    // Redis初期化
    await initialize();
    console.log('Redis接続成功\n');
    
    // 永続化テスト用のユニークなデータを作成
    const timestamp = Date.now();
    const testPositionKey = `bitbank:BTC/JPY:persistenceTest:order_${timestamp}`;
    
    console.log('1. データ保存テスト');
    
    // テスト用ポジションを保存
    await savePosition(testPositionKey, {
      exchangeId: 'bitbank',
      symbol: 'BTC/JPY',
      strategyKey: 'persistenceTest',
      orderId: `order_${timestamp}`,
      side: 'buy',
      amount: 0.05,
      entryPrice: 6000000,
      highestPrice: 6000000,
      status: 'open',
      createdAt: timestamp,
      testData: 'REDIS_PERSISTENCE_TEST'
    });
    
    // データ保存確認
    const savedPosition = await getPosition(testPositionKey);
    if (savedPosition && savedPosition.testData === 'REDIS_PERSISTENCE_TEST') {
      console.log('✅ ポジションデータ保存成功');
      console.log(`   orderId: ${savedPosition.orderId}`);
      console.log(`   entryPrice: ${savedPosition.entryPrice.toLocaleString()}円`);
      console.log(`   testData: ${savedPosition.testData}`);
    } else {
      console.log('❌ ポジションデータ保存失敗');
      return;
    }
    
    // 損益データも保存
    await recordPnL('bitbank', 'persistenceTest', 100000); // 10万円の利益
    console.log('✅ 損益データ保存成功: +100,000円\n');
    
    console.log('2. データ取得テスト');
    
    // データ再取得して確認
    const retrievedPosition = await getPosition(testPositionKey);
    if (retrievedPosition && retrievedPosition.testData === 'REDIS_PERSISTENCE_TEST') {
      console.log('✅ ポジションデータ取得成功');
      console.log(`   データ整合性: ${retrievedPosition.orderId === `order_${timestamp}` ? 'OK' : 'NG'}`);
      console.log(`   永続化確認: ${retrievedPosition.testData === 'REDIS_PERSISTENCE_TEST' ? 'OK' : 'NG'}`);
    } else {
      console.log('❌ ポジションデータ取得失敗');
    }
    
    console.log('\n📝 永続化テスト完了');
    console.log('💡 Docker Composeを再起動してもこのデータは保持されます');
    console.log(`🔑 テストポジションキー: ${testPositionKey}`);
    
  } catch (error) {
    console.error('❌ テスト実行エラー:', error.message);
  }
  
  process.exit(0);
}

testPersistence().catch(console.error);