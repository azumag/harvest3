const { client, initRedisClient, closeRedisClient } = require('../src/redisClient');

const { updateFilledTrades } = require('../src/utils');
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
    const exchangeId = exchange.id;

    console.log(`\n--- 取引所: ${exchangeId} の処理開始 ---`);
    
    // 通貨ペア一覧を取得
    const symbols = await client.sMembers(`symbols:${exchangeId}`);
    
    // 各通貨ペアの処理
    for (const symbol of symbols) {
        console.log(`\n>> 通貨ペア: ${symbol} の処理開始`);
        
        try {
            await updateFilledTrades(exchange, symbol);
        } catch (err) {
            console.error(`  修正エラー:`, err);

        }
        
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