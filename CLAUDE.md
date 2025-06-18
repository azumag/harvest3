# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 🏗️ Project Overview

**harvest3** is a sophisticated cryptocurrency trading bot system built with Node.js that executes multiple trading strategies in parallel. The system uses a microservices architecture with Docker containers and dual-database approach (Redis + MongoDB) for optimal performance.

### Tech Stack
- **Runtime**: Node.js 16
- **Exchange API**: ccxt v3.1.60  
- **Databases**: Redis 8 (real-time), MongoDB 7.0 (historical)
- **Web Framework**: Express.js
- **UI**: Vanilla JavaScript + Chart.js 4.4.9
- **Testing**: Jest 29.7.0
- **Containers**: Docker + Docker Compose

### Core Services
```
bot (strategy-runner)    # Main strategy execution container
hft                     # High-frequency trading container  
backtest               # Backtesting execution container
web-ui (trade_viewer)  # Web UI container
redis                  # Real-time database
mongodb               # Historical database
```

## 🛠️ Essential Commands

### Development Commands
```bash
# Testing
npm test                    # Run all tests
npm run test:unit          # Run unit tests only
npm run test:watch         # Watch mode testing

# Bot Operations  
npm start                  # Start main bot
npm run start-hft         # Start HFT bot
npm run start-web         # Start Web UI server
npm run backtest          # Run backtesting

# Balance Management
npm run check-balance     # Check balance consistency
npm run compare-balance   # Compare exchange vs internal balance
npm run fix-position-inconsistencies  # Fix position inconsistencies
```

### Docker Operations (Makefile)
```bash
# Quick restarts (recommended for development)
make quick-restart-bot       # Restart bot container
make quick-restart-backtest  # Restart backtest container
make restart-webui          # Restart Web UI

# Full restarts
make restart-all           # Restart all containers
make restart-bot          # Full bot restart
make restart-backtest     # Full backtest restart

# Bot-specific commands
make bot-logs             # View bot logs
make bot-status          # Check bot status  
make bot-exec            # Shell into bot container
make help                # Show all available commands
```

## 🏛️ Architecture & Key Directories

```
/workspace/
├── src/
│   ├── bot.js                    # Main bot entry point
│   ├── config.js                 # Strategy & configuration management
│   ├── api/                      # Web API (Express routes)
│   ├── strategies/               # Trading strategy implementations
│   │   ├── trendFollowing.js     # MA, MACD, RSI, Bollinger Bands
│   │   ├── meanReversion.js      # Mean reversion, oscillator strategies
│   │   ├── arbitrage.js          # Inter-exchange arbitrage
│   │   └── utils/               # Strategy utilities & common functions
│   ├── database/                 # Database management (Redis/MongoDB)
│   ├── hft/                      # High-frequency trading modules
│   ├── common/                   # Shared utilities & helpers
│   │   ├── utils.js             # Core utility functions
│   │   ├── balanceChecker.js    # Balance validation
│   │   └── notifications.js     # Discord notifications
│   └── web/                      # Web UI (HTML/CSS/JS)
├── scripts/                      # Operational & maintenance scripts
├── test/                         # Test suites (Jest)
├── docs/                         # Documentation
├── docker-compose.yml            # Service definitions
├── Makefile                      # Automation commands
└── package.json                  # Dependencies & npm scripts
```

### Key Configuration Files
- `src/config.js` - Central strategy configuration and parameters
- `docker-compose.yml` - Container orchestration
- `.env` - Environment variables (API keys, database URLs)
- `Makefile` - Docker operation shortcuts

## 🔨 最重要ルール - 新しいルールの追加プロセス

ユーザーから今回限りではなく常に対応が必要だと思われる指示を受けた場合：

1. CLAUDE.mdに追加ルールとして記載する
2. 以降は標準ルールとして常に適用する

このプロセスにより、プロジェクトのルールを継続的に改善していきます

## 重要: 実行結果や応答を以下のコマンドでDiscordに送信                                                                                                                                                 
```bash
claude-discord-bot send-to-discord "あなたの応答内容" --session claude-harvest
```                                                                                                                                                   

