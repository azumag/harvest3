/**
 * ゴーストポジション削除スクリプト
 * キャンセル済み注文に対応するRedisポジションを削除
 */
const { initRedisClient, client: redisClient } = require('../src/database/redisClient');
const { getStrategyPositionsRedis } = require('../src/database/redisDatabase');
const fs = require('fs');

async function deleteGhostPositions() {
  try {
    console.log('🚨 ゴーストポジション緊急削除開始...');
    
    await initRedisClient();
    
    // キャンセル済み注文のリスト（15件）
    const canceledOrders = [
      { currency: 'XRP', strategy: 'MACD', orderId: '47147742663', amount: 0.6532 },
      { currency: 'XRP', strategy: 'BOLLINGER_BANDS', orderId: '47149617126', amount: 0.0769 },
      { currency: 'SAND', strategy: 'MACD', orderId: '47142640619', amount: 0.2548 },
      { currency: 'SAND', strategy: 'BOLLINGER_BANDS', orderId: '47150191181', amount: 1.3775 },
      { currency: 'CHZ', strategy: 'BOLLINGER_BANDS', orderId: '47140187226', amount: 1.9343 },
      { currency: 'APE', strategy: 'BOLLINGER_BANDS', orderId: '47137641882', amount: 0.2685 },
      { currency: 'APE', strategy: 'MULTI_INDICATOR', orderId: '47137672805', amount: 0.2181 },
      { currency: 'APE', strategy: 'MULTI_INDICATOR', orderId: '47142892113', amount: 0.0636 },
      { currency: 'DOT', strategy: 'BOLLINGER_BANDS', orderId: '47149709858', amount: 0.0413 },
      { currency: 'LINK', strategy: 'MULTI_INDICATOR', orderId: '47149471066', amount: 0.0149 },
      { currency: 'SOL', strategy: 'MACD', orderId: '47147818450', amount: 0.0089 },
      { currency: 'SOL', strategy: 'BOLLINGER_BANDS', orderId: '47149148566', amount: 0.0021 },
      { currency: 'SOL', strategy: 'BOLLINGER_BANDS', orderId: '47149675939', amount: 0.001 },
      { currency: 'SOL', strategy: 'BOLLINGER_BANDS', orderId: '47147824278', amount: 0.0089 },
      { currency: 'SOL', strategy: 'MA', orderId: '47149160486', amount: 0.0021 }
    ];
    
    const exchangeId = 'bitbank';
    const deletedKeys = [];
    const backupData = [];
    
    console.log('\n📋 削除対象ポジション特定・バックアップ中...');
    
    for (const canceledOrder of canceledOrders) {
      const symbol = `${canceledOrder.currency}/JPY`;
      console.log(`\n🔍 ${canceledOrder.currency} ${canceledOrder.strategy} (OrderID: ${canceledOrder.orderId})`);
      
      try {
        const positions = await getStrategyPositionsRedis(exchangeId, symbol, canceledOrder.strategy);
        
        const targetPositions = positions.filter(p => 
          p.orderId === canceledOrder.orderId && 
          p.status === 'open' && 
          p.side === 'buy'
        );
        
        if (targetPositions.length > 0) {
          console.log(`  ✅ 削除対象ポジション: ${targetPositions.length}件`);
          
          for (const pos of targetPositions) {
            const redisKey = `position:${exchangeId}:${symbol}:${canceledOrder.strategy}:${pos.orderId}`;
            
            // バックアップ用にデータを保存
            const positionData = await redisClient.hGetAll(redisKey);
            if (Object.keys(positionData).length > 0) {
              backupData.push({
                redisKey,
                data: JSON.stringify(positionData),
                currency: canceledOrder.currency,
                strategy: canceledOrder.strategy,
                orderId: canceledOrder.orderId,
                amount: pos.amount,
                timestamp: new Date().toISOString()
              });
              
              console.log(`    📝 バックアップ済み: ${redisKey}`);
              console.log(`        Amount: ${pos.amount} ${canceledOrder.currency}`);
              console.log(`        OrderID: ${pos.orderId}`);
            }
          }
        } else {
          console.log(`  ⚠️ 対象ポジションが見つかりません`);
        }
      } catch (err) {
        console.log(`  ❌ エラー: ${err.message}`);
      }
    }
    
    // バックアップファイル作成
    const backupFilename = `ghost-positions-backup-${Date.now()}.json`;
    fs.writeFileSync(backupFilename, JSON.stringify(backupData, null, 2));
    console.log(`\n💾 バックアップファイル作成: ${backupFilename}`);
    console.log(`📊 バックアップ対象: ${backupData.length}件`);
    
    if (backupData.length === 0) {
      console.log('\n⚠️ 削除対象のポジションが見つかりませんでした');
      return;
    }
    
    // 実際の削除実行
    console.log('\n🗑️ ゴーストポジション削除実行中...');
    
    for (const backup of backupData) {
      try {
        const result = await redisClient.del(backup.redisKey);
        if (result === 1) {
          console.log(`  ✅ 削除成功: ${backup.redisKey}`);
          console.log(`      ${backup.currency} ${backup.strategy} ${backup.amount} (OrderID: ${backup.orderId})`);
          deletedKeys.push(backup.redisKey);
        } else {
          console.log(`  ⚠️ キーが存在しません: ${backup.redisKey}`);
        }
      } catch (deleteErr) {
        console.log(`  ❌ 削除エラー: ${backup.redisKey} - ${deleteErr.message}`);
      }
    }
    
    console.log(`\n✅ ゴーストポジション削除完了`);
    console.log(`📊 削除実行件数: ${deletedKeys.length}件`);
    console.log(`💾 バックアップファイル: ${backupFilename}`);
    
    // 削除されたキーのリストを出力
    console.log('\n📋 削除されたRedisキー一覧:');
    deletedKeys.forEach((key, index) => {
      console.log(`[${index + 1}] ${key}`);
    });
    
    return {
      deletedKeys,
      backupFile: backupFilename,
      deletedCount: deletedKeys.length
    };
    
  } catch (error) {
    console.error('❌ エラー:', error.message);
    console.error(error.stack);
  }
}

if (require.main === module) {
  deleteGhostPositions().then(() => process.exit(0)).catch(console.error);
}

module.exports = { deleteGhostPositions };