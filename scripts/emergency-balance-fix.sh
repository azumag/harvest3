#!/bin/bash
# scripts/emergency-balance-fix.sh
# Issue #234: 残高整合性緊急修正 スクリプト

echo "=== 残高整合性緊急修正 ==="
echo "実行時刻: $(date)"
echo ""

# Node.jsプロジェクトのルートディレクトリに移動
cd "$(dirname "$0")/.."

# 1. 取引所残高を取得して変数に保存
echo "1. 取引所残高取得中..."
REAL_BALANCE=$(node -e "
const { exchangeBB } = require('./src/config');
(async () => {
  try {
    const balance = await exchangeBB.fetchBalance();
    const jpyBalance = balance.free.JPY || 0;
    console.log(jpyBalance);
  } catch (error) {
    console.error('取引所残高取得エラー:', error.message);
    process.exit(1);
  }
})();
")

if [ $? -ne 0 ]; then
  echo "❌ 取引所残高取得に失敗しました"
  exit 1
fi

echo "取得した残高: $REAL_BALANCE JPY"

# 2. Redis残高を更新
echo "2. Redis残高更新中..."
node -e "
const { initRedisClient } = require('./src/database/redisClient');
(async () => {
  try {
    const redis = await initRedisClient();
    if (redis) {
      await redis.set('balance:bitbank:JPY', '$REAL_BALANCE');
      console.log('Redis残高を $REAL_BALANCE に更新');
    } else {
      console.error('Redis接続失敗');
      process.exit(1);
    }
  } catch (error) {
    console.error('Redis残高更新エラー:', error.message);
    process.exit(1);
  }
})();
"

if [ $? -ne 0 ]; then
  echo "❌ Redis残高更新に失敗しました"
  exit 1
fi

# 3. データベース残高を更新（該当する機能があれば）
echo "3. データベース残高更新中..."
node -e "
const { updateBalance } = require('./src/database/manager');
(async () => {
  try {
    // updateBalance関数が存在するか確認
    if (typeof updateBalance === 'function') {
      await updateBalance('bitbank', 'JPY', $REAL_BALANCE);
      console.log('データベース残高更新完了');
    } else {
      console.log('updateBalance関数が見つかりません。スキップします。');
    }
  } catch (error) {
    console.error('データベース残高更新エラー:', error.message);
    // データベース更新失敗は警告レベルとして処理継続
  }
})();
"

# 4. 検証
echo ""
echo "=== 修正後検証 ==="
echo "修正後の状態確認:"

# 取引所残高再確認
echo "取引所残高:"
node -e "
const { exchangeBB } = require('./src/config');
(async () => {
  try {
    const balance = await exchangeBB.fetchBalance();
    console.log('  JPY:', balance.free.JPY || 0);
  } catch (error) {
    console.error('  取得エラー:', error.message);
  }
})();
"

# Redis残高再確認
echo "Redis残高:"
node -e "
const { initRedisClient } = require('./src/database/redisClient');
(async () => {
  try {
    const redis = await initRedisClient();
    if (redis) {
      const jpyBalance = await redis.get('balance:bitbank:JPY');
      console.log('  JPY:', jpyBalance || 'データなし');
    } else {
      console.log('  Redis接続失敗');
    }
  } catch (error) {
    console.error('  取得エラー:', error.message);
  }
})();
"

echo ""
echo "✅ 修正完了: $(date)"
echo "残高整合性が修正されました"