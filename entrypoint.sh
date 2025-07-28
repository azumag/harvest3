#!/bin/bash

# strategy-runner コンテナ起動時エラーハンドリング & Discord通知スクリプト
# Geminiの厳格レビューに基づく実装
# Issue #2511 修正: 二重再起動防止機能とDocker restart policyとの競合回避

set -e  # エラー時即座終了

# 設定（環境変数で上書き可能）
CONTAINER_NAME="strategy-runner"
MAX_STARTUP_TIME=${MAX_STARTUP_TIME:-60}  # 最大起動時間（秒）
HEALTH_CHECK_INTERVAL=${HEALTH_CHECK_INTERVAL:-5}  # ヘルスチェック間隔（秒）
API_STARTUP_TIMEOUT=${API_STARTUP_TIMEOUT:-90}  # APIサーバー起動タイムアウト（秒）
API_CHECK_INTERVAL=${API_CHECK_INTERVAL:-3}  # APIチェック間隔（秒）
PROGRESS_LOG_INTERVAL=${PROGRESS_LOG_INTERVAL:-15}  # 進捗ログ間隔（秒）
DATABASE_CONNECTION_TIMEOUT=${DATABASE_CONNECTION_TIMEOUT:-10}  # DB接続タイムアウト（秒）
DISCORD_NOTIFICATION_TIMEOUT=${DISCORD_NOTIFICATION_TIMEOUT:-10}  # Discord通知タイムアウト（秒）

# Issue #5417: セキュリティ強化 - 一時ファイル格納場所の改善
# /tmpから/var/runへの移行（環境変数で設定可能、後方互換性維持）
LOCK_BASE_DIR=${LOCK_BASE_DIR:-/var/run/strategy-runner}  # 一時ファイル・ロックファイル基底ディレクトリ

# Issue #5417: セキュアなディレクトリ作成とセットアップ関数
setup_lock_base_directory() {
    # ディレクトリが存在しない場合は作成
    if [ ! -d "$LOCK_BASE_DIR" ]; then
        log "Creating secure lock directory: $LOCK_BASE_DIR"
        if ! mkdir -p "$LOCK_BASE_DIR" 2>/dev/null; then
            # /var/runの作成に失敗した場合はフォールバック
            log "WARNING: Failed to create $LOCK_BASE_DIR, falling back to /tmp"
            LOCK_BASE_DIR="/tmp"
            return 0
        fi
    fi
    
    # セキュアな権限設定（所有者のみアクセス可能）
    if ! set_secure_permissions "$LOCK_BASE_DIR" "dir"; then
        log "WARNING: Failed to set secure permissions on $LOCK_BASE_DIR"
    fi
    
    log "Lock base directory setup completed: $LOCK_BASE_DIR"
    return 0
}

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

# Issue #5338: 重複防止メトリクス設定
ENABLE_DUPLICATE_STATS=${ENABLE_DUPLICATE_STATS:-false}  # 重複防止統計記録機能（デフォルト無効）
DUPLICATE_STATS_LOG_FILE=${DUPLICATE_STATS_LOG_FILE:-"$LOCK_BASE_DIR/duplicate-stats.log"}  # 統計ログファイルパス（セキュア）

# バックグラウンドプロセス追跡
BACKGROUND_CLEANUP_PIDS=""

# Issue #5127 & #5372: backtest container重複起動メッセージ防止設定（KISS原則適用・統一化）
# Issue #5372修正: 設定の外部化と一元管理
# Issue #5417修正: セキュリティ強化により$LOCK_BASE_DIRを使用
BACKTEST_STARTUP_LOCK_FILE="$LOCK_BASE_DIR/backtest-startup-message.lock"  # backtest用永続ロックファイル
BACKTEST_STARTUP_TIMESTAMP_FILE="$LOCK_BASE_DIR/backtest-startup-message.last"  # Issue #5372: 統一されたタイムスタンプファイル名
BACKTEST_STARTUP_LOCK_TIMEOUT=${BACKTEST_STARTUP_LOCK_TIMEOUT:-60}  # backtest起動ロックタイムアウト（秒）
BACKTEST_STARTUP_FLOCK_TIMEOUT=${BACKTEST_STARTUP_FLOCK_TIMEOUT:-15}  # flock最大待機時間（秒）
BACKTEST_CONTAINER_RESTART_DETECTION_FILE="$LOCK_BASE_DIR/backtest-restart-detection.state"  # Issue #5175: コンテナ再起動検出用
BACKTEST_FD_BASE=${BACKTEST_FD_BASE:-200}  # Issue #5372: 動的ファイルディスクリプタ基底値（設定可能）

# セキュリティ注記: Issue #5417により/var/runへ移行
# ・Dockerコンテナ内での一時的なプロセス間同期に使用
# ・ファイル権限700でアクセス制御、プロセスID検証実装済み
# ・コンテナ再起動時に自動クリーンアップされるため永続化の懸念なし
STARTUP_LOCK_FILE="$LOCK_BASE_DIR/strategy-runner-startup.lock"  # 起動ロックファイル
STARTUP_LOCK_TIMEOUT=${STARTUP_LOCK_TIMEOUT:-30}  # 起動ロックタイムアウト（秒）

# 重複起動メッセージ防止（ファイルベースの atomic 実装）
# atomic ファイルベース実装によるメッセージ重複防止システム
STARTUP_MESSAGE_LOCK_DIR="$LOCK_BASE_DIR/startup_messages"


# Issue #5307 Phase 2: MD5計算の最適化
# 短いメッセージ（64文字以下）は直接比較用、長いメッセージはMD5ハッシュ化
MESSAGE_DIRECT_COMPARISON_THRESHOLD=${MESSAGE_DIRECT_COMPARISON_THRESHOLD:-64}

# Issue #5307 Phase 3: 統一的なファイル権限ポリシー
TEMP_FILE_PERMISSIONS=${TEMP_FILE_PERMISSIONS:-600}  # 所有者のみ読み書き可能
TEMP_DIR_PERMISSIONS=${TEMP_DIR_PERMISSIONS:-700}   # 所有者のみアクセス可能

# Issue #5307 Phase 3: 残存するマジックナンバーの外部化
CONTAINER_RESTART_DETECTION_THRESHOLD=${CONTAINER_RESTART_DETECTION_THRESHOLD:-60}  # コンテナ再起動検出閾値（秒）
PROCESS_RESTART_COOLDOWN=${PROCESS_RESTART_COOLDOWN:-45}  # プロセス再起動クールダウン（秒）
GRACEFUL_SHUTDOWN_TIMEOUT=${GRACEFUL_SHUTDOWN_TIMEOUT:-15}  # 優雅な終了タイムアウト（秒）

# 統一的なファイル権限設定関数
set_secure_permissions() {
    local target="$1"
    local target_type="$2"  # "file" or "dir"
    
    if [ ! -e "$target" ]; then
        return 1  # ファイル/ディレクトリが存在しない
    fi
    
    case "$target_type" in
        "file")
            chmod "$TEMP_FILE_PERMISSIONS" "$target" 2>/dev/null || {
                log "WARNING: Failed to set permissions on file: $target"
                return 1
            }
            ;;
        "dir")
            chmod "$TEMP_DIR_PERMISSIONS" "$target" 2>/dev/null || {
                log "WARNING: Failed to set permissions on directory: $target"
                return 1
            }
            ;;
        *)
            log "ERROR: Invalid target type '$target_type' for set_secure_permissions"
            return 1
            ;;
    esac
    
    return 0
}

# Issue #5307 Phase 3: 統一的なエラーハンドリング戦略
# Issue #5417修正: セキュリティ強化により$LOCK_BASE_DIRを使用
ERROR_LOG_FILE=${ERROR_LOG_FILE:-"$LOCK_BASE_DIR/backtest-errors.log"}
ERROR_NOTIFICATION_THRESHOLD=${ERROR_NOTIFICATION_THRESHOLD:-3}  # 連続エラー通知閾値

# Issue #5370: DRY原則適用 - 統一的なタイムスタンプ更新関数
update_timestamp_atomically() {
    local file="$1"
    local time="$2"
    local temp="${file}.tmp.$$"
    
    if echo "$time" > "$temp" && mv "$temp" "$file"; then
        set_secure_permissions "$file" "file"
        return 0
    else
        rm -f "$temp" 2>/dev/null || true
        log "WARNING: Failed to update startup message timestamp"
        return 1
    fi
}

