#!/bin/bash

# テスト専用の軽量版entrypoint関数
# Issue #5103テスト用 - 重い初期化処理を除外した必要な関数のみ

# 設定（テスト用にシンプル化）
SUCCESS_FILE_CLEANUP_DELAY=${SUCCESS_FILE_CLEANUP_DELAY:-300}

# バックグラウンドプロセス追跡
BACKGROUND_CLEANUP_PIDS=""

# 重複起動メッセージ防止（ファイルベースの atomic 実装）
STARTUP_MESSAGE_LOCK_DIR=${STARTUP_MESSAGE_LOCK_DIR:-"/tmp/startup_messages"}
mkdir -p "$STARTUP_MESSAGE_LOCK_DIR" 2>/dev/null || true

# MD5ハッシュ値生成関数（DRY原則適用）
get_message_hash() {
    echo "$1" | md5sum | cut -d' ' -f1
}

# 重複起動ログ防止関数（Issue #5103 修正: 簡素化による信頼性向上版）
# シンプルで確実な重複防止機構
log_startup_message() {
    local message="$1"
    
    # Issue #5127: backtest containerの場合は専用関数を使用
    if [ "$BACKTEST_MODE" = "true" ]; then
        log_backtest_startup_message "$message"
        return $?
    fi
    
    # Issue #5103: プロセス内での確実な重複防止（第一防御線）
    local message_hash=$(get_message_hash "$message")
    local var_name="STARTUP_MSG_$(echo "$message_hash" | cut -c1-8)"
    
    # 同一プロセス内で既に出力済みの場合は即座に終了
    if [ "${!var_name}" = "1" ]; then
        return 0
    fi
    
    # Issue #5103: シンプルなファイルベース重複防止（第二防御線）
    local success_file="$STARTUP_MESSAGE_LOCK_DIR/$message_hash.done"
    
    # 既に成功ファイルが存在し、内容が有効な場合はスキップ
    if [ -f "$success_file" ]; then
        local success_content=$(cat "$success_file" 2>/dev/null || echo "")
        if [ -n "$success_content" ]; then
            return 0
        fi
    fi
    
    # Issue #5103: atomicロック実装（mkdirによるatomic操作）
    local lock_file="$STARTUP_MESSAGE_LOCK_DIR/$message_hash.lock"
    local max_lock_wait=10  # 最大10秒待機
    local lock_acquired=false
    local wait_time=0
    
    # 古いロックファイルのクリーンアップ（60秒以上古いもの）
    find "$STARTUP_MESSAGE_LOCK_DIR" -name "*.lock" -type d -mmin +1 -exec rm -rf {} \; 2>/dev/null || true
    
    # atomicロック取得試行（0.1秒間隔で最大10秒）
    local iteration=0
    local max_iterations=100  # 10秒 / 0.1秒 = 100回
    while [ $iteration -lt $max_iterations ]; do
        if mkdir "$lock_file" 2>/dev/null; then
            lock_acquired=true
            break
        fi
        sleep 0.1
        iteration=$((iteration + 1))
    done
    
    if [ "$lock_acquired" = false ]; then
        # ロック取得失敗時は重複チェックのみ実行
        if [ -f "$success_file" ]; then
            return 0
        fi
    fi
    
    # 最終確認：他のプロセスが既に実行済みでないかチェック
    if [ -f "$success_file" ]; then
        # ロック解放
        rm -rf "$lock_file" 2>/dev/null || true
        return 0
    fi
    
    # メッセージ出力
    echo "$message"
    
    # プロセス内フラグ設定
    export "$var_name"="1"
    
    # 成功マーカー作成（プロセスIDを含む）
    echo "$$" > "$success_file" 2>/dev/null || true
    
    # ロック解放
    rm -rf "$lock_file" 2>/dev/null || true
    
    # Issue #5103: バックグラウンドクリーンアップ（300秒後）
    (sleep "$SUCCESS_FILE_CLEANUP_DELAY" && rm -f "$success_file" 2>/dev/null) &
    local cleanup_pid=$!
    BACKGROUND_CLEANUP_PIDS="$BACKGROUND_CLEANUP_PIDS $cleanup_pid"
    
    return 0
}

# backtest専用の起動メッセージログ関数（Issue #5127対応）
log_backtest_startup_message() {
    local message="$1"
    
    # backtest専用のロック機構
    local backtest_lock_file="/tmp/backtest-startup-message.lock"
    local backtest_timeout=${BACKTEST_STARTUP_LOCK_TIMEOUT:-10}
    
    # 簡素化されたbacktest用重複防止
    if [ -f "$backtest_lock_file" ]; then
        # ファイルの存在時間を簡単にチェック（find コマンドを使用）
        local recent_lock=$(find "$backtest_lock_file" -mmin -1 2>/dev/null)
        if [ -n "$recent_lock" ]; then
            return 0  # 1分以内に作成されたロックファイルが存在する場合はスキップ
        fi
    fi
    
    # ロックファイル作成
    echo "$$" > "$backtest_lock_file" 2>/dev/null || true
    
    # メッセージ出力
    echo "$message"
    
    # バックグラウンドでロックファイルをクリーンアップ
    (sleep $backtest_timeout && rm -f "$backtest_lock_file" 2>/dev/null) &
    
    return 0
}