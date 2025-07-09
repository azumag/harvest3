#!/usr/bin/env node

/**
 * UNKNOWN戦略をOUTSIDE戦略に統合するスクリプト
 *
 * 設計不整合により作成されたUNKNOWN戦略データを
 * 標準のOUTSIDE戦略に統合して一貫性を保つ
 */

const { getClient, initialize: initializeRedis } = require('../src/database/redisDatabase');

async function migrateUnknownToOutside() {
  console.log('🔧 UNKNOWN→OUTSIDE戦略統合開始');
  console.log('================================================================================');

  try {
    await initializeRedis();
    const client = getClient();
    console.log('✅ Redis接続完了');
    console.log('');

    // UNKNOWN戦略のキーを検索
    const unknownKeys = await client.keys('summary:trade:*:UNKNOWN');
    console.log(`📊 UNKNOWN戦略キー: ${unknownKeys.length}件`);

    if (unknownKeys.length === 0) {
      console.log('📝 統合対象なし');
      return { migrated: 0 };
    }

    let migratedCount = 0;

    for (const unknownKey of unknownKeys) {
      try {
        // UNKNOWNキーからデータを取得
        const unknownData = await client.hGetAll(unknownKey);
        if (!unknownData || Object.keys(unknownData).length === 0) {
          console.log(`  ⚠️  空のキー: ${unknownKey}`);
          continue;
        }

        // 対応するOUTSIDEキーを構築
        const outsideKey = unknownKey.replace(':UNKNOWN', ':OUTSIDE');

        console.log(`🔄 統合処理: ${unknownKey} → ${outsideKey}`);

        // OUTSIDEキーが既存かチェック
        const outsideExists = await client.exists(outsideKey);

        if (outsideExists) {
          // 既存のOUTSIDEデータと統合
          const outsideData = await client.hGetAll(outsideKey);

          const mergedData = {
            buyAmount: (parseFloat(outsideData.buyAmount || 0) + parseFloat(unknownData.buyAmount || 0)).toFixed(8),
            sellAmount: (parseFloat(outsideData.sellAmount || 0) + parseFloat(unknownData.sellAmount || 0)).toFixed(8),
            totalBuyCost: (parseFloat(outsideData.totalBuyCost || 0) + parseFloat(unknownData.totalBuyCost || 0)).toFixed(8),
            totalSellRevenue: (parseFloat(outsideData.totalSellRevenue || 0) + parseFloat(unknownData.totalSellRevenue || 0)).toFixed(8),
            netPosition: (parseFloat(outsideData.netPosition || 0) + parseFloat(unknownData.netPosition || 0)).toFixed(8),
            totalFee: (parseFloat(outsideData.totalFee || 0) + parseFloat(unknownData.totalFee || 0)).toFixed(8),
            realizedPnL: (parseFloat(outsideData.realizedPnL || 0) + parseFloat(unknownData.realizedPnL || 0)).toFixed(8),
            avgBuyPrice: '0', // 再計算が必要
            avgSellPrice: '0', // 再計算が必要
            createdAt: Math.min(parseFloat(outsideData.createdAt || Date.now()), parseFloat(unknownData.createdAt || Date.now())),
            updatedAt: Date.now()
          };

          // 平均価格を再計算
          if (parseFloat(mergedData.buyAmount) > 0) {
            mergedData.avgBuyPrice = (parseFloat(mergedData.totalBuyCost) / parseFloat(mergedData.buyAmount)).toFixed(8);
          }
          if (parseFloat(mergedData.sellAmount) > 0) {
            mergedData.avgSellPrice = (parseFloat(mergedData.totalSellRevenue) / parseFloat(mergedData.sellAmount)).toFixed(8);
          }

          await client.hSet(outsideKey, mergedData);
          console.log(`  ✅ 統合完了: netPosition ${unknownData.netPosition} + ${outsideData.netPosition} = ${mergedData.netPosition}`);
        } else {
          // OUTSIDEキーが存在しない場合は単純にコピー
          await client.hSet(outsideKey, {
            ...unknownData,
            updatedAt: Date.now()
          });
          console.log(`  ✅ 移行完了: netPosition ${unknownData.netPosition}`);
        }

        // UNKNOWNキーを削除
        await client.del(unknownKey);
        migratedCount++;

      } catch (error) {
        console.error(`  ❌ ${unknownKey} 処理エラー: ${error.message}`);
      }
    }

    console.log('');
    console.log('================================================================================');
    console.log(`🎉 統合完了: ${migratedCount}件のUNKNOWN戦略をOUTSIDEに統合`);

    return { migrated: migratedCount };

  } catch (error) {
    console.error('❌ 統合処理エラー:', error);
    throw error;
  }
}

// スクリプト実行
if (require.main === module) {
  migrateUnknownToOutside().then((result) => {
    console.log(`\n📊 最終結果: ${result.migrated}件のUNKNOWN戦略を統合`);
    process.exit(0);
  }).catch((error) => {
    console.error('❌ スクリプト実行失敗:', error);
    process.exit(1);
  });
}

module.exports = { migrateUnknownToOutside };