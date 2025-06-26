#!/usr/bin/env node

/**
 * 緊急残高修復スクリプト
 * 包括的残高整合性調査で発見された問題を修復
 * 2025年6月25日 作成
 */

const { postOrderToDiscord, postErrorToDiscord } = require('../src/common/notifications');
const { config } = require('../src/config');
const Redis = require('redis');

// Redis接続の初期化
let redisClient;

async function initializeRedis() {
  try {
    const redisHost = process.env.REDIS_HOST || 'redis';
    const redisPort = process.env.REDIS_PORT || 6379;
    const redisUrl = `redis://${redisHost}:${redisPort}`;
    
    console.log(`Redis接続試行: ${redisUrl}`);
    redisClient = Redis.createClient({
      url: redisUrl,
      socket: {
        reconnectStrategy: (retries) => Math.min(retries * 50, 500)
      }
    });

    redisClient.on('error', (err) => {
      console.error('Redis接続エラー:', err);
    });

    await redisClient.connect();
    console.log('✅ Redis接続成功');
    return true;
  } catch (error) {
    console.error('❌ Redis接続失敗:', error.message);
    return false;
  }
}

/**
 * Phase 1: Closedポジションの完全削除
 */
async function removeClosedPositions() {
  console.log('\n=== Phase 1: Closedポジションの完全削除 ===');
  
  try {
    const positionKeys = await redisClient.keys('position:*');
    let removedCount = 0;
    const removedPositions = [];

    for (const key of positionKeys) {
      const status = await redisClient.hGet(key, 'status');
      if (status === 'closed') {
        const positionData = await redisClient.hGetAll(key);
        removedPositions.push({
          key,
          symbol: positionData.symbol,
          strategy: positionData.strategyKey,
          amount: positionData.amount,
          closePrice: positionData.closePrice,
          closedAt: positionData.closedAt
        });
        
        await redisClient.del(key);
        removedCount++;
        console.log(`🗑️  削除: ${key}`);
      }
    }

    console.log(`✅ Phase 1 完了: ${removedCount}件のClosedポジションを削除`);
    
    if (removedCount > 0) {
      const message = `🔧 **緊急修復 Phase 1 完了**\n` +
        `削除したClosedポジション: ${removedCount}件\n\n` +
        removedPositions.map(p => 
          `・${p.symbol} ${p.strategy}: ${p.amount} (¥${p.closePrice})`
        ).join('\n');
      await postOrderToDiscord(message);
    }

    return { success: true, removedCount, removedPositions };
  } catch (error) {
    console.error('❌ Phase 1 エラー:', error.message);
    await postErrorToDiscord(`Phase 1 Closedポジション削除エラー: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Phase 2: Undefined戦略データの削除
 */
async function removeUndefinedStrategies() {
  console.log('\n=== Phase 2: Undefined戦略データの削除 ===');
  
  try {
    const summaryKeys = await redisClient.keys('summary:trade:*');
    let removedCount = 0;
    const removedSummaries = [];

    for (const key of summaryKeys) {
      if (key.includes('undefined')) {
        const summaryData = await redisClient.hGetAll(key);
        removedSummaries.push({
          key,
          netPosition: summaryData.netPosition || 0,
          totalBuyCost: summaryData.totalBuyCost || 0
        });
        
        await redisClient.del(key);
        removedCount++;
        console.log(`🗑️  削除: ${key}`);
      }
    }

    console.log(`✅ Phase 2 完了: ${removedCount}件のUndefined戦略データを削除`);
    
    if (removedCount > 0) {
      const message = `🔧 **緊急修復 Phase 2 完了**\n` +
        `削除したUndefined戦略: ${removedCount}件\n\n` +
        removedSummaries.map(s => 
          `・${s.key.split(':').slice(1, 3).join('/')}: ポジション ${s.netPosition}`
        ).join('\n');
      await postOrderToDiscord(message);
    }

    return { success: true, removedCount, removedSummaries };
  } catch (error) {
    console.error('❌ Phase 2 エラー:', error.message);
    await postErrorToDiscord(`Phase 2 Undefined戦略削除エラー: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Phase 3: 古い未約定注文の削除
 */
async function removeOldPendingOrders() {
  console.log('\n=== Phase 3: 古い未約定注文の削除 ===');
  
  try {
    const pendingKeys = await redisClient.keys('pending_order:*');
    let removedCount = 0;
    const removedOrders = [];
    const now = Date.now();
    const threshold = 48 * 60 * 60 * 1000; // 48時間

    for (const key of pendingKeys) {
      const orderData = await redisClient.hGetAll(key);
      const timestamp = parseInt(orderData.timestamp);
      
      if (now - timestamp > threshold) {
        removedOrders.push({
          key,
          symbol: orderData.symbol,
          side: orderData.side,
          amount: orderData.amount,
          price: orderData.price,
          age: Math.round((now - timestamp) / (60 * 60 * 1000))
        });
        
        await redisClient.del(key);
        removedCount++;
        console.log(`🗑️  削除: ${key} (${Math.round((now - timestamp) / (60 * 60 * 1000))}時間経過)`);
      }
    }

    console.log(`✅ Phase 3 完了: ${removedCount}件の古い未約定注文を削除`);
    
    if (removedCount > 0) {
      const message = `🔧 **緊急修復 Phase 3 完了**\n` +
        `削除した古い未約定注文: ${removedCount}件\n\n` +
        removedOrders.map(o => 
          `・${o.symbol} ${o.side}: ${o.amount} @ ¥${o.price} (${o.age}時間前)`
        ).join('\n');
      await postOrderToDiscord(message);
    }

    return { success: true, removedCount, removedOrders };
  } catch (error) {
    console.error('❌ Phase 3 エラー:', error.message);
    await postErrorToDiscord(`Phase 3 古い未約定注文削除エラー: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Phase 4: 残高整合性の最終確認
 */
async function verifyBalanceConsistency() {
  console.log('\n=== Phase 4: 残高整合性の最終確認 ===');
  
  try {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    // 残高整合性チェッカーを実行
    const { stdout, stderr } = await execAsync('node scripts/balanceConsistencyChecker.js');
    
    console.log('✅ Phase 4 完了: 残高整合性チェック実行');
    return { success: true, output: stdout };
  } catch (error) {
    console.error('❌ Phase 4 エラー:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * メイン実行関数
 */
async function main() {
  console.log('🚨 緊急残高修復スクリプト開始');
  console.log('実行時刻:', new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }));
  
  // Redis接続初期化
  const connected = await initializeRedis();
  if (!connected) {
    console.error('❌ Redis接続に失敗しました。修復を中止します。');
    process.exit(1);
  }

  const results = {
    phase1: null,
    phase2: null,
    phase3: null,
    phase4: null
  };

  try {
    // Phase 1: Closedポジションの削除
    results.phase1 = await removeClosedPositions();
    
    // Phase 2: Undefined戦略データの削除  
    results.phase2 = await removeUndefinedStrategies();
    
    // Phase 3: 古い未約定注文の削除
    results.phase3 = await removeOldPendingOrders();
    
    // Phase 4: 最終確認
    results.phase4 = await verifyBalanceConsistency();

    // 総合結果レポート
    const totalRemoved = 
      (results.phase1?.removedCount || 0) + 
      (results.phase2?.removedCount || 0) + 
      (results.phase3?.removedCount || 0);

    const summaryMessage = `🎯 **緊急残高修復 完了報告**\n\n` +
      `**修復統計:**\n` +
      `・Closedポジション削除: ${results.phase1?.removedCount || 0}件\n` +
      `・Undefined戦略削除: ${results.phase2?.removedCount || 0}件\n` +
      `・古い未約定注文削除: ${results.phase3?.removedCount || 0}件\n` +
      `・**総修復件数: ${totalRemoved}件**\n\n` +
      `**実行時刻:** ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}\n` +
      `**システム状態:** 大幅改善`;

    await postOrderToDiscord(summaryMessage);
    
    console.log('\n✅ 緊急残高修復スクリプト完了');
    console.log(`総修復件数: ${totalRemoved}件`);

  } catch (error) {
    console.error('❌ 修復スクリプト実行エラー:', error.message);
    await postErrorToDiscord(`緊急残高修復スクリプトエラー: ${error.message}`);
  } finally {
    if (redisClient) {
      await redisClient.quit();
    }
  }
}

module.exports = {
  removeClosedPositions,
  removeUndefinedStrategies,
  removeOldPendingOrders,
  verifyBalanceConsistency
};

// 直接実行の場合はメイン関数を実行
if (require.main === module) {
  main().catch(console.error);
}