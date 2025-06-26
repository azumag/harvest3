# 🚨 filled_trade削除 緊急ロールバック手順書

## 🎯 目的
filled_trade削除作業中に問題が発生した場合の緊急対応手順

## ⚠️ 緊急停止手順

### 1. システム緊急停止
```bash
# 全Dockerコンテナ停止
docker-compose down

# 個別サービス停止（必要に応じて）
docker stop strategy-runner
docker stop hft  
docker stop backtest
docker stop trade_viewer
```

### 2. 削除作業の即座停止
```bash
# 削除スクリプトが実行中の場合
Ctrl+C  # プロセス強制終了

# tmuxセッションで実行中の場合
tmux kill-session -t <セッション名>
```

## 🔄 ロールバック手順

### Phase 1: バックアップ確認
```bash
# バックアップファイル確認
ls -la /Users/azumag/work/harvest3/filled_trade_backup_*.json

# バックアップ内容確認
head -20 filled_trade_backup_<timestamp>.json
```

### Phase 2: データ復元
```bash
# 復元スクリプト実行
node scripts/filled_trade_restore.js filled_trade_backup_<timestamp>.json
```

### Phase 3: システム再起動
```bash
# Dockerサービス再起動
docker-compose up -d

# 起動確認
docker-compose ps
```

### Phase 4: 動作確認
```bash
# Redis接続確認
redis-cli -h redis -p 6379 ping

# filled_tradeキー確認
redis-cli -h redis -p 6379 keys "filled_trade:*" | wc -l

# 監視システム確認
node scripts/startBasicAnomalyDetector.js
```

## 🔍 問題判定基準

### 🔴 緊急停止すべき状況
- システムエラー発生率 > 10%
- 取引実行の完全停止
- 監視システムの異常終了
- Redis接続エラーの頻発

### 🟡 注意深く監視すべき状況  
- 分析スクリプトの警告メッセージ
- 監視システムのアラート増加
- パフォーマンス低下（レスポンス > 5秒）

## 📋 復元後確認チェックリスト

### ✅ データ整合性
- [ ] filled_tradeキー数が復元前と一致
- [ ] サンプルデータの内容確認
- [ ] MongoDB tradesとの整合性確認

### ✅ システム動作
- [ ] 監視システム正常動作
- [ ] 全分析スクリプト正常実行
- [ ] Web UIの取引サマリー表示

### ✅ 依存システム
- [ ] basicAnomalyDetector正常動作
- [ ] deepSignalAnalysis正常実行
- [ ] 他7つの分析スクリプト正常実行

## 📞 緊急連絡先

**システム管理者**: manager-claude (tmux)
**報告方法**: 
```bash
tmux send-keys -t "manager-claude" "🚨 緊急事態: filled_trade削除でシステム障害発生" Enter
```

## 📝 インシデント記録

### 記録すべき情報
- 発生時刻
- エラーメッセージ
- 実行していた削除段階
- 影響範囲
- 復旧完了時刻

### 記録方法
```bash
echo "$(date): [ERROR] <エラー内容>" >> /Users/azumag/work/harvest3/filled_trade_incident.log
```

---

**重要**: この手順書は緊急時に備えて常に最新の状態に保つこと