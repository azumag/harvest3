#!/usr/bin/env node
/**
 * scripts/emergency-balance-fix-optimized.js
 * Issue #234: 残高整合性緊急修正 (最適化版)
 * 
 * 使用方法: node scripts/emergency-balance-fix-optimized.js
 */

const { exchangeBB } = require('../src/config');
const { initRedisClient } = require('../src/database/redisClient');

async function emergencyBalanceFix() {
  console.log('=== 残高整合性緊急修正 ===');
  console.log('実行時刻:', new Date().toLocaleString());
  console.log('');

  let redis = null;
  
  try {
    // 1. 取引所残高を取得
    console.log('1. 取引所残高取得中...');
    const balance = await exchangeBB.fetchBalance();
    const realBalance = balance.free.JPY || 0;
    console.log('取得した残高:', realBalance, 'JPY');
    
    // 2. Redis残高を更新
    console.log('2. Redis残高更新中...');
    redis = await initRedisClient();
    if (redis) {
      await redis.set('balance:bitbank:JPY', realBalance.toString());
      console.log('Redis残高を', realBalance, 'に更新');
    } else {
      throw new Error('Redis接続失敗');
    }
    
    // 3. データベース残高を更新（機能があれば）
    console.log('3. データベース残高更新中...');
    try {
      const { updateBalance } = require('../src/database/manager');
      if (typeof updateBalance === 'function') {
        await updateBalance('bitbank', 'JPY', realBalance);
        console.log('データベース残高更新完了');
      } else {
        console.log('updateBalance関数が見つかりません。スキップします。');
      }
    } catch (error) {
      console.warn('データベース残高更新エラー:', error.message);
      console.log('データベース更新をスキップして続行します。');
    }
    
    // 4. 検証
    console.log('');
    console.log('=== 修正後検証 ===');
    
    // 取引所残高再確認
    console.log('修正後の状態確認:');
    const verifyBalance = await exchangeBB.fetchBalance();
    console.log('取引所残高:', verifyBalance.free.JPY || 0, 'JPY');
    
    // Redis残高再確認
    const redisBalance = await redis.get('balance:bitbank:JPY');
    console.log('Redis残高:', redisBalance || 'データなし', 'JPY');
    
    // 乖離計算
    const exchangeBalance = verifyBalance.free.JPY || 0;
    const managedBalance = isNaN(parseFloat(redisBalance)) ? 0 : parseFloat(redisBalance);
    if (isNaN(managedBalance)) {
      console.warn('Invalid Redis balance value:', redisBalance);
    }
    const balanceDiscrepancy = Math.abs(exchangeBalance - managedBalance);
    
    console.log('');
    console.log('乖離状況:');
    console.log('- 取引所:', exchangeBalance, 'JPY');
    console.log('- 管理値:', managedBalance, 'JPY');
    console.log('- 乖離:', balanceDiscrepancy.toFixed(4), 'JPY');
    
    if (balanceDiscrepancy < 0.01) {
      console.log('✅ 残高整合性が正常に修正されました');
    } else {
      console.log('⚠️ 残高乖離が残っています。追加確認が必要です。');
    }
    
    console.log('');
    console.log('✅ 修正完了:', new Date().toLocaleString());
    
  } catch (error) {
    console.error('❌ 緊急修正実行エラー:', error.message);
    process.exit(1);
  } finally {
    // Redis接続を明示的に閉じる
    if (redis) {
      try {
        await redis.quit();
      } catch (closeError) {
        console.warn('Redis接続終了エラー:', closeError.message);
      }
    }
  }
}

// スクリプトとして実行された場合のみ実行
if (require.main === module) {
  emergencyBalanceFix()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('スクリプト実行エラー:', error.message);
      process.exit(1);
    });
}

module.exports = { emergencyBalanceFix };