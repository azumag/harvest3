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
    const symbol = 'MKR/JPY';
    const amount = 0.01;
    const price = 193612;
        
    try {
        const order = await exchange.createLimitSellOrder(symbol, 0.01, 193612, { postOnly: true });
        updateTradeRecord(exchange.id, symbol, amount, price, 'sell', 'HFT', order.id, 'limit');
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