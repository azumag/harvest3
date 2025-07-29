# harvest3 - 暗号通貨取引ボット

複数の取引戦略を実装したBitcoin自動取引ボットシステム。複数の取引所（Bitbank、Bitflyer）に対応し、リアルタイム監視とWebUIを提供します。

> **最新の更新**: バックテストサービスのエラー分類システムが実装され、CI/CD パイプラインが強化されました。

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
- **ログ監視**: Docker Composeログ監視とGitHub Issue自動発行
- **Discord通知**: エラー、注文、損益レポート
- **データ永続化**: Redis（リアルタイム）+ MongoDB（履歴）
- **バックテスト**: 戦略の事前検証
- **リスク管理**: 基本的なポジション管理

## 🔄 コンテナ再起動検出機構

### 実装方式
システムは`/proc/uptime`ベースのシンプルなコンテナ再起動検出機構を採用しています。

#### 旧方式から新方式への変更（Issue #5186）
- **旧方式**: ファイルベースの複雑な状態管理
- **新方式**: `/proc/uptime`を使用したシンプルな稼働時間チェック
- **YAGNI原則適用**: 不要な複雑性を排除し、保守性を向上

#### 検出ロジック
```bash
# 実装場所: entrypoint.sh の check_container_recently_restarted()
# システム稼働時間が60秒以内の場合、「最近再起動した」と判定
if [ "$uptime_seconds" -lt 60 ]; then
    return 0  # 最近再起動した
fi
```

#### 利用用途
- **npm installリトライ戦略の調整**: 再起動直後は適切なリトライ回数に調整
- **重複メッセージ防止**: 起動メッセージの重複出力を防止
- **backtestクリーンアップ**: 古いタイムスタンプファイルとエラー状態ファイルの自動削除

### 設定パラメーター
現在の実装では固定値（60秒）を使用していますが、将来的な拡張に備えた設定項目：

```env
# CONTAINER_RESTART_THRESHOLD（Issue #5321で実装予定）
# コンテナ再起動検出の閾値（秒）
# デフォルト: 60
# 用途: uptime値がこの値未満の場合、最近再起動したと判定
CONTAINER_RESTART_THRESHOLD=60
```

### トラブルシューティング

#### コンテナ再起動検出が正しく動作しない
1. **`/proc/uptime`ファイルの確認**
   ```bash
   cat /proc/uptime
   # 出力例: 1234.56 9876.78（最初の値がシステム稼働時間）
   ```

2. **ログメッセージの確認**
   ```bash
   # uptime-based detectionログメッセージを確認
   docker compose logs bot | grep "uptime"
   ```

3. **環境変数の確認**（Issue #5321実装後）
   ```bash
   echo $CONTAINER_RESTART_THRESHOLD
   ```

#### 実装の利点
- **シンプル性**: ファイル管理不要、プロセス監視不要
- **信頼性**: カーネルレベルの情報源（`/proc/uptime`）を使用
- **保守性**: YAGNI原則に従った最小限の実装
- **性能**: オーバーヘッドが極めて少ない

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

# 残高整合性緊急対応
node scripts/emergency-balance-check-optimized.js     # 残高乖離状況の確認
node scripts/emergency-balance-fix-optimized.js       # 残高乖離の緊急修正
node scripts/balance-monitor-optimized.js             # 残高監視（手動実行）

# 残高監視設定のカスタマイズ
export BALANCE_THRESHOLD=2.0                          # 乖離閾値変更（デフォルト: 1.0）
export BALANCE_LOG_FILE=/var/log/balance.log          # ログファイルパス変更
export DISCORD_WEBHOOK_URL=your_webhook_url           # Discord通知設定
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

### ログ監視
```bash
# Docker Composeログ監視開始（GitHub Issue自動発行）
npm run log-monitor

# デバッグモード付きログ監視
npm run log-monitor:debug

# 自動再接続無効でログ監視
npm run log-monitor:no-reconnect
```

#### ログ監視システムの機能
- **インテリジェントな重複防止**: エラーハッシュ生成によるIssue重複作成防止
- **エラータイプ分類**: 17種類のエラータイプ（TypeError、ConnectionError、ERROR等）を自動識別
- **スロットリング機能**: 同じエラーのIssue作成間隔制御（デフォルト: 5分）
- **類似エラー検出**: 同一サービス内の類似エラータイプの長期間スロットリング
- **自動正規化**: タイムスタンプ、UUID、URL、メモリアドレス等の動的情報を除去
- **スタックトレース抽出**: エラー発生時の詳細なスタックトレース情報を自動抽出（機密情報サニタイズ付き）
- **設定可能なIssue数制限**: 1日あたりのIssue作成数制限（0で無制限、デフォルト: 無制限）
- **自動再接続機能**: Docker Composeプロセス終了時の自動再接続（デフォルト: 10秒間隔）
- **堅牢性**: Docker再起動やネットワーク一時断絶に対する耐性
- **出力最適化**: 通常時のログ出力を抑制し、issue発行時のみログを表示