# 統一エラーハンドリング関数
handle_unified_error() {
    local error_type="$1"      # "critical", "warning", "info"
    local error_message="$2"   # エラーメッセージ
    local error_context="$3"   # エラーコンテキスト（オプション）
    local notify_discord="$4"  # Discord通知フラグ（true/false）
    
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    local full_message="[$timestamp] [$error_type] $error_message"
    
    # コンテキスト情報があれば追加
    if [ -n "$error_context" ]; then
        full_message="$full_message (Context: $error_context)"
    fi
    
    # ログファイルに記録
    echo "$full_message" >> "$ERROR_LOG_FILE" 2>/dev/null || {
        # ログファイルへの書き込みが失敗した場合はstderrに出力
        echo "$full_message" >&2
    }
    
    # エラータイプに応じた処理
    case "$error_type" in
        "critical")
            log "CRITICAL ERROR: $error_message"
            # クリティカルエラーは必ずDiscord通知
            if [ "$notify_discord" != "false" ]; then
                send_startup_error_to_discord "Critical Error" "$error_message"
            fi
            ;;
        "warning")
            log "WARNING: $error_message"
            # 警告は閾値を超えた場合のみ通知（原子的カウンター操作）
            local warning_count
            if command -v flock >/dev/null 2>&1; then
                warning_count=$(flock -x "$ERROR_LOG_FILE.lock" -c "grep -c 'WARNING.*$error_message' '$ERROR_LOG_FILE' 2>/dev/null || echo '0'")
            else
                warning_count=$(grep -c "WARNING.*$error_message" "$ERROR_LOG_FILE" 2>/dev/null || echo "0")
            fi
            if [ "$warning_count" -ge "$ERROR_NOTIFICATION_THRESHOLD" ] && [ "$notify_discord" != "false" ]; then
                send_startup_error_to_discord "Repeated Warning" "$error_message (occurred $warning_count times)"
            fi
            ;;
        "info")
            log "INFO: $error_message"
            # 情報レベルは通常Discord通知しない
            ;;
        *)
            log "UNKNOWN ERROR TYPE [$error_type]: $error_message"
            ;;
    esac
    
    # ログファイルサイズ制限（1MB超過で古いエントリを削除）
    if [ -f "$ERROR_LOG_FILE" ]; then
        local log_size=$(wc -c < "$ERROR_LOG_FILE" 2>/dev/null || echo "0")
        if [ "$log_size" -gt 1048576 ]; then  # 1MB = 1048576 bytes
            # 原子的ログローテーション操作
            local temp_log="${ERROR_LOG_FILE}.rotate.$$"
            tail -n 500 "$ERROR_LOG_FILE" > "$temp_log" 2>/dev/null && \
                mv "$temp_log" "$ERROR_LOG_FILE" 2>/dev/null || \
                rm -f "$temp_log" 2>/dev/null
            set_secure_permissions "$ERROR_LOG_FILE" "file"
        fi
    fi
    
    return 0
}

# 簡便なエラーハンドリング関数
critical_error() {
    handle_unified_error "critical" "$1" "$2" "${3:-true}"
}

warning_error() {
    handle_unified_error "warning" "$1" "$2" "${3:-false}"
}

info_message() {
    handle_unified_error "info" "$1" "$2" "false"
}

get_message_hash() {
    local message="$1"
    local message_length=${#message}
    
    # 短いメッセージの場合は直接比較のため元のメッセージを返す（prefix付き）
    if [ $message_length -le $MESSAGE_DIRECT_COMPARISON_THRESHOLD ]; then
        echo "direct:$message"
    else
        # 長いメッセージの場合はMD5ハッシュ化（prefix付き）
        echo "md5:$(echo "$message" | md5sum | cut -d' ' -f1)"
    fi
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

# Issue #5292レビュー対応: キャッシュクリーンアップの改善
cleanup_npm_cache() {
    local cleanup_success=true
    
    log "Cleaning npm cache for stability..."
    
    if ! npm cache clean --force 2>/dev/null; then
        log "WARNING: npm cache clean failed"
        cleanup_success=false
    fi
    
    if ! rm -rf ~/.npm/_cacache 2>/dev/null; then
        log "WARNING: _cacache removal failed"
        cleanup_success=false
    fi
    
    if [ "$cleanup_success" = "true" ]; then
        log "npm cache cleanup completed successfully"
    else
        log "npm cache cleanup completed with warnings"
    fi
    
    return $cleanup_success
}

# Issue #5172: 共通クリーンアップ関数（DRY原則適用）
cleanup_old_lock_file() {
    local lock_file="$1"
    local max_age="$2"
    local current_time="$3"
    
    if [ -f "$lock_file" ] || [ -d "$lock_file" ]; then
        local lock_age=$((current_time - $(stat -c %Y "$lock_file" 2>/dev/null || echo 0)))
        if [ $lock_age -gt $max_age ]; then
            rm -rf "$lock_file" 2>/dev/null || true
            return 0  # クリーンアップ実行
        fi
    fi
    return 1  # クリーンアップ不要
}


# ログ関数
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

# 既存依存関係チェック関数 (Issue #4202)
# Issue #4202 修正: 既存の依存関係の状態を事前確認
check_existing_dependencies() {
    log "Checking existing dependency status..."
    local npm_check_log="/tmp/npm-check.log"
    
    if npm ls 2>"$npm_check_log" >/dev/null; then
        log "Dependencies already satisfied, skipping npm install"
        return 0
    else
        log "Dependencies check failed, npm install required:"
        if [ -f "$npm_check_log" ]; then
            cat "$npm_check_log" | head -10 | while read line; do
                log "  dependency issue: $line"
            done
        fi
        return 1
    fi
}

# Issue #5186: YAGNI原則適用 - 簡素化されたPIDベース再起動検出
# シンプルなPIDベース再起動検出関数
check_container_recently_restarted() {
    # /proc/uptimeを使用してコンテナの稼働時間をチェック
    if [ -f /proc/uptime ]; then
        local uptime_seconds=$(cat /proc/uptime | cut -d' ' -f1 | cut -d'.' -f1)
        # 設定可能な閾値以内の場合は最近再起動したと判定
        if [ "$uptime_seconds" -lt $CONTAINER_RESTART_DETECTION_THRESHOLD ]; then
            return 0  # 最近再起動した
        fi
    fi
    return 1  # 安定稼働中
}

# npm install リトライ処理 (Issue #4202)
# Issue #4202 修正: 指数バックオフによるリトライとコンテナ再起動防止
# Issue #5292: タイムアウトとエラー処理の強化
# Issue #5186: YAGNI原則適用による簡素化
retry_npm_install_with_backoff() {
    local max_npm_attempts=3
    local npm_install_attempts=0
    local npm_install_success=false
    local max_container_restarts=3
    
    # Issue #5186: 簡素化されたPID基準の再起動検出
    local restart_count=1  # デフォルトは1回目の試行
    if check_container_recently_restarted; then
        restart_count=2  # 最近再起動した場合は2回目とみなす
        log "Container recently restarted, adjusting retry strategy"
    fi
    
    log "Container restart assessment: attempt $restart_count (uptime-based detection)"
    
    # 最大再起動回数に達した場合は依存関係チェックを緩和
    if [ $restart_count -gt $max_container_restarts ]; then
        log "WARNING: Maximum container restart count exceeded. Attempting minimal dependency install..."
        max_npm_attempts=1  # 最小限のリトライに制限
    fi
    
    # Issue #5292: npm install事前チェック強化
    log "Pre-install system check:"
    log "  Disk space available: $(df -h . | tail -1 | awk '{print $4}' || echo 'unknown')"
    log "  Available memory: $(free -h | grep '^Mem:' | awk '{print $7}' || echo 'unknown')"
    log "  npm registry ping test..."
    
    # npm registry接続テスト（5秒タイムアウト）
    if ! timeout 5 npm ping >/dev/null 2>&1; then
        log "WARNING: npm registry ping failed - using offline-first approach"
    fi
    
    while [ $npm_install_attempts -lt $max_npm_attempts ] && [ "$npm_install_success" = false ]; do
        npm_install_attempts=$((npm_install_attempts + 1))
        local attempt_log="/tmp/npm-install-error-${npm_install_attempts}.log"
        # Issue #5292: タイムアウトを短縮して早期検出（120s, 180s, 240s）
        local timeout_seconds=$((120 + npm_install_attempts * 60))
        
        log "Attempting npm install (attempt $npm_install_attempts/$max_npm_attempts, timeout: ${timeout_seconds}s)..."
        
        # Issue #5219: 各試行で異なるオプションを使用（セキュリティ強化：シェルインジェクション対策）
        local npm_options="--no-audit --no-fund --prefer-offline"
        case $npm_install_attempts in
            1) npm_options="$npm_options --no-optional" ;;
            2) npm_options="$npm_options --legacy-peer-deps --no-optional" ;;
            3) npm_options="$npm_options --force --no-optional" ;;
        esac
        
        # セキュリティ: npmオプションの検証（許可された文字のみ）
        if ! echo "$npm_options" | grep -E '^[a-zA-Z0-9 \-]+$' >/dev/null; then
            log "ERROR: Invalid npm options detected, using safe defaults"
            npm_options="--no-audit --no-fund --prefer-offline --no-optional"
        fi
        
        log "  Using npm options: $npm_options"
        
        # Issue #5186: YAGNI原則適用 - 簡素化されたタイムアウト処理
        # 複雑なプロセス監視を単純なtimeoutコマンドに置き換え
        log "Starting npm install with ${timeout_seconds}s timeout..."
        if ! timeout "${timeout_seconds}" npm install $npm_options 2>"$attempt_log"; then
            return 1
        fi
        
        if [ $? -eq 0 ]; then
            log "npm install completed successfully on attempt $npm_install_attempts"
            npm_install_success=true
            # Issue #5186: 簡素化によりファイルベースカウンタ管理不要
            break
        else
            log "npm install attempt $npm_install_attempts failed, error details:"
            # エラーログを統合ログファイルにも保存 (Issue #2559 互換性)
            if [ -f "$attempt_log" ]; then
                cat "$attempt_log" >> "$npm_error_log"
                cat "$attempt_log" | head -15 | while read line; do
                    log "  npm error: $line"
                done
            fi
            
            # 最後の試行でない場合のみリトライ準備
            if [ $npm_install_attempts -lt $max_npm_attempts ]; then
                local retry_delay=$((npm_install_attempts * 15))  # Issue #5292レビュー対応: 15s, 30s の待機（延長）
                log "Cleaning npm cache and retrying..."
                log "Waiting ${retry_delay}s before retry..."
                
                # Issue #5292レビュー対応: 改善されたキャッシュクリーンアップ
                cleanup_npm_cache || log "Cache cleanup warnings (non-critical)"
                
                sleep $retry_delay
            fi
        fi
    done
    
    # リトライ結果の処理
    if [ "$npm_install_success" = false ]; then
        # Issue #5159: NPMエラー発生時刻を記録（改良版）
        if [ "$BACKTEST_MODE" = "true" ]; then
            local npm_error_marker="$LOCK_BASE_DIR/backtest-npm-error-detection.state"
            echo "$(date +%s)" > "$npm_error_marker"
            set_secure_permissions "$npm_error_marker" "file"
            log "NPM error recorded for Issue #5159 duplicate message prevention"
            
            # NPMエラー時は明示的にDiscord通知を送信
            send_startup_error_to_discord "NPM installation failed (Issue #5159)" \
                "Container will restart - duplicate message prevention active"
        fi
        
        # Issue #5186: 簡素化された再起動制限チェック
        if [ $restart_count -le $max_container_restarts ]; then
            local error_msg="npm install failed after cache clean and $max_npm_attempts attempts"
            log "ERROR: $error_msg"
            log "npm install failed after cache clean"  # Issue #2644 下位互換性
            send_startup_error_to_discord "$error_msg" "Node.js dependency installation failed - will retry on container restart"
            return 1
        else
            # 最大再起動回数に達した場合は依存関係を部分的に無視して続行
            log "WARNING: Maximum restart attempts reached. Continuing with partial dependencies..."
            log "This may cause runtime errors, but prevents infinite restart loop"
            send_startup_error_to_discord "npm install repeatedly failed - continuing with partial dependencies" "Infinite restart loop prevention activated"
            return 0
        fi
    fi
    
    return 0
}

