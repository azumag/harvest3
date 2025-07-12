# GitHub Actions ワークフロー構成

このディレクトリには、CI/CD および自動化に関する GitHub Actions ワークフローが含まれています。

## ワークフローの概要

### 1. **ci.yml** - メインCI/CDパイプライン
- **トリガー**: Push (main, develop, feature/*)、PR (main, develop)
- **内容**: テスト実行、セキュリティ監査、ビルド検証
- **サービス**: Redis, MongoDB
- **出力**: カバレッジレポート、Discord通知（失敗時）

### 2. **ci-result-handler.yml** - CI結果ハンドリング
- **トリガー**: `CI/CD Pipeline` 完了時
- **動作**: 
  - CI 失敗時: `ci-failure` ラベルを追加、`ci-passed` と `review-fixed` を削除
  - CI 成功時: `ci-passed` ラベルを追加、`ci-failure` を削除

### 3. **claude-ci-fix.yml** - CI自動修正
- **トリガー**: `ci-failure` ラベル付与時
- **動作**: Claude AI が CI 失敗を分析・修正

### 4. **claude-auto-review.yml** - 自動コードレビュー
- **トリガー**: `ci-passed` ラベル付与時（`review-fixed` がない場合）
- **動作**: Claude AI によるコードレビュー実行

### 5. **claude-review-fix.yml** - レビュー対応
- **トリガー**: `reviewed` ラベル付与時
- **動作**: Claude AI がレビュー結果に基づいて修正

### 6. **claude.yml** - 汎用Claudeインターフェース
- **トリガー**: `@claude` メンション（Issue/PR/レビュー）
- **動作**: ユーザーの指示に応じた処理

### 7. **config-validation.yml** - 設定検証
- **トリガー**: 設定ファイル変更時
- **動作**: 設定の整合性確認


## ワークフローの依存関係

```mermaid
graph TD
    A[コード変更] --> B[ci.yml]
    B --> C[ci-result-handler.yml]
    C -->|CI失敗: ci-failure ラベル| D[claude-ci-fix.yml]
    C -->|CI成功: ci-passed ラベル| E[claude-auto-review.yml]
    E -->|reviewed ラベル| F[claude-review-fix.yml]
    G[@claude メンション] --> H[claude.yml]
    I[設定変更] --> J[config-validation.yml]
    
```

## ラベルの役割

### PR関連ラベル
- **ci-failure**: CI が失敗した PR に付与
- **ci-passed**: CI が成功した PR に付与
- **reviewed**: Claude AI によるレビューが完了した PR に付与
- **review-fixed**: レビュー対応が完了した PR に付与


## 注意事項

1. ラベルは自動的に管理されるため、手動での変更は避けてください
2. Claude AI の修正は自動的にコミットされます
3. 各ワークフローの実行には適切な権限（secrets）が必要です

## 必要な Secrets

- `GITHUB_TOKEN`: GitHub Actions のデフォルトトークン
- `CLAUDE_CODE_OAUTH_TOKEN`: Claude AI との連携用トークン
- `DISCORD_WEBHOOK`: Discord 通知用 Webhook URL
- `PERSONAL_ACCESS_TOKEN`: GitHub Actions からの自動ラベル付けに必要

## Personal Access Token (PAT) の設定

### 概要
`PERSONAL_ACCESS_TOKEN` は、GitHub Actions からの自動ラベル付けでワークフローを起動するために必要です。
標準の `GITHUB_TOKEN` では、GitHub Actions によるラベル付けが他のワークフローをトリガーできない制限があります。

### 設定手順

#### 1. Personal Access Token の作成
1. GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
2. "Generate new token" をクリック
3. 以下の権限を付与：
   - `repo` (Full control of private repositories)
   - `workflow` (Update GitHub Action workflows)
4. トークンを生成して値をコピー

#### 2. リポジトリの Secrets に追加
1. リポジトリページ → Settings → Secrets and variables → Actions
2. "New repository secret" をクリック
3. Name: `PERSONAL_ACCESS_TOKEN`
4. Secret: 作成したトークンの値を貼り付け

#### 3. ワークフローでの使用例
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

### 重要な注意事項
- PATはユーザー個人に紐づくため、トークン作成者がリポジトリアクセス権を失うとトークンも無効になります
- セキュリティのため、最小限の権限のみを付与してください
- 定期的にトークンの更新を行うことを推奨します

## 廃止されたワークフロー

### main-ci-failure-issue-creator.yml（削除済み）
- **理由**: 実装が複雑すぎてメンテナンス困難
- **代替**: 現在、より適切な設計での再実装を検討中
- **状況**: YAGNI、DRY、KISS、TDD原則に従った新しいアプローチを評価中