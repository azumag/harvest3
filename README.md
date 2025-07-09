# harvest3 - 暗号通貨取引ボット

複数の取引戦略を実装したBitcoin自動取引ボットシステム。複数の取引所（Bitbank、Bitflyer）に対応し、リアルタイム監視とWebUIを提供します。

## 🚀 クイックスタート

### 必要な環境
- Node.js v16以上
- Docker & Docker Compose
- Redis
- MongoDB

### インストール

```bash
# リポジトリのクローン
git clone <repository-url>
cd harvest3

# 依存関係のインストール
npm install

# 環境変数の設定
cp .env.example .env
# .envファイルを編集してAPIキーを設定

# Docker環境での起動
docker compose up -d

# 動作確認
open http://localhost:3000
```

## 📋 主な機能

### 取引戦略
- **トレンドフォロー戦略**: MA、MACD、RSI、ボリンジャーバンド
- **逆張り戦略**: 平均回帰、オシレーター
- **相互情報戦略**: 統計的手法による取引判断
- **HFT戦略**: 高頻度取引戦略（実験的）

### システム機能
- **リアルタイム監視**: WebUIでの状態確認
- **Discord通知**: エラー、注文、損益レポート
- **データ永続化**: Redis（リアルタイム）+ MongoDB（履歴）
- **バックテスト**: 戦略の事前検証
- **リスク管理**: 基本的なポジション管理

## 🛠️ 利用可能なコマンド

### 基本実行
```bash
# メインボット起動
npm start

# HFT戦略実行
npm run start-hft

# WebUI起動
npm run start-web

# バックテスト実行
npm run backtest
```

### 分析・監視
```bash
# 残高整合性チェック
npm run check-balance

# リアルデータ収集
npm run collect-real-data

# データ分析
npm run analyze-real-data

# 設定値検証
npm run validate-config
```

### テスト
```bash
# 全テスト実行
npm run test

# 単体テスト
npm run test:unit

# 統合テスト
npm run test:integration

# カバレッジ測定
npm run test:coverage
```

## 🎯 アーキテクチャ

### データフロー
```
取引所API → MarketDataProvider → 戦略エンジン → 注文実行 → 結果保存
                     ↓
               WebUI ← Redis ← MongoDB
```

### 主要コンポーネント
- **src/bot.js**: メインエントリーポイント
- **src/strategies/**: 各種取引戦略
- **src/api/**: WebUI用APIサーバー
- **src/database/**: データベース管理
- **src/monitoring/**: システム監視
- **src/hft/**: 高頻度取引機能

## ⚙️ 設定

### 環境変数
```env
# 取引所APIキー
BB_API_KEY=your_bitbank_api_key
BB_API_SECRET=your_bitbank_api_secret
BF_API_KEY=your_bitflyer_api_key
BF_API_SECRET=your_bitflyer_api_secret

# データベース
REDIS_URL=redis://localhost:6379
MONGO_URL=mongodb://localhost:27017
MONGO_DB_NAME=harvest3

# Discord通知
DISCORD_ERROR_WEBHOOK_URL=your_webhook_url
DISCORD_ORDER_WEBHOOK_URL=your_webhook_url
DISCORD_RESULT_WEBHOOK_URL=your_webhook_url
```

### 戦略設定
各戦略は`src/config.js`で設定可能。環境変数でのオーバーライドも対応。

```javascript
// 戦略の有効/無効
STRATEGY_MA_ENABLED=true
STRATEGY_MACD_ENABLED=false
STRATEGY_RSI_ENABLED=true
```

## 🔧 開発

### テスト駆動開発
新機能開発時は必ず単体テストを作成し、CIに統合してください。

```bash
# 開発用テスト監視
npm run test:watch

# テスト作成場所
test/unit/           # 単体テスト
test/integration/    # 統合テスト
```

### コーディング規約
- YAGNI: 必要のない機能は作らない
- DRY: コードの重複を避ける
- KISS: シンプルに保つ
- 一時ファイルは`.tmp`ディレクトリに作成

## 📊 監視とメンテナンス

### WebUI
- **ダッシュボード**: `http://localhost:3000`
- **ポジション確認**: `http://localhost:3000/positions.html`
- **取引履歴**: `http://localhost:3000/history.html`
- **パフォーマンス分析**: `http://localhost:3000/analysis.html`

### ログ確認
```bash
# Dockerログ
docker compose logs -f bot

# システムヘルスチェック
docker compose ps
```

## 🚨 トラブルシューティング

### よくある問題

| エラー | 対処法 |
|--------|--------|
| `throttle queue over maxCapacity` | `export EXCHANGE_RATE_LIMIT=15000` |
| MongoDB接続エラー | `docker compose up -d mongo` |
| Redis接続エラー | `docker compose up -d redis` |

### 緊急対応
```bash
# システム停止
pkill -f "node.*bot"

# 設定リセット
npm run validate-config

# 再起動
docker compose restart
```

## ⚠️ 注意事項

- 暗号通貨取引にはリスクが伴います
- 実運用前に必ずバックテストを実行
- APIキーは厳重に管理
- 損失について当方は一切の責任を負いません

## 📄 ライセンス

MIT License