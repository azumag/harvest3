#!/bin/bash

# lock-manager.sh
# ロック管理・重複防止機構
# Issue #5351: entrypoint.shリファクタリング - 単一責任の原則適用

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

# ロッククリーンアップヘルパー関数
cleanup_backtest_lock() {
    # flock利用時のファイルディスクリプタクリーンアップ
    # ファイルディスクリプタを閉じてロック解放
    if command -v flock >/dev/null 2>&1; then
        exec 200>&- 2>/dev/null || true
        trap - EXIT INT TERM 2>/dev/null || true
    else
        # フォールバック時のディレクトリクリーンアップ
        local fallback_lock_dir="/tmp/backtest-startup-message.lock.fallback"
        rmdir "$fallback_lock_dir" 2>/dev/null || true
        trap - EXIT INT TERM 2>/dev/null || true
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

# Issue #5127, #5058 & #5175: backtest専用クリーンアップ関数（改良版）  
# Issue #5127, #5058 & #5175 & #5333: backtest専用クリーンアップ関数（強化版）
# Issue #5333修正: グローバルファイルのクリーンアップを追加
# Issue #5292: 新しいマーカーファイルのクリーンアップ追加
cleanup_backtest_locks() {
    log "Cleaning up backtest-specific lock files..."
    
    # backtest開始時刻マーカーのクリーンアップ
    if [ -f "/tmp/backtest-start-time.marker" ]; then
        rm -f "/tmp/backtest-start-time.marker" 2>/dev/null || true
        log "Removed backtest start time marker"
    fi
    
    # Issue #5058: 新しいatomicロックディレクトリのクリーンアップ
    if [ -d "/tmp/backtest-startup-lock.dir" ]; then
        rm -rf "/tmp/backtest-startup-lock.dir" 2>/dev/null || true
        log "Removed backtest startup lock directory"
    fi
    
    # Issue #5175: コンテナ再起動検出ファイルのクリーンアップ
    if [ -f "$BACKTEST_CONTAINER_RESTART_DETECTION_FILE" ]; then
        rm -f "$BACKTEST_CONTAINER_RESTART_DETECTION_FILE" 2>/dev/null || true
        log "Removed backtest container restart detection file"
    fi
    
    # Issue #5254: NPMエラー検出ファイルのクリーンアップ
    if [ -f "/tmp/backtest-npm-error-detection.state" ]; then
        rm -f "/tmp/backtest-npm-error-detection.state" 2>/dev/null || true
        log "Removed backtest NPM error detection file (Issue #5254)"
    fi
    
    # Issue #5194修正: タイムスタンプファイルのクリーンアップ
    if [ -f "$BACKTEST_STARTUP_TIMESTAMP_FILE" ]; then
        rm -f "$BACKTEST_STARTUP_TIMESTAMP_FILE" 2>/dev/null || true
        log "Removed backtest timestamp file (Issue #5194)"
    fi
    
    # Issue #5333修正: グローバルファイルのクリーンアップ
    if [ -f "/tmp/backtest-startup-message-global.lock" ]; then
        rm -f "/tmp/backtest-startup-message-global.lock" 2>/dev/null || true
        log "Removed global backtest startup lock file (Issue #5333)"
    fi
    
    if [ -f "/tmp/backtest-startup-timestamp-global.state" ]; then
        rm -f "/tmp/backtest-startup-timestamp-global.state" 2>/dev/null || true
        log "Removed global backtest timestamp file (Issue #5333)"
    fi
    
    # Issue #5292レビュー対応: PIDマーカーは不要になったためコメントアウト
    # PIDマーカーは簡素化により削除されました
    
    # Issue #5292レビュー対応: セキュリティ改善 - より制限的なパターン使用
    if ls /tmp/backtest-message-*.marker 1> /dev/null 2>&1; then
        rm -f /tmp/backtest-message-*.marker 2>/dev/null || true
        log "Cleaned up backtest message markers (Issue #5292)"
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
    if [ -f "/tmp/main-startup-message.done" ]; then
        rm -f "/tmp/main-startup-message.done" 2>/dev/null || true
        log "Cleaned up main startup message done marker"
    fi
    
    if [ -d "/tmp/main-startup-message.lock" ]; then
        rm -rf "/tmp/main-startup-message.lock" 2>/dev/null || true
        log "Cleaned up main startup message lock directory"
    fi
    
    # プロセス内フラグのクリアは環境変数なので、コンテナ再起動時に自動的にクリアされる
}