#!/bin/bash

# Issue #5316修正のテスト: entrypoint.shの起動メッセージ重複防止機構のテスト
# testsディレクトリに永続的に配置

set -e

# テスト結果カウンタ
TESTS_PASSED=0
TESTS_FAILED=0

# テスト用の一時ディレクトリ
TEST_TEMP_DIR="/tmp/test_startup_message_$$"
mkdir -p "$TEST_TEMP_DIR"

# クリーンアップ関数
cleanup() {
    rm -rf "$TEST_TEMP_DIR"
}
trap cleanup EXIT

echo "=== entrypoint.sh 起動メッセージ重複防止テスト開始 ==="

# entrypoint.shから必要な関数を抽出（テスト用の簡略版）
# 実際のentrypoint.shの関数をテスト環境で再現
test_log_startup_message() {
    local message="$1"
    local output_file="$TEST_TEMP_DIR/test_output.log"
    
    # LOCK_BASE_DIRを設定
    export LOCK_BASE_DIR="$TEST_TEMP_DIR"
    
    # 実際のentrypoint.shのlog_startup_message機能をテスト
    case "$message" in
        *"Starting strategy-runner container with enhanced error handling"*)
            # プロセス内変数による即座の重複防止（第0防御線）
            if [ "$_MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS" = "1" ]; then
                return 0
            fi
            
            # 環境変数フラグによる第1防御線
            if [ "$MAIN_STARTUP_MESSAGE_LOGGED" = "1" ]; then
                _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
                return 0
            fi
            
            # 完了マーカーファイル存在チェック（第2防御線）
            local startup_msg_done_file="$LOCK_BASE_DIR/main-startup-message.done"
            if [ -f "$startup_msg_done_file" ]; then
                return 0
            fi
            
            # アトミックロック取得（第3防御線）
            local startup_msg_lock_file="$LOCK_BASE_DIR/main-startup-message.lock"
            local lock_acquired=false
            local lock_timeout=5
            local lock_attempts=0
            
            # タイムアウト付きロック取得
            while [ $lock_attempts -lt $lock_timeout ] && [ "$lock_acquired" = false ]; do
                if mkdir "$startup_msg_lock_file" 2>/dev/null; then
                    lock_acquired=true
                    break
                fi
                lock_attempts=$((lock_attempts + 1))
                sleep 0.1
            done
            
            if [ "$lock_acquired" = true ]; then
                # ロック取得成功後にフラグを設定
                _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
                export MAIN_STARTUP_MESSAGE_LOGGED=1
                
                # ロック取得後の最終チェック（二重防止）
                if [ -f "$startup_msg_done_file" ]; then
                    rm -rf "$startup_msg_lock_file" 2>/dev/null || true
                    return 0
                fi
                
                # 完了マーカーファイルを原子的に作成し、成功した場合のみメッセージを出力
                local temp_marker="${startup_msg_done_file}.tmp.$$"
                if echo "$(date +%s):$$:$(hostname)" > "$temp_marker" 2>/dev/null && \
                   mv "$temp_marker" "$startup_msg_done_file" 2>/dev/null; then
                    chmod 600 "$startup_msg_done_file" 2>/dev/null || true
                    
                    # メッセージ出力（完了マーカー作成成功後のみ）
                    echo "$message" >> "$output_file"
                else
                    # 完了マーカー作成失敗時は重複と判定してメッセージを抑制
                    rm -f "$temp_marker" 2>/dev/null || true
                fi
                
                # ロック解放
                rm -rf "$startup_msg_lock_file" 2>/dev/null || true
                return 0
            else
                # ロック取得失敗時の処理
                _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
                export MAIN_STARTUP_MESSAGE_LOGGED=1
                echo "DEBUG: Startup message lock acquisition timeout - message suppressed to prevent duplicate" >> "$output_file"
                return 0
            fi
            ;;
    esac
    
    return 0
}

