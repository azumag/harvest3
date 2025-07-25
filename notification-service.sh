#!/bin/bash

# notification-service.sh  
# Discord通知・起動メッセージ管理機能
# Issue #5351: entrypoint.shリファクタリング - 単一責任の原則適用

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

# Issue #5127, #5058 & #5175 & #5216: backtest container専用起動メッセージ関数（簡素化版）
# Issue #5127, #5058 & #5175 & #5216 & #5333: backtest container専用起動メッセージ関数（強化版）
# Issue #5333修正: 複数コンテナ間での重複メッセージ防止を強化
# Issue #5216修正: KISS原則に基づく簡素化でレースコンディション問題を根本解決
# Issue #5159: flockによる確実なatomic lock実装（フォールバック対応）
log_backtest_startup_message() {
    local message="$1"
    local current_time=$(date +%s.%N)
    # Issue #5333修正: よりグローバルなロックファイル名を使用（複数コンテナ間で共有）
    # セキュリティ強化: より安全なディレクトリを使用（/var/run優先、フォールバック付き）
    local temp_dir="/var/run/backtest"
    if ! mkdir -p "$temp_dir" 2>/dev/null || ! [ -w "$temp_dir" ]; then
        temp_dir="/tmp"  # フォールバック
    fi
    chmod 700 "$temp_dir" 2>/dev/null || true
    local lock_file="$temp_dir/startup-message-global.lock"
    # Issue #5333修正: グローバルなタイムスタンプファイルを使用
    local timestamp_file="$temp_dir/startup-timestamp-global.state"
    local max_wait_time="$BACKTEST_STARTUP_FLOCK_TIMEOUT"
    local container_id=$(hostname)
    local process_id=$$
    
    # Issue #5333修正: デバッグ情報の記録（一時的）
    # この情報は実際の問題解決後に削除される予定
    
    # Issue #5216修正: 複雑な事前チェックを削除し、atomicロック内でのみタイムスタンプチェック
    # レースコンディションの原因となっていた複数チェックポイントを単一化
    # Issue #5216修正: 単一のクリティカルセクション内でタイムスタンプチェックを実行
    
    # flockによるatomicロック取得（フォールバック対応）
    # 複数プロセス間でのrace conditionを完全に防止
    if command -v flock >/dev/null 2>&1; then
        # flock利用可能な場合の実装
        exec 200>"$lock_file"
        
        # 異常終了時のFDクリーンアップ用trap
        trap 'exec 200>&- 2>/dev/null || true' EXIT INT TERM
        
        # タイムアウト付きでexclusiveロックを取得
        if ! flock -x -w "$max_wait_time" 200; then
            log "Backtest startup message suppressed (lock acquisition timeout)"
            exec 200>&-
            trap - EXIT INT TERM
            return 0
        fi
    else
        # flockが利用不可の場合のフォールバック（mkdir-based）
        local fallback_lock_dir="${lock_file}.fallback"
        local attempt=0
        local max_attempts=3
        
        while [ $attempt -lt $max_attempts ]; do
            if mkdir "$fallback_lock_dir" 2>/dev/null; then
                trap 'rmdir "$fallback_lock_dir" 2>/dev/null || true' EXIT INT TERM
                break
            fi
            attempt=$((attempt + 1))
            sleep 1
        done
        
        if [ $attempt -eq $max_attempts ]; then
            log "Backtest startup message suppressed (fallback lock acquisition failed)"
            return 0
        fi
    fi
    
    # Issue #5333修正: ロック取得後、より厳密なタイムスタンプチェック
    # Issue #5340修正: bcコマンド依存を除去し、整数算術のみ使用
    # パフォーマンス最適化: 複数cutコマンドの代わりに1回のIFS読み込み使用
    if [ -f "$timestamp_file" ]; then
        IFS=':' read -r last_time last_container last_pid < "$timestamp_file" 2>/dev/null || {
            last_time=0; last_container="unknown"; last_pid="unknown"
        }
        
        # 整数部分のみを使用してCI環境での互換性を確保
        local current_time_int=${current_time%.*}
        local last_time_int=${last_time%.*}
        local time_diff=$((current_time_int - last_time_int))
        
        # Issue #5333修正: より詳細な重複検出ログ
        # 整数算術でタイムスタンプ比較（bcコマンド不要）
        if [ "$time_diff" -lt "$BACKTEST_STARTUP_LOCK_TIMEOUT" ]; then
            if [ "$last_container" = "$container_id" ] && [ "$last_pid" = "$process_id" ]; then
                log "Backtest startup message suppressed (same process, last shown ${time_diff}s ago)"
            else
                log "Backtest startup message suppressed (different process: ${last_container}:${last_pid}, last shown ${time_diff}s ago)"
            fi
            cleanup_backtest_lock
            return 0
        fi
    fi
    
    # NPMエラー状態をチェック（Issue #5159）
    local npm_error_marker="/tmp/backtest-npm-error-detection.state"
    if [ -f "$npm_error_marker" ]; then
        local last_npm_error=$(cat "$npm_error_marker" 2>/dev/null || echo "0")
        local npm_error_age=$((current_time - last_npm_error))
        
        if [ $npm_error_age -lt $NPM_ERROR_SUPPRESS_DURATION ]; then
            log "Backtest startup message suppressed (NPM error recovery within ${npm_error_age}s)"
            cleanup_backtest_lock
            return 0
        fi
    fi
    
    # Issue #5333修正: メッセージ出力とより詳細なタイムスタンプ更新
    log "$message"
    
    # エラーハンドリング強化: 原子的ファイル書き込み実装
    local temp_timestamp="${timestamp_file}.tmp.$$"
    if ! echo "${current_time}:${container_id}:${process_id}" > "$temp_timestamp" || 
       ! chmod 600 "$temp_timestamp" ||
       ! mv "$temp_timestamp" "$timestamp_file"; then
        log "ERROR: Failed to update timestamp file"
        rm -f "$temp_timestamp" 2>/dev/null || true
        cleanup_backtest_lock
        return 1
    fi
    
    # ロック解放
    cleanup_backtest_lock
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

# Issue #5172: メイン重複防止関数（簡素化・YAGNI/KISS原則）
# Issue #5220: 起動メッセージ重複防止を強化（KISS原則に基づく簡素化）
log_startup_message() {
    local message="$1"
    
    # backtest containerの場合は専用関数を使用
    if [ "$BACKTEST_MODE" = "true" ]; then
        log_backtest_startup_message "$message"
        return $?
    fi
    
    # Issue #5220/#5248/#5267: 起動メッセージの重複防止（アトミックファイルロック強化版）
    # Issue #5267修正: アトミックファイルロックによる確実な重複防止
    # レースコンディションを完全に防ぐためのアトミックファイルベース重複防止機構
    # 注意: バックテストモード以外でのみ適用
    case "$message" in
        *"Starting strategy-runner container with enhanced error handling"*)
            # Issue #5295修正: アトミックファイルロックによる確実な重複防止とfallthrough防止
            local startup_msg_lock_file="/tmp/main-startup-message.lock"
            local startup_msg_done_file="/tmp/main-startup-message.done"
            local atomic_processing_success=false
            
            # 既に完了マーカーが存在する場合は重複防止
            if [ -f "$startup_msg_done_file" ]; then
                return 0  # 既にログ出力済み、重複防止
            fi
            
            # 環境変数フラグによる高速チェック（第一防御線）
            if [ "$MAIN_STARTUP_MESSAGE_LOGGED" = "1" ]; then
                return 0  # 既にログ出力済み、重複防止
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
                export MAIN_STARTUP_MESSAGE_LOGGED=1
                log "$message"
                atomic_processing_success=true
                
                # 完了マーカー作成（他のプロセス用）
                echo "$(date +%s):$$:$(hostname)" > "$startup_msg_done_file" 2>/dev/null || true
                chmod 600 "$startup_msg_done_file" 2>/dev/null || true
                
                # ロック解放
                rm -rf "$startup_msg_lock_file" 2>/dev/null || true
                
                # Issue #5295修正: 明示的な成功フラグをチェックしてreturn
                if [ "$atomic_processing_success" = true ]; then
                    return 0  # 処理完了、以降のRedis/ファイル処理を確実にスキップ
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
                export MAIN_STARTUP_MESSAGE_LOGGED=1
                return 0  # 他のプロセスがログ出力したため、重複防止
            fi
            
            # Issue #5295修正: fallthroughが発生した場合の緊急停止
            # このコードに到達した場合は予期しない状況なので、安全のためreturn
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