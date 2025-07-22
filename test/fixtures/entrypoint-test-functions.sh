#!/bin/bash

# CI用超軽量版テストフィクスチャ
# 複雑な操作を除去してテストタイムアウトを回避

# 設定（テスト用にシンプル化）
SUCCESS_FILE_CLEANUP_DELAY=${SUCCESS_FILE_CLEANUP_DELAY:-2}

# 重複起動メッセージ防止（ファイルベースの超簡素版）
STARTUP_MESSAGE_LOCK_DIR=${STARTUP_MESSAGE_LOCK_DIR:-"/tmp/startup_messages"}
mkdir -p "$STARTUP_MESSAGE_LOCK_DIR" 2>/dev/null || true

# MD5ハッシュ値生成関数（シンプル版）
get_message_hash() {
    echo "$1" | md5sum | cut -d' ' -f1
}

# 超軽量版：重複起動ログ防止関数
log_startup_message() {
    local message="$1"
    
    # backtest モードチェック
    if [ "$BACKTEST_MODE" = "true" ]; then
        log_backtest_startup_message "$message"
        return $?
    fi
    
    # ハッシュ生成
    local message_hash=$(get_message_hash "$message")
    local var_name="STARTUP_MSG_$(echo "$message_hash" | cut -c1-8)"
    
    # プロセス内重複チェック
    if [ "${!var_name}" = "1" ]; then
        return 0
    fi
    
    # ファイルベース重複チェック（簡素化）
    local success_file="$STARTUP_MESSAGE_LOCK_DIR/$message_hash.done"
    if [ -f "$success_file" ]; then
        return 0
    fi
    
    # 簡素化されたロック機構（findコマンド除去、高速化）
    local lock_file="$STARTUP_MESSAGE_LOCK_DIR/$message_hash.lock"
    local max_attempts=5
    local attempt=0
    
    # 軽量ロック取得
    while [ $attempt -lt $max_attempts ]; do
        if mkdir "$lock_file" 2>/dev/null; then
            break
        fi
        attempt=$((attempt + 1))
        sleep 0.01  # 10ms待機に短縮
    done
    
    # 重複チェック
    if [ -f "$success_file" ]; then
        rm -rf "$lock_file" 2>/dev/null || true
        return 0
    fi
    
    # メッセージ出力
    echo "$message"
    
    # フラグ設定
    export "$var_name"="1"
    
    # 成功マーカー作成
    echo "$$" > "$success_file" 2>/dev/null || true
    
    # ロック解放
    rm -rf "$lock_file" 2>/dev/null || true
    
    # 軽量クリーンアップ（バックグラウンド処理なし）
    if [ "$SUCCESS_FILE_CLEANUP_DELAY" -lt 10 ]; then
        # テスト環境では即座にクリーンアップ予約
        (sleep "$SUCCESS_FILE_CLEANUP_DELAY" && rm -f "$success_file" 2>/dev/null) &
    fi
    
    return 0
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