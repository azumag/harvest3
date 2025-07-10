# harvest3 - 暗号通貨取引ボット

複数の取引戦略を実装したBitcoin自動取引ボットシステム。複数の取引所（Bitbank、Bitflyer）に対応し、リアルタイム監視とWebUIを提供します。

## 🚀 クイックスタート

### 必要な環境
- Node.js v16以上
- Docker & Docker Compose
- Redis
- MongoDB
- Playwright（ブラウザ自動化テスト用）

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
- **残高監視システム**: 自動残高監視と異常検知
- **残高整合性サービス**: 3つのデータソースの照合と自動修正
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

# レポート生成
npm run reporter
```

### 分析・監視
```bash
# 残高整合性チェック
npm run check-balance

# 残高シンボル別チェック
npm run check-balance-symbol

# 残高比較（取引所 vs サマリー）
npm run compare-balance

# ポジション整合性チェック
npm run check-position-consistency

# ポジション不整合修正
npm run fix-position-inconsistencies

# ポジション不整合修正（ドライラン）
npm run fix-position-inconsistencies-dry

# リアルデータ収集
npm run collect-real-data

# リアルデータ収集（拡張）
npm run collect-real-data-enhanced

# データ分析
npm run analyze-real-data

# 負荷テスト
npm run load-test

# 設定値検証
npm run validate-config

# 設定値構造検証
npm run validate-config-structural

# 設定ドキュメント生成
npm run generate-config-docs

# 設定の同期
npm run sync-docs
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

# CI用テスト
npm run test:ci

# E2Eテスト
npm run test:e2e

# E2Eデータ整合性テスト
npm run test:e2e-integrity

# E2Eポジションサイジングテスト
npm run test:e2e-position-sizing

