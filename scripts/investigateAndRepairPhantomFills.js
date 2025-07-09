

/**
 * 偽約定ポジションの調査・修復スクリプト
 *
 * 特定のオーダーIDについて、取引所の実際の状態とRedis上のポジション記録を比較し、
 * 不整合（偽約定）を検出して修正します。
 */
require('dotenv').config();
const ccxt = require('ccxt');
const { getClient, initialize: initializeRedis } = require('../src/database/redisDatabase');

// 調査対象のオーダーID
const TARGET_ORDERS = {
  'GALA/JPY': '47148451536',
  'OAS/JPY': '47148562118'
};

// メイン実行関数
async function investigateAndRepair() {
  console.log('--- 偽約定ポジション調査・修復開始 ---');
  const executeMode = process.argv.includes('--execute');
  console.log(`実行モード: ${executeMode ? '修復実行' : '調査のみ (Dry Run)'}`);

  let client;
  try {
    await initializeRedis();
    client = getClient();
    const exchange = new ccxt.bitbank({
      apiKey: process.env.BB_API_KEY,
      secret: process.env.BB_API_SECRET
    });

    for (const [symbol, orderId] of Object.entries(TARGET_ORDERS)) {
      console.log(`\n--- 調査対象: ${symbol} (オーダーID: ${orderId}) ---`);

      // 1. 取引所で注文状態を確認
      let exchangeOrder;
      try {
        exchangeOrder = await exchange.fetchOrder(orderId, symbol);
        console.log(`  [取引所] 状態: ${exchangeOrder.status}, 約定量: ${exchangeOrder.filled}`);
      } catch (error) {
        if (error instanceof ccxt.OrderNotFound) {
          console.log(`  [取引所] オーダーID ${orderId} は存在しませんでした。`);
        } else {
          console.error(`  [取引所] APIエラー: ${error.message}`);
        }
        exchangeOrder = null;
      }

      // 2. Redisでポジション記録を確認
      const positionPattern = `position:bitbank:${symbol}*:${orderId}`;
      const positionKeys = await client.keys(positionPattern);

      if (positionKeys.length === 0) {
        console.log('  [Redis] ポジション記録なし。整合性OK。');
        continue;
      }
      const positionKey = positionKeys[0];
      const positionData = await client.hGetAll(positionKey);
      console.log(`  [Redis] ポジション発見: ${positionKey}`);
      console.log(`    -> 状態: ${positionData.status}, 数量: ${positionData.amount}`);

      // 3. 偽約定の判定と修復
      // 取引所にオーダーが存在しない、またはキャンセル済みだが、Redisにオープンポジションとして残っている場合
      if ((!exchangeOrder || exchangeOrder.status === 'canceled') && positionData.status === 'open') {
        console.log('  [判定] 🚨 偽約定（ゴーストポジション）を検出！');

        if (executeMode) {
          console.log('    -> [修復実行] Redisからポジションを削除します...');
          const result = await client.del(positionKey);
          if (result > 0) {
            console.log(`    -> ✅ 削除成功: ${positionKey}`);
          } else {
            console.error(`    -> ❌ 削除失敗: ${positionKey}`);
          }
        } else {
          console.log('    -> [調査のみ] 削除対象としてマークしました。');
        }
      } else {
        console.log('  [判定] 正常または判断不能。手動確認を推奨します。');
        console.log('    -> 取引所状態:', exchangeOrder?.status, 'Redis状態:', positionData.status);
      }
    }

  } catch (error) {
    console.error('\n❌ 致命的なエラーが発生しました:', error);
  } finally {
    if (client) {
      await client.quit();
    }
    console.log('\n--- 処理完了 ---');
  }
}

investigateAndRepair();
