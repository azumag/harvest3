const { initRedisClient } = require('../src/database/redisClient');
const { getStrategyPositionsRedis } = require('../src/database/redisDatabase');
const { config } = require('../src/config');

async function checkPositionVsOrders() {
  try {
    await initRedisClient();
    console.log('=== ポジションと売り注文の整合性チェック ===\n');
    
    const exchange = config.exchanges.bitbank.instance;
    const symbol = 'OMG/JPY';
    const exchangeId = 'bitbank';
    
    // 1. Redisポジション取得
    const strategies = ['MA', 'BOLLINGER_BANDS', 'RSI', 'MACD', 'OSCILLATOR', 'MEAN_REVERSION', 'MUTUAL_INFO'];
    const allPositions = [];
    
    for (const strategy of strategies) {
      const positions = await getStrategyPositionsRedis(exchangeId, symbol, strategy);
      const openPositions = positions.filter(p => p.status === 'open' && p.side === 'buy');
      allPositions.push(...openPositions);
    }
    
    console.log(`Redisポジション数: ${allPositions.length}件`);
    const totalPositionAmount = allPositions.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
    console.log(`合計保有量: ${totalPositionAmount.toFixed(4)} OMG\n`);
    
    // 2. オープン売り注文取得
    const orders = await exchange.fetchOpenOrders(symbol);
    const sellOrders = orders.filter(o => o.side === 'sell');
    
    console.log(`売り注文数: ${sellOrders.length}件`);
    const totalSellAmount = sellOrders.reduce((sum, o) => sum + o.amount, 0);
    console.log(`売り注文合計: ${totalSellAmount.toFixed(4)} OMG\n`);
    
    // 3. 残高確認
    const balance = await exchange.fetchBalance();
    console.log('残高状況:');
    console.log(`  Total: ${balance.total.OMG || 0} OMG`);
    console.log(`  Free: ${balance.free.OMG || 0} OMG`);
    console.log(`  Used: ${balance.used.OMG || 0} OMG\n`);
    
    // 4. 分析
    console.log('=== 分析結果 ===');
    console.log(`Redisポジション合計: ${totalPositionAmount.toFixed(4)} OMG`);
    console.log(`売り注文合計: ${totalSellAmount.toFixed(4)} OMG`);
    console.log(`残高Total: ${balance.total.OMG} OMG`);
    
    if (balance.free.OMG === 0 && totalPositionAmount > 0) {
      console.log('\n⚠️ 警告: Free残高が0でRedisポジションが存在');
      console.log('→ ポジションは既に売り注文で拘束されている可能性があります');
      
      // ポジション詳細
      console.log('\n検出されたポジション:');
      allPositions.forEach(p => {
        console.log(`  ${p.strategyKey}: ${p.amount} OMG (OrderID: ${p.orderId})`);
      });
    }
    
  } catch (error) {
    console.error('エラー:', error);
  }
  
  process.exit(0);
}

checkPositionVsOrders().catch(console.error);