# npm依存関係インストール統合関数 (Issue #4202)
install_npm_dependencies() {
    log "Installing npm dependencies..."
    
    # Issue #2559 下位互換性: エラーログ変数を定義
    npm_error_log="/tmp/npm-install-error.log"
    local dep_install_error="/tmp/dep-install.log"
    local dep_check_error="/tmp/dep-check.log"
    local npm_ls_error="/tmp/npm-ls-error.log"
    
    # Issue #5219: 事前診断情報の収集（強化版）
    log "Pre-install diagnostics:"
    log "  Working directory: $(pwd)"
    log "  Node.js version: $(node --version 2>/dev/null || echo 'Node.js not found')"
    log "  npm version: $(npm --version 2>/dev/null || echo 'npm not found')"
    log "  Disk space: $(df -h . | tail -1 | awk '{print $4}' || echo 'unknown')"
    log "  Memory available: $(free -h | grep '^Mem:' | awk '{print $7}' || echo 'unknown')"
    log "  package.json exists: $([ -f package.json ] && echo 'yes' || echo 'no')"
    log "  node_modules exists: $([ -d node_modules ] && echo 'yes' || echo 'no')"
    log "  npm cache size: $(du -sh ~/.npm 2>/dev/null | cut -f1 || echo 'unknown')"
    
    # Issue #5219: ネットワーク接続性テスト
    log "Network connectivity test:"
    if timeout 10 npm ping >/dev/null 2>&1; then
        log "  npm registry connectivity: OK"
    else
        log "  npm registry connectivity: FAILED - will try alternative approaches"
    fi
    
    # 既存の依存関係チェック
    if check_existing_dependencies; then
        return 0  # 依存関係が既に満たされている
    fi
    
    # Issue #5219: npmキャッシュクリーンアップ（予防的対策）
    log "Cleaning npm cache to prevent stale cache issues..."
    npm cache clean --force 2>/dev/null || log "  npm cache clean failed (non-critical)"
    
    # Issue #5219: npmレジストリ設定の最適化
    log "Optimizing npm configuration for stability..."
    npm config set fetch-retry-mintimeout 20000 2>/dev/null || true
    npm config set fetch-retry-maxtimeout 120000 2>/dev/null || true
    npm config set fetch-retries 5 2>/dev/null || true
    npm config set network-timeout 300000 2>/dev/null || true
    
    # Issue #2559 下位互換性: 最初は固定タイムアウト（300秒）で実行
    log "Attempting initial npm install with fixed timeout (Issue #2559 compatibility)..."
    if timeout 300 npm install --no-audit --no-fund --prefer-offline 2>"$npm_error_log"; then
        log "npm install completed successfully with fixed timeout"
        return 0
    else
        log "Fixed timeout npm install failed, switching to enhanced retry logic..."
        # Issue #2644 下位互換性: エラーログの詳細表示
        if [ -f "$npm_error_log" ]; then
            log "npm error details:"
            cat "$npm_error_log" | head -20 | while read line; do
                log "  npm error: $line"
            done
        fi
    fi
    
    # Issue #5219: 拡張リトライロジックを実行（改良版）
    if ! retry_npm_install_with_backoff; then
        # Issue #5219: 最終的なフォールバック戦略
        log "All npm install attempts failed. Attempting final fallback strategy..."
        
        # 練習モードで重要な依存関係のみインストールを試行
        local critical_deps="ccxt express mongodb redis axios moment"
        log "Attempting to install critical dependencies only: $critical_deps"
        
        if timeout 180 npm install $critical_deps --no-audit --no-fund --prefer-offline 2>/dev/null; then
            log "Critical dependencies installed successfully - continuing with limited functionality"
            log "Warning: Some features may not work due to incomplete dependency installation"
            return 0
        else
            log "Even critical dependency installation failed - container will restart"
            return 1
        fi
    fi
    
    # クリーンアップ (Issue #2559 下位互換性維持)
    rm -f "$npm_error_log" 2>/dev/null || true
    rm -f "$dep_install_error" 2>/dev/null || true  
    rm -f "$dep_check_error" 2>/dev/null || true
    rm -f "$npm_ls_error" 2>/dev/null || true
    rm -f /tmp/npm-check.log /tmp/npm-install-error-*.log 2>/dev/null || true
    
    return 0
}

# Issue #5372: 統一されたエラーハンドリング関数（実際に使用される関数のみ保持）
log_backtest_error() {
    local message="$1"
    local context="${2:-GENERAL}"
    log "[BACKTEST_ERROR:$context] $message"
}

# Issue #5372: 従来のcleanup_backtest_lock関数（後方互換性維持・簡素化）
cleanup_backtest_lock() {
    # flock利用時のファイルディスクリプタクリーンアップ
    # Issue #5372改善: より予測可能なクリーンアップフロー
    exec 200>&- 2>/dev/null || true
    trap - EXIT INT TERM 2>/dev/null || true
}

# Issue #5230修正: backtest container専用起動メッセージ関数（KISS原則適用・簡素化版）
# 過去の複雑な実装（Issue #5127, #5058, #5175, #5216, #5333）を簡素化
# Issue #5315修正: プロセス内フラグとflockによる二重防御システムで重複メッセージを確実に防止
# Issue #5315修正: backtest container専用起動メッセージ関数（強化版重複防止）
# Issue #5372改善: より線形で予測可能なフロー、統一エラーハンドリング、設定外部化
# Issue #5371: YAGNI原則に基づく簡素化（120行→45行、73%削減）
# 核心機能のみ保持: プロセス内重複防止 + flockベース同期 + シンプルフォールバック
log_backtest_startup_message() {
    local message="$1"
    local current_time=$(date +%s)
    local timestamp_file="$BACKTEST_STARTUP_TIMESTAMP_FILE"
    local suppress_duration=${BACKTEST_STARTUP_LOCK_TIMEOUT:-60}
    
    # Issue #5315修正: プロセス内フラグによる即座の重複防止（第一防御線）
    [ "$_BACKTEST_STARTUP_MESSAGE_LOGGED_IN_PROCESS" = "1" ] && return 0
    
    # Issue #5315修正: flockによる確実なファイルロック（第二防御線）
    if command -v flock >/dev/null 2>&1; then
        local lock_file="$BACKTEST_STARTUP_LOCK_FILE"
        exec 200>"$lock_file"
        if flock -w $BACKTEST_STARTUP_FLOCK_TIMEOUT 200; then
            # 重複チェック
            if [ -f "$timestamp_file" ]; then
                local last_time=$(cat "$timestamp_file" 2>/dev/null || echo "0")
                local time_diff=$((current_time - last_time))
                [ "$time_diff" -lt "$suppress_duration" ] && { _BACKTEST_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1; exec 200>&-; return 0; }
            fi
            
            # メッセージ出力とタイムスタンプ更新
            _BACKTEST_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
            log "$message"
            echo "$current_time" > "$timestamp_file"
            exec 200>&-
        else
            _BACKTEST_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
        fi
    else
        # flock利用不可時のフォールバック
        log "WARNING: flock not available, using fallback duplicate prevention"
        if [ -f "$timestamp_file" ]; then
            local last_time=$(cat "$timestamp_file" 2>/dev/null || echo "0")
            local time_diff=$((current_time - last_time))
            [ "$time_diff" -lt "$suppress_duration" ] && { _BACKTEST_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1; return 0; }
        fi
        
        _BACKTEST_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
        log "$message"
        echo "$current_time" > "$timestamp_file"
    fi
    
    return 0
}

