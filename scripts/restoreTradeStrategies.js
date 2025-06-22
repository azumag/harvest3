#!/usr/bin/env node

/**
 * 取引戦略情報復元スクリプト
 * 
 * Redis内のpositionキーから戦略情報を抽出し、
 * MongoDB内の取引データに戦略情報を復元する
 */

const { connectDB } = require('../src/database/mongoDatabase');
const { getClient, initialize: initializeRedis } = require('../src/database/redisDatabase');

async function restoreTradeStrategies() {
  console.log('🔄 取引戦略情報復元開始');
  console.log('================================================================================');
  
  try {
    await connectDB();
    await initializeRedis();
    const client = getClient();
    
    // MongoDBのコレクション参照を取得
    const mongoModule = require('../src/database/mongoDatabase');
    const tradesCollection = mongoModule.tradesCollection;
    
    if (!tradesCollection) {
      throw new Error('tradesCollection not available');
    }
    
    console.log('✅ データベース接続完了');
    console.log('');
    
    // === Step 1: Redis position キーから戦略情報を収集 ===
    console.log('⏰ Step 1: Redis position キーから戦略情報を収集');
    console.log('----------------------------------------------------');
    
    const positionKeys = await client.keys('position:*');
    console.log(`📊 見つかったposition キー: ${positionKeys.length}件`);
    
    const orderIdToStrategy = new Map(); // orderId -> strategyKey mapping
    let processedPositions = 0;
    
    for (const positionKey of positionKeys) {
      try {
        const positionData = await client.hGetAll(positionKey);
        
        if (positionData.orderId && positionData.strategyKey) {
          const orderId = positionData.orderId;
          const strategyKey = positionData.strategyKey;
          
          // 既存のマッピングと異なる戦略が見つかった場合は警告
          if (orderIdToStrategy.has(orderId) && orderIdToStrategy.get(orderId) !== strategyKey) {
            console.warn(`  ⚠️  OrderId ${orderId} に複数の戦略: ${orderIdToStrategy.get(orderId)} vs ${strategyKey}`);
          }
          
          orderIdToStrategy.set(orderId, strategyKey);
          processedPositions++;
        }
        
      } catch (error) {
        console.error(`  ❌ Position処理エラー ${positionKey}: ${error.message}`);
      }
    }
    
    console.log(`✅ 処理完了: ${processedPositions}件のposition、${orderIdToStrategy.size}件のorderIdマッピング`);
    console.log('');
    
    // === Step 2: MongoDB取引データに戦略情報を復元 ===
    console.log('⏰ Step 2: MongoDB取引データに戦略情報を復元');
    console.log('--------------------------------------------------');
    
    // 戦略別統計
    const strategyStats = new Map();
    let updatedCount = 0;
    let totalTrades = 0;
    
    // 全取引をバッチで処理
    const batchSize = 100;
    let skip = 0;
    
    while (true) {
      const trades = await tradesCollection
        .find({})
        .skip(skip)
        .limit(batchSize)
        .toArray();
      
      if (trades.length === 0) break;
      
      const bulkOps = [];
      
      for (const trade of trades) {
        totalTrades++;
        
        if (trade.orderId && orderIdToStrategy.has(trade.orderId)) {
          const strategyKey = orderIdToStrategy.get(trade.orderId);
          
          // 統計更新
          if (!strategyStats.has(strategyKey)) {
            strategyStats.set(strategyKey, { count: 0, symbols: new Set() });
          }
          strategyStats.get(strategyKey).count++;
          strategyStats.get(strategyKey).symbols.add(trade.symbol);
          
          // MongoDB更新操作を準備
          bulkOps.push({
            updateOne: {
              filter: { _id: trade._id },
              update: { $set: { strategyKey: strategyKey } }
            }
          });
          
          updatedCount++;
        }
      }
      
      // バッチ更新実行
      if (bulkOps.length > 0) {
        await tradesCollection.bulkWrite(bulkOps);
        console.log(`  📝 ${skip + 1}-${skip + trades.length}: ${bulkOps.length}件更新`);
      }
      
      skip += batchSize;
    }
    
    console.log('');
    console.log(`✅ MongoDB更新完了: ${updatedCount}/${totalTrades}件の取引に戦略情報を復元`);
    console.log('');
    
    // === Step 3: 復元結果の統計表示 ===
    console.log('📊 復元結果の統計:');
    console.log('------------------');
    
    for (const [strategy, stats] of strategyStats) {
      console.log(`  ${strategy}: ${stats.count}件 (通貨: ${Array.from(stats.symbols).join(', ')})`);
    }
    
    const unknownCount = totalTrades - updatedCount;
    if (unknownCount > 0) {
      console.log(`  UNKNOWN: ${unknownCount}件 (戦略情報なし)`);
    }
    
    console.log('');
    
    // === Step 4: 検証 ===
    console.log('🔍 検証: 更新後の戦略分布');
    console.log('----------------------------');
    
    const strategyDistribution = await tradesCollection.aggregate([
      { $group: { 
        _id: '$strategyKey', 
        count: { $sum: 1 },
        symbols: { $addToSet: '$symbol' }
      }},
      { $sort: { count: -1 } }
    ]).toArray();
    
    strategyDistribution.forEach(dist => {
      const strategy = dist._id || 'UNKNOWN';
      console.log(`  ${strategy}: ${dist.count}件 (${dist.symbols.length}通貨)`);
    });
    
    console.log('');
    console.log('================================================================================');
    console.log('🎉 取引戦略情報復元完了');
    
    return {
      totalTrades,
      updatedTrades: updatedCount,
      unknownTrades: unknownCount,
      strategiesFound: strategyStats.size,
      orderIdMappings: orderIdToStrategy.size
    };
    
  } catch (error) {
    console.error('❌ 戦略復元エラー:', error);
    throw error;
  }
}

// スクリプト実行
if (require.main === module) {
  restoreTradeStrategies().then((result) => {
    console.log(`\\n📊 最終結果:`);
    console.log(`  総取引数: ${result.totalTrades}`);
    console.log(`  戦略復元: ${result.updatedTrades}件`);
    console.log(`  未復元: ${result.unknownTrades}件`);
    console.log(`  発見戦略: ${result.strategiesFound}種類`);
    console.log(`  OrderIdマッピング: ${result.orderIdMappings}件`);
    process.exit(0);
  }).catch((error) => {
    console.error('❌ スクリプト実行失敗:', error);
    process.exit(1);
  });
}

module.exports = { restoreTradeStrategies };