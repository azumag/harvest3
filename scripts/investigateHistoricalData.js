#!/usr/bin/env node

/**
 * 歴史的データの戦略キー復元可能性調査スクリプト
 * 
 * 戦略キー未設定の約定に対応する注文データを調査し、
 * 戦略情報の復元可能性を検証する
 */

const { connectDB } = require('../src/database/mongoDatabase');

async function investigateHistoricalData() {
  console.log('🔍 歴史的データ戦略キー復元可能性調査開始');
  console.log('================================================================================');
  
  try {
    await connectDB();
    
    const mongoModule = require('../src/database/mongoDatabase');
    const tradesCollection = mongoModule.tradesCollection;
    const ordersCollection = mongoModule.ordersCollection;
    
    if (!tradesCollection || !ordersCollection) {
      throw new Error('MongoDB collections not available');
    }
    
    console.log('✅ MongoDB接続完了');
    console.log('');
    
    // 1. 戦略キー未設定の約定を取得（サンプル）
    const tradesWithoutStrategy = await tradesCollection.find({
      $or: [
        { strategyKey: { $exists: false } },
        { strategyKey: null },
        { strategyKey: "" },
        { strategyKey: undefined }
      ]
    }).limit(50).toArray();
    
    console.log(`📊 戦略キー未設定約定: ${tradesWithoutStrategy.length}件（サンプル）`);
    
    // 2. これらの約定のオーダーIDを調査
    const orderIds = tradesWithoutStrategy
      .filter(trade => trade.orderId)
      .map(trade => trade.orderId);
    
    console.log(`🔍 調査対象オーダーID: ${orderIds.length}件`);
    
    // 3. 対応する注文データの存在確認
    const matchingOrders = await ordersCollection.find({
      orderId: { $in: orderIds }
    }).toArray();
    
    console.log(`📄 対応する注文記録: ${matchingOrders.length}件`);
    console.log('');
    
    // 4. 詳細分析
    let strategiesFound = 0;
    let strategiesNotFound = 0;
    const strategyDistribution = new Map();
    
    console.log('📋 詳細分析（最初の10件）:');
    for (let i = 0; i < Math.min(10, tradesWithoutStrategy.length); i++) {
      const trade = tradesWithoutStrategy[i];
      console.log(`\n  [${i + 1}] ${trade.symbol} ${trade.side} ${trade.amount}`);
      console.log(`      オーダーID: ${trade.orderId}`);
      console.log(`      約定日時: ${trade.filledAt || '不明'}`);
      
      if (trade.orderId) {
        const matchingOrder = matchingOrders.find(order => order.orderId === trade.orderId);
        if (matchingOrder) {
          console.log(`      ✅ 注文記録: 存在`);
          console.log(`          戦略: ${matchingOrder.strategy || '未設定'}`);
          console.log(`          注文日時: ${matchingOrder.createdAt || matchingOrder.orderedAt || '不明'}`);
          console.log(`          注文タイプ: ${matchingOrder.type || '不明'}`);
          
          if (matchingOrder.strategy) {
            strategiesFound++;
            const strategy = matchingOrder.strategy;
            strategyDistribution.set(strategy, (strategyDistribution.get(strategy) || 0) + 1);
          } else {
            strategiesNotFound++;
          }
        } else {
          console.log(`      ❌ 注文記録: 不存在`);
          strategiesNotFound++;
        }
      } else {
        console.log(`      ⚠️  オーダーIDなし`);
        strategiesNotFound++;
      }
    }
    
    // 5. 戦略分布
    console.log('\\n🏷️  発見された戦略分布:');
    for (const [strategy, count] of strategyDistribution) {
      console.log(`  ${strategy}: ${count}件`);
    }
    
    // 6. 全体統計
    const totalOrdersInDB = await ordersCollection.countDocuments({});
    const ordersWithStrategy = await ordersCollection.countDocuments({
      strategy: { $exists: true, $ne: null, $ne: "" }
    });
    
    console.log('\\n📊 注文データベース統計:');
    console.log(`  全注文数: ${totalOrdersInDB}件`);
    console.log(`  戦略付き注文: ${ordersWithStrategy}件 (${((ordersWithStrategy / totalOrdersInDB) * 100).toFixed(1)}%)`);
    console.log(`  戦略なし注文: ${totalOrdersInDB - ordersWithStrategy}件`);
    
    // 7. 時系列分析
    const ordersWithTimestamp = await ordersCollection.find({
      $or: [
        { createdAt: { $exists: true } },
        { orderedAt: { $exists: true } }
      ]
    }).sort({ createdAt: 1, orderedAt: 1 }).limit(10).toArray();
    
    console.log('\\n📅 注文データの時系列サンプル（古い順）:');
    for (let i = 0; i < Math.min(5, ordersWithTimestamp.length); i++) {
      const order = ordersWithTimestamp[i];
      const timestamp = order.createdAt || order.orderedAt;
      console.log(`  ${new Date(timestamp).toLocaleDateString()}: ${order.symbol} (戦略: ${order.strategy || '未設定'})`);
    }
    
    console.log('');
    console.log('================================================================================');
    console.log('🎯 復元可能性評価:');
    console.log(`📊 サンプル約定: ${tradesWithoutStrategy.length}件`);
    console.log(`✅ 戦略復元可能: ${strategiesFound}件 (${((strategiesFound / tradesWithoutStrategy.length) * 100).toFixed(1)}%)`);
    console.log(`❌ 戦略復元不可: ${strategiesNotFound}件 (${((strategiesNotFound / tradesWithoutStrategy.length) * 100).toFixed(1)}%)`);
    console.log(`📄 注文記録存在率: ${((matchingOrders.length / orderIds.length) * 100).toFixed(1)}%`);
    
    return {
      sampleTrades: tradesWithoutStrategy.length,
      strategiesFound,
      strategiesNotFound,
      matchingOrders: matchingOrders.length,
      totalOrdersInDB,
      ordersWithStrategy,
      strategyDistribution: Object.fromEntries(strategyDistribution)
    };
    
  } catch (error) {
    console.error('❌ 調査エラー:', error);
    throw error;
  }
}

// スクリプト実行
if (require.main === module) {
  investigateHistoricalData().then((result) => {
    console.log(`\\n📊 最終結果: ${result.sampleTrades}件中${result.strategiesFound}件で戦略復元可能`);
    process.exit(0);
  }).catch((error) => {
    console.error('❌ スクリプト実行失敗:', error);
    process.exit(1);
  });
}

module.exports = { investigateHistoricalData };