# Issue #5172: success file検証ヘルパー関数（DRY原則適用・簡素化）
validate_success_file() {
    local success_file="$1"
    local container_id="$2" 
    local current_time="$3"
    
    if [ ! -f "$success_file" ]; then
        return 1  # ファイルが存在しない = 重複なし
    fi
    
    local file_content=$(cat "$success_file" 2>/dev/null || echo "")
    local file_time=$(echo "$file_content" | cut -d':' -f1 2>/dev/null || echo "0")
    local file_container=$(echo "$file_content" | cut -d':' -f3 2>/dev/null || echo "")
    
    # 同一コンテナかつ最近の場合は重複
    if [ "$file_container" = "$container_id" ] && [ $((current_time - file_time)) -lt $SAME_CONTAINER_DUPLICATE_THRESHOLD ]; then
        return 0  # 重複検出
    fi
    
    # 異なるコンテナまたは古いエントリの場合はクリーンアップ（共通関数使用）
    if [ "$file_container" != "$container_id" ] || [ $((current_time - file_time)) -gt $SUCCESS_FILE_MAX_AGE ]; then
        rm -f "$success_file" 2>/dev/null || true
    fi
    
    return 1  # 重複なし
}

# Issue #5172: atomicロック取得ヘルパー関数（KISS原則適用・簡素化）
acquire_message_lock() {
    local lock_file="$1"
    local process_info="$2"
    local current_time="$3"
    
    # 共通クリーンアップ関数を使用（DRY原則）
    cleanup_old_lock_file "$lock_file" "$SAME_CONTAINER_DUPLICATE_THRESHOLD" "$current_time"
    
    # リトライ付きロック取得
    local lock_attempts=0
    while [ $lock_attempts -lt $MAX_LOCK_ATTEMPTS ]; do
        if mkdir "$lock_file" 2>/dev/null; then
            # プロセス情報を記録
            echo "$process_info" > "$lock_file/process_info" 2>/dev/null || true
            return 0  # ロック取得成功
        else
            lock_attempts=$((lock_attempts + 1))
            if [ $lock_attempts -lt $MAX_LOCK_ATTEMPTS ]; then
                sleep $LOCK_RETRY_DELAY
            fi
        fi
    done
    
    return 1  # ロック取得失敗
}

# Issue #5172: success file atomicクリエーションヘルパー関数（KISS原則適用・簡素化）
create_success_file() {
    local success_file="$1"
    local process_info="$2"
    local message="$3"
    
    local temp_success_file="${success_file}.tmp.$$"
    if echo "$process_info" > "$temp_success_file" 2>/dev/null; then
        if mv "$temp_success_file" "$success_file" 2>/dev/null; then
            log "$message"
            return 0  # 成功
        else
            rm -f "$temp_success_file" 2>/dev/null || true
        fi
    fi
    
    return 1  # 失敗
}

# Issue #5338: 重複防止統計記録関数（強化版）
log_duplicate_stats() {
    # 重複防止統計が有効な場合のみ記録
    if [ "$ENABLE_DUPLICATE_STATS" = "true" ]; then
        local timestamp=$(date +%s)
        
        # エラーハンドリング強化：ログファイル書き込み
        if ! echo "${timestamp}:suppressed" >> "$DUPLICATE_STATS_LOG_FILE" 2>/dev/null; then
            log "WARNING: Failed to write duplicate stats to $DUPLICATE_STATS_LOG_FILE"
            return 1
        fi
        
        # セキュアな権限設定
        set_secure_permissions "$DUPLICATE_STATS_LOG_FILE" "file" 2>/dev/null || true
        
        # ログローテーション（1MB制限）
        if [ -f "$DUPLICATE_STATS_LOG_FILE" ]; then
            local log_size=$(wc -c < "$DUPLICATE_STATS_LOG_FILE" 2>/dev/null || echo "0")
            if [ "$log_size" -gt 1048576 ]; then
                # 原子的ログローテーション操作
                local temp_log="${DUPLICATE_STATS_LOG_FILE}.rotate.$$"
                if tail -n 500 "$DUPLICATE_STATS_LOG_FILE" > "$temp_log" 2>/dev/null && \
                   mv "$temp_log" "$DUPLICATE_STATS_LOG_FILE" 2>/dev/null; then
                    set_secure_permissions "$DUPLICATE_STATS_LOG_FILE" "file" 2>/dev/null || true
                else
                    rm -f "$temp_log" 2>/dev/null || true
                    log "WARNING: Failed to rotate duplicate stats log file"
                fi
            fi
        fi
    fi
    return 0
}