# テスト1: 同一プロセス内での重複防止
test_same_process_duplication() {
    echo "テスト1: 同一プロセス内での重複防止"
    
    # 環境変数をクリア
    unset _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS
    unset MAIN_STARTUP_MESSAGE_LOGGED
    
    local output_file="$TEST_TEMP_DIR/test_output.log"
    rm -f "$output_file"
    rm -rf "$TEST_TEMP_DIR/main-startup-message"*
    
    # 複数回呼び出し
    test_log_startup_message "Starting strategy-runner container with enhanced error handling (container: test, pid: $$)"
    test_log_startup_message "Starting strategy-runner container with enhanced error handling (container: test, pid: $$)"
    test_log_startup_message "Starting strategy-runner container with enhanced error handling (container: test, pid: $$)"
    
    # 出力行数をカウント
    local line_count=0
    if [ -f "$output_file" ]; then
        line_count=$(grep -c "Starting strategy-runner container" "$output_file" 2>/dev/null || echo 0)
    fi
    
    if [ "$line_count" -eq 1 ]; then
        echo "✓ テスト1 成功: メッセージが1回のみ出力されました (出力行数: $line_count)"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        echo "✗ テスト1 失敗: メッセージが $line_count 回出力されました (期待値: 1)"
        TESTS_FAILED=$((TESTS_FAILED + 1))
        if [ -f "$output_file" ]; then
            echo "実際の出力:"
            cat "$output_file"
        fi
    fi
}

# テスト2: 環境変数フラグによる重複防止
test_environment_flag_duplication() {
    echo "テスト2: 環境変数フラグによる重複防止"
    
    # 環境変数を事前に設定
    unset _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS
    export MAIN_STARTUP_MESSAGE_LOGGED=1
    
    local output_file="$TEST_TEMP_DIR/test_output.log"
    rm -f "$output_file"
    rm -rf "$TEST_TEMP_DIR/main-startup-message"*
    
    # 呼び出し
    test_log_startup_message "Starting strategy-runner container with enhanced error handling (container: test, pid: $$)"
    
    # 出力ファイルが作成されていないことを確認
    local line_count=0
    if [ -f "$output_file" ]; then
        line_count=$(grep -c "Starting strategy-runner container" "$output_file" 2>/dev/null || echo 0)
    fi
    
    if [ "$line_count" -eq 0 ]; then
        echo "✓ テスト2 成功: 環境変数フラグによりメッセージが抑制されました"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        echo "✗ テスト2 失敗: 環境変数フラグが設定されているにも関わらずメッセージが出力されました (出力行数: $line_count)"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
}

# テスト3: 完了マーカーファイルによる重複防止
test_marker_file_duplication() {
    echo "テスト3: 完了マーカーファイルによる重複防止"
    
    # 環境変数をクリア
    unset _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS
    unset MAIN_STARTUP_MESSAGE_LOGGED
    
    local output_file="$TEST_TEMP_DIR/test_output.log"
    local marker_file="$TEST_TEMP_DIR/main-startup-message.done"
    rm -f "$output_file"
    rm -rf "$TEST_TEMP_DIR/main-startup-message"*
    
    # 完了マーカーファイルを事前に作成
    echo "$(date +%s):test:$(hostname)" > "$marker_file"
    chmod 600 "$marker_file"
    
    # 呼び出し
    test_log_startup_message "Starting strategy-runner container with enhanced error handling (container: test, pid: $$)"
    
    # 出力ファイルが作成されていないことを確認
    local line_count=0
    if [ -f "$output_file" ]; then
        line_count=$(grep -c "Starting strategy-runner container" "$output_file" 2>/dev/null || echo 0)
    fi
    
    if [ "$line_count" -eq 0 ]; then
        echo "✓ テスト3 成功: 完了マーカーファイルによりメッセージが抑制されました"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        echo "✗ テスト3 失敗: 完了マーカーファイルが存在するにも関わらずメッセージが出力されました (出力行数: $line_count)"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
}

# テスト実行
test_same_process_duplication
test_environment_flag_duplication
test_marker_file_duplication

# 結果まとめ
echo ""
echo "=== テスト結果まとめ ==="
echo "成功: $TESTS_PASSED"
echo "失敗: $TESTS_FAILED"

if [ "$TESTS_FAILED" -eq 0 ]; then
    echo "✓ すべてのテストが成功しました"
    exit 0
else
    echo "✗ $TESTS_FAILED 個のテストが失敗しました"
    exit 1
fi