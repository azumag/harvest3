#!/bin/bash

# CI用超軽量版テストフィクスチャ
# 複雑な操作を除去してテストタイムアウトを回避

# 設定（テスト用にシンプル化）
SUCCESS_FILE_CLEANUP_DELAY=${SUCCESS_FILE_CLEANUP_DELAY:-2}

# Issue #5172: マジックナンバー定数化（メイン実装と統一・リファクタリング版）
SAME_CONTAINER_DUPLICATE_THRESHOLD=${SAME_CONTAINER_DUPLICATE_THRESHOLD:-30}
SUCCESS_FILE_MAX_AGE=${SUCCESS_FILE_MAX_AGE:-300}
MAX_LOCK_ATTEMPTS=${MAX_LOCK_ATTEMPTS:-5}  # テスト用により多くの試行
LOCK_RETRY_DELAY=${LOCK_RETRY_DELAY:-0.01}  # テスト用により高速化

# Issue #5172: リファクタリング後の設定
REDIS_DUPLICATE_PREVENTION_TTL=${REDIS_DUPLICATE_PREVENTION_TTL:-300}
DUPLICATE_PREVENTION_STRATEGY=${DUPLICATE_PREVENTION_STRATEGY:-file_only}  # テスト用はfile_only

# 重複起動メッセージ防止（ファイルベースの超簡素版）
STARTUP_MESSAGE_LOCK_DIR=${STARTUP_MESSAGE_LOCK_DIR:-"/tmp/startup_messages"}
mkdir -p "$STARTUP_MESSAGE_LOCK_DIR" 2>/dev/null || true

# MD5ハッシュ値生成関数（シンプル版）
get_message_hash() {
    echo "$1" | md5sum | cut -d' ' -f1
}

# Issue #5172: 共通クリーンアップ関数（テスト用簡易版）
cleanup_old_lock_file() {
    local lock_file="$1"
    local max_age="$2"
    local current_time="$3"
    
    if [ -f "$lock_file" ] || [ -d "$lock_file" ]; then
        local lock_age=$((current_time - $(stat -c %Y "$lock_file" 2>/dev/null || echo 0)))
        if [ $lock_age -gt $max_age ]; then
            rm -rf "$lock_file" 2>/dev/null || true
            return 0
        fi
    fi
    return 1
}

# Issue #5172: ファイルベースフォールバック関数（テスト用簡易版）
fallback_to_file_based_prevention() {
    local message="$1"
    local message_hash="$2"
    local container_id=$(hostname)
    local current_time=$(date +%s)
    
    # プロセス内重複防止
    local var_name="STARTUP_MSG_$(echo "$message_hash" | cut -c1-8)"
    if [ "${!var_name}" = "1" ]; then
        return 0
    fi
    
    # ファイルベース重複防止
    local success_file="$STARTUP_MESSAGE_LOCK_DIR/$message_hash.done"
    local lock_file="$STARTUP_MESSAGE_LOCK_DIR/$message_hash.lock"
    
    # success_fileチェック
    if [ -f "$success_file" ]; then
        local file_content=$(cat "$success_file" 2>/dev/null || echo "")
        local file_time=$(echo "$file_content" | cut -d':' -f1 2>/dev/null || echo "0")
        local file_container=$(echo "$file_content" | cut -d':' -f3 2>/dev/null || echo "")
        
        if [ "$file_container" = "$container_id" ] && [ $((current_time - file_time)) -lt $SAME_CONTAINER_DUPLICATE_THRESHOLD ]; then
            export "$var_name"=1
            return 0
        fi
        
        if [ "$file_container" != "$container_id" ] || [ $((current_time - file_time)) -gt $SUCCESS_FILE_MAX_AGE ]; then
            rm -f "$success_file" 2>/dev/null || true
        fi
    fi
    
    # ロッククリーンアップ
    cleanup_old_lock_file "$lock_file" "$SAME_CONTAINER_DUPLICATE_THRESHOLD" "$current_time"
    
    # ロック取得とメッセージ出力
    local process_info="${container_id}:$$:${current_time}"
    local attempt=0
    while [ $attempt -lt $MAX_LOCK_ATTEMPTS ]; do
        if mkdir "$lock_file" 2>/dev/null; then
            echo "$process_info" > "$lock_file/process_info" 2>/dev/null || true
            sleep 0.01
            break
        fi
        attempt=$((attempt + 1))
        sleep $LOCK_RETRY_DELAY
    done
    
    if [ ! -f "$success_file" ]; then
        echo "$message"
        export "$var_name"="1"
        echo "${current_time}:$$:${container_id}" > "$success_file" 2>/dev/null || true
        
        if [ "$SUCCESS_FILE_CLEANUP_DELAY" -lt 10 ]; then
            (sleep "$SUCCESS_FILE_CLEANUP_DELAY" && rm -f "$success_file" 2>/dev/null) &
        fi
    fi
    
    rm -rf "$lock_file" 2>/dev/null || true
    return 0
}

# Issue #5172: メイン重複防止関数（テスト用簡易版）
log_startup_message() {
    local message="$1"
    
    # backtest モードチェック
    if [ "$BACKTEST_MODE" = "true" ]; then
        log_backtest_startup_message "$message"
        return $?
    fi
    
    local message_hash=$(get_message_hash "$message")
    
    # テスト環境では常にfile_onlyを使用
    fallback_to_file_based_prevention "$message" "$message_hash"
    
    return 0
}

# Issue #5172: Redis-based重複防止関数（テスト用簡易版）
try_redis_duplicate_prevention() {
    local message="$1"
    
    # Node.js存在チェック
    if ! command -v node >/dev/null 2>&1; then
        return 1
    fi
    
    # REDIS_URL設定チェック
    if [ -z "$REDIS_URL" ]; then
        return 1
    fi
    
    # Redis接続テスト（簡易版）
    local redis_test_result=$(node -e "
const url = process.env.REDIS_URL;
if (!url) process.exit(1);
console.log('connected');
" 2>/dev/null || echo "error")
    
    if [ "$redis_test_result" = "error" ]; then
        return 1
    fi
    
    echo "redis-success"
    return 0
}

# メッセージロック取得関数（テスト用簡易版）
acquire_message_lock() {
    local message="$1"
    local timeout="${2:-5}"
    
    local message_hash=$(get_message_hash "$message")
    local lock_file="$STARTUP_MESSAGE_LOCK_DIR/$message_hash.lock"
    local container_id=$(hostname)
    local current_time=$(date +%s)
    
    local attempt=0
    while [ $attempt -lt $MAX_LOCK_ATTEMPTS ]; do
        if mkdir "$lock_file" 2>/dev/null; then
            local process_info="${container_id}:$$:${current_time}"
            echo "$process_info" > "$lock_file/process_info" 2>/dev/null || true
            return 0
        fi
        attempt=$((attempt + 1))
        sleep $LOCK_RETRY_DELAY
        
        # タイムアウトチェック
        if [ $attempt -ge $timeout ]; then
            break
        fi
    done
    
    return 1
}

# backtest専用関数（超軽量版）
log_backtest_startup_message() {
    local message="$1"
    
    local backtest_lock_file="/tmp/backtest-startup-message.lock"
    
    # 簡単な重複チェック
    if [ -f "$backtest_lock_file" ]; then
        return 0
    fi
    
    # ロックファイル作成
    echo "$$" > "$backtest_lock_file" 2>/dev/null || true
    
    # メッセージ出力
    echo "$message"
    
    # 短時間でクリーンアップ
    (sleep 1 && rm -f "$backtest_lock_file" 2>/dev/null) &
    
    return 0
}