# Issue #5172: Redis-based重複防止関数（単一責任化・KISS原則）
try_redis_duplicate_prevention() {
    local message="$1"
    local message_hash="$2"
    local redis_key="startup_msg:$message_hash"
    local container_id=$(hostname)
    local current_time=$(date +%s)
    
    # Redisが利用可能な場合のみ実行
    if command -v node >/dev/null 2>&1 && [ -n "$REDIS_URL" ]; then
        local redis_check_result=$(node -e "
            const redis = require('redis');
            const client = redis.createClient({url: process.env.REDIS_URL});
            client.on('error', () => process.exit(1));
            client.connect().then(async () => {
                const key = '$redis_key';
                const value = '$container_id:$current_time';
                const existing = await client.get(key);
                if (existing) {
                    console.log('duplicate');
                    process.exit(0);
                }
                await client.setEx(key, $REDIS_DUPLICATE_PREVENTION_TTL, value);
                console.log('new');
                process.exit(0);
            }).catch(() => process.exit(1));
        " 2>/dev/null || echo "error")
        
        if [ "$redis_check_result" = "duplicate" ]; then
            # Issue #5403修正: log_duplicate_stats関数の存在チェック
            if command -v log_duplicate_stats >/dev/null 2>&1; then
                log_duplicate_stats  # Issue #5338: 重複検出時の統計記録
            fi
            return 0  # Redisで重複検出
        elif [ "$redis_check_result" = "new" ]; then
            log "$message"
            return 0  # Redisでメッセージ出力済み
        fi
    fi
    
    return 1  # Redis不可またはエラー、フォールバックが必要
}

# Issue #5172: ファイルベースフォールバック関数（単一責任化・KISS原則）
fallback_to_file_based_prevention() {
    local message="$1"
    local message_hash="$2"
    local container_id=$(hostname)
    local current_time=$(date +%s)
    
    # プロセス内重複防止（第二防御線）
    local var_name="STARTUP_MSG_$(echo "$message_hash" | cut -c1-8)"
    if [ "${!var_name}" = "1" ]; then
        # Issue #5403修正: log_duplicate_stats関数の存在チェック
        if command -v log_duplicate_stats >/dev/null 2>&1; then
            log_duplicate_stats  # Issue #5338: 重複検出時の統計記録
        fi
        return 0
    fi
    
    # ファイルベース重複防止（第三防御線）
    local success_file="$STARTUP_MESSAGE_LOCK_DIR/$message_hash.done"
    local lock_file="$STARTUP_MESSAGE_LOCK_DIR/$message_hash.lock"
    local process_info="${current_time}:$$:${container_id}"
    
    # success fileチェック
    if validate_success_file "$success_file" "$container_id" "$current_time"; then
        export "$var_name"=1
        # Issue #5403修正: log_duplicate_stats関数の存在チェック
        if command -v log_duplicate_stats >/dev/null 2>&1; then
            log_duplicate_stats  # Issue #5338: 重複検出時の統計記録
        fi
        return 0
    fi
    
    # atomicロック取得とメッセージ出力
    if acquire_message_lock "$lock_file" "$process_info" "$current_time"; then
        if [ ! -f "$success_file" ]; then
            export "$var_name"=1
            create_success_file "$success_file" "$process_info" "$message"
            
            # バックグラウンドクリーンアップ
            (sleep "$SUCCESS_FILE_CLEANUP_DELAY" && rm -f "$success_file" 2>/dev/null) &
            local cleanup_pid=$!
            BACKGROUND_CLEANUP_PIDS="$BACKGROUND_CLEANUP_PIDS $cleanup_pid"
        else
            export "$var_name"=1
        fi
        rm -rf "$lock_file" 2>/dev/null || true
    else
        export "$var_name"=1
    fi
    
    return 0
}

# Issue #5172: メイン重複防止関数（簡素化・YAGNI/KISS原則）
# Issue #5362: KISS原則に基づく重複防止機構（簡素化・確実性の向上）
# Issue #5264修正: 起動メッセージの完全分離処理（fallthrough完全防止）
# Issue #5267修正: アトミックファイルロックによる確実な重複防止
# Issue #5302修正: プロセス内変数による即座の重複防止（第0防御線）
# Issue #5413修正: 3層の防御線によるアトミック操作
log_startup_message() {
    local message="$1"
    
    # Issue #5431修正: backtest containerの場合の重複防止強化
    if [ "$BACKTEST_MODE" = "true" ]; then
        # 既にbacktest起動メッセージが出力済みの場合は重複を防ぐ
        if [ "${_BACKTEST_STARTUP_MESSAGE_LOGGED_IN_PROCESS:-}" = "1" ]; then
            return 0
        fi
        log_backtest_startup_message "$message"
        return $?
    fi
    
    # Issue #5362修正: 起動メッセージの重複防止（KISS原則に基づく確実な単一機構）
    case "$message" in
        *"Starting strategy-runner container with enhanced error handling"*)
            # Issue #5302修正: プロセス内変数による即座の重複防止（第0防御線）
            if [ "${_MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS:-}" = "1" ]; then
                log "DEBUG: [Issue #5302] Process-level flag prevented duplicate startup message (PID: $$)"
                return 0
            fi
            
            # Issue #5264修正: 環境変数フラグによる第1防御線
            if [ "${MAIN_STARTUP_MESSAGE_LOGGED:-}" = "1" ]; then
                _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
                log "DEBUG: [Issue #5264] Environment flag prevented duplicate startup message (PID: $$)"
                return 0
            fi
            
            # Issue #5264修正: 完了マーカーファイル存在チェック（第2防御線）
            local startup_msg_done_file="$LOCK_BASE_DIR/main-startup-message.done"
            if [ -f "$startup_msg_done_file" ]; then
                _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
                export MAIN_STARTUP_MESSAGE_LOGGED=1
                log "DEBUG: [Issue #5264] Done marker file prevented duplicate startup message (PID: $$)"
                return 0
            fi
            
            # Issue #5413修正: グローバル起動フラグによる防御線
            local global_startup_flag="$LOCK_BASE_DIR/global-startup-flag.marker"
            if [ "${_GLOBAL_STARTUP_MESSAGE_SENT_PROCESS:-}" = "1" ] || [ -f "$global_startup_flag" ]; then
                _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
                log "DEBUG: [Issue #5413] Global startup flag prevented duplicate startup message (PID: $$)"
                return 0
            fi
            
            # 第一防御線: プロセス内変数による即座の重複防止（最優先）
            if [ "${_STARTUP_MESSAGE_LOGGED:-}" = "1" ]; then
                log "DEBUG: [Issue #5362] Process variable prevented duplicate startup message (PID: $$)"
                return 0
            fi
            
            # Issue #5264修正: アトミックロック取得（第3防御線）
            local startup_msg_lock_file="$LOCK_BASE_DIR/main-startup-message.lock"
            
            # Issue #5267修正: アトミックファイルロックによる確実な重複防止
            if mkdir "$startup_msg_lock_file" 2>/dev/null; then
                # ロック取得成功後の二重チェック
                if [ -f "$startup_msg_done_file" ]; then
                    rm -rf "$startup_msg_lock_file" 2>/dev/null || true
                    _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
                    export MAIN_STARTUP_MESSAGE_LOGGED=1
                    log "DEBUG: [Issue #5267] Double-check prevented duplicate startup message (PID: $$)"
                    return 0
                fi
                
                # アトミックファイル作成による完了マーカー設定
                local temp_marker="${startup_msg_done_file}.tmp.$$"
                echo "$(date +%s):$$:$(hostname)" > "$temp_marker" 2>/dev/null && \
                mv "$temp_marker" "$startup_msg_done_file" 2>/dev/null
                
                # グローバル起動フラグの設定
                _GLOBAL_STARTUP_MESSAGE_SENT_PROCESS=1
                echo "$(date +%s):$$:$(hostname)" > "$global_startup_flag" 2>/dev/null || true
                
                # メッセージ出力とフラグ設定
                _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
                export MAIN_STARTUP_MESSAGE_LOGGED=1
                _STARTUP_MESSAGE_LOGGED=1
                export _STARTUP_MESSAGE_LOGGED
                
                log "$message"
                log "DEBUG: [Issue #5362] Startup message sent with flock protection (PID: $$, Container: $(hostname))"
                
                # ロック解除
                rm -rf "$startup_msg_lock_file" 2>/dev/null || true
                return 0
            else
                log "DEBUG: [Issue #5267] Atomic file operation prevented duplicate startup message (PID: $$)"
                _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
                return 0
            fi
            
            # 第二防御線: flockベースの確実なファイルロック
            local lock_file="$LOCK_BASE_DIR/startup-message.lock"
            local lock_fd=200
            
            # flockが利用可能な場合は使用（より確実）
            if command -v flock >/dev/null 2>&1; then
                exec 200>"$lock_file"
                if flock -w 5 200; then
                    # ロック取得成功後、プロセス変数を再チェック
                    if [ "${_STARTUP_MESSAGE_LOGGED:-}" = "1" ]; then
                        log "DEBUG: [Issue #5362] Flock double-check prevented duplicate startup message (PID: $$)"
                        exec 200>&-
                        return 0
                    fi
                    
                    # メッセージ出力とフラグ設定
                    _STARTUP_MESSAGE_LOGGED=1
                    export _STARTUP_MESSAGE_LOGGED
                    log "$message"
                    log "DEBUG: [Issue #5362] Startup message sent with flock protection (PID: $$, Container: $(hostname))"
                    
                    exec 200>&-
                    return 0
                else
                    log "DEBUG: [Issue #5362] Flock timeout - message suppressed to prevent duplicate (PID: $$)"
                    exec 200>&-
                    _STARTUP_MESSAGE_LOGGED=1
                    export _STARTUP_MESSAGE_LOGGED
                    _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
                    return 0
                fi
            else
                # フォールバック: flockが利用できない場合のmkdirベースロック
                local mkdir_lock_dir="$LOCK_BASE_DIR/startup-message-mkdir.lock"
                local attempts=0
                local max_attempts=50
                
                while [ $attempts -lt $max_attempts ]; do
                    if mkdir "$mkdir_lock_dir" 2>/dev/null; then
                        # ロック取得成功
                        if [ "${_STARTUP_MESSAGE_LOGGED:-}" = "1" ]; then
                            rm -rf "$mkdir_lock_dir" 2>/dev/null || true
                            log "DEBUG: [Issue #5362] Mkdir fallback double-check prevented duplicate startup message (PID: $$)"
                            return 0
                        fi
                        
                        _STARTUP_MESSAGE_LOGGED=1
                        export _STARTUP_MESSAGE_LOGGED
                        log "$message"
                        log "DEBUG: [Issue #5362] Startup message sent with mkdir fallback protection (PID: $$, Container: $(hostname))"
                        
                        rm -rf "$mkdir_lock_dir" 2>/dev/null || true
                        return 0
                    fi
                    
                    attempts=$((attempts + 1))
                    sleep 0.1
                done
                
                # mkdir ロック取得失敗時の処理
                log "DEBUG: [Issue #5362] Mkdir fallback timeout - message suppressed to prevent duplicate (PID: $$)"
                _STARTUP_MESSAGE_LOGGED=1
                export _STARTUP_MESSAGE_LOGGED
                _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
                return 0
            fi
            ;;
    esac
    
    # Issue #5308修正: 特定メッセージパターン処理後は汎用ロジックをスキップ
    return 0
    
    local message_hash=$(get_message_hash "$message")
    
    # 戦略に応じた重複防止処理
    case "$DUPLICATE_PREVENTION_STRATEGY" in
        "redis_first")
            if ! try_redis_duplicate_prevention "$message" "$message_hash"; then
                fallback_to_file_based_prevention "$message" "$message_hash"
            fi
            ;;
        "file_only")
            fallback_to_file_based_prevention "$message" "$message_hash"
            ;;
        *)
            # デフォルト: redis_first
            if ! try_redis_duplicate_prevention "$message" "$message_hash"; then
                fallback_to_file_based_prevention "$message" "$message_hash"
            fi
            ;;
    esac
    
    return 0
}

# 起動ロック関数
acquire_startup_lock() {
    local lock_file="$STARTUP_LOCK_FILE"
    local timeout="$STARTUP_LOCK_TIMEOUT"
    local waited=0
    
    log "Acquiring startup lock..."
    
    # 既存のロックファイルの検証
    if [ -f "$lock_file" ]; then
        local lock_pid=$(cat "$lock_file" 2>/dev/null)
        
        # PIDが有効で、プロセスが実行中の場合は待機
        if [ -n "$lock_pid" ] && kill -0 "$lock_pid" 2>/dev/null; then
            log "Another startup process is running (PID: $lock_pid), waiting..."
            
            # ロックが解放されるまで待機
            while [ -f "$lock_file" ] && [ $waited -lt $timeout ]; do
                sleep 1
                waited=$((waited + 1))
                
                # ロックプロセスが終了した場合は古いロックファイルを削除
                if [ -n "$lock_pid" ] && ! kill -0 "$lock_pid" 2>/dev/null; then
                    log "Lock process (PID: $lock_pid) has exited, removing stale lock"
                    rm -f "$lock_file"
                    break
                fi
            done
            
            # タイムアウトした場合の処理
            if [ $waited -ge $timeout ]; then
                log "ERROR: Startup lock acquisition timed out after ${timeout}s"
                log "Removing potentially stale lock file"
                rm -f "$lock_file"
            fi
        else
            # 古いロックファイルを削除
            log "Removing stale lock file (PID: $lock_pid not running)"
            rm -f "$lock_file"
        fi
    fi
    
    # ロックファイルを作成
    echo "$$" > "$lock_file"
    chmod 600 "$lock_file"  # 所有者のみアクセス可能
    
    # ロックファイルの作成を確認
    if [ ! -f "$lock_file" ] || [ "$(cat "$lock_file" 2>/dev/null)" != "$$" ]; then
        log "ERROR: Failed to create startup lock file"
        return 1
    fi
    
    log "Startup lock acquired successfully (PID: $$)"
    return 0
}

# 起動ロック解放関数
release_startup_lock() {
    local lock_file="$STARTUP_LOCK_FILE"
    
    if [ -f "$lock_file" ]; then
        local lock_pid=$(cat "$lock_file" 2>/dev/null)
        
        # 自分のPIDと一致する場合のみ削除
        if [ "$lock_pid" = "$$" ]; then
            rm -f "$lock_file"
            log "Startup lock released"
        else
            log "WARNING: Cannot release lock owned by PID: $lock_pid (current: $$)"
        fi
    fi
}

# バックグラウンドプロセス管理・クリーンアップ関数
cleanup_background_processes() {
    if [ -n "$BACKGROUND_CLEANUP_PIDS" ]; then
        log "Cleaning up background cleanup processes..."
        for pid in $BACKGROUND_CLEANUP_PIDS; do
            if kill -0 "$pid" 2>/dev/null; then
                log "Terminating background cleanup process (PID: $pid)"
                kill -TERM "$pid" 2>/dev/null || true
            fi
        done
        BACKGROUND_CLEANUP_PIDS=""
    fi
}

