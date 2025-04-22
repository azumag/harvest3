const { client, initRedisClient, closeRedisClient } = require('../src/redisClient');

const { getCurrentOrderPair, setCurrentOrderPair } = require('../src/redisDatabase');
const { updateTradeRecord } = require('../src/redisTradeRecords');

const { exchangeBB } = require('../src/config');

/**
 * メイン処理関数
 */
async function main() {
  try {
    // Redisクライアントの初期化
    await initRedisClient();
    console.log('Redisクライアントが初期化されました');

    // 各取引所の処理
    const exchange = exchangeBB;
    const symbol = 'XLM/JPY';
    const amount = 35;
    const price = 35.2;
        
    try {
        const order = await exchange.createLimitSellOrder(symbol, amount, price, { postOnly: true });
        updateTradeRecord(exchange.id, symbol, amount, price, 'sell', 'INTER_EXCHANGE_ARBITRAGE', order.id, 'limit');
    } catch (err) {
        console.error(`  修正エラー:`, err);

    }
    
  } catch (error) {
    console.error('処理エラー:', error);
  } finally {
    // Redisクライアントの終了
    await closeRedisClient();
    console.log('Redisクライアントを終了しました');
  }
}

// スクリプト実行
main().catch(err => {
  console.error('スクリプト実行エラー:', err);
  process.exit(1);
});