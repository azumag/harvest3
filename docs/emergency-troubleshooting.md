# 🚨 緊急対応・トラブルシューティング

> **パニック状態の開発者へ**: このドキュメントは緊急事態に即座に対処するためのものです。症状を確認し、対応するコマンドを実行してください。

## 🔥 最も頻発するエラーと即座の対処法

### `throttle queue is over maxCapacity` エラー

**症状**
```
エラー例: throttle queue is over maxCapacity (1000), see https://github.com/ccxt/ccxt/issues/11645
```

**🚑 即座の対処法（30秒で実行）**
```bash
# 1. システムを一時停止
pkill -f "node.*bot" || docker compose stop bot

# 2. 緊急設定で再開（大幅な制限緩和）
export EXCHANGE_RATE_LIMIT=15000           # 15秒間隔
export EXCHANGE_MAX_CONCURRENT_PAIRS=1     # 1ペアのみ
export EXCHANGE_EXECUTION_DELAY_MS=5000    # 5秒遅延

# 3. システム再開
npm start
# または docker compose up -d bot
```

**🔍 原因確認（5分で完了）**
```bash
# 現在の設定値を確認
echo "=== EXCHANGE_SETTINGS ==="
grep -A 15 "EXCHANGE_SETTINGS" src/common/const.js

echo "=== 実際のccxt設定 ==="
node -e "console.log('maxThrottleQueueSize:', require('./src/config.js').exchangeBB.options.maxThrottleQueueSize || 'undefined')"

echo "=== 環境変数の確認 ==="
env | grep EXCHANGE_
```

**🛠️ 根本対策（15分で完了）**
```bash
# 1. 設定ファイルを直接修正（推奨）
# src/common/const.js を編集:
# RATE_LIMIT: 8000 以上に設定
# MAX_THROTTLE_QUEUE_SIZE: 2000 以上に設定

# 2. システム再起動
npm start

# 3. 動作確認
tail -f logs/app.log | grep -E "(throttle|queue|maxCapacity)"
```

## 🗄️ MongoDB関連エラー

### E11000 重複キーエラー

**症状**
```
MongoServerError: E11000 duplicate key error collection
```

**対処法**
```bash
# 1. 重複データの確認
mongo harvest3 --eval "db.collection.find({'_id': ObjectId('...')}).count()"

# 2. 重複データの削除（注意：バックアップ必須）
mongo harvest3 --eval "db.collection.deleteOne({'_id': ObjectId('...')})"

# 3. インデックスの再構築
mongo harvest3 --eval "db.collection.reIndex()"
```

## 🔌 Redis接続エラー

**症状**
```
Redis connection failed
```

**対処法**
```bash
# 1. Redis状態確認
redis-cli ping

# 2. Redis再起動
sudo systemctl restart redis
# または docker compose restart redis

# 3. 接続確認
redis-cli info
```

## 🌐 API接続エラー

### Bitbank API エラー

**症状**
```
Request failed with status code 429 (Too Many Requests)
```

**対処法**
```bash
# 1. レート制限の一時緩和
export BB_API_RATE_LIMIT=10000  # 10秒間隔

# 2. 並列実行の制限
export MAX_CONCURRENT_PAIRS=1

# 3. システム再起動
npm start
```

## 📊 システム負荷が高い場合

**確認コマンド**
```bash
# CPU使用率
top -p $(pgrep -f "node.*bot")

# メモリ使用量
ps aux | grep "node.*bot"

# ファイルディスクリプタ数
lsof -p $(pgrep -f "node.*bot") | wc -l
```

**対処法**
```bash
# 1. 戦略の一時無効化
export STRATEGY_MULTI_INDICATOR_ENABLED=false
export STRATEGY_OSCILLATOR_ENABLED=false

# 2. データ収集頻度の削減
export OHLCV_FETCH_INTERVAL=300000  # 5分間隔

# 3. システム再起動
npm start
```

## 📞 緊急連絡・エスカレーション

重大な障害が発生し、上記の対処法で解決しない場合：

1. **システムの完全停止**
   ```bash
   pkill -f "node.*bot"
   docker compose down
   ```

2. **ログの保存**
   ```bash
   cp logs/app.log logs/emergency-$(date +%Y%m%d_%H%M%S).log
   ```

3. **Discord通知の確認**
   - エラー通知チャンネルを確認
   - システム状態の最終報告を確認

4. **バックアップからの復旧準備**
   - データベースの最新バックアップを確認
   - 設定ファイルのバックアップを確認