# 拡張データ収集テスト
npm run test-enhanced
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
- **src/monitors/**: 残高監視システム
- **src/services/**: 残高整合性サービス
- **src/config/**: 設定管理（settings.js）
- **src/common/**: 共通ユーティリティ
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

### 設定管理システム
`src/config/settings.js`でシステム全体の設定を統一管理しています：

#### 設定カテゴリ
- **取引所設定**: APIキー、レート制限、タイムアウト
- **データベース設定**: Redis、MongoDB接続情報
- **監視設定**: ヘルスチェック間隔、アラート闾値
- **リスク管理**: ポジションサイズ制限、ストップロス
- **パフォーマンス**: ログレベル、メトリクス設定

#### 設定検証
```bash
# 設定値検証とバリデーション
npm run validate-config
```

### 共通ユーティリティ
コードの品質と信頼性を向上させるためのユーティリティを提供：

#### エラーハンドリング
- **bitbankErrorHandler.js**: Bitbank API固有のエラー処理
- エラーコード別の自動リトライ機能
- フォールバック結果の提供

#### 高精度計算
- **decimalUtils.js**: Decimal.jsを使用した浮動小数点誤差の解消
- 通貨ごとの精度設定
- 残高計算の安全な実行

#### システム定数
- **constants.js**: システム全体で使用する定数の統一管理
- 時間、数値精度、API関連、通貨ペア等の定数

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

### 自動Issue解決システム
Claude Code Actionを使用したIssue自動解決システムを導入しています。

#### 使用方法
1. **ラベルを付与** - 既存のIssueに`claude-resolve`ラベルを付けると解決を開始
2. **コメントで起動** - Issue内で`@claude-resolver`コメントを投稿すると解決を開始

#### 自動処理フロー
- Issue内容の分析と解決策の実装
- 必要に応じた単体テストの作成
- コーディング規約に従った実装
- 自動テスト実行（lint、単体テスト）
- 専用ブランチでのPR作成（develop向け）
- Issue内への結果報告

#### 設定
- `CLAUDE_CODE_OAUTH_TOKEN`をGitHub Secretsに設定する必要があります
- ワークフローは`.github/workflows/claude-issue-resolver.yml`で管理

### 開発環境の改善
#### スケジューリングマネージャーの改善
- **DRY原則の完全実装**: 重複コードを完全に削除し、全てのタスク実行を`_executeTask`に統一
- **最適化された非同期処理**: Promise判定によりawaitの必要性を動的に判断する効率的な実装
- **包括的なエラーハンドリング**: 同期・非同期両方に対応した統一エラーハンドリング
- **実用的な単体テスト**: 実際の使用パターンに合わせたテストケースに精査

#### コード品質向上
- **効率的な非同期処理**: 同期関数に不要なawaitを適用しない最適化実装
- **統一されたエラーメッセージ**: 全てのエラーハンドリングで一貫したメッセージ形式
- **テスト品質維持**: 実際の要件に基づいた必要最小限のテスト作成
- **Redis操作の信頼性向上**: multi.exec()結果チェックによる操作失敗の適切な検出
- **API呼び出しの堅牢性強化**: 再試行ロジックと詳細エラー分類の実装
- **API機能復元**: summary.jsのcalculateAvailableAmounts機能復活とエラーハンドリング強化
- **CI/CDエラー修正**: multiIndicator.test.jsの構文エラー解消とテスト安定化

#### テストの安定化とCI/CD改善
- 不安定なテストアサーションの修正
- メモリ使用量テストの適正化（250MB→320MB、実測値に対する適切なマージン設定）
- テスト実行環境の並行実行対応
- CI/CDパイプライン構文エラーの完全解決（const.jsファイル修正）
- Jestキャッシュ問題の解決とテスト安定性向上
- backtestRunnerのconsole.log問題修正とLintエラー解消
- Claude設定ファイルの権限管理強化（sandbox関連コマンドの整理）
- デバッグ情報の適切な保持（レビュー指摘事項への対応）
- PR #219レビュー指摘事項の完全修正（Critical Issues対応）

#### 設計原則の適用
- **YAGNI**: 不要な機能（未使用の同期関数対応）を削除
- **KISS**: Promise判定による効率的でシンプルな実装
- **DRY**: 全タスク実行処理の完全統一

### 残高整合性サービス
残高の信頼性を高めるためのサービスで、以下の機能を提供します：

#### データソース照合
- **取引所残高**: APIから取得した実際の残高
- **Redis残高**: リアルタイムデータから計算した残高
- **MongoDB残高**: 取引履歴から計算した残高

#### 自動修正機能
- 不整合極初の自動修正（1日最大3回まで）
- 異常レベル別の対応（critical、warning、minor）
- 緊急停止機能

#### 監視・監査
- リアルタイム監視（1分間隔）
- 詳細な監査ログ記録
- Discord通知連携
- パフォーマンス統計とヘルスチェック

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

## 📝 リリース情報

### 最新の新機能（v1.0.0）

- **残高監視システム**: リアルタイム残高監視と異常検知機能
- **残高整合性サービス**: 3つのデータソースからの残高照合と自動修正
- **設定管理システム**: 環境変数ベースの設定管理と検証機能
- **高精度数値計算**: Decimal.jsを使用した浮動小数点誤差の解消
- **エラーハンドリング強化**: Bitbank API固有のエラー処理とリトライ機能
- **テストサポート拡張**: E2Eテスト、Playwright統合、テストカバレッジ測定
- **Sandboxセキュリティ**: macOSでのSandboxプロファイル改善とプロセス管理権限強化

### 新しい依存関係
- **decimal.js**: 高精度数値計算
- **zod**: データ検証ライブラリ
- **playwright**: ブラウザ自動化テスト
- **node-cache**: キャッシュ機能
- **node-cron**: スケジュール機能
- **typescript**: TypeScript支援ツール

### セキュリティ強化
- **permissive-open.sb**: macOSでのSandboxプロファイル改善
  - `/bin/ps`コマンドエラーの修正
  - 最小権限のmach権限追加（mach-lookup、mach-task-name、mach-per-user-lookup）
  - プロセス管理権限の強化（セキュリティ重視の設定）
  - setuidバイナリ実行権限の追加

## 📄 ライセンス

MIT License