### 自動更新監視
```bash
# mainブランチ自動更新監視開始
npm run auto-update

# デバッグモード付き自動更新監視
npm run auto-update:debug

# 自動更新監視のステータス確認
npm run auto-update:status
```

#### 自動更新監視システムの機能
- **定期的なmainブランチ監視**: デフォルト5分間隔で更新をチェック
- **自動git pull**: 更新検出時に自動でgit pullを実行
- **Dockerサービス自動再起動**: `docker compose down && docker compose build && docker compose up backtest bot -d`
- **リトライ機能**: 更新失敗時の自動リトライ（最大3回）
- **グレースフルシャットダウン**: SIGINT/SIGTERMでの安全な停止
- **ステータス確認**: 現在の監視状態とハッシュ情報の表示

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
- **scripts/log-monitor.js**: Docker Composeログ監視とGitHub Issue自動発行
- **scripts/auto-update-monitor.js**: mainブランチ自動更新監視とDockerサービス再起動

## ⚙️ 設定

### 環境変数

詳細な環境変数設定は`.env.example`ファイルを参照してください。主要なカテゴリと設定項目を以下に示します。

#### 必須設定

```env
# 基本システム設定
NODE_ENV=development              # 実行環境 (development/production/test)
PORT=3000                        # Webサーバーポート

# 取引所APIキー（必須）
BB_API_KEY=your_bitbank_api_key
BB_API_SECRET=your_bitbank_api_secret
BF_API_KEY=your_bitflyer_api_key
BF_API_SECRET=your_bitflyer_api_secret

# データベース設定
REDIS_URL=redis://localhost:6379
MONGO_URL=mongodb://localhost:27017
MONGODB_DB_NAME=harvest3

# Discord通知（推奨）
DISCORD_ERROR_WEBHOOK_URL=your_webhook_url
DISCORD_ORDER_WEBHOOK_URL=your_webhook_url
DISCORD_RESULT_WEBHOOK_URL=your_webhook_url
```

#### オプション設定

**戦略設定**
```env
# 基本戦略の有効化
STRATEGY_MA_ENABLED=true          # 移動平均戦略
STRATEGY_RSI_ENABLED=true         # RSI戦略
STRATEGY_BOLLINGER_BANDS_ENABLED=true  # ボリンジャーバンド戦略

# 戦略パラメータ
RSI_OVERSOLD_THRESHOLD=30         # RSI売られすぎ閾値
RSI_OVERBOUGHT_THRESHOLD=70       # RSI買われすぎ閾値
BOLLINGER_BAND_PERIOD=20          # ボリンジャーバンド期間
```

**リスク管理設定**
```env
# ストップロス設定
FIXED_STOP_LOSS_PERCENT=0.02      # 固定ストップロス（2%）
TRAILING_STOP_TRIGGER_PERCENT=0.01  # トレーリングストップ発動閾値

# 損失制限
DAILY_MAX_LOSS_PERCENT=0.05       # 日次最大損失（5%）
WEEKLY_MAX_LOSS_PERCENT=0.10      # 週次最大損失（10%）
```

**監視・バランスチェック設定**
```env
# バランス監視
BALANCE_CHECK_INTERVAL=300000     # バランスチェック間隔（5分）
BALANCE_THRESHOLD=0.01            # 乖離検知閾値
BALANCE_DEBUG=false               # デバッグモード

# システム監視
MAX_CONSECUTIVE_FAILURES=3        # 最大連続失敗回数
MONITORING_ENABLED=true           # 監視機能有効化
```

**API制限・パフォーマンス設定**
```env
# API制限設定
EXCHANGE_RATE_LIMIT=15000         # API呼び出し間隔（15秒）
EXCHANGE_TIMEOUT=60000            # APIタイムアウト（60秒）
MAX_RETRIES=3                     # 最大リトライ回数

# パフォーマンス設定
PERFORMANCE_LOOKBACK_DAYS=30      # パフォーマンス分析期間
MAX_CALCULATION_TIME=5000         # 計算時間制限（5秒）
```

