const { client, initRedisClient, closeRedisClient } = require('../src/redisClient');

const { getCurrentOrderPair, setCurrentOrderPair } = require('../src/redisDatabase');

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

            console.log(`${symbol}: DBから注文ペアを復元中...`);
            const restoredPair = await getCurrentOrderPair(exchangeId, symbol, 'MARKET_MAKING');
            if (!restoredPair) {
                console.log(`${symbol}: DBから注文ペアの復元に失敗しました`);
                continue;
            }

            const buyOrder = restoredPair.buyOrder;
            const sellOrder = restoredPair.sellOrder;
            
            try {
                if (buyOrder) await exchange.cancelOrder(buyOrder.id, symbol);
            } catch (err) {
                console.error(`  キャンセルエラー:`, err);
            }
            try {
                if (sellOrder) await exchange.cancelOrder(sellOrder.id, symbol);
            } catch (err) {
                console.error(`  キャンセルエラー:`, err);
            }

            // 約定判定
            if (restoredPair.buyFilled && restoredPair.selFilled) {
                // 両方約定
            } else if(restoredPair.buyFilled && !restoredPair.selFilled) {
                // 売り約定
                const orderStatus = await exchange.fetchOrder(sellOrder.id, symbol);
                if (orderStatus.status === 'closed' || orderStatus.status === 'filled') {
                    console.log(`${symbol}: $注文が約定しました (個別確認)`);
                    

                } else {
                    console.log(`${symbol}: 注文()が約定していません (個別確認)`);
                    await exchange.createMarketSellOrder(symbol, restoredPair.amount);
                    console.log(`${symbol}:注文()を成行で売却しました`);
                }

            } else if(!restoredPair.buyFilled && restoredPair.selFilled) {
                // 買い約定

                const orderStatus = await exchange.fetchOrder(buyOrder.id, symbol);
                if (orderStatus.status === 'closed' || orderStatus.status === 'filled') {
                    console.log(`${symbol}: $注文が約定しました (個別確認)`);
                    
                    // 約定していたら売る
                    await exchange.createMarketSellOrder(symbol, restoredPair.amount);
                    console.log(`${symbol}: 注文()を成行で売却しました`);
                } else {
                    console.log(`${symbol}: 注文()が約定していません (個別確認)`);

                }
            }

            // 注文ペアの削除
            // 新しい空のペアを作成
            const newPair = {
                id: Date.now().toString() + Math.random().toString(16).slice(2),
                buyOrder: null,
                sellOrder: null,
                buyFilled: false,
                sellFilled: false,
                amount: 0
            };
          
            await setCurrentOrderPair(exchange.id, symbol, 'MARKET_MAKING', newPair);
            console.log(`${this.symbol}: 注文ペアを削除しました`);
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