# 重要
日本語で応答すること
機能を作成する場合は必ず単体テストをセットで作成し、CIに組み込め。
lint や test エラーを一時的に回避した場合、github issue に登録すること。

# 原則
- YAGNI（You Aren't Gonna Need It）：今必要じゃない機能は作らない
- DRY（Don't Repeat Yourself）：同じコードを繰り返さない
- KISS（Keep It Simple Stupid）：シンプルに保つ
- t-wada TDD: テスト駆動開発

## YAGNI適用成功事例
- **Issue #5371** (2025-07): log_backtest_startup_message関数の簡素化
  - 120行→45行（73%削減）を達成
  - Docker再起動検出システム、log_duplicate_stats統計機能を削除
  - 核心機能（重複防止、flock同期）は完全保持
  - テスト品質向上、CI通過、レビュー承認済み

# 注意
- トップディレクトリにテスト用スクリプトを作って放置してはならない
- テスト用スクリプトは .tmp に作成し、終わったら捨てる

## ファイル作成ルール
- セッション中に作成する中間ファイル・一時的なファイルは .tmp に作成すること

# Github actions
## anthropics/claude-code-action@beta
仕様： https://github.com/anthropics/claude-code-action/blob/main/README.md
### 非対応
`anthropics/claude-code-action@beta` を使うとき以下が非対応です. github actions `github-script` のみの利用のときは使用可能です。
- workflow_run
- repository_dispatch

## Github actions
- 自動で作成した github actions からの comment, label などではアクションをトリガーできない

