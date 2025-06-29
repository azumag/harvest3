const { getPositionRedis, getAllPositionsRedis } = require('./src/database/redisDatabase.js');

async function debugPosition() {
  console.log('=== ポジション調査開始 ===');
  
  // 失敗しているオーダーID の調査
  const orderIds = ['47265543952', '47265488202', '47265343794'];
  
  for (const orderId of orderIds) {
    console.log('--- Order ID: ' + orderId + ' ---');
    
    // 可能性のあるposition keyを試す
    const strategies = ['MULTI_INDICATOR', 'OSCILLATOR', 'RSI', 'OUTSIDE'];
    const exchanges = ['bitbank'];
    const symbols = ['BTC/JPY', 'SOL/JPY', 'MKR/JPY', 'ASTR/JPY'];
    
    let found = false;
    for (const exchange of exchanges) {
      for (const symbol of symbols) {
        for (const strategy of strategies) {
          const key = exchange + ':' + symbol + ':' + strategy + ':' + orderId;
          try {
            const position = await getPositionRedis(key);
            if (position) {
              console.log('✅ Found position: ' + key);
              console.log('   Status: ' + position.status);
              console.log('   Amount: ' + position.amount);
              found = true;
            }
          } catch (e) {
            // Ignore errors
          }
        }
      }
    }
    
    if (!found) {
      console.log('❌ Position not found for any key combination');
    }
  }
  
  // 全ポジション一覧表示
  console.log('\n=== 全ポジション一覧 ===');
  try {
    const allPositions = await getAllPositionsRedis();
    console.log('Total positions: ' + Object.keys(allPositions).length);
    
    Object.entries(allPositions).slice(0, 10).forEach(([key, position]) => {
      console.log('Key: ' + key + ', Status: ' + position.status + ', Symbol: ' + position.symbol);
    });
  } catch (e) {
    console.error('Failed to get all positions:', e.message);
  }
}

debugPosition().catch(console.error);