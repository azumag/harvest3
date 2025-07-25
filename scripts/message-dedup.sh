#!/bin/bash

# メッセージ重複防止専用スクリプト
# Issue #5290: entrypoint.shリファクタリング - メッセージ重複防止機能を分離
# KISS原則に基づく単一責任実装

set -e

# 重複防止設定（環境変数で上書き可能）
MESSAGE_SUPPRESS_DURATION=${MESSAGE_SUPPRESS_DURATION:-30}
SAME_CONTAINER_DUPLICATE_THRESHOLD=${SAME_CONTAINER_DUPLICATE_THRESHOLD:-30}
SUCCESS_FILE_MAX_AGE=${SUCCESS_FILE_MAX_AGE:-300}
MAX_LOCK_ATTEMPTS=${MAX_LOCK_ATTEMPTS:-3}
LOCK_RETRY_DELAY=${LOCK_RETRY_DELAY:-1}
REDIS_DUPLICATE_PREVENTION_TTL=${REDIS_DUPLICATE_PREVENTION_TTL:-300}
DUPLICATE_PREVENTION_STRATEGY=${DUPLICATE_PREVENTION_STRATEGY:-redis_first}
SUCCESS_FILE_CLEANUP_DELAY=${SUCCESS_FILE_CLEANUP_DELAY:-300}

# バックテスト専用設定
BACKTEST_STARTUP_LOCK_TIMEOUT=${BACKTEST_STARTUP_LOCK_TIMEOUT:-60}

# バックグラウンドプロセス追跡
BACKGROUND_CLEANUP_PIDS=""

# startup message locks ディレクトリ
STARTUP_MESSAGE_LOCK_DIR="/tmp/startup_messages"
mkdir -p "$STARTUP_MESSAGE_LOCK_DIR" 2>/dev/null || true

# ログ関数
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [MESSAGE-DEDUP] $1"
}

# MD5ハッシュ値生成関数
get_message_hash() {
    echo "$1" | md5sum | cut -d' ' -f1
}

# 統一されたタイムスタンプ検証関数
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
        
        # 整数算術でタイムスタンプ比較
        if [ "$time_diff" -lt "$suppress_duration" ]; then
            return 0  # 抑制すべき（タイムスタンプが新しすぎる）
        fi
    fi
    return 1  # 抑制不要
}

# 共通クリーンアップ関数
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

# success file検証ヘルパー関数
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
    
    # 異なるコンテナまたは古いエントリの場合はクリーンアップ
    if [ "$file_container" != "$container_id" ] || [ $((current_time - file_time)) -gt $SUCCESS_FILE_MAX_AGE ]; then
        rm -f "$success_file" 2>/dev/null || true
    fi
    
    return 1  # 重複なし
}

# atomicロック取得ヘルパー関数
acquire_message_lock() {
    local lock_file="$1"
    local process_info="$2"
    local current_time="$3"
    
    # 共通クリーンアップ関数を使用
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

# success file atomicクリエーションヘルパー関数
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

# Redis-based重複防止関数
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
            return 0  # Redisで重複検出
        elif [ "$redis_check_result" = "new" ]; then
            log "$message"
            return 0  # Redisでメッセージ出力済み
        fi
    fi
    
    return 1  # Redis不可またはエラー、フォールバックが必要
}

