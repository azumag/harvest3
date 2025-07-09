#!/usr/bin/env node

/**
 * trade summaryキー形式マイグレーションスクリプト
 *
 * summary:trade:* 形式から trade_summary:* 形式への移行
 * MongoDB取引履歴との整合性も確認
 */

const { connectDB } = require('../src/database/mongoDatabase');
const { getClient, initialize: initializeRedis } = require('../src/database/redisDatabase');

async function migrateTradeKeys() {
  console.log('🔧 Trade Summaryキー形式マイグレーション開始');
  console.log('================================================================================');

  try {
    await connectDB();
    await initializeRedis();
    const client = getClient();

    // MongoDBのコレクション参照を取得
    const mongoModule = require('../src/database/mongoDatabase');
    const tradesCollection = mongoModule.tradesCollection;

    console.log('✅ データベース接続完了');
    console.log('');

    // === Step 1: 既存キーの確認 ===
    console.log('📊 既存キーの確認:');
    const oldKeys = await client.keys('summary:trade:*');
    const newKeys = await client.keys('trade_summary:*');

    console.log(`  summary:trade:* 形式: ${oldKeys.length}件`);
    console.log(`  trade_summary:* 形式: ${newKeys.length}件`);
    console.log('');

    // === Step 2: キーのマイグレーション ===
    console.log('🔄 キーマイグレーション開始:');
    let migratedCount = 0;
    let mergedCount = 0;

    for (const oldKey of oldKeys) {
      try {
        // 旧キーからデータを取得
        const oldData = await client.hGetAll(oldKey);

        // 新キー名を生成
        const keyParts = oldKey.split(':');
        const exchange = keyParts[2];
        const symbol = keyParts[3];
        const strategy = keyParts[4];
        const newKey = `trade_summary:${exchange}:${symbol}:${strategy}`;

        console.log(`  ${oldKey} → ${newKey}`);

        // 新キーが既に存在する場合はマージ処理
        const newExists = await client.exists(newKey);
        if (newExists) {
          console.log('    既存データとマージ');
          const existingData = await client.hGetAll(newKey);

          // 数値データをマージ（新しい方を優先）
          const mergedData = {
            buyAmount: (parseFloat(existingData.buyAmount || 0) + parseFloat(oldData.buyAmount || 0)).toFixed(8),
            sellAmount: (parseFloat(existingData.sellAmount || 0) + parseFloat(oldData.sellAmount || 0)).toFixed(8),
            totalBuyCost: (parseFloat(existingData.totalBuyCost || 0) + parseFloat(oldData.totalBuyCost || 0)).toFixed(8),
            totalSellValue: (parseFloat(existingData.totalSellValue || 0) + parseFloat(oldData.totalSellValue || 0)).toFixed(8),
            netPosition: (parseFloat(existingData.netPosition || 0) + parseFloat(oldData.netPosition || 0)).toFixed(8),
            totalFee: (parseFloat(existingData.totalFee || 0) + parseFloat(oldData.totalFee || 0)).toFixed(8),
            realizedPnL: (parseFloat(existingData.realizedPnL || 0) + parseFloat(oldData.realizedPnL || 0)).toFixed(8),
            createdAt: Math.min(parseInt(existingData.createdAt || Date.now()), parseInt(oldData.createdAt || Date.now())),
            updatedAt: Math.max(parseInt(existingData.updatedAt || 0), parseInt(oldData.updatedAt || 0))
          };

          await client.hSet(newKey, mergedData);
          mergedCount++;
        } else {
          // 新キーが存在しない場合はそのまま移行
          await client.hSet(newKey, oldData);
        }

        // 旧キーを削除
        await client.del(oldKey);
        migratedCount++;

      } catch (error) {
        console.error(`    ❌ エラー: ${error.message}`);
      }
    }

    console.log('');
    console.log(`✅ マイグレーション完了: ${migratedCount}件処理, ${mergedCount}件マージ`);
    console.log('');

    // === Step 3: MongoDB取引履歴との照合 ===
    console.log('🔍 MongoDB取引履歴との照合:');

    // 問題のある通貨をチェック
    const problemCurrencies = ['BAT/JPY', 'ADA/JPY', 'BOBA/JPY', 'OAS/JPY', 'DOGE/JPY'];

    for (const symbol of problemCurrencies) {
      console.log(`  ${symbol}:`);

      // MongoDBから取引統計を取得
      const mongoStats = await tradesCollection.aggregate([
        { $match: { symbol: symbol } },
        { $group: {
          _id: { side: '$side' },
          totalAmount: { $sum: { $toDouble: '$amount' } },
          count: { $sum: 1 }
        } }
      ]).toArray();

      let mongoBuyTotal = 0;
      let mongoSellTotal = 0;

      mongoStats.forEach(stat => {
        if (stat._id.side === 'buy') {
          mongoBuyTotal = stat.totalAmount;
          console.log(`    MongoDB買い: ${stat.totalAmount.toFixed(6)} (${stat.count}件)`);
        } else if (stat._id.side === 'sell') {
          mongoSellTotal = stat.totalAmount;
          console.log(`    MongoDB売り: ${stat.totalAmount.toFixed(6)} (${stat.count}件)`);
        }
      });

      const mongoNetPosition = mongoBuyTotal - mongoSellTotal;
      console.log(`    MongoDB正味: ${mongoNetPosition.toFixed(6)}`);

      // Redisのデータを確認
      const redisKeys = await client.keys(`trade_summary:bitbank:${symbol}:*`);
      let redisBuyTotal = 0;
      let redisSellTotal = 0;

      for (const key of redisKeys) {
        const data = await client.hGetAll(key);
        redisBuyTotal += parseFloat(data.buyAmount || 0);
        redisSellTotal += parseFloat(data.sellAmount || 0);
      }

      console.log(`    Redis買い: ${redisBuyTotal.toFixed(6)}`);
      console.log(`    Redis売り: ${redisSellTotal.toFixed(6)}`);
      console.log(`    Redis正味: ${(redisBuyTotal - redisSellTotal).toFixed(6)}`);
      console.log('');
    }

    // === Step 4: 最終確認 ===
    console.log('📊 最終確認:');
    const finalOldKeys = await client.keys('summary:trade:*');
    const finalNewKeys = await client.keys('trade_summary:*');

    console.log(`  summary:trade:* 形式: ${finalOldKeys.length}件`);
    console.log(`  trade_summary:* 形式: ${finalNewKeys.length}件`);

    console.log('');
    console.log('================================================================================');
    console.log('🎉 キー形式マイグレーション完了');

    return {
      migrated: migratedCount,
      merged: mergedCount,
      remaining: finalOldKeys.length
    };

  } catch (error) {
    console.error('❌ マイグレーションエラー:', error);
    throw error;
  }
}

// スクリプト実行
if (require.main === module) {
  migrateTradeKeys().then((result) => {
    console.log(`\\n📊 最終結果: ${result.migrated}件マイグレート, ${result.merged}件マージ, ${result.remaining}件残存`);
    process.exit(0);
  }).catch((error) => {
    console.error('❌ スクリプト実行失敗:', error);
    process.exit(1);
  });
}

module.exports = { migrateTradeKeys };