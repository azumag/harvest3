# 残高チェック手動実行ガイド

## 概要

harvest3の残高チェック機能を手動で実行する方法について説明します。通常は1時間毎に自動実行されますが、テストや緊急時の確認のために手動実行が可能です。

## 実行方法

### 1. Makefileコマンド（推奨）

最も簡単で使いやすい方法です。

```bash
# 詳細ログ付きで実行
make balance-check

# 結果のみ表示（静粛モード）
make balance-check-quiet
```

### 2. 専用スクリプト

カスタムオプションが必要な場合に使用します。

```bash
# 基本実行
./scripts/manual-balance-check.sh

# 静粛モード
./scripts/manual-balance-check.sh --quiet

# 結果をファイルに出力
./scripts/manual-balance-check.sh --output balance-result.json

# ヘルプ表示
./scripts/manual-balance-check.sh --help
```

### 3. 開発者向けテストスクリプト

詳細なデバッグ情報が必要な場合に使用します。

```bash
node test_balance_checker.js
```

## 出力例

### 正常実行時の出力

```json
[
  {
    "exchangeId": "bitbank",
    "discrepancies": [
      {
        "currency": "JPY", 
        "exchangeAmount": 10336.7805,
        "botAmount": 0,
        "difference": 10336.7805,
        "discrepancyPercent": 100
      }
    ],
    "isHealthy": false
  }
]
```

### 各フィールドの説明

- `exchangeId`: 取引所名
- `currency`: 通貨名
- `exchangeAmount`: 取引所での実際の残高
- `botAmount`: botが管理している残高
- `difference`: 差異の絶対値
- `discrepancyPercent`: 差異の比率（%）
- `isHealthy`: 残高が一致している場合はtrue

## 注意事項

### Redis接続について

- botが正常に動作している場合、Redis接続により正確なbot管理残高を取得できます
- Redisが停止している場合、botAmount は 0 として表示されます

### Discord通知について

- 手動実行時はDiscord通知は送信されません
- 自動実行（1時間毎）では差異検出時にDiscord通知が送信されます

### 実行タイミング

- いつでも実行可能ですが、取引所APIの制限に注意してください
- 連続実行する場合は、数分間隔を空けることを推奨します

## トラブルシューティング

### よくあるエラー

1. **Redis接続エラー**
   ```
   ClientClosedError: The client is closed
   ```
   → Redisサービスが停止している場合の正常な動作です

2. **取引所API接続エラー**  
   → ネットワーク接続またはAPI制限の可能性があります

3. **Docker同期エラー**
   → `make restart-bot` でコンテナを再起動してください

### 確認コマンド

```bash
# サービス状況確認
docker compose ps

# Redisサービス確認
docker compose logs redis

# Botサービス確認  
docker compose logs bot --tail 20
```

## 自動実行について

残高チェックは通常、以下のスケジュールで自動実行されます：

- **実行間隔**: 1時間毎
- **実行タイミング**: 毎時0分
- **対象**: config.jsで設定された全取引所
- **通知**: 差異検出時のみDiscordに送信

手動実行は、この自動実行に加えて任意のタイミングで実行できる補助機能です。