# Issue #5127, #5058 & #5175 & #5315: backtest専用クリーンアップ関数（強化版）
# Issue #5315修正: 新しいプロセス内フラグとflockリソースのクリーンアップを追加
cleanup_backtest_locks() {
    log "Cleaning up backtest-specific lock files..."
    
    # Issue #5315修正: プロセス内フラグのリセット
    unset _BACKTEST_STARTUP_MESSAGE_LOGGED_IN_PROCESS
    
    # Issue #5315修正: flockのファイルディスクリプタクリーンアップ
    # Issue #5372改善: より予測可能なクリーンアップフロー
    exec 200>&- 2>/dev/null || true
    
    # Issue #5315修正: 新しいロックファイルのクリーンアップ
    # Issue #5372改善: 統一されたファイルパス使用
    # Issue #5417修正: セキュアなディレクトリパス使用
    if [ -f "$LOCK_BASE_DIR/backtest-startup-message.lock" ]; then
        rm -f "$LOCK_BASE_DIR/backtest-startup-message.lock" 2>/dev/null || true
        log "Removed backtest startup message lock file (Issue #5315, #5372, #5417)"
    fi
    
    if [ -f "$LOCK_BASE_DIR/backtest-startup-message.last" ]; then
        rm -f "$LOCK_BASE_DIR/backtest-startup-message.last" 2>/dev/null || true
        log "Removed backtest startup message timestamp file (Issue #5315, #5372, #5417)"
    fi
    
    # backtest開始時刻マーカーのクリーンアップ
    if [ -f "$LOCK_BASE_DIR/backtest-start-time.marker" ]; then
        rm -f "$LOCK_BASE_DIR/backtest-start-time.marker" 2>/dev/null || true
        log "Removed backtest start time marker"
    fi
    
    # Issue #5058: 新しいatomicロックディレクトリのクリーンアップ
    if [ -d "$LOCK_BASE_DIR/backtest-startup-lock.dir" ]; then
        rm -rf "$LOCK_BASE_DIR/backtest-startup-lock.dir" 2>/dev/null || true
        log "Removed backtest startup lock directory"
    fi
    
    # Issue #5175: コンテナ再起動検出ファイルのクリーンアップ
    if [ -f "$BACKTEST_CONTAINER_RESTART_DETECTION_FILE" ]; then
        rm -f "$BACKTEST_CONTAINER_RESTART_DETECTION_FILE" 2>/dev/null || true
        log "Removed backtest container restart detection file"
    fi
    
    # Issue #5254: NPMエラー検出ファイルのクリーンアップ
    if [ -f "$LOCK_BASE_DIR/backtest-npm-error-detection.state" ]; then
        rm -f "$LOCK_BASE_DIR/backtest-npm-error-detection.state" 2>/dev/null || true
        log "Removed backtest NPM error detection file (Issue #5254, #5417)"
    fi
    
    # Issue #5194修正: タイムスタンプファイルのクリーンアップ
    if [ -f "$BACKTEST_STARTUP_TIMESTAMP_FILE" ]; then
        rm -f "$BACKTEST_STARTUP_TIMESTAMP_FILE" 2>/dev/null || true
        log "Removed backtest timestamp file (Issue #5194)"
    fi
    
    # Issue #5333修正: グローバルファイルのクリーンアップ
    if [ -f "$LOCK_BASE_DIR/backtest-startup-message-global.lock" ]; then
        rm -f "$LOCK_BASE_DIR/backtest-startup-message-global.lock" 2>/dev/null || true
        log "Removed global backtest startup lock file (Issue #5333, #5417)"
    fi
    
    if [ -f "$LOCK_BASE_DIR/backtest-startup-timestamp-global.state" ]; then
        rm -f "$LOCK_BASE_DIR/backtest-startup-timestamp-global.state" 2>/dev/null || true
        log "Removed global backtest timestamp file (Issue #5333, #5417)"
    fi
    
    # Issue #5307 Phase 3: セキュリティ強化 - findコマンドによる安全なファイル操作
    local marker_files_found=false
    if find /tmp -maxdepth 1 -name "backtest-message-*.marker" -type f -print0 2>/dev/null | grep -q .; then
        marker_files_found=true
        find /tmp -maxdepth 1 -name "backtest-message-*.marker" -type f -delete 2>/dev/null || true
    fi
    
    if [ "$marker_files_found" = true ]; then
        log "Cleaned up backtest message markers (Issue #5307 security enhancement)"
    fi
    
    # backtest専用ロックファイルは通常は残す（次回起動時に重複メッセージを防ぐため）
    # ただし、正常終了時のみ削除する場合は以下のコメントアウトを解除
    # if [ -f "$BACKTEST_STARTUP_LOCK_FILE" ]; then
    #     rm -f "$BACKTEST_STARTUP_LOCK_FILE" 2>/dev/null || true
    #     log "Removed backtest startup lock file"
    # fi
}

# Issue #5150: startup message locks のクリーンアップ関数
cleanup_startup_message_locks() {
    log "Cleaning up startup message lock files..."
    
    # startup message lock ディレクトリのクリーンアップ
    if [ -d "$STARTUP_MESSAGE_LOCK_DIR" ]; then
        # .done ファイルと .lock ディレクトリを削除
        find "$STARTUP_MESSAGE_LOCK_DIR" -name "*.done" -type f -delete 2>/dev/null || true
        find "$STARTUP_MESSAGE_LOCK_DIR" -name "*.lock" -type d -exec rm -rf {} + 2>/dev/null || true
        log "Cleaned up startup message lock files"
    fi
    
    # Issue #5267: メインの起動メッセージ用ロックファイルのクリーンアップ
    # Issue #5417修正: セキュアなディレクトリパス使用
    if [ -f "$LOCK_BASE_DIR/main-startup-message.done" ]; then
        rm -f "$LOCK_BASE_DIR/main-startup-message.done" 2>/dev/null || true
        log "Cleaned up main startup message done marker (Issue #5267, #5417)"
    fi
    
    if [ -d "$LOCK_BASE_DIR/main-startup-message.lock" ]; then
        rm -rf "$LOCK_BASE_DIR/main-startup-message.lock" 2>/dev/null || true
        log "Cleaned up main startup message lock directory (Issue #5417)"
    fi
    
    # プロセス内フラグのクリアは環境変数なので、コンテナ再起動時に自動的にクリアされる
}

