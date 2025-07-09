#!/usr/bin/env node

/**
 * 全システムリセットスクリプト
 *
 * 実行手順:
 * 1. 全オープンオーダーをキャンセル
 * 2. 全ポジションを強制決済
 * 3. Redis内のポジション記録をクリア
 * 4. 取引サマリー（netPosition等）を初期化
 *
 * 使用方法: node scripts/fullSystemReset.js
 *
 * ⚠️ 警告: このスクリプトは全てのポジションを決済し、記録をクリアします
 * 実行前に必ず取引botを停止してください
 */

const { config } = require('../src/config');
const { connectDB } = require('../src/database/mongoDatabase');
const {
  getClient,
  getAllPositionsRedis,
  getAllPendingOrdersRedis,
  clearAllPositionsRedis,
  clearAllPnLRedis,
  initialize: initializeRedis
} = require('../src/database/redisDatabase');

// Discord通知関数
async function sendDiscordNotification(message) {
  try {
    console.log(`[Discord通知] ${message}`);
    // Discord通知の実装は省略（必要に応じて追加）
  } catch (error) {
    console.warn(`Discord通知失敗: ${error.message}`);
  }
}

/**
 * ステップ1: 全オープンオーダーをキャンセル
 */
async function cancelAllOpenOrders() {
  console.log('\n=== ステップ1: 全オープンオーダーキャンセル ===');

  let totalCanceled = 0;
  let totalErrors = 0;

  for (const [exchangeId, exchangeConfig] of Object.entries(config.exchanges)) {
    if (!exchangeConfig || !exchangeConfig.instance) {
      console.log(`${exchangeId}: 設定なし、スキップ`);
      continue;
    }

    const exchange = exchangeConfig.instance;
    console.log(`\n${exchangeId}: オープンオーダーキャンセル開始`);

    try {
      // 全シンボルのオープンオーダーを取得
      const symbols = Object.keys(exchange.markets || {});

      for (const symbol of symbols) {
        try {
          const openOrders = await exchange.fetchOpenOrders(symbol);
          console.log(`  ${symbol}: ${openOrders.length}件のオープンオーダー発見`);

          for (const order of openOrders) {
            try {
              await exchange.cancelOrder(order.id, symbol);
              console.log(`    ✅ キャンセル成功: ${order.id} (${order.side} ${order.amount} ${symbol})`);
              totalCanceled++;

              // API制限対応
              await new Promise(resolve => setTimeout(resolve, 100));
            } catch (cancelError) {
              console.error(`    ❌ キャンセル失敗: ${order.id} - ${cancelError.message}`);
              totalErrors++;
            }
          }
        } catch (fetchError) {
          if (fetchError.message.includes('authentication') ||
              fetchError.message.includes('Invalid symbol')) {
            console.log(`  ${symbol}: サポートされていない、スキップ`);
          } else {
            console.error(`  ${symbol}: 取得エラー - ${fetchError.message}`);
            totalErrors++;
          }
        }
      }
    } catch (error) {
      console.error(`${exchangeId}: 全体エラー - ${error.message}`);
      totalErrors++;
    }
  }

  console.log(`\n[ステップ1完了] キャンセル: ${totalCanceled}件, エラー: ${totalErrors}件`);
  await sendDiscordNotification(`📝 オープンオーダーキャンセル完了: ${totalCanceled}件成功, ${totalErrors}件エラー`);

  return { canceled: totalCanceled, errors: totalErrors };
}

/**
 * ステップ2: 全ポジションを強制決済
 */
