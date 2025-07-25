#!/bin/bash

# entrypoint.sh - Strategy-Runner Container Orchestrator
# Issue #5351: KISS原則適用によるリファクタリング - 単一責任のオーケストレーター
# Geminiの厳格レビューに基づく実装
# Issue #2511 修正: 二重再起動防止機能とDocker restart policyとの競合回避

set -e  # エラー時即座終了

# === 設定（環境変数で上書き可能） ===
CONTAINER_NAME="strategy-runner"
MAX_STARTUP_TIME=${MAX_STARTUP_TIME:-60}  # 最大起動時間（秒）
HEALTH_CHECK_INTERVAL=${HEALTH_CHECK_INTERVAL:-5}  # ヘルスチェック間隔（秒）
API_STARTUP_TIMEOUT=${API_STARTUP_TIMEOUT:-90}  # APIサーバー起動タイムアウト（秒）
API_CHECK_INTERVAL=${API_CHECK_INTERVAL:-3}  # APIチェック間隔（秒）
PROGRESS_LOG_INTERVAL=${PROGRESS_LOG_INTERVAL:-15}  # 進捗ログ間隔（秒）
DATABASE_CONNECTION_TIMEOUT=${DATABASE_CONNECTION_TIMEOUT:-10}  # DB接続タイムアウト（秒）
DISCORD_NOTIFICATION_TIMEOUT=${DISCORD_NOTIFICATION_TIMEOUT:-10}  # Discord通知タイムアウト（秒）

# Issue #5121 専用設定: 重複ログ防止ロック機構
LOCK_CLEANUP_TIMEOUT=${LOCK_CLEANUP_TIMEOUT:-60}  # 古いロックファイル削除タイムアウト（秒）
SUCCESS_FILE_CLEANUP_DELAY=${SUCCESS_FILE_CLEANUP_DELAY:-300}  # 完了マーカーファイル削除遅延（秒）

# Issue #5195: マジックナンバー定数化（KISS/DRY原則適用）
SAME_CONTAINER_DUPLICATE_THRESHOLD=${SAME_CONTAINER_DUPLICATE_THRESHOLD:-30}  # 同一コンテナ重複検出閾値（秒）
SUCCESS_FILE_MAX_AGE=${SUCCESS_FILE_MAX_AGE:-300}  # success file最大寿命（秒）
MAX_LOCK_ATTEMPTS=${MAX_LOCK_ATTEMPTS:-3}  # ロック取得最大試行回数
LOCK_RETRY_DELAY=${LOCK_RETRY_DELAY:-1}  # ロックリトライ待機時間（秒）

# Issue #5292レビュー対応: マジックナンバーの統一定数化
MESSAGE_SUPPRESS_DURATION=${MESSAGE_SUPPRESS_DURATION:-30}  # メッセージ抑制期間（秒）
NPM_ERROR_SUPPRESS_DURATION=${NPM_ERROR_SUPPRESS_DURATION:-60}  # NPMエラー後抑制期間（秒）
PROCESS_MONITOR_INTERVAL=${PROCESS_MONITOR_INTERVAL:-10}  # プロセス監視間隔（秒）

# Issue #5172: リファクタリング - 設定の外部化（YAGNI/KISS原則）
REDIS_DUPLICATE_PREVENTION_TTL=${REDIS_DUPLICATE_PREVENTION_TTL:-300}  # Redis重複防止TTL（秒）
DUPLICATE_PREVENTION_STRATEGY=${DUPLICATE_PREVENTION_STRATEGY:-redis_first}  # 重複防止戦略

# バックグラウンドプロセス追跡
BACKGROUND_CLEANUP_PIDS=""

# Issue #5127 専用設定: backtest container重複起動メッセージ防止強化
BACKTEST_STARTUP_LOCK_FILE="/tmp/backtest-startup-message.lock"  # backtest用永続ロックファイル
BACKTEST_STARTUP_TIMESTAMP_FILE="/tmp/backtest-startup-timestamp.state"  # Issue #5194修正: タイムスタンプ専用ファイル  
BACKTEST_STARTUP_LOCK_TIMEOUT=${BACKTEST_STARTUP_LOCK_TIMEOUT:-60}  # backtest起動ロックタイムアウト（秒）- Issue #5175: 60秒に延長
BACKTEST_STARTUP_FLOCK_TIMEOUT=${BACKTEST_STARTUP_FLOCK_TIMEOUT:-5}  # flock最大待機時間（秒）
BACKTEST_CONTAINER_RESTART_DETECTION_FILE="/tmp/backtest-restart-detection.state"  # Issue #5175: コンテナ再起動検出用

# セキュリティ注記: /tmp使用について
# ・Dockerコンテナ内での一時的なプロセス間同期に使用
# ・ファイル権限600でアクセス制御、プロセスID検証実装済み
# ・コンテナ再起動時に自動クリーンアップされるため永続化の懸念なし
STARTUP_LOCK_FILE="/tmp/strategy-runner-startup.lock"  # 起動ロックファイル
STARTUP_LOCK_TIMEOUT=${STARTUP_LOCK_TIMEOUT:-30}  # 起動ロックタイムアウト（秒）

# 重複起動メッセージ防止（ファイルベースの atomic 実装）
# atomic ファイルベース実装によるメッセージ重複防止システム
STARTUP_MESSAGE_LOCK_DIR="/tmp/startup_messages"
mkdir -p "$STARTUP_MESSAGE_LOCK_DIR" 2>/dev/null || true

