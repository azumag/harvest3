# Docker Compose ログ監視とGitHub Issue自動発行

## 概要
Docker Composeサービスのログを監視し、例外やエラーが発生した際に自動的にGitHub Issueを作成するスクリプトです。

## 機能
- Docker Composeログのリアルタイム監視
- 複数のエラーパターンによる例外検出
- GitHub Issue自動作成
- 重複Issue防止（スロットリング機能）
- 1日あたりのIssue作成数制限
- カスタマイズ可能な設定

## 使用方法

### 基本的な使用方法
```bash
# ログ監視開始
npm run log-monitor

# デバッグモード付きで実行
npm run log-monitor:debug

# 特定のサービスのみ監視
node scripts/log-monitor.js --services bot,hft
```

### 前提条件
1. GitHub CLIがインストールされ、認証が完了していること
   ```bash
   gh auth login
   ```

2. Docker Composeサービスが起動していること
   ```bash
   docker compose up -d
   ```

## 設定

### 設定ファイル
`config/log-monitor-config.json` で監視設定をカスタマイズできます：

```json
{
  "services": ["bot", "hft", "backtest", "web-ui"],
  "errorPatterns": [
    "Error:",
    "Exception:",
    "MongoServerError",
    "RedisError"
  ],
  "issueThrottleMs": 300000,
  "maxIssuesPerDay": 10,
  "debug": false
}
```

### 設定項目
- `services`: 監視対象のDocker Composeサービス名
- `errorPatterns`: エラー検出パターン（正規表現対応）
- `issueThrottleMs`: 同じエラーでのIssue作成間隔（ミリ秒）
- `maxIssuesPerDay`: 1日あたりの最大Issue作成数
- `debug`: デバッグ出力の有効/無効

## 検出されるエラーパターン
- `Error:`, `Exception:` - 一般的なエラー
- `TypeError:`, `ReferenceError:`, `SyntaxError:` - JavaScript エラー
- `UnhandledPromiseRejectionWarning` - 未処理のPromise拒否
- `MongoServerError`, `RedisError` - データベース接続エラー
- `ECONNREFUSED`, `ETIMEDOUT` - ネットワークエラー
- `FATAL`, `Uncaught` - 致命的なエラー

## Issue発行ルール

### 重複防止機能
- 同じエラーパターンでは5分間（設定可能）Issue作成をスロットリング
- エラーメッセージの動的部分（時刻、行番号等）を正規化して重複判定

### 制限機能
- 1日あたりの最大Issue作成数制限（デフォルト10件）
- 24時間ごとに履歴をクリーンアップ

### Issue内容
自動作成されるIssueには以下が含まれます：
- エラーメッセージ
- ログコンテキスト（前後数行）
- 発生時刻
- 対象サービス名
- 自動生成ラベル（`bug`, `auto-generated`）

## ログファイル
- Issue履歴: `.tmp/issue-history.json`
- 一時ファイルは `.tmp` ディレクトリに作成されます

## トラブルシューティング

### GitHub Issue作成に失敗する場合
1. GitHub CLIの認証状態を確認
   ```bash
   gh auth status
   ```

2. リポジトリへの書き込み権限を確認

### ログが監視されない場合
1. Docker Composeサービスが起動しているか確認
   ```bash
   docker compose ps
   ```

2. 監視対象サービス名が正しいか確認
   ```bash
   docker compose config --services
   ```

## テスト
```bash
# 単体テスト実行
npm test test/unit/log-monitor.test.js

# 全テスト実行（カバレッジ付き）
npm run test:coverage
```

## 監視の停止
`Ctrl+C` で監視を停止できます。グレースフルシャットダウンにより、実行中の処理が完了してから終了します。