# ファイルベースフォールバック関数
fallback_to_file_based_prevention() {
    local message="$1"
    local message_hash="$2"
    local container_id=$(hostname)
    local current_time=$(date +%s)
    
    # プロセス内重複防止（第二防御線）
    local var_name="STARTUP_MSG_$(echo "$message_hash" | cut -c1-8)"
    if [ "${!var_name}" = "1" ]; then
        return 0
    fi
    
    # ファイルベース重複防止（第三防御線）
    local success_file="$STARTUP_MESSAGE_LOCK_DIR/$message_hash.done"
    local lock_file="$STARTUP_MESSAGE_LOCK_DIR/$message_hash.lock"
    local process_info="${current_time}:$$:${container_id}"
    
    # success fileチェック
    if validate_success_file "$success_file" "$container_id" "$current_time"; then
        export "$var_name"=1
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

# backtest container専用起動メッセージ関数
log_backtest_startup_message() {
    local message="$1"
    local current_time=$(date +%s)
    local timestamp_file="/tmp/backtest-startup-message.last"
    local suppress_duration=${BACKTEST_STARTUP_LOCK_TIMEOUT:-60}
    
    # プロセス内フラグによる即座の重複防止（第一防御線）
    if [ "$_BACKTEST_STARTUP_MESSAGE_LOGGED_IN_PROCESS" = "1" ]; then
        return 0  # 既に同一プロセス内でログ出力済み
    fi
    
    # flockによる確実なファイルロック（第二防御線）
    local lock_file="/tmp/backtest-startup-message.lock"
    
    # flockが利用可能な場合の確実なロック取得
    if command -v flock >/dev/null 2>&1; then
        # ファイルディスクリプタ200を使用してロック取得（タイムアウト付き）
        exec 200>"$lock_file"
        if flock -w 5 200; then  # 5秒タイムアウト
            # ロック取得成功 - 重複チェックとメッセージ出力
            local should_output=true
            
            # タイムスタンプファイルチェック
            if [ -f "$timestamp_file" ]; then
                local last_time=$(cat "$timestamp_file" 2>/dev/null || echo "0")
                local time_diff=$((current_time - last_time))
                
                if [ "$time_diff" -lt "$suppress_duration" ]; then
                    should_output=false
                    log "Backtest startup message suppressed (last shown ${time_diff}s ago)"
                fi
            fi
            
            # メッセージ出力とタイムスタンプ更新
            if [ "$should_output" = true ]; then
                _BACKTEST_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1  # プロセス内フラグ設定
                log "$message"
                
                # アトミックタイムスタンプ更新
                local temp_file="${timestamp_file}.tmp.$$"
                if echo "$current_time" > "$temp_file" && mv "$temp_file" "$timestamp_file"; then
                    chmod 600 "$timestamp_file" 2>/dev/null || true
                else
                    rm -f "$temp_file" 2>/dev/null || true
                    log "WARNING: Failed to update startup message timestamp"
                fi
            else
                _BACKTEST_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1  # 抑制の場合もフラグ設定
            fi
            
            # ロック解放
            exec 200>&-
        else
            # ロック取得失敗（タイムアウト）
            log "WARNING: Could not acquire backtest startup message lock, skipping duplicate output"
            _BACKTEST_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
        fi
    else
        # flockが利用できない場合のフォールバック
        log "WARNING: flock not available, using fallback duplicate prevention"
        
        # 前回のメッセージ出力時刻をチェック
        if [ -f "$timestamp_file" ]; then
            local last_time=$(cat "$timestamp_file" 2>/dev/null || echo "0")
            local time_diff=$((current_time - last_time))
            
            if [ "$time_diff" -lt "$suppress_duration" ]; then
                log "Backtest startup message suppressed (last shown ${time_diff}s ago)"
                _BACKTEST_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
                return 0
            fi
        fi
        
        # メッセージ出力
        _BACKTEST_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
        log "$message"
        
        # タイムスタンプ更新（atomic write）
        local temp_file="${timestamp_file}.tmp.$$"
        if echo "$current_time" > "$temp_file" && mv "$temp_file" "$timestamp_file"; then
            chmod 600 "$timestamp_file" 2>/dev/null || true
        else
            rm -f "$temp_file" 2>/dev/null || true
            log "WARNING: Failed to update startup message timestamp"
        fi
    fi
    
    return 0
}

# メイン重複防止関数
log_startup_message() {
    local message="$1"
    
    # backtest containerの場合は専用関数を使用
    if [ "$BACKTEST_MODE" = "true" ]; then
        log_backtest_startup_message "$message"
        return $?
    fi
    
    # 起動メッセージの重複防止（アトミックファイルロック強化版）
    case "$message" in
        *"Starting strategy-runner container with enhanced error handling"*)
            # プロセス内変数による即座の重複防止（第0防御線）
            if [ "$_MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS" = "1" ]; then
                return 0  # 既に同一プロセス内でログ出力済み
            fi
            
            # アトミックファイルロックによる確実な重複防止
            local startup_msg_lock_file="/tmp/main-startup-message.lock"
            local startup_msg_done_file="/tmp/main-startup-message.done"
            local atomic_processing_success=false
            
            # 既に完了マーカーが存在する場合は重複防止
            if [ -f "$startup_msg_done_file" ]; then
                return 0  # 既にログ出力済み
            fi
            
            # 環境変数フラグによる高速チェック（第一防御線）
            if [ "$MAIN_STARTUP_MESSAGE_LOGGED" = "1" ]; then
                return 0  # 既にログ出力済み
            fi
            
            # アトミックディレクトリロック取得（第二防御線）
            if mkdir "$startup_msg_lock_file" 2>/dev/null; then
                # ロック取得成功 - 二重チェック後にメッセージ出力
                if [ -f "$startup_msg_done_file" ]; then
                    # 他のプロセスが先にメッセージを出力していた
                    rm -rf "$startup_msg_lock_file" 2>/dev/null || true
                    return 0
                fi
                
                # フラグ設定とメッセージ出力
                _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
                export MAIN_STARTUP_MESSAGE_LOGGED=1
                log "$message"
                atomic_processing_success=true
                
                # 完了マーカー作成（他のプロセス用）
                echo "$(date +%s):$$:$(hostname)" > "$startup_msg_done_file" 2>/dev/null || true
                chmod 600 "$startup_msg_done_file" 2>/dev/null || true
                
                # ロック解放
                rm -rf "$startup_msg_lock_file" 2>/dev/null || true
                
                if [ "$atomic_processing_success" = true ]; then
                    return 0  # 処理完了
                fi
            else
                # ロック取得失敗 - 他のプロセスが処理中
                # 短時間待機してから完了マーカーをチェック
                local wait_attempts=0
                while [ $wait_attempts -lt 10 ] && [ ! -f "$startup_msg_done_file" ]; do
                    sleep 0.1
                    wait_attempts=$((wait_attempts + 1))
                done
                
                # 環境変数フラグも設定（一貫性のため）
                _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
                export MAIN_STARTUP_MESSAGE_LOGGED=1
                return 0  # 他のプロセスがログ出力したため、重複防止
            fi
            
            return 0
            ;;
    esac
    
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

# backtest専用クリーンアップ関数
cleanup_backtest_locks() {
    log "Cleaning up backtest-specific lock files..."
    
    # プロセス内フラグのリセット
    unset _BACKTEST_STARTUP_MESSAGE_LOGGED_IN_PROCESS
    
    # flockのファイルディスクリプタクリーンアップ
    exec 200>&- 2>/dev/null || true
    
    # 各種ロックファイルのクリーンアップ
    local cleanup_files=(
        "/tmp/backtest-startup-message.lock"
        "/tmp/backtest-startup-message.last"
        "/tmp/backtest-start-time.marker"
        "/tmp/backtest-startup-lock.dir"
        "/tmp/backtest-container-restart-detection.state"
        "/tmp/backtest-npm-error-detection.state"
        "/tmp/backtest-startup-timestamp.state"
        "/tmp/backtest-startup-message-global.lock"
        "/tmp/backtest-startup-timestamp-global.state"
    )
    
    for file in "${cleanup_files[@]}"; do
        if [ -f "$file" ] || [ -d "$file" ]; then
            rm -rf "$file" 2>/dev/null || true
            log "Removed backtest file: $(basename "$file")"
        fi
    done
    
    # パターンマッチによるクリーンアップ
    if ls /tmp/backtest-message-*.marker 1> /dev/null 2>&1; then
        rm -f /tmp/backtest-message-*.marker 2>/dev/null || true
        log "Cleaned up backtest message markers"
    fi
}

# startup message locks のクリーンアップ関数
cleanup_startup_message_locks() {
    log "Cleaning up startup message lock files..."
    
    # startup message lock ディレクトリのクリーンアップ
    if [ -d "$STARTUP_MESSAGE_LOCK_DIR" ]; then
        # .done ファイルと .lock ディレクトリを削除
        find "$STARTUP_MESSAGE_LOCK_DIR" -name "*.done" -type f -delete 2>/dev/null || true
        find "$STARTUP_MESSAGE_LOCK_DIR" -name "*.lock" -type d -exec rm -rf {} + 2>/dev/null || true
        log "Cleaned up startup message lock files"
    fi
    
    # メインの起動メッセージ用ロックファイルのクリーンアップ
    if [ -f "/tmp/main-startup-message.done" ]; then
        rm -f "/tmp/main-startup-message.done" 2>/dev/null || true
        log "Cleaned up main startup message done marker"
    fi
    
    if [ -d "/tmp/main-startup-message.lock" ]; then
        rm -rf "/tmp/main-startup-message.lock" 2>/dev/null || true
        log "Cleaned up main startup message lock directory"
    fi
}

# 全般的なクリーンアップ
cleanup_all_locks() {
    log "Performing comprehensive lock cleanup..."
    cleanup_background_processes
    cleanup_backtest_locks
    cleanup_startup_message_locks
    log "Lock cleanup completed"
}

# メイン関数
main() {
    case "${1:-log}" in
        "log")
            if [ -z "$2" ]; then
                log "Usage: $0 log <message>"
                exit 1
            fi
            log_startup_message "$2"
            ;;
        "log-backtest")
            if [ -z "$2" ]; then
                log "Usage: $0 log-backtest <message>"
                exit 1
            fi
            log_backtest_startup_message "$2"
            ;;
        "cleanup")
            cleanup_all_locks
            ;;
        "cleanup-backtest")
            cleanup_backtest_locks
            ;;
        "cleanup-startup")
            cleanup_startup_message_locks
            ;;
        *)
            log "Usage: $0 [log|log-backtest|cleanup|cleanup-backtest|cleanup-startup] [message]"
            exit 1
            ;;
    esac
}

# スクリプトが直接実行された場合のみmainを呼び出し
if [ "${BASH_SOURCE[0]}" == "${0}" ]; then
    main "$@"
fi