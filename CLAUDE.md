# 開発初期設定

## 概要
このドキュメントでは、効率的で品質の高い開発を行うための基本的なワークフローを定義します。
ホームディレクトリに配置することで、すべてのプロジェクトで共通のワークフローを適用できます。

## セットアップ方法

### 1. ファイル配置
```bash
# ホームディレクトリに開発設定ディレクトリを作成
mkdir -p ~/.dev-config

# このファイルをホームディレクトリに配置
cp claude.md ~/.dev-config/
```

### 2. グローバル設定の適用
```bash
# .bashrc または .zshrc に追加
echo 'export DEV_CONFIG_PATH="$HOME/.dev-config"' >> ~/.bashrc
echo 'alias dev-guide="cat $DEV_CONFIG_PATH/claude.md"' >> ~/.bashrc

# 設定を反映
source ~/.bashrc
```

## 開発フロー

### 1. 実装計画の立案
GitHubが利用可能な場合は、以下の手順で実装計画を整理します：

- **Issue作成**: 機能単位または問題単位でIssueを作成
- **ラベル付け**: `enhancement`, `bug`, `documentation`等の適切なラベルを設定
- **優先度設定**: High/Medium/Lowで優先度を明記
- **作業見積もり**: 大まかな工数を記載（例：1-3日、1週間等）

```markdown
## Issue例
**タイトル**: ユーザー認証機能の実装
**説明**: 
- [ ] ログイン画面の作成
- [ ] 認証ロジックの実装
- [ ] セッション管理の実装
- [ ] テストケースの作成
**優先度**: High
**見積もり**: 3-5日
```

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

## グローバルツール設定

### Git設定（ホームディレクトリ）
```bash
# グローバルGit設定
git config --global init.templatedir ~/.dev-config/git-template
mkdir -p ~/.dev-config/git-template/hooks

# 共通pre-commitフック作成
cat > ~/.dev-config/git-template/hooks/pre-commit << 'EOF'
#!/bin/sh
# パッケージマネージャーを自動検出
if [ -f "package.json" ]; then
  if [ -f "yarn.lock" ]; then
    yarn lint 2>/dev/null || echo "Lint not configured"
    yarn test 2>/dev/null || echo "Test not configured"
  elif [ -f "pnpm-lock.yaml" ]; then
    pnpm lint 2>/dev/null || echo "Lint not configured"
    pnpm test 2>/dev/null || echo "Test not configured"
  else
    npm run lint 2>/dev/null || echo "Lint not configured"
    npm test 2>/dev/null || echo "Test not configured"
  fi
fi
EOF

chmod +x ~/.dev-config/git-template/hooks/pre-commit
```

### VS Code設定例（グローバル）
```bash
# VS Code設定ディレクトリに移動
cd ~/Library/Application\ Support/Code/User/  # macOS
# cd ~/.config/Code/User/  # Linux
# cd %APPDATA%\Code\User\  # Windows

# settings.jsonに追加する設定
cat >> settings.json << 'EOF'
{
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "git.confirmSync": false,
  "git.autofetch": true,
  "terminal.integrated.defaultProfile.osx": "zsh"
}
EOF
```

### 便利なグローバルエイリアス
```bash
# ~/.dev-config/aliases.sh を作成
cat > ~/.dev-config/aliases.sh << 'EOF'
# Git関連
alias gs='git status'
alias ga='git add'
alias gc='git commit'
alias gp='git push'
alias gl='git log --oneline'
alias gco='git checkout'
alias gcb='git checkout -b'

# 開発関連
alias serve='python -m http.server 8000'
alias testw='npm test -- --watch'
alias lintfix='npm run lint -- --fix'

# プロジェクト初期化
alias init-project='cp ~/.dev-config/project-template/* .'

# Issue作成支援
alias create-issue='gh issue create --title'
alias list-issues='gh issue list'
EOF

# シェル設定ファイルに追加
echo 'source ~/.dev-config/aliases.sh' >> ~/.bashrc
```

### プロジェクトテンプレート作成
```bash
# テンプレートディレクトリ作成
mkdir -p ~/.dev-config/project-template

# 共通.gitignore
cat > ~/.dev-config/project-template/.gitignore << 'EOF'
node_modules/
.env
.env.local
.DS_Store
*.log
coverage/
dist/
build/
EOF

# 共通README.md雛形
cat > ~/.dev-config/project-template/README.md << 'EOF'
# プロジェクト名

## 概要
このプロジェクトについて簡潔に説明

## セットアップ
```bash
npm install
npm start
```

## 開発ワークフロー
- Issue作成 → ブランチ作成 → 開発 → テスト → PR作成 → レビュー → マージ
- 参考: ~/.dev-config/claude.md

## テスト実行
```bash
npm test
npm run test:watch
```
EOF
```

### GitHub CLI便利エイリアス
```bash
# GitHub CLI関連エイリアス（~/.dev-config/aliases.shに追加）
cat >> ~/.dev-config/aliases.sh << 'EOF'

# GitHub関連
alias ghpr='gh pr create'
alias ghprl='gh pr list'
alias ghprv='gh pr view'
alias ghprm='gh pr merge --squash'
alias ghis='gh issue create'
alias ghisl='gh issue list'
EOF
```

## 使用方法

### 新しいプロジェクトでの適用
```bash
# 新しいプロジェクトディレクトリで
cd your-new-project

# テンプレートファイルをコピー
cp ~/.dev-config/project-template/* .

# 開発ガイドを確認
dev-guide

# Git初期化（テンプレートが自動適用される）
git init
```

### 既存プロジェクトでの適用
```bash
# 既存プロジェクトディレクトリで
cd your-existing-project

# 必要な設定ファイルのみコピー
cp ~/.dev-config/project-template/.gitignore .

# pre-commitフックを有効化
cp ~/.dev-config/git-template/hooks/pre-commit .git/hooks/
```

### 日常的な使用例
```bash
# 開発開始
ghis --title "新機能の実装" --body "詳細な説明..."  # Issue作成
gcb feature/new-feature

# 開発作業...

# テスト実行
testw  # watchモードでテスト

# コミット
ga .
gc -m "feat: 新機能の実装

詳細説明...

Closes #123"

# PR作成
gp  # プッシュ
ghpr --title "feat: 新機能の実装" --body "Closes #123"
```