async function closeAllPositions() {
  console.log('\n=== ステップ2: 全ポジション強制決済 ===');

  let totalClosed = 0;
  let totalErrors = 0;

  for (const [exchangeId, exchangeConfig] of Object.entries(config.exchanges)) {
    if (!exchangeConfig || !exchangeConfig.instance) {
      console.log(`${exchangeId}: 設定なし、スキップ`);
      continue;
    }

    const exchange = exchangeConfig.instance;
    console.log(`\n${exchangeId}: ポジション決済開始`);

    try {
      // 取引所の残高を取得
      const balance = await exchange.fetchBalance();

      for (const [currency, amount] of Object.entries(balance.total)) {
        if (currency === 'JPY' || amount <= 0) {
          continue;
        } // JPYと0残高はスキップ

        const symbol = `${currency}/JPY`;
        if (!(symbol in exchange.markets)) {
          console.log(`  ${symbol}: サポートされていない、スキップ`);
          continue;
        }

        console.log(`  ${symbol}: ${amount} ${currency} を決済中`);

        try {
          // マーケット売り注文で即座に決済
          const order = await exchange.createMarketSellOrder(symbol, amount);
          console.log(`    ✅ 決済成功: ${order.id} (${amount} ${currency})`);
          totalClosed++;

          // API制限対応
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (sellError) {
          console.error(`    ❌ 決済失敗: ${symbol} ${amount} - ${sellError.message}`);
          totalErrors++;
        }
      }
    } catch (error) {
      console.error(`${exchangeId}: 残高取得エラー - ${error.message}`);
      totalErrors++;
    }
  }

  console.log(`\n[ステップ2完了] 決済: ${totalClosed}件, エラー: ${totalErrors}件`);
  await sendDiscordNotification(`💰 ポジション決済完了: ${totalClosed}件成功, ${totalErrors}件エラー`);

  return { closed: totalClosed, errors: totalErrors };
}

/**
 * ステップ3: Redis内のポジション記録をクリア
 */
async function clearPositionRecords() {
  console.log('\n=== ステップ3: ポジション記録クリア ===');

  try {
    const client = getClient();

    // ポジション記録をクリア
    const positionKeys = await client.keys('position:*');
    console.log(`  削除対象ポジション: ${positionKeys.length}件`);

    if (positionKeys.length > 0) {
      await client.del(positionKeys);
      console.log(`  ✅ ポジション記録削除完了: ${positionKeys.length}件`);
    }

    // 未約定注文記録をクリア
    const pendingKeys = await client.keys('pending_order:*');
    console.log(`  削除対象未約定注文: ${pendingKeys.length}件`);

    if (pendingKeys.length > 0) {
      await client.del(pendingKeys);
      console.log(`  ✅ 未約定注文記録削除完了: ${pendingKeys.length}件`);
    }

    // 損益記録をクリア
    const pnlKeys = await client.keys('pnl:*');
    console.log(`  削除対象損益記録: ${pnlKeys.length}件`);

    if (pnlKeys.length > 0) {
      await client.del(pnlKeys);
      console.log(`  ✅ 損益記録削除完了: ${pnlKeys.length}件`);
    }

    console.log('\n[ステップ3完了] Redis記録クリア完了');
    await sendDiscordNotification(`🧹 Redis記録クリア完了: ポジション${positionKeys.length}件, 未約定${pendingKeys.length}件, 損益${pnlKeys.length}件`);

    return {
      positions: positionKeys.length,
      pendingOrders: pendingKeys.length,
      pnl: pnlKeys.length
    };
  } catch (error) {
    console.error(`Redis記録クリアエラー: ${error.message}`);
    throw error;
  }
}

/**
 * ステップ4: 取引サマリー（netPosition等）を初期化
 */
async function resetTradeSummaries() {
  console.log('\n=== ステップ4: 取引サマリー初期化 ===');

  try {
    const client = getClient();

    // 取引サマリーキーを取得
    const summaryKeys = await client.keys('summary:trade:*');
    console.log(`  初期化対象サマリー: ${summaryKeys.length}件`);

    let resetCount = 0;

    for (const key of summaryKeys) {
      try {
        // サマリーを初期値にリセット
        await client.hSet(key, {
          netPosition: 0,
          buyAmount: 0,
          sellAmount: 0,
          totalBuyCost: 0,
          totalSellRevenue: 0,
          avgBuyPrice: 0,
          avgSellPrice: 0,
          updatedAt: Date.now()
        });

        resetCount++;

        if (resetCount % 50 === 0) {
          console.log(`  進捗: ${resetCount}/${summaryKeys.length}件完了`);
        }
      } catch (error) {
        console.error(`  サマリーリセット失敗: ${key} - ${error.message}`);
      }
    }

    console.log(`\n[ステップ4完了] 取引サマリー初期化完了: ${resetCount}件`);
    await sendDiscordNotification(`🔄 取引サマリー初期化完了: ${resetCount}件リセット`);

    return { reset: resetCount };
  } catch (error) {
    console.error(`取引サマリー初期化エラー: ${error.message}`);
    throw error;
  }
}

/**
 * メイン実行関数
 */
async function main() {
  console.log('🚨 全システムリセット開始 🚨');
  console.log('⚠️  警告: このスクリプトは全てのポジションを決済し、記録をクリアします');
  console.log('');

  const startTime = Date.now();

  // ローカル実行のためのデータベース URL調整
  const originalMongoUrl = process.env.MONGO_URL;
  const originalRedisUrl = process.env.REDIS_URL;

  try {
    // データベース初期化
    console.log('データベース接続を初期化中...');

    process.env.MONGO_URL = process.env.MONGO_URL || 'mongodb://harvest3-mongodb:27017';
    process.env.REDIS_URL = 'redis://localhost:6379';

    try {
      await connectDB();
    } catch (mongoError) {
      console.warn('MongoDB接続をスキップ (Redis操作のみ実行)');
    }

    await initializeRedis();
    console.log('✅ データベース接続完了');

    await sendDiscordNotification('🚨 全システムリセット開始');

    // ステップ1: オープンオーダーキャンセル
    const cancelResult = await cancelAllOpenOrders();

    // ステップ2: ポジション決済
    const closeResult = await closeAllPositions();

    // ステップ3: ポジション記録クリア
    const clearResult = await clearPositionRecords();

    // ステップ4: 取引サマリー初期化
    const resetResult = await resetTradeSummaries();

    // 完了報告
    const endTime = Date.now();
    const duration = Math.round((endTime - startTime) / 1000);

    console.log('\n🎉 全システムリセット完了 🎉');
    console.log(`実行時間: ${duration}秒`);
    console.log('');
    console.log('📊 実行結果サマリー:');
    console.log(`  オープンオーダーキャンセル: ${cancelResult.canceled}件成功, ${cancelResult.errors}件エラー`);
    console.log(`  ポジション決済: ${closeResult.closed}件成功, ${closeResult.errors}件エラー`);
    console.log(`  ポジション記録削除: ${clearResult.positions}件`);
    console.log(`  未約定注文記録削除: ${clearResult.pendingOrders}件`);
    console.log(`  損益記録削除: ${clearResult.pnl}件`);
    console.log(`  取引サマリーリセット: ${resetResult.reset}件`);
    console.log('');
    console.log('✅ システムは初期化されました。安全に取引botを再開できます。');

    await sendDiscordNotification(`✅ 全システムリセット完了 (${duration}秒)\n決済: ${closeResult.closed}件\nクリア: ポジション${clearResult.positions}件, サマリー${resetResult.reset}件`);

  } catch (error) {
    console.error('\n❌ 全システムリセット失敗');
    console.error(error);
    await sendDiscordNotification(`❌ 全システムリセット失敗: ${error.message}`);
    process.exit(1);
  } finally {
    // 環境変数を元に戻す
    if (originalMongoUrl) {
      process.env.MONGO_URL = originalMongoUrl;
    }
    if (originalRedisUrl) {
      process.env.REDIS_URL = originalRedisUrl;
    }
  }
}

// スクリプト実行
if (require.main === module) {
  main();
}

module.exports = {
  cancelAllOpenOrders,
  closeAllPositions,
  clearPositionRecords,
  resetTradeSummaries,
  main
};