const { exchangeBB } = require('../src/config');
const { getTradeSummaries, addOrder } = require('../src/database/manager');
const { initRedisClient, closeRedisClient } = require('../src/database/redisClient');
const moment = require('moment'); // 時間計算のためにmomentを使用

// 数秒待機するためのヘルパー関数
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 1日取引がないHFTポジションを強制決済するスクリプト
 */
async function main() {

  try {
    await initRedisClient();
    console.log('Redisクライアントが初期化されました');

    const exchanges = [exchangeBB];
    const oneDayAgo = moment().subtract(1, 'day');

    for (const exchange of exchanges) {
      console.log(`取引所: ${exchange.id} のサマリーを取得します`);
      const summaries = await getTradeSummaries(exchange.id);

      for (const summary of summaries) {
        if (summary.strategyKey === 'HFT' && summary.netPosition !== 0) {
          try {
            // 現在価格を取得
            const ticker = await exchange.fetchTicker(summary.symbol);
            const price = ticker.last;
            console.log(`  ${summary.symbol} の現在価格: ${price}`);

            // リミットセル注文を発注
            const amount = Math.abs(summary.netPosition); // ポジションの絶対値を数量とする
            console.log(`  ${summary.symbol} のポジション ${summary.netPosition} を価格 ${price} で決済注文を発注します (postOnly: true)`);
            const order = await exchange.createLimitSellOrder(summary.symbol, amount, price, { postOnly: true });
            console.log(`  注文を発注しました: ID ${order.id}`);

            // 注文情報をデータベースに保存
            await addOrder(exchange, summary.symbol, summary.strategyKey, 'sell', amount, price, order.id, 'limit');

            // 数秒待機
            await sleep(5000); // 5秒待機

            // 注文確認
            const openOrders = await exchange.fetchOpenOrders(summary.symbol);
            const orderExists = openOrders.some(openOrder => openOrder.id === order.id);

            if (orderExists) {
              console.log(`  注文 ID ${order.id} は約定せず残っています。`);
            } else {
              console.log(`  注文 ID ${order.id} は約定したか、キャンセルされました。詳細を確認します。`);
              try {
                // fetchOrderで詳細ステータスを確認
                const orderStatus = await exchange.fetchOrder(order.id, summary.symbol);
                if (orderStatus.status === 'closed' || orderStatus.status === 'filled') {
                  console.log(`  注文 ID ${order.id} は約定しました。`);
                } else {
                  console.log(`  注文 ID ${order.id} はキャンセルされました。リトライを開始します。`);
                  let retryCount = 0;
                  let orderConfirmed = false;

                  while (!orderConfirmed) {
                    retryCount++;
                    console.log(`  リトライ試行回数: ${retryCount}`);
                    try {
                      console.log(`  ${summary.symbol} のポジション ${summary.netPosition} を価格 ${price} で決済注文をリトライします (postOnly: true)`);
                      const retryOrder = await exchange.createLimitSellOrder(summary.symbol, amount, price, { postOnly: true });
                      console.log(`  リトライ注文を発注しました: ID ${retryOrder.id}`);
                      await addOrder(exchange, summary.symbol, summary.strategyKey, 'sell', amount, price, order.id, 'limit');

                      // 数秒待機
                      await sleep(5000); // 5秒待機

                      // リトライ注文確認
                      const retryOpenOrders = await exchange.fetchOpenOrders(summary.symbol);
                      const retryOrderExists = retryOpenOrders.some(openOrder => openOrder.id === retryOrder.id);

                      if (retryOrderExists) {
                        console.log(`  リトライ注文 ID ${retryOrder.id} は約定せず残っています。`);
                        orderConfirmed = true; // 注文が確認できたのでループを抜ける
                      } else {
                        console.log(`  リトライ注文 ID ${retryOrder.id} は約定したか、キャンセルされました。詳細を確認します。`);
                        try {
                          const retryOrderStatus = await exchange.fetchOrder(retryOrder.id, summary.symbol);
                          if (retryOrderStatus.status === 'closed' || retryOrderStatus.status === 'filled') {
                            console.log(`  リトライ注文 ID ${retryOrder.id} は約定しました。`);
                            orderConfirmed = true; // 約定が確認できたのでループを抜ける
                          } else {
                            console.log(`  リトライ注文 ID ${retryOrder.id} はまだ約定または確認できません。再度リトライします。`);
                            // ループが継続される
                          }
                        } catch (fetchRetryOrderError) {
                          console.error(`  リトライ注文 ID ${retryOrder.id} の詳細ステータス確認中にエラーが発生しました (${summary.symbol}):`, fetchRetryOrderError);
                          // エラーが発生した場合もリトライを続けるか検討。今回は続ける。
                        }
                      }

                    } catch (retryOrderError) {
                      console.error(`  リトライ注文処理中にエラーが発生しました (${summary.symbol}):`, retryOrderError);
                      // エラーが発生した場合もリトライを続けるか検討。今回は続ける。
                      await sleep(10000); // エラー時は少し長めに待機
                    }
                  }
                  console.log(`  リトライ処理が完了しました (${summary.symbol})`);
                }
              } catch (fetchOrderError) {
                console.error(`  注文 ID ${order.id} の詳細ステータス確認中にエラーが発生しました (${summary.symbol}):`, fetchOrderError);
              }
            }

          } catch (orderError) {
            console.error(`  注文処理中にエラーが発生しました (${summary.symbol}):`, orderError);
          }
        }
      }
    }

  } catch (error) {
    console.error('スクリプト実行中にエラーが発生しました:', error);
  } finally {
    await closeRedisClient();
    console.log('Redisクライアントを終了しました');
    console.log('スクリプトを終了します');
    process.exit(0);
  }
}

// スクリプト実行
main().catch(err => {
  console.error('スクリプト実行エラー:', err);
  process.exit(1);
});