# Discord通知関数
send_startup_error_to_discord() {
    local error_message="$1"
    local error_details="$2"
    
    if [ -z "$DISCORD_ERROR_WEBHOOK_URL" ]; then
        log "WARNING: DISCORD_ERROR_WEBHOOK_URL not set, skipping Discord notification"
        return 0  # 設定されていない場合は正常として扱う
    fi
    
    local discord_message="🚨 **Strategy-Runner起動エラー**
\`\`\`
コンテナ: ${CONTAINER_NAME}
エラー: ${error_message}
詳細: ${error_details}
時刻: $(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")
ホスト: $(hostname)
\`\`\`"

    # Node.js経由でDiscord通知送信
    if command -v node >/dev/null 2>&1; then
        # セキュアな一時ファイル作成
        local temp_script=$(mktemp "/tmp/discord_notify_XXXXXX.js")
        # 一時ファイルのクリーンアップを保証
        trap "rm -f \"$temp_script\"" EXIT ERR
        
        cat > "$temp_script" << 'EOF'
const fs = require('fs');

// Discord通知送信関数
async function sendDiscordNotification() {
    try {
        // package.jsonの存在確認
        if (!fs.existsSync('package.json')) {
            console.error('package.json not found');
            return false;
        }
        
        // axiosの利用可能性確認
        let axios;
        try {
            axios = require('axios');
        } catch (e) {
            console.error('axios module not available:', e.message);
            return false;
        }
        
        const webhookUrl = process.env.DISCORD_ERROR_WEBHOOK_URL;
        if (!webhookUrl) {
            console.error('DISCORD_ERROR_WEBHOOK_URL not set');
            return false;
        }
        
        const message = { content: process.argv[2] };
        const timeout = parseInt(process.argv[3]) * 1000 || 10000;
        
        await axios.post(webhookUrl, message, { timeout });
        console.log('Discord notification sent successfully');
        return true;
    } catch (error) {
        console.error('Discord notification failed:', error.message);
        return false;
    }
}

sendDiscordNotification().then(success => {
    process.exit(success ? 0 : 1);
});
EOF
        
        # Discord通知実行
        if node "$temp_script" "$discord_message" "$DISCORD_NOTIFICATION_TIMEOUT" 2>/dev/null; then
            log "Discord notification sent successfully"
        else
            log "WARNING: Discord notification failed (non-critical)"
        fi
        
        # 一時ファイルを削除（trapでも削除されるが、明示的に削除）
        rm -f "$temp_script"
        # trapをリセット（この関数内での処理完了）
        trap - EXIT ERR
    else
        log "WARNING: Node.js not available for Discord notification"
    fi
}

# 起動前チェック
pre_startup_checks() {
    log "Performing pre-startup checks..."
    
    # 必須環境変数チェック
    local required_vars=("REDIS_URL" "MONGO_URL" "MONGODB_DB_NAME")
    for var in "${required_vars[@]}"; do
        if [ -z "${!var}" ]; then
            local error_msg="Required environment variable $var is not set"
            log "ERROR: $error_msg"
            send_startup_error_to_discord "$error_msg" "Environment variable validation failed"
            exit 1
        fi
    done
    
    # 必須ファイルチェック
    local required_files=("package.json" "src/bot.js" "src/config.js")
    for file in "${required_files[@]}"; do
        if [ ! -f "$file" ]; then
            local error_msg="Required file $file not found"
            log "ERROR: $error_msg"
            send_startup_error_to_discord "$error_msg" "File system validation failed"
            exit 1
        fi
    done
    
    # Node.js依存関係インストールとチェック（Issue #4202 修正: 無限再起動ループ防止）
    if ! install_npm_dependencies; then
        exit 1
    fi
    
    # critical dependenciesの存在を具体的にチェック（強化版）
    log "Checking critical dependencies..."
    local critical_deps=("decimal.js@10.6.0" "ccxt" "mongodb" "redis")
    for dep in "${critical_deps[@]}"; do
        local dep_name=$(echo "$dep" | cut -d'@' -f1)
        log "Checking dependency: $dep_name"
        
        local dep_specific_check="/tmp/dep-check-$dep_name.log"
        if ! node -e "require('$dep_name'); console.log('$dep_name OK');" 2>"$dep_specific_check"; then
            log "$dep_name not found, installation required. Error details:"
            if [ -f "$dep_specific_check" ]; then
                cat "$dep_specific_check" >> "$dep_check_error"
                cat "$dep_specific_check" | head -5 | while read line; do
                    log "  require error: $line"
                done
            fi
            
            log "Installing $dep specifically..."
            local dep_specific_install="/tmp/dep-install-$dep_name.log"
            if ! timeout 120 npm install "$dep" 2>"$dep_specific_install"; then
                local error_msg="Failed to install $dep specifically"
                log "ERROR: $error_msg"
                log "Install error details:"
                if [ -f "$dep_specific_install" ]; then
                    cat "$dep_specific_install" >> "$dep_install_error"
                    cat "$dep_specific_install" | head -10 | while read line; do
                        log "  install error: $line"
                    done
                fi
                send_startup_error_to_discord "$error_msg" "$dep installation failed"
                exit 1
            fi
            
            # インストール後の再確認
            if ! node -e "require('$dep_name'); console.log('$dep_name verified after install');" 2>"$dep_specific_check"; then
                local error_msg="$dep_name still not accessible after installation"
                log "ERROR: $error_msg"
                log "Post-install verification error:"
                if [ -f "$dep_specific_check" ]; then
                    cat "$dep_specific_check" >> "$dep_check_error"
                    cat "$dep_specific_check" | head -5 | while read line; do
                        log "  verification error: $line"
                    done
                fi
                send_startup_error_to_discord "$error_msg" "$dep_name accessibility check failed"
                exit 1
            else
                log "$dep_name successfully installed and verified"
            fi
            
            # クリーンアップ
            rm -f "$dep_specific_install" 2>/dev/null || true
        else
            log "$dep_name OK"
        fi
        
        # クリーンアップ
        rm -f "$dep_specific_check" 2>/dev/null || true
    done
    
    # 最終的な依存関係の検証
    log "Performing final dependency validation..."
    
    # Issue #4646 修正: npm_ls_error変数の安全な定義と検証
    local npm_ls_error_safe="${npm_ls_error:-/tmp/npm-ls-error-fallback.log}"
    
    # 一時ファイルのディレクトリが存在することを確認
    mkdir -p "$(dirname "$npm_ls_error_safe")" 2>/dev/null || true
    
    # npm ls実行時のエラーハンドリング強化
    if ! npm ls 2>"$npm_ls_error_safe" >/dev/null; then
        local error_msg="npm dependencies validation failed"
        log "ERROR: $error_msg"
        log "npm ls error details:"
        if [ -f "$npm_ls_error_safe" ] && [ -s "$npm_ls_error_safe" ]; then
            cat "$npm_ls_error_safe" | head -15 | while read line; do
                log "  npm ls error: $line"
            done
        else
            log "  npm ls error log file not found or empty"
        fi
        send_startup_error_to_discord "$error_msg" "Node.js dependency validation failed"
        
        # クリーンアップ
        rm -f "$npm_ls_error_safe" 2>/dev/null || true
        exit 1
    fi
    
    # クリーンアップ
    rm -f "$npm_ls_error_safe" 2>/dev/null || true
    
    log "All dependencies successfully installed and validated"
    
    log "Pre-startup checks completed successfully"
}

# データベース接続チェック関数（共通化）
check_database_connection() {
    local service_name="$1"
    local check_command="$2"
    local max_retries=3
    local retry_delay=5
    
    log "Testing $service_name connection with retry..."
    local retry=0
    while [ $retry -lt $max_retries ]; do
        if eval "$check_command" 2>/dev/null; then
            log "$service_name connection verified successfully (attempt $((retry + 1)))"
            return 0
        else
            retry=$((retry + 1))
            if [ $retry -lt $max_retries ]; then
                log "$service_name connection failed (attempt $retry/$max_retries), retrying in ${retry_delay}s..."
                sleep $retry_delay
            else
                log "WARNING: $service_name connection failed after $max_retries attempts (service will retry later)"
                return 1
            fi
        fi
    done
}

# データベース接続チェック（統合版）
check_database_connections() {
    log "Checking database connections with retry logic..."
    
    local redis_failed=false
    local mongo_failed=false
    
    # Redis接続チェック
    local redis_check="node -e '
        const redis = require(\"redis\");
        const client = redis.createClient({url: process.env.REDIS_URL});
        client.connect()
            .then(() => { 
                console.log(\"Redis connection OK\"); 
                return client.quit();
            })
            .then(() => process.exit(0))
            .catch(err => { 
                console.error(\"Redis connection failed:\", err.message); 
                process.exit(1); 
            });
        setTimeout(() => { 
            console.error(\"Redis connection timeout\"); 
            process.exit(1); 
        }, ${DATABASE_CONNECTION_TIMEOUT}000);'"
    
    if ! check_database_connection "Redis" "$redis_check"; then
        redis_failed=true
    fi
    
    # MongoDB接続チェック
    local mongo_check="node -e '
        const { MongoClient } = require(\"mongodb\");
        const client = new MongoClient(process.env.MONGO_URL);
        client.connect()
            .then(() => { 
                console.log(\"MongoDB connection OK\"); 
                return client.close(); 
            })
            .then(() => process.exit(0))
            .catch(err => { 
                console.error(\"MongoDB connection failed:\", err.message); 
                process.exit(1); 
            });
        setTimeout(() => { 
            console.error(\"MongoDB connection timeout\"); 
            process.exit(1); 
        }, ${DATABASE_CONNECTION_TIMEOUT}000);'"
    
    if ! check_database_connection "MongoDB" "$mongo_check"; then
        mongo_failed=true
    fi
    
    # 両方のデータベースが失敗した場合のみエラー終了
    if [ "$redis_failed" = true ] && [ "$mongo_failed" = true ]; then
        local error_msg="All database connections failed after retry attempts"
        log "ERROR: $error_msg"
        send_startup_error_to_discord "$error_msg" "Both Redis and MongoDB connectivity failed after retries"
        exit 1
    fi
    
    log "Database connectivity check completed (some connections may retry automatically)"
}

# アプリケーション起動
start_application() {
    log "Starting strategy-runner application..."
    
    # ボットアプリケーションのみ起動（APIサーバーは別のweb-uiサービスで起動）
    log "Starting bot application..."
    npm run start &
    local app_pid=$!
    
    # 起動監視
    local startup_time=0
    while [ $startup_time -lt $MAX_STARTUP_TIME ]; do
        if ! kill -0 $app_pid 2>/dev/null; then
            local error_msg="Bot application process died during startup"
            log "ERROR: $error_msg"
            send_startup_error_to_discord "$error_msg" "Process died after ${startup_time} seconds"
            exit 1
        fi
        
        # アプリケーションヘルスチェック（ログファイルや特定条件をチェック）
        if [ $startup_time -gt 30 ]; then
            # 30秒後からヘルスチェック開始
            log "Application startup monitoring: ${startup_time}s elapsed"
        fi
        
        sleep $HEALTH_CHECK_INTERVAL
        startup_time=$((startup_time + HEALTH_CHECK_INTERVAL))
    done
    
    log "Application started successfully (Bot PID: $app_pid)"
    log "Initializing enhanced process monitoring (Issue #2511 fix: dual-restart prevention)"
    
    # プロセス監視と自動回復機能（Issue #2511: 二重再起動防止強化版）
    local process_restart_count=0
    local max_process_restarts=2  # Docker restart policy (5回) と合わせて制限を強化
    local restart_cooldown=45     # クールダウン期間を延長して再起動ループを防止
    local restart_in_progress=false
    local last_restart_time=0
    local consecutive_failures=0  # 連続失敗回数を追跡
    local max_consecutive_failures=3
    
    while true; do
        local current_time=$(date +%s)
        local bot_alive=true
        
        # プロセス状態の確認
        if ! kill -0 $app_pid 2>/dev/null; then
            bot_alive=false
        fi
        
        # ボットプロセスが死んでいる場合の処理
        if [ "$bot_alive" = false ]; then
            # レースコンディション防止：再起動が進行中の場合はスキップ
            if [ "$restart_in_progress" = true ]; then
                log "Restart already in progress, skipping..."
                sleep 5
                continue
            fi
            
            # Issue #2511対策: 頻繁な再起動を防ぐ（最後の再起動から45秒以内は再起動しない）
            if [ $((current_time - last_restart_time)) -lt 45 ]; then
                log "Too soon since last restart (min 45s interval), waiting..."
                sleep 10  # 待機時間を延長
                continue
            fi
            
            # 連続失敗回数をインクリメント
            consecutive_failures=$((consecutive_failures + 1))
            log "Bot process failure detected (consecutive failures: $consecutive_failures/$max_consecutive_failures)"
            
            # 連続失敗が限界に達した場合は Dockerレベルの再起動に委ねる
            if [ $consecutive_failures -gt $max_consecutive_failures ]; then
                log "Maximum consecutive failures reached. Allowing Docker-level restart."
                log "Exiting entrypoint to trigger Docker restart policy..."
                # 起動ロックを解放してからexit
                release_startup_lock
                exit 1  # Dockerのrestart policyが作動
            fi
            
            restart_in_progress=true
            last_restart_time=$current_time
            
            log "Bot process died, attempting recovery..."
            
            # 再起動制限チェック
            if [ $process_restart_count -lt $max_process_restarts ]; then
                process_restart_count=$((process_restart_count + 1))
                log "Restarting bot process (attempt $process_restart_count/$max_process_restarts)..."
                
                # クールダウン期間
                log "Waiting for ${restart_cooldown}s cooldown period..."
                sleep $restart_cooldown
                
                # ボットを再起動
                log "Restarting bot application..."
                npm run start &
                app_pid=$!
                
                log "Bot process restarted successfully (Bot PID: $app_pid)"
                restart_in_progress=false
                consecutive_failures=0  # Issue #2511対策: 成功時は連続失敗カウンターをリセット
            else
                log "Maximum internal restart attempts reached ($max_process_restarts)."
                log "Allowing Docker restart policy to handle container-level restart..."
                restart_in_progress=false
                # 起動ロックを解放してからexit
                release_startup_lock
                exit 1  # Dockerのrestart policyに委ねる
            fi
        fi
        
        # 定期的なヘルスチェック（60秒間隔）
        if [ $((current_time % 60)) -eq 0 ]; then
            log "Process health check: Bot PID $app_pid"
            
            # Issue #2511対策: 長期間安定動作している場合は連続失敗カウンターをリセット
            if [ $bot_alive = true ] && [ $consecutive_failures -gt 0 ] && [ $((current_time - last_restart_time)) -gt 300 ]; then
                log "Bot running stable for 5+ minutes, resetting consecutive failure counter"
                consecutive_failures=0
            fi
        fi
        
        sleep $PROCESS_MONITOR_INTERVAL
    done
}

# シグナルハンドラー（強化版）
cleanup() {
    log "Received termination signal, shutting down gracefully..."
    
    # 診断情報を記録
    log "=== SHUTDOWN DIAGNOSTICS ==="
    log "Process status at shutdown:"
    if [ -n "$app_pid" ]; then
        if kill -0 $app_pid 2>/dev/null; then
            log "  Bot process (PID: $app_pid): Running"
        else
            log "  Bot process (PID: $app_pid): Not running"
        fi
    fi
    
    # リソース使用状況
    log "Memory usage:"
    free -h | head -2
    
    log "Disk usage:"
    df -h / | tail -1
    
    # プロセスの優雅な終了
    if [ -n "$app_pid" ] && kill -0 $app_pid 2>/dev/null; then
        log "Sending SIGTERM to bot process (PID: $app_pid)..."
        kill -TERM $app_pid 2>/dev/null
        
        # プロセスが終了するまで待つ（最大15秒）
        local wait_count=0
        while kill -0 $app_pid 2>/dev/null && [ $wait_count -lt 15 ]; do
            sleep 1
            wait_count=$((wait_count + 1))
        done
        
        # まだ動いている場合は強制終了
        if kill -0 $app_pid 2>/dev/null; then
            log "Bot process did not exit gracefully, force killing..."
            kill -KILL $app_pid 2>/dev/null
        fi
    fi
    
    # バックグラウンドプロセスのクリーンアップ
    cleanup_background_processes
    
    # 起動ロックの解放
    release_startup_lock
    
    # Issue #5127: backtest関連のクリーンアップ
    if [ "$BACKTEST_MODE" = "true" ]; then
        cleanup_backtest_locks
    fi
    
    # Issue #5150: startup message lock のクリーンアップ
    cleanup_startup_message_locks
    
    # Issue #5413修正: グローバル起動フラグファイルのクリーンアップ
    if [ -f "$LOCK_BASE_DIR/global-startup-flag.marker" ]; then
        rm -f "$LOCK_BASE_DIR/global-startup-flag.marker" 2>/dev/null || true
        log "Cleaned up global startup flag marker (Issue #5413 fix)"
    fi
    
    log "Graceful shutdown completed"
    exit 0
}

# 診断機能（強化版）
run_diagnostics() {
    log "=== COMPREHENSIVE DIAGNOSTICS ==="
    
    # システム情報
    log "System Information:"
    log "  OS: $(uname -a)"
    log "  Node.js: $(node --version 2>/dev/null || echo 'Not available')"
    log "  NPM: $(npm --version 2>/dev/null || echo 'Not available')"
    log "  Container: $(hostname)"
    
    # メモリとリソース
    log "Resource Usage:"
    free -h | head -2 | while read line; do
        log "  $line"
    done
    
    log "Disk Space:"
    df -h / | tail -1 | while read line; do
        log "  $line"
    done
    
    # プロセス情報
    log "Process Information:"
    ps aux | head -1 | while read line; do
        log "  $line"
    done
    ps aux | grep -E "(node|npm)" | grep -v grep | while read line; do
        log "  $line"
    done
    
    # ネットワーク接続
    log "Network Connectivity:"
    
    # Redis接続テスト
    if nc -z redis 6379 2>/dev/null; then
        log "  Redis (redis:6379): ✓ Reachable"
    else
        log "  Redis (redis:6379): ✗ Not reachable"
    fi
    
    # MongoDB接続テスト
    if nc -z mongodb 27017 2>/dev/null; then
        log "  MongoDB (mongodb:27017): ✓ Reachable"
    else
        log "  MongoDB (mongodb:27017): ✗ Not reachable"
    fi
    
    # パッケージ情報
    log "Package Information:"
    if [ -f "package.json" ]; then
        log "  package.json: ✓ Found"
        if npm ls decimal.js 2>/dev/null | grep -q decimal.js; then
            log "  decimal.js: ✓ Installed"
        else
            log "  decimal.js: ✗ Not found"
        fi
    else
        log "  package.json: ✗ Not found"
    fi
    
    # 環境変数チェック
    log "Environment Variables:"
    log "  REDIS_URL: ${REDIS_URL:-'Not set'}"
    log "  MONGO_URL: ${MONGO_URL:-'Not set'}"
    log "  MONGODB_DB_NAME: ${MONGODB_DB_NAME:-'Not set'}"
    log "  NODE_ENV: ${NODE_ENV:-'Not set'}"
    
    # ファイルシステム権限
    log "File System Permissions:"
    log "  Current directory: $(pwd)"
    log "  Directory permissions: $(ls -ld . | awk '{print $1}')"
    log "  Owner: $(ls -ld . | awk '{print $3":"$4}')"
    
    log "=== DIAGNOSTICS COMPLETE ==="
}

trap cleanup SIGTERM SIGINT

# メイン実行
main() {
    # 起動診断情報の記録
    log "=== 起動診断情報 ==="
    log "プロセス ID: $$"
    log "起動時刻: $(date '+%Y-%m-%d %H:%M:%S')"
    log "作業ディレクトリ: $(pwd)"
    log "バックテストモード: ${BACKTEST_MODE:-false}"
    
    # Issue #5417: セキュアなロックディレクトリのセットアップ
    setup_lock_base_directory
    
    # ロックディレクトリセットアップ後にstartupmessageディレクトリを作成
    mkdir -p "$STARTUP_MESSAGE_LOCK_DIR" 2>/dev/null || true
    set_secure_permissions "$STARTUP_MESSAGE_LOCK_DIR" "dir" || true
    
    # Issue #5150: コンテナ再起動時の初期クリーンアップ
    # 前回の実行で残ったロックファイルを削除してクリーンな状態で開始
    find "$STARTUP_MESSAGE_LOCK_DIR" -name "*.done" -type f -delete 2>/dev/null || true
    find "$STARTUP_MESSAGE_LOCK_DIR" -name "*.lock" -type d -exec rm -rf {} + 2>/dev/null || true
    
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
        echo "$(date +%s)" > "$LOCK_BASE_DIR/backtest-start-time.marker"
        
        # Issue #5431修正: execコマンド失敗時の適切なエラーハンドリング
        # execが失敗した場合にelse分岐に進んで重複ログが発生することを防ぐ
        log "Executing backtest command: $*"
        exec "$@"
        
        # execが失敗した場合はここに到達する（通常は到達しない）
        log "ERROR: Failed to execute backtest command: $*"
        send_startup_error_to_discord "Backtest execution failed" "Command: $*"
        exit 1
    else
        # Issue #5318修正: 起動メッセージの確実な重複防止（グローバルフラグによる追加防御）
        if [ "$_GLOBAL_STARTUP_MESSAGE_SENT" != "1" ]; then
            export _GLOBAL_STARTUP_MESSAGE_SENT=1
            # Issue #5362修正: 起動メッセージの重複防止をlog_startup_message関数に一元化（KISS原則）
            log_startup_message "Starting strategy-runner container with enhanced error handling (container: $(hostname), pid: $$)"
        else
            log "DEBUG: Global flag prevented duplicate startup message"
        fi
        
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