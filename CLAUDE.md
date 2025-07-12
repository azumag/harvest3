# 重要
日本語で応答すること
機能を作成する場合は必ず単体テストをセットで作成し、CIに組み込め。
lint や test エラーを一時的に回避した場合、github issue に登録すること。

# 原則
- YAGNI（You Aren't Gonna Need It）：今必要じゃない機能は作らない
- DRY（Don't Repeat Yourself）：同じコードを繰り返さない
- KISS（Keep It Simple Stupid）：シンプルに保つ
- t-wada TDD: テスト駆動開発

# 注意
- トップディレクトリにテスト用スクリプトを作って放置してはならない
- テスト用スクリプトは .tmp に作成し、終わったら捨てる

## ファイル作成ルール
- セッション中に作成する中間ファイル・一時的なファイルは .tmp に作成すること

# GitHub Actions
- anthropics/claude-code-action@beta は、workflow_run に対応していません。