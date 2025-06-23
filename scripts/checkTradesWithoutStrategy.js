#!/usr/bin/env node

/**
 * 戦略キーが設定されていない約定の調査スクリプト
 * 
 * MongoDBで戦略キーがnull、undefined、または不正な値の約定を調査
 */

const { connectDB } = require('../src/database/mongoDatabase');

async function checkTradesWithoutStrategy() {
  console.log('🔍 戦略キー未設定約定調査開始');
  console.log('================================================================================');
  
  try {
    await connectDB();
    
    const mongoModule = require('../src/database/mongoDatabase');
    const tradesCollection = mongoModule.tradesCollection;
    
    if (!tradesCollection) {
      throw new Error('MongoDB trades collection not available');
    }
    
    console.log('✅ MongoDB接続完了');
    console.log('');
    
    // 1. 全約定数
    const totalTrades = await tradesCollection.countDocuments({});
    console.log(`📊 全約定数: ${totalTrades}件`);
    
    // 2. 戦略キーが存在しない約定
    const tradesWithoutStrategyKey = await tradesCollection.find({
      $or: [
        { strategyKey: { $exists: false } },
        { strategyKey: null },
        { strategyKey: "" },
        { strategyKey: undefined }
      ]
    }).sort({ filledAt: -1 }).limit(10).toArray();
    
    console.log(`📈 戦略キー未設定約定: ${tradesWithoutStrategyKey.length}件（直近10件まで表示）`);
    
    // 3. 戦略キー別の統計
    const strategyStats = await tradesCollection.aggregate([
      {
        $group: {
          _id: "$strategyKey",
          count: { $sum: 1 },
          firstTrade: { $min: "$filledAt" },
          lastTrade: { $max: "$filledAt" }
        }
      },
      { $sort: { count: -1 } }
    ]).toArray();
    
    console.log(`\n🔬 戦略キー別統計:`);
    for (const stat of strategyStats) {
      const strategyName = stat._id || '(未設定)';
      console.log(`  ${strategyName}: ${stat.count}件 (${new Date(stat.firstTrade).toLocaleDateString()} - ${new Date(stat.lastTrade).toLocaleDateString()})`);
    }
    
    // 4. 戦略キー未設定約定の詳細
    if (tradesWithoutStrategyKey.length > 0) {
      console.log(`\n📋 戦略キー未設定約定の詳細:`);
      for (let i = 0; i < Math.min(5, tradesWithoutStrategyKey.length); i++) {
        const trade = tradesWithoutStrategyKey[i];
        console.log(`  [${i + 1}] ${trade.symbol} ${trade.side} ${trade.amount}`);
        console.log(`      約定時刻: ${new Date(trade.filledAt).toLocaleString()}`);
        console.log(`      オーダーID: ${trade.orderId}`);
        console.log(`      戦略キー: ${trade.strategyKey}`);
        console.log(`      価格: ${trade.price}`);
        console.log('');
      }
    }
    
    // 5. 現在のOUTSIDE約定数も確認
    const outsideTrades = await tradesCollection.countDocuments({ strategyKey: 'OUTSIDE' });
    console.log(`📊 現在のOUTSIDE約定数: ${outsideTrades}件`);
    
    // 6. 最近の約定の戦略キー分布（直近100件）
    const recentTrades = await tradesCollection.find({}).sort({ filledAt: -1 }).limit(100).toArray();
    const recentStrategyCount = new Map();
    
    for (const trade of recentTrades) {
      const key = trade.strategyKey || '(未設定)';
      recentStrategyCount.set(key, (recentStrategyCount.get(key) || 0) + 1);
    }
    
    console.log(`\n📈 直近100件の戦略キー分布:`);
    for (const [strategy, count] of Array.from(recentStrategyCount.entries()).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${strategy}: ${count}件`);
    }
    
    console.log('');
    console.log('================================================================================');
    console.log('🎯 調査結果サマリー:');
    console.log(`📊 全約定数: ${totalTrades}件`);
    console.log(`❌ 戦略キー未設定: ${tradesWithoutStrategyKey.length}件`);
    console.log(`🏷️  OUTSIDE約定: ${outsideTrades}件`);
    console.log(`📈 戦略種類数: ${strategyStats.length}種類`);
    
    return {
      totalTrades,
      tradesWithoutStrategy: tradesWithoutStrategyKey.length,
      outsideTrades,
      strategyCount: strategyStats.length,
      strategyStats
    };
    
  } catch (error) {
    console.error('❌ 調査エラー:', error);
    throw error;
  }
}

// スクリプト実行
if (require.main === module) {
  checkTradesWithoutStrategy().then((result) => {
    console.log(`\n📊 最終結果: ${result.totalTrades}件中${result.tradesWithoutStrategy}件が戦略キー未設定`);
    process.exit(0);
  }).catch((error) => {
    console.error('❌ スクリプト実行失敗:', error);
    process.exit(1);
  });
}

module.exports = { checkTradesWithoutStrategy };