## 🔨 最重要ルール - 新しいルールの追加プロセス

ユーザーから今回限りではなく常に対応が必要だと思われる指示を受けた場合：

1. 「これを標準のルールにしますか？」と質問する
2. YESの回答を得た場合、CLAUDE.mdに追加ルールとして記載する
3. 以降は標準ルールとして常に適用する

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

## 知見管理システム
このプロジェクトでは以下のファイルで知見を体系的に管理しています：

### `.claude/context.md`
- プロジェクトの背景、目的、制約条件
- 技術スタック選定理由
- ビジネス要件や技術的制約

### `.claude/project-knowledge.md`
- 実装パターンや設計決定の知見
- アーキテクチャの選択理由
- 避けるべきパターンやアンチパターン

### `.claude/project-improvements.md`
- 過去の試行錯誤の記録
- 失敗した実装とその原因
- 改善プロセスと結果

### `.claude/common-patterns.md`
- 頻繁に使用するコマンドパターン
- 定型的な実装テンプレート

**重要**: 新しい実装や重要な決定を行った際は、該当するファイルを更新してください。

# 指示
タスクごとに git branch を作成し、 git worktree に割り当て作業する。

## qa
タスク終了後、かならず単体テストと静的解析を実行し、fixを行う
またタスク実装内容について、UIの実装タスクならブラウザを操作して実装内容が正しいか確認する。

docker-compose.yml などでアプリケーションが構成されている場合、npmなどローカルサーバを起動せず、
docker compose を利用してアプリテストを行う

### UIテストの実行
UIの改修を行った場合は、必ず以下の手順でテストを実行する：
1. **`docker compose restart web-ui`** でWebUIサービスを再起動（UIに変更があった場合は毎回必須）
2. ブラウザで実際の動作を確認
3. コンソールエラーがないことを確認
4. 期待される動作が行われることを確認

### Botの再起動
bot部分の修正（src/strategies/、src/database/、src/common/など）を行った場合は、必ず以下のコマンドで再起動する：
```bash
docker compose restart bot
```


## Claude Code CLI設定

### デフォルトフラグの設定

Dev Container内では、`--dangerously-skip-permissions`フラグがデフォルトで有効になっています：

```bash
# .bashrcに設定済み
alias claude="claude --dangerously-skip-permissions"
```

これにより、コンテナ内での権限チェックをバイパスし、スムーズな開発体験を提供します。

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
