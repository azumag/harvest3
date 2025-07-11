#!/bin/bash
# scripts/emergency-balance-check.sh
# Issue #234: 残高整合性緊急チェック スクリプト

echo "=== 残高整合性緊急チェック ==="
echo "実行時刻: $(date)"
echo ""

# Node.jsプロジェクトのルートディレクトリに移動
cd "$(dirname "$0")/.."

# 取引所残高確認
echo "1. 取引所残高確認"
node -e "
const { exchangeBB } = require('./src/config');
(async () => {
  try {
    const balance = await exchangeBB.fetchBalance();
    console.log('bitbank JPY free:', balance.free.JPY || 0);
    console.log('bitbank JPY total:', balance.total.JPY || 0);
  } catch (error) {
    console.error('取引所残高取得エラー:', error.message);
  }
})();
"

echo ""

# Redis残高確認
echo "2. Redis管理残高確認"
node -e "
const { initRedisClient } = require('./src/database/redisClient');
(async () => {
  try {
    const redis = await initRedisClient();
    if (redis) {
      const jpyBalance = await redis.get('balance:bitbank:JPY');
      console.log('Redis JPY残高:', jpyBalance || 'データなし');
    } else {
      console.log('Redis接続失敗');
    }
  } catch (error) {
    console.error('Redis残高取得エラー:', error.message);
  }
})();
"

echo ""

# ポジション合計確認
echo "3. ポジション合計確認"
node -e "
const { getPositions } = require('./src/database/manager');
(async () => {
  try {
    const positions = await getPositions('bitbank');
    const jpyPositions = positions.filter(p => p.currency === 'JPY');
    const jpyTotal = jpyPositions.reduce((sum, p) => sum + (p.amount || 0), 0);
    console.log('ポジション合計 JPY:', jpyTotal);
    console.log('JPYポジション数:', jpyPositions.length);
  } catch (error) {
    console.error('ポジション取得エラー:', error.message);
  }
})();
"

echo ""
echo "=== チェック完了 ==="