## ⚠️ データベース操作における重要な制約

### RedisとMongoDBのデータ削除禁止
**絶対にRedisとMongoDBのデータを全削除してはならない**

理由：
- ポジション管理データが失われる
- オーダー戦略データが消失する
- **取引所側のオープンオーダーとの不整合が発生**
- 金銭的損失につながる可能性

### やむを得ずデータを全削除する場合の必須手順
1. **取引所側の全オープンオーダーをキャンセル**
2. **`closeAllPositions.js` を実行** - 全ポジションを解消
3. **`updateAllSummaryTimestamp.js` を実行** - サマリータイムスタンプを更新
4. 取引所との整合性を確認

この手順を踏まずにデータ削除を行うことは厳禁とする。

## 残高チェックにおける制約

### JPY（日本円）の除外
**残高チェック機能では、JPY（日本円）を比較対象から除外する**

理由：
- 暗号通貨の残高管理に焦点を当てるため
- JPY残高は取引所側で別途管理されるため

実装：
- `src/common/balanceChecker.js` で JPY を自動的にスキップ
- 手動実行時も自動実行時も常に適用される

## WebUIアクセスの注意事項
WebUIコンテナ（trade_viewer）へのアクセスに問題がある場合は、以下の方法を試してください：

1. **コンテナIPアドレスでの直接アクセス**
   ```bash
   # コンテナのIPアドレスを確認
   docker inspect trade_viewer | grep IPAddress
   # 表示されたIPアドレス（例: 192.168.97.6）でアクセス
   # http://192.168.97.6:3000
   ```

2. **コンテナ内からのアクセス**
   ```bash
   docker exec trade_viewer curl http://localhost:3000/api/filled-positions
   ```

## システム更新時の注意事項

### Dockerコンテナ更新のガイドライン
- docker コンテナが更新されていないからといって、コピーして実行しないで、コンテナが更新されない原因を探って修正すること

### Docker cp 操作に関する注意事項
- `docker cp` コマンドは禁止
- コンテナ間のファイル転送は、ボリュームマウントや共有ネットワークストレージなど、安全で追跡可能な方法を使用すること

### Docker絶対パス使用に関する注意事項
- docker 関連に絶対パスを絶対に使わない。禁止されています

# 指示
タスクごとに git branch を作成し、 git worktree に割り当て作業する。

## qa
タスク終了後、かならず単体テストと静的解析を実行し、fixを行う
またタスク実装内容について、UIの実装タスクならブラウザを操作して実装内容が正しいか確認する。

docker-compose.yml などでアプリケーションが構成されている場合、npmなどローカルサーバを起動せず、
docker compose を利用してアプリテストを行う

### ファイル変更の反映確保
**重要**: コードファイルを変更した後は、必ず以下の手順で変更を確実にコンテナに反映する：

#### Makefileコマンドの使用（推奨）
```bash
# バックテスト関連の変更時
make quick-restart-backtest

# 戦略実行関連の変更時  
make quick-restart-bot

# 全体を確実に反映したい場合
make restart-all
```

#### 手動でのコンテナ再起動
```bash
# バックテストコンテナ
docker compose restart backtest

# 戦略実行コンテナ
docker compose restart strategy-runner
```

**注意**: ボリュームマウントの問題でファイル変更が反映されない場合があるため、変更後は必ずコンテナを再起動すること。

**詳細**: ボリュームマウントの問題と解決方法については、`docs/volume-mount-troubleshooting.md` を参照してください。

### UIテストの実行
UIの改修を行った場合は、必ず以下の手順でテストを実行する：
1. **`docker compose restart web-ui`** でWebUIサービスを再起動（UIに変更があった場合は毎回必須）
2. ブラウザで実際の動作を確認
3. コンソールエラーがないことを確認
4. 期待される動作が行われることを確認

### Botの再起動
bot部分の修正（src/strategies/、src/database/、src/common/など）を行った場合は、必ず以下のコマンドで再起動する：
```bash
make quick-restart-bot
# または
docker compose restart bot
```

## html, javascript などのUI系修正は、必ず修正内容をアクセスし確認すること。

## 開発フロー

### 1. 課題管理とIssue駆動開発

問題を解決する前に、必ずGitHub Issueとして発行し、解決後にissueに紐付けたcommitおよびPRを作成する：

#### Issue作成のタイミング
- バグ修正の前
- 新機能実装の前
- リファクタリングの前
- パフォーマンス改善の前

#### Issue作成の手順
```bash
# Issueを作成
gh issue create --title "タイトル" --body "詳細説明"

# 作業ブランチ作成（Issue番号を含める）
git checkout -b feature/issue-123-description

# 作業完了後、commitメッセージにIssue番号を含める
git commit -m "feat: 機能追加 - Fixes #123"

# PRを作成（自動的にIssueとリンク）
gh pr create --title "PR Title - Fixes #123"
```

#### Issueの書き方
- **概要**: 問題の簡潔な説明
- **現状の問題点**: 具体的な問題
- **提案する解決策**: 実装方針
- **期待される効果**: 改善される点

### 2. 実装計画の立案

### 2. コミット管理

効果的なバージョン管理のための規則：

#### コミットの粒度

- **小さな単位**でコミットする（1つの機能追加、1つのバグ修正）
- **動作する状態**でコミットすることを心がける
- **関連性のない変更**は別々のコミットに分ける

#### コミットメッセージ

```bash
# 推奨フォーマット
git commit -m "feat: ユーザー認証APIの実装

- JWT認証の仕組みを追加
- ログイン/ログアウト機能を実装
- 認証エラーハンドリングを追加

Closes #123"
```

#### Issue紐付け

- コミットメッセージに `Closes #<issue番号>` または `Fixes #<issue番号>` を記載
- 進行中の作業には `Refs #<issue番号>` を使用

### 3. テスト駆動開発

品質確保のためのテスト戦略：

#### テスタブルな関数設計

```javascript
// Good: 純粋関数、テストしやすい
function calculateTax(price, taxRate) {
  return price * taxRate;
}

// Good: 依存性注入でテストしやすい
function processOrder(order, paymentService, emailService) {
  // 処理ロジック
}
```

#### テスト実行の習慣

```bash
# 開発中の継続的テスト実行
npm test -- --watch

# コミット前の全テスト実行
npm test
npm run test:coverage
```

#### テストカバレッジ目安

- **最低限**: 70%以上
- **推奨**: 80%以上
- **重要な関数**: 100%

### 4. プルリクエスト自動化

効率的なコードレビュープロセス：

#### PR作成のタイミング

- 機能実装が**おおよそ完了**した段階
- テストが**通っている**状態
- **自己レビュー**を完了した後

#### PR自動化ツール例

```bash
# GitHub CLI使用例
gh pr create --title "feat: ユーザー認証機能" --body-file pr_template.md

# 自動化スクリプト例
#!/bin/bash
git push origin feature/user-auth
gh pr create --title "$(git log -1 --pretty=%s)" --body "$(git log -1 --pretty=%b)"
```

### 5. CI/CDパイプライン

継続的インテグレーションの管理：

#### チェック項目

- [ ] **テスト実行**: 全テストケースの実行
- [ ] **Lint検査**: コードスタイルの統一
- [ ] **型チェック**: TypeScript等の型安全性確認
- [ ] **セキュリティ検査**: 脆弱性スキャン
- [ ] **ビルド確認**: 本番環境でのビルド成功

#### 失敗時の対応手順

1. **CIログ確認**: エラー内容の特定
2. **ローカル修正**: 問題の修正とテスト
3. **Re-push**: 修正内容のプッシュ
4. **CI再実行**: パイプラインの再確認
5. **完了まで繰り返し**: 全チェックが通るまで継続

```bash
# CI失敗時の修正例
git add .
git commit -m "fix: CIエラーの修正 - lint警告の解消"
git push origin feature/user-auth
```

## タスク完了時の重要ルール

### タスク終了後のコミットとプッシュ
task完了後、taskの内容に従って適宜CLAUDE.mdを更新して、かならずコミットとpushを行なってください
```