# Issue #5150: コンテナ再起動時の初期クリーンアップ
# 前回の実行で残ったロックファイルを削除してクリーンな状態で開始
find "$STARTUP_MESSAGE_LOCK_DIR" -name "*.done" -type f -delete 2>/dev/null || true
find "$STARTUP_MESSAGE_LOCK_DIR" -name "*.lock" -type d -exec rm -rf {} + 2>/dev/null || true

# === 共通ユーティリティ関数 ===

# ログ関数
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

# MD5ハッシュ値生成関数（DRY原則適用）
get_message_hash() {
    echo "$1" | md5sum | cut -d' ' -f1
}

# Issue #5292レビュー対応: 統一されたタイムスタンプ検証関数（DRY原則）
# Issue #5340修正: bcコマンド依存を除去し、整数算術のみ使用
check_timestamp_validity() {
    local marker_file="$1"
    local suppress_duration="$2"
    local current_time="$3"
    
    if [ -f "$marker_file" ]; then
        local last_time=$(cat "$marker_file" 2>/dev/null || echo "0")
        # 整数部分のみを使用してCI環境での互換性を確保
        local current_time_int=${current_time%.*}
        local last_time_int=${last_time%.*}
        local time_diff=$((current_time_int - last_time_int))
        
        # 整数算術でタイムスタンプ比較（bcコマンド不要）
        if [ "$time_diff" -lt "$suppress_duration" ]; then
            return 0  # 抑制すべき（タイムスタンプが新しすぎる）
        fi
    fi
    return 1  # 抑制不要
}

# === モジュール読み込み ===
# 各モジュールを読み込んで機能を利用可能にする

# ロック管理機能
source lock-manager.sh

# 通知サービス
source notification-service.sh

# 依存関係インストーラー
source dependency-installer.sh

# データベース接続
source database-connector.sh

# 起動マネージャー（メイン機能）
source startup-manager.sh

# === メイン実行処理 ===

# シグナルハンドラー設定
trap cleanup SIGTERM SIGINT

# メイン実行
main() {
    # 起動診断情報の記録
    log "=== 起動診断情報 ==="
    log "プロセス ID: $$"
    log "起動時刻: $(date '+%Y-%m-%d %H:%M:%S')"
    log "作業ディレクトリ: $(pwd)"
    log "バックテストモード: ${BACKTEST_MODE:-false}"
    
    # 起動ロックの取得（重複起動防止）
    if ! acquire_startup_lock; then
        log "ERROR: Failed to acquire startup lock"
        exit 1
    fi
    
    # ロック解放のための終了時処理を設定
    trap release_startup_lock EXIT
    
    if [ "$BACKTEST_MODE" = "true" ]; then
        # 起動ロック取得後に安全にメッセージを出力
        log_backtest_startup_message "Starting backtest container with enhanced error handling"
        
        # backtest用の段階的起動プロセス
        pre_startup_checks
        check_database_connections
        
        # Issue #5127: backtest実行前の追加診断
        log "Pre-startup checks completed for backtest mode"
        log "Backtest command arguments: $*"
        
        # backtest実行可能性チェック
        if [ $# -eq 0 ]; then
            log "ERROR: No command arguments provided for backtest execution"
            send_startup_error_to_discord "Backtest container: No command arguments provided" "Command line: $0 (no args)"
            exit 1
        fi
        
        # Issue #5127: npm run backtestコマンドの検証
        if [ "$1" = "npm" ] && [ "$2" = "run" ] && [ "$3" = "backtest" ]; then
            log "Validating npm run backtest command..."
            
            # package.jsonのbacktestスクリプト存在確認
            if [ -f "package.json" ]; then
                if grep -q '"backtest"' package.json; then
                    log "Backtest script found in package.json"
                else
                    log "WARNING: Backtest script not found in package.json"
                fi
            else
                log "WARNING: package.json not found"
            fi
            
            # backtestRunner.jsファイル存在確認
            if [ -f "src/backtestRunner.js" ]; then
                log "Backtest runner found: src/backtestRunner.js"
            else
                log "WARNING: Backtest runner not found: src/backtestRunner.js"
            fi
        fi
        
        # Issue #5127/#5173対策: exec実行前のファイナルチェックと重複メッセージ防止  
        # Issue #5132修正: 重複する起動メッセージを防止するため、exec実行前の追加メッセージを削除
        # バックテスト実行開始はline 1288で既に通知済み
        
        # backtest開始時刻を記録（問題追跡用）
        echo "$(date +%s)" > /tmp/backtest-start-time.marker
        
        # execコマンドの実行
        exec "$@"
    else
        # 起動ロック取得後に安全にメッセージを出力
        log_startup_message "Starting strategy-runner container with enhanced error handling (container: $(hostname), pid: $$)"
        
        # 初期診断の実行
        run_diagnostics
        
        # 段階的起動プロセス
        pre_startup_checks
        check_database_connections
        start_application
    fi
}

# エラーハンドリング付きメイン実行
if ! main "$@"; then
    exit_code=$?
    log "FATAL: Container startup failed with exit code $exit_code"
    send_startup_error_to_discord "Container startup failed" "Exit code: $exit_code"
    exit $exit_code
fi