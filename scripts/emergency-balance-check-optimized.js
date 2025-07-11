#!/usr/bin/env node
/**
 * scripts/emergency-balance-check-optimized.js
 * Issue #234: 残高整合性緊急チェック (最適化版)
 * 
 * 使用方法: node scripts/emergency-balance-check-optimized.js
 */

const { exchangeBB } = require('../src/config');
const { initRedisClient } = require('../src/database/redisClient');

async function emergencyBalanceCheck() {
  console.log('=== 残高整合性緊急チェック ===');
  console.log('実行時刻:', new Date().toLocaleString());
  console.log('');

  let redis = null;
  
  try {
    // 1. 取引所残高確認
    console.log('1. 取引所残高確認');
    try {
      const balance = await exchangeBB.fetchBalance();
      console.log('bitbank JPY free:', balance.free.JPY || 0);
      console.log('bitbank JPY total:', balance.total.JPY || 0);
    } catch (error) {
      console.error('取引所残高取得エラー:', error.message);
    }
    
    console.log('');
    
    // 2. Redis残高確認
    console.log('2. Redis管理残高確認');
    try {
      redis = await initRedisClient();
      if (redis) {
        const jpyBalance = await redis.get('balance:bitbank:JPY');
        console.log('Redis JPY残高:', jpyBalance || 'データなし');
      } else {
        console.log('Redis接続失敗');
      }
    } catch (error) {
      console.error('Redis残高取得エラー:', error.message);
    }
    
    console.log('');
    
    // 3. ポジション合計確認（簡略版）
    console.log('3. ポジション合計確認');
    try {
      // database/manager.jsの関数が重い場合があるため、直接Redisから確認
      if (redis) {
        let keys = [];
        let cursor = '0';
        do {
          const [newCursor, batchKeys] = await redis.scan(cursor, 'MATCH', 'position:*:JPY', 'COUNT', 100);
          cursor = newCursor;
          keys = keys.concat(batchKeys);
        } while (cursor !== '0');
        
        console.log('JPYポジション数:', keys.length);
        
        // 合計計算（設定可能な制限値）
        const POSITION_LIMIT = process.env.POSITION_CHECK_LIMIT || 100;
        let jpyTotal = 0;
        const limitedKeys = keys.slice(0, POSITION_LIMIT);
        for (const key of limitedKeys) {
          const positionData = await redis.get(key);
          if (positionData) {
            try {
              const position = JSON.parse(positionData);
              jpyTotal += position.amount || 0;
            } catch (parseError) {
              // JSONパースエラーは無視
            }
          }
        }
        console.log(`ポジション合計 JPY (最初の${POSITION_LIMIT}件):`, jpyTotal);
        
        if (keys.length > POSITION_LIMIT) {
          console.log('※ 設定制限以上のポジションが存在します。詳細確認が必要です。');
        }
      } else {
        console.log('Redis接続なし - ポジション確認不可');
      }
    } catch (error) {
      console.error('ポジション取得エラー:', error.message);
    }
    
    console.log('');
    console.log('=== チェック完了 ===');
    
  } catch (error) {
    console.error('緊急チェック実行エラー:', error.message);
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
  emergencyBalanceCheck()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('スクリプト実行エラー:', error.message);
      process.exit(1);
    });
}

module.exports = { emergencyBalanceCheck };