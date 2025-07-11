#!/bin/bash
# scripts/balance-monitor.sh
# Issue #234: 残高整合性予防監視 スクリプト
# crontab: */5 * * * * /Users/azumag/work/harvest3/scripts/balance-monitor.sh

# 設定
THRESHOLD=1.0  # 1JPY以上の乖離で警告
LOG_FILE="/tmp/balance-monitor.log"
ALERT_LOG="/tmp/balance-alert.log"

# Node.jsプロジェクトのルートディレクトリに移動
cd "$(dirname "$0")/.."

# ログファイルの準備
echo "=== 残高監視 $(date) ===" >> "$LOG_FILE"

# 取引所残高取得
REAL_BALANCE=$(node -e "
const { exchangeBB } = require('./src/config');
(async () => {
  try {
    const balance = await exchangeBB.fetchBalance();
    const jpyBalance = balance.free.JPY || 0;
    console.log(jpyBalance);
  } catch (error) {
    console.error('取引所残高取得エラー:', error.message);
    console.log('0');
  }
})();
" 2>/dev/null)

# Redis残高取得
MANAGED_BALANCE=$(node -e "
const { initRedisClient } = require('./src/database/redisClient');
(async () => {
  try {
    const redis = await initRedisClient();
    if (redis) {
      const jpyBalance = await redis.get('balance:bitbank:JPY');
      console.log(jpyBalance || '0');
    } else {
      console.log('0');
    }
  } catch (error) {
    console.error('Redis残高取得エラー:', error.message);
    console.log('0');
  }
})();
" 2>/dev/null)

# 乖離計算
DIFF=$(echo "scale=4; $REAL_BALANCE - $MANAGED_BALANCE" | bc 2>/dev/null || echo "0")
ABS_DIFF=$(echo "scale=4; if ($DIFF < 0) -$DIFF else $DIFF" | bc 2>/dev/null || echo "0")

# ログ記録
echo "取引所残高: $REAL_BALANCE JPY" >> "$LOG_FILE"
echo "管理残高: $MANAGED_BALANCE JPY" >> "$LOG_FILE"
echo "乖離: $DIFF JPY" >> "$LOG_FILE"

# 乖離チェック
if (( $(echo "$ABS_DIFF > $THRESHOLD" | bc -l 2>/dev/null) )); then
  ALERT_MSG="⚠️ 残高乖離検出: $DIFF JPY (閾値: $THRESHOLD JPY)"
  echo "$ALERT_MSG" >> "$ALERT_LOG"
  echo "$(date): $ALERT_MSG" >> "$LOG_FILE"
  
  # Discord通知（環境変数があれば）
  if [ -n "$DISCORD_WEBHOOK_URL" ]; then
    curl -X POST "$DISCORD_WEBHOOK_URL" \
      -H "Content-Type: application/json" \
      -d "{\"content\": \"🚨 **残高乖離アラート**\\n残高乖離: $DIFF JPY\\n取引所残高: $REAL_BALANCE JPY\\n管理残高: $MANAGED_BALANCE JPY\\n時刻: $(date)\"}" \
      2>/dev/null
  fi
  
  # コンソール出力（cron実行時はメール通知される）
  echo "残高乖離アラート: $DIFF JPY"
else
  echo "残高整合性OK: 乖離 $DIFF JPY" >> "$LOG_FILE"
fi

# ログファイルのローテーション（1000行以上で古いログを削除）
if [ -f "$LOG_FILE" ]; then
  LINE_COUNT=$(wc -l < "$LOG_FILE")
  if [ "$LINE_COUNT" -gt 1000 ]; then
    tail -n 500 "$LOG_FILE" > "${LOG_FILE}.tmp"
    mv "${LOG_FILE}.tmp" "$LOG_FILE"
  fi
fi

echo "完了: $(date)" >> "$LOG_FILE"
echo "---" >> "$LOG_FILE"