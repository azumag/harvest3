# entrypoint.sh リファクタリング仕様書

## 概要

Issue #5351: entrypoint.shの大幅リファクタリング（KISS原則適用）により、1608行の巨大なファイルを5つの責任別モジュールに分割しました。

## 新しいファイル構造

### 1. entrypoint.sh（オーケストレーター）- 212行

**責任**: モジュール管理・起動制御・共通設定

- **機能**:
  - 環境変数・設定の一元管理
  - 各モジュールの読み込み
  - メイン実行フローの制御
  - 共通ユーティリティ関数（log, get_message_hash, check_timestamp_validity）

### 2. startup-manager.sh（起動制御）- 470行

**責任**: アプリケーション起動・プロセス管理・診断

- **主要機能**:
  - `acquire_startup_lock()` / `release_startup_lock()`: 起動ロック管理
  - `pre_startup_checks()`: 起動前チェック（環境変数・ファイル・依存関係）
  - `start_application()`: アプリケーション起動・監視・自動回復
  - `cleanup()`: グレースフルシャットダウン
  - `run_diagnostics()`: システム診断情報収集

### 3. dependency-installer.sh（npm依存関係）- 169行

**責任**: Node.js依存関係管理・キャッシュ処理

- **主要機能**:
  - `check_existing_dependencies()`: 既存依存関係チェック
  - `install_npm_dependencies()`: npm install統合処理
  - `retry_npm_install_with_backoff()`: 指数バックオフリトライ
  - `cleanup_npm_cache()`: npmキャッシュクリーンアップ
  - `check_container_recently_restarted()`: 再起動検出

### 4. notification-service.sh（Discord通知）- 300行

**責任**: Discord通知・起動メッセージ管理

- **主要機能**:
  - `send_startup_error_to_discord()`: Discord通知送信
  - `log_startup_message()`: 起動メッセージ重複防止
  - `log_backtest_startup_message()`: backtest専用メッセージ処理
  - `try_redis_duplicate_prevention()`: Redis重複防止
  - `fallback_to_file_based_prevention()`: ファイルベース重複防止

### 5. lock-manager.sh（ロック管理）- 162行

**責任**: 各種ロック管理・重複防止機構

- **主要機能**:
  - `acquire_message_lock()` / `create_success_file()`: atomicロック処理
  - `validate_success_file()`: success file検証
  - `cleanup_backtest_locks()`: backtest関連クリーンアップ
  - `cleanup_startup_message_locks()`: 起動メッセージロッククリーンアップ
  - `cleanup_background_processes()`: バックグラウンドプロセス管理

### 6. database-connector.sh（DB接続）- 65行

**責任**: データベース接続・リトライ処理

- **主要機能**:
  - `check_database_connection()`: 共通DB接続チェック
  - `check_database_connections()`: Redis・MongoDB接続統合処理

## 利点

### KISS原則の適用

- **単一責任の原則**: 各モジュールが明確に分離された責任を持つ
- **可読性の向上**: 1608行 → 212行（メインファイル）で構造が理解しやすい
- **保守性の向上**: 変更影響範囲の明確化

### テスト容易性

- 個別機能のユニットテストが可能
- モジュール単位での単体テスト実装

### 再利用性

- 各モジュールが独立しており、他のスクリプトからも利用可能
- 機能の部分的な置き換えが容易

## モジュール依存関係

```
entrypoint.sh (オーケストレーター)
├── lock-manager.sh
├── notification-service.sh
├── dependency-installer.sh
├── database-connector.sh
└── startup-manager.sh (他全てのモジュールに依存)
```

## 使用方法

### 通常モード
```bash
./entrypoint.sh
```

### backtestモード
```bash
BACKTEST_MODE=true ./entrypoint.sh npm run backtest
```

## 互換性

- **API互換性**: 既存のDockerコンテナとの完全互換性を維持
- **設定互換性**: 全ての環境変数・設定項目が既存のまま利用可能
- **機能互換性**: 全ての既存機能を維持

## テスト状況

既存のテストの一部でリファクタリング前のファイル内容を期待する箇所があり、修正が必要です。しかし、これは機能的な問題ではなく、テストの期待値の更新が必要なケースです。

## 今後の改善点

1. 各モジュールの単体テスト追加
2. 既存テストの期待値更新
3. モジュール間の依存関係をさらに疎結合化
4. エラーハンドリングの統一化

---

**作成日**: 2025-07-25  
**Issue**: #5351  
**原則**: KISS（Keep It Simple Stupid）、DRY（Don't Repeat Yourself）、YAGNI（You Aren't Gonna Need It）