#!/usr/bin/env node

/**
 * 歴史的約定の戦略キー復元スクリプト
 *
 * MongoDBの約定データで戦略キーが未設定のものを、
 * 対応する注文データから戦略情報を復元して修正する
 */

const { connectDB } = require('../src/database/mongoDatabase');
const { getClient, initialize: initializeRedis } = require('../src/database/redisDatabase');

async function restoreHistoricalStrategies() {
  console.log('🔧 歴史的約定の戦略キー復元開始');
  console.log('================================================================================');

  try {
    await connectDB();
    await initializeRedis();

    const mongoModule = require('../src/database/mongoDatabase');
    const tradesCollection = mongoModule.tradesCollection;
    const ordersCollection = mongoModule.ordersCollection;
    const client = getClient();

    if (!tradesCollection || !ordersCollection) {
      throw new Error('MongoDB collections not available');
    }

    console.log('✅ データベース接続完了');
    console.log('');

    // 1. 戦略キー未設定の約定を全取得
    console.log('📊 戦略キー未設定約定の取得...');
    const tradesWithoutStrategy = await tradesCollection.find({
      $or: [
        { strategyKey: { $exists: false } },
        { strategyKey: null },
        { strategyKey: '' },
        { strategyKey: undefined }
      ]
    }).toArray();

    console.log(`📈 対象約定数: ${tradesWithoutStrategy.length}件`);

    if (tradesWithoutStrategy.length === 0) {
      console.log('📝 復元対象なし');
      return { restored: 0, failed: 0 };
    }

    // 2. オーダーIDを抽出
    const orderIds = [...new Set(tradesWithoutStrategy
      .filter(trade => trade.orderId)
      .map(trade => trade.orderId))];

    console.log(`🔍 ユニークオーダーID: ${orderIds.length}件`);

    // 3. 対応する注文データを一括取得
    console.log('📄 注文データ取得中...');
    const orderRecords = await ordersCollection.find({
      orderId: { $in: orderIds }
    }).toArray();

    // オーダーIDをキーとするMapを作成
    const orderMap = new Map();
    for (const order of orderRecords) {
      orderMap.set(order.orderId, order);
    }

    console.log(`📋 取得した注文データ: ${orderRecords.length}件`);
    console.log('');

    // 4. 戦略キー復元処理
    console.log('🔧 戦略キー復元処理開始...');
    let restoredCount = 0;
    let failedCount = 0;
    const strategyStats = new Map();

    // バッチ処理用配列
    const bulkOperations = [];

    for (const trade of tradesWithoutStrategy) {
      try {
        if (!trade.orderId) {
          console.log(`  ⚠️  オーダーIDなし: ${trade._id}`);
          failedCount++;
          continue;
        }

        const orderRecord = orderMap.get(trade.orderId);
        if (!orderRecord) {
          console.log(`  ❌ 注文データ不存在: ${trade.orderId}`);
          failedCount++;
          continue;
        }

        if (!orderRecord.strategy) {
          console.log(`  ⚠️  注文に戦略なし: ${trade.orderId}`);
          failedCount++;
          continue;
        }

        // 戦略キーを復元
        bulkOperations.push({
          updateOne: {
            filter: { _id: trade._id },
            update: { $set: { strategyKey: orderRecord.strategy } }
          }
        });

        restoredCount++;
        strategyStats.set(orderRecord.strategy, (strategyStats.get(orderRecord.strategy) || 0) + 1);

        // 進捗表示（100件ごと）
        if (restoredCount % 100 === 0) {
          console.log(`  📈 復元進捗: ${restoredCount}件`);
        }

      } catch (error) {
        console.error(`  ❌ 処理エラー: ${trade._id} - ${error.message}`);
        failedCount++;
      }
    }

    // 5. バッチ更新実行
    if (bulkOperations.length > 0) {
      console.log(`\n🚀 バッチ更新実行: ${bulkOperations.length}件`);
      const bulkResult = await tradesCollection.bulkWrite(bulkOperations);
      console.log(`✅ 更新完了: ${bulkResult.modifiedCount}件`);
    }

    // 6. 復元結果サマリー
    console.log('\n📊 復元結果サマリー:');
    console.log(`✅ 復元成功: ${restoredCount}件`);
    console.log(`❌ 復元失敗: ${failedCount}件`);
    console.log('');

    console.log('🏷️  復元された戦略分布:');
    for (const [strategy, count] of Array.from(strategyStats.entries()).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${strategy}: ${count}件`);
    }

    // 7. OUTSIDE戦略キーのクリーンアップ
    console.log('\n🧹 OUTSIDE戦略データクリーンアップ...');
    const outsideKeys = await client.keys('summary:trade:*:OUTSIDE');
    if (outsideKeys.length > 0) {
      console.log(`🗑️  削除対象OUTSIDE戦略キー: ${outsideKeys.length}件`);
      await client.del(outsideKeys);
      console.log('✅ OUTSIDE戦略データ削除完了');
    } else {
      console.log('📝 削除対象のOUTSIDE戦略データなし');
    }

    console.log('');
    console.log('================================================================================');
    console.log('🎉 歴史的約定の戦略キー復元完了');
    console.log(`📊 処理結果: ${restoredCount}件復元成功, ${failedCount}件失敗`);
    console.log('');
    console.log('⚠️  次の手順: Redis trade_summaryの再構築を実行してください');
    console.log('   → node scripts/rebuildFromMongoTrades.js');

    return {
      restored: restoredCount,
      failed: failedCount,
      strategyDistribution: Object.fromEntries(strategyStats),
      outsideKeysRemoved: outsideKeys.length
    };

  } catch (error) {
    console.error('❌ 復元処理エラー:', error);
    throw error;
  }
}

// スクリプト実行
if (require.main === module) {
  restoreHistoricalStrategies().then((result) => {
    console.log(`\n📊 最終結果: ${result.restored}件の戦略キーを復元、${result.failed}件失敗`);
    console.log(`🗑️  ${result.outsideKeysRemoved}件のOUTSIDEキーを削除`);
    process.exit(0);
  }).catch((error) => {
    console.error('❌ スクリプト実行失敗:', error);
    process.exit(1);
  });
}

module.exports = { restoreHistoricalStrategies };