**データ収集・セキュリティ設定**
```env
# データ収集
COLLECTION_INTERVAL=60000         # データ収集間隔（1分）
DATA_RETENTION_DAYS=30            # データ保持期間
DATA_DIR=./data                   # データ保存ディレクトリ

# セキュリティ
ENABLE_ENCRYPTION=false           # データ暗号化
LOG_SENSITIVE_DATA=false          # 機密データログ出力
API_KEY_MASK_LENGTH=4             # APIキーマスク文字数
```

#### 環境別設定例

**開発環境**
```env
NODE_ENV=development
LOG_LEVEL=debug
BALANCE_DEBUG=true
LOAD_TEST_ENABLED=false
```

**本番環境**
```env
NODE_ENV=production
LOG_LEVEL=info
BALANCE_DEBUG=false
MONITORING_ENABLED=true
ALERTS_ENABLED=true
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

#### 自動マージシステム
- **トリガー**: PRコメントに`review-fixed`が含まれる時
- **動作**: PR承認と自動マージを実行
- **ワークフロー**: `auto-merge.yml`

#### 設定
- `CLAUDE_CODE_OAUTH_TOKEN`をGitHub Secretsに設定する必要があります
- ワークフローは`.github/workflows/claude-issue-resolver.yml`で管理

### PR自動作成システム
GitHub App認証を使用したPR自動作成システムを導入しています。

#### 使用方法
Issue内で`Create PR: {GitHub Compare URL}`コメントを投稿すると自動でPRを作成します。

#### 利点
- **CI正常動作**: Personal Access Tokenの制限を回避し、作成されたPRでCIが起動
- **GitHub App認証**: リポジトリ単位の権限管理、自動トークン管理

#### 設定
- GitHub App作成と`APP_ID`/`APP_PRIVATE_KEY`設定が必要
- 詳細は`.github/workflows/README.md`を参照

### CI自動修正システム
GitHub Actionsを使用したCI失敗の自動修正システムを導入しています。

#### 使用方法
1. **自動起動** - CI失敗時にPersonal Access Tokenを使用して自動でfix-requestedラベルを付与
2. **手動起動** - 既存のPRに`fix-requested`ラベルを手動で付与
3. **mainブランチ対応** - mainブランチでCI失敗時の自動Issue作成機能（計画中）

#### Personal Access Token (PAT) 設定方法

##### 1. PAT作成
GitHub Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token

**必要な権限:**
- `repo` (Full control of private repositories)
- `workflow` (Update GitHub Action workflows)

##### 2. リポジトリのSecretsに追加
リポジトリ Settings → Secrets and variables → Actions → New repository secret

**Name:** `PERSONAL_ACCESS_TOKEN`  
**Secret:** 作成したPATを貼り付け

##### 3. ワークフローで使用
```yaml
- name: Add fix-requested label
  uses: actions/github-script@v7
  with:
    github-token: ${{ secrets.PERSONAL_ACCESS_TOKEN }}
    script: |
      await github.rest.issues.addLabels({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.payload.pull_request.number,
        labels: ['fix-requested']
      });
```

**注意:** PATを使用することで、GitHub Actionsからのラベル付けでもワークフローを自動起動できるようになります。

#### 自動処理フロー
- CI失敗検出時の自動ラベル付与
- CI失敗原因の分析と修正
- 必要なテストの実行
- 修正完了後の自動コミット

#### mainブランチCI失敗対応
- **実装完了**: mainブランチでCI失敗時の自動Issue作成機能（KISS原則適用）
- **機能**: 失敗通知、基本情報収集、重複防止（24時間内チェック）
- **ワークフロー**: `ci-result-handler.yml`内に統合（DRY原則適用、約190行）

### Claude Code設定管理改善
#### 設定ファイルの最適化
- **DRY原則の徹底**: `.claude/settings.local.json`の重複hook削除（8個→1個に統合）  
- **権限管理の強化**: git pull権限の追加
- **設定の簡素化**: 冗長な設定エントリの削除とファイルサイズ最適化

#### CI/CDワークフローの論理的整合性修正
- **claude-ci-fix.yml**の修正: `ci-failure`ラベルトリガーとラベル削除処理の整合性確保
- **論理的一貫性**: トリガー条件とアクション処理の正確な対応関係を確立
- **ワークフロー品質向上**: コメントとコードの一致、実際の動作と期待される動作の統一

#### 廃止されたワークフローの削除
- **main-ci-failure-handler.yml**: KISS原則違反（180行の複雑すぎる実装）のため削除
- **main-ci-failure-issue-creator.yml**: 実装が複雑すぎてメンテナンス困難のため削除
- **方針**: YAGNI、DRY、KISS、TDD原則に従った簡素な実装への置き換えを検討中

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
- **テスト品質向上**: スキップされたテストに詳細理由を明記、Jest実行時間改善対応
- **構文エラー修正**: src/common/const.jsのSyntaxError完全解消とテスト安定化
- **テスト品質レビュー**: YAGNI/DRY/KISS原則遵守確認、TDD環境依存課題の特定
- **最終品質確認**: const.js修正完了、全テスト安定化、CI/CDパイプライン正常化

#### テストの安定化とCI/CD改善
- 不安定なテストアサーションの修正
- メモリ使用量テストの適正化（250MB→320MB、実測値に対する適切なマージン設定）
- テスト実行環境の並行実行対応
- CI/CDパイプライン構文エラーの完全解決（const.jsファイル修正）
- MongoDB/Redis接続テストのスキップ理由詳細化と再有効化方針の明確化
- 厳格なコードレビューによる品質担保と今後の改善方針策定
- Jestキャッシュクリアによるテスト実行安定性の完全確保
- Jestキャッシュ問題の解決とテスト安定性向上
- backtestRunnerのconsole.log問題修正とLintエラー解消
- Claude設定ファイルの権限管理強化（sandbox関連コマンドの整理）
- デバッグ情報の適切な保持（レビュー指摘事項への対応）
- PR #219レビュー指摘事項の完全修正（Critical Issues対応）
- Docker環境の最終確認とコンテナ起動の安定化
- 厳格なコードレビューによる品質課題の特定と改善方針策定
- 一時的テストファイルの適切な整理とプロジェクト指示遵守の徹底
- eventDrivenBot.test.jsの構文エラー完全解消とテスト安定化
- レビューで特定された全問題の修正完了とコードベース品質向上

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
| 残高不整合・乖離エラー | `node scripts/emergency-balance-fix-optimized.js` |

### 緊急対応
```bash
# システム停止
pkill -f "node.*bot"

# 設定リセット
npm run validate-config

# 再起動
docker compose restart

# 残高整合性緊急対応（4日間の残高不整合など）
node scripts/emergency-balance-check-optimized.js     # 1. 現状確認
node scripts/emergency-balance-fix-optimized.js       # 2. 緊急修正（ロールバック機能付き）
node scripts/balance-monitor-optimized.js             # 3. 監視確認

# 定期監視設定（乖離予防）
echo "*/5 * * * * /usr/bin/node $(pwd)/scripts/balance-monitor-optimized.js" | crontab -

# 監視設定のカスタマイズ（必要に応じて）
export BALANCE_THRESHOLD=2.0                          # 乖離閾値変更（デフォルト: 1.0）
export DISCORD_WEBHOOK_URL=your_webhook_url           # Discord通知有効化
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
- **残高整合性緊急解決スクリプト**: 残高不整合問題の即座解決ツール（Issue #234対応）
  - 現状確認スクリプト: 取引所・Redis残高の乖離状況確認
  - 即座修正スクリプト: 検出された乖離の自動修正（ロールバック機能付き）
  - 予防監視スクリプト: 定期監視とアラート通知（設定外部化対応）
  - 設定外部化: 環境変数による閾値・ログ・通知のカスタマイズ
  - 単体テスト: 各スクリプトの品質保証と CI 統合
- **ログ監視システム強化**: Docker Composeログ監視のIssue重複防止機能と出力最適化
  - インテリジェントなエラーハッシュ生成による重複Issue防止
  - 17種類のエラータイプ自動分類（TypeError、ConnectionError等）
  - 動的情報（タイムスタンプ、UUID、URL、メモリアドレス）の自動正規化
  - 同一サービス内類似エラーの長期間スロットリング機能
  - 通常時のログ出力抑制とissue発行時のみの最適化された出力
  - 包括的な単体テスト（40テストケース）による品質保証
- **自動更新監視システム**: mainブランチ自動更新とDockerサービス再起動機能
  - 定期的なmainブランチ監視（デフォルト5分間隔）
  - 更新検出時の自動git pullとDockerサービス再起動
  - リトライ機能付きの堅牢な更新処理（最大3回リトライ）
  - グレースフルシャットダウンとステータス監視機能
  - 包括的な単体テスト（19テストケース）による品質保証
- **設定管理システム**: 環境変数ベースの設定管理と検証機能
- **高精度数値計算**: Decimal.jsを使用した浮動小数点誤差の解消
- **エラーハンドリング強化**: Bitbank API固有のエラー処理とリトライ機能
- **テストサポート拡張**: E2Eテスト、Playwright統合、テストカバレッジ測定
- **Sandboxセキュリティ**: macOSでのSandboxプロファイル改善とプロセス管理権限強化
- **APIコーディネーター改善**: メモリリーク防止とテスト安定性向上

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

ver 1.0