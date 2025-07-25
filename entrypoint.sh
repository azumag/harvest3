#!/bin/bash

# 新しいentrypoint.sh - リファクタリング後のシンプル版
# Issue #5290: 複雑性改善とリファクタリング - KISS/YAGNI/DRY原則適用
# 機能別に分離されたスクリプトを使用する単一責任実装

set -e

# 基本設定（環境変数で上書き可能）
CONTAINER_NAME="strategy-runner"
MAX_STARTUP_TIME=${MAX_STARTUP_TIME:-60}
HEALTH_CHECK_INTERVAL=${HEALTH_CHECK_INTERVAL:-5}
DATABASE_CONNECTION_TIMEOUT=${DATABASE_CONNECTION_TIMEOUT:-10}
DISCORD_NOTIFICATION_TIMEOUT=${DISCORD_NOTIFICATION_TIMEOUT:-10}

# 起動ロック設定
STARTUP_LOCK_FILE="/tmp/strategy-runner-startup.lock"
STARTUP_LOCK_TIMEOUT=${STARTUP_LOCK_TIMEOUT:-30}

# スクリプトディレクトリ
SCRIPT_DIR="$(dirname "$0")/scripts"

# ログ関数
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

# ヘルパースクリプトの読み込み
source_helper_scripts() {
    local scripts=(
        "npm-handler.sh"
        "message-dedup.sh"
    )
    
    for script in "${scripts[@]}"; do
        local script_path="$SCRIPT_DIR/$script"
        if [ -f "$script_path" ]; then
            log "Loading helper script: $script"
            source "$script_path"
        else
            log "WARNING: Helper script not found: $script_path"
        fi
    done
}

# Discord通知関数（簡素化版）
send_startup_error_to_discord() {
    local error_message="$1"
    local error_details="$2"
    
    if [ -z "$DISCORD_ERROR_WEBHOOK_URL" ]; then
        log "WARNING: DISCORD_ERROR_WEBHOOK_URL not set, skipping Discord notification"
        return 0
    fi
    
    local discord_message="🚨 **Strategy-Runner起動エラー**
\`\`\`
Container: ${CONTAINER_NAME}
Error: ${error_message}
Details: ${error_details}
Time: $(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")
Host: $(hostname)
\`\`\`"

    # Node.js経由でDiscord通知送信（簡素化）
    if command -v node >/dev/null 2>&1; then
        local temp_script=$(mktemp "/tmp/discord_notify_XXXXXX.js")
        trap "rm -f \"$temp_script\"" EXIT ERR
        
        cat > "$temp_script" << 'EOF'
async function sendDiscordNotification() {
    try {
        const axios = require('axios');
        const webhookUrl = process.env.DISCORD_ERROR_WEBHOOK_URL;
        if (!webhookUrl) return false;
        
        const message = { content: process.argv[2] };
        const timeout = parseInt(process.argv[3]) * 1000 || 10000;
        
        await axios.post(webhookUrl, message, { timeout });
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
        
        if node "$temp_script" "$discord_message" "$DISCORD_NOTIFICATION_TIMEOUT" 2>/dev/null; then
            log "Discord notification sent successfully"
        else
            log "WARNING: Discord notification failed (non-critical)"
        fi
        
        rm -f "$temp_script"
        trap - EXIT ERR
    else
        log "WARNING: Node.js not available for Discord notification"
    fi
}

# 起動ロック関数（簡素化）
acquire_startup_lock() {
    local lock_file="$STARTUP_LOCK_FILE"
    local timeout="$STARTUP_LOCK_TIMEOUT"
    local waited=0
    
    log "Acquiring startup lock..."
    
    # 既存のロックファイルの検証
    if [ -f "$lock_file" ]; then
        local lock_pid=$(cat "$lock_file" 2>/dev/null)
        
        # PIDが有効でプロセスが実行中の場合は待機
        if [ -n "$lock_pid" ] && kill -0 "$lock_pid" 2>/dev/null; then
            log "Another startup process is running (PID: $lock_pid), waiting..."
            
            while [ -f "$lock_file" ] && [ $waited -lt $timeout ]; do
                sleep 1
                waited=$((waited + 1))
                
                if [ -n "$lock_pid" ] && ! kill -0 "$lock_pid" 2>/dev/null; then
                    log "Lock process (PID: $lock_pid) has exited, removing stale lock"
                    rm -f "$lock_file"
                    break
                fi
            done
            
            if [ $waited -ge $timeout ]; then
                log "ERROR: Startup lock acquisition timed out after ${timeout}s"
                rm -f "$lock_file"
            fi
        else
            log "Removing stale lock file (PID: $lock_pid not running)"
            rm -f "$lock_file"
        fi
    fi
    
    # ロックファイルを作成
    echo "$$" > "$lock_file"
    chmod 600 "$lock_file"
    
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
        if [ "$lock_pid" = "$$" ]; then
            rm -f "$lock_file"
            log "Startup lock released"
        else
            log "WARNING: Cannot release lock owned by PID: $lock_pid (current: $$)"
        fi
    fi
}

# 起動前チェック（簡素化）
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
    
    # NPM依存関係インストール（外部スクリプト使用）
    log "Installing npm dependencies using npm-handler..."
    if ! install_npm_dependencies; then
        log "ERROR: NPM dependency installation failed"
        send_startup_error_to_discord "NPM dependency installation failed" "See npm-handler logs for details"
        exit 1
    fi
    
    log "Pre-startup checks completed successfully"
}

# データベース接続チェック（簡素化）
check_database_connections() {
    log "Checking database connections..."
    
    local redis_failed=false
    local mongo_failed=false
    
    # Redis接続チェック
    log "Testing Redis connection..."
    if ! timeout "$DATABASE_CONNECTION_TIMEOUT" node -e "
        const redis = require('redis');
        const client = redis.createClient({url: process.env.REDIS_URL});
        client.connect()
            .then(() => { 
                console.log('Redis connection OK'); 
                return client.quit();
            })
            .then(() => process.exit(0))
            .catch(err => { 
                console.error('Redis connection failed:', err.message); 
                process.exit(1); 
            });
    " 2>/dev/null; then
        log "WARNING: Redis connection failed (service will retry later)"
        redis_failed=true
    else
        log "✓ Redis connection verified"
    fi
    
    # MongoDB接続チェック
    log "Testing MongoDB connection..."
    if ! timeout "$DATABASE_CONNECTION_TIMEOUT" node -e "
        const { MongoClient } = require('mongodb');
        const client = new MongoClient(process.env.MONGO_URL);
        client.connect()
            .then(() => { 
                console.log('MongoDB connection OK'); 
                return client.close(); 
            })
            .then(() => process.exit(0))
            .catch(err => { 
                console.error('MongoDB connection failed:', err.message); 
                process.exit(1); 
            });
    " 2>/dev/null; then
        log "WARNING: MongoDB connection failed (service will retry later)"
        mongo_failed=true
    else
        log "✓ MongoDB connection verified"
    fi
    
    # 両方のデータベースが失敗した場合のみエラー終了
    if [ "$redis_failed" = true ] && [ "$mongo_failed" = true ]; then
        local error_msg="All database connections failed"
        log "ERROR: $error_msg"
        send_startup_error_to_discord "$error_msg" "Both Redis and MongoDB connectivity failed"
        exit 1
    fi
    
    log "Database connectivity check completed"
}

# アプリケーション起動（簡素化）
start_application() {
    log "Starting strategy-runner application..."
    
    # ボットアプリケーション起動
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
        
        if [ $startup_time -gt 30 ]; then
            log "Application startup monitoring: ${startup_time}s elapsed"
        fi
        
        sleep $HEALTH_CHECK_INTERVAL
        startup_time=$((startup_time + HEALTH_CHECK_INTERVAL))
    done
    
    log "Application started successfully (Bot PID: $app_pid)"
    
    # プロセス監視（簡素化）
    local process_restart_count=0
    local max_process_restarts=2
    local restart_cooldown=45
    
    while true; do
        if ! kill -0 $app_pid 2>/dev/null; then
            log "Bot process failure detected"
            
            if [ $process_restart_count -lt $max_process_restarts ]; then
                process_restart_count=$((process_restart_count + 1))
                log "Restarting bot process (attempt $process_restart_count/$max_process_restarts)..."
                
                sleep $restart_cooldown
                
                log "Restarting bot application..."
                npm run start &
                app_pid=$!
                
                log "Bot process restarted successfully (Bot PID: $app_pid)"
            else
                log "Maximum internal restart attempts reached. Allowing Docker restart policy..."
                release_startup_lock
                exit 1
            fi
        fi
        
        # 定期的なヘルスチェック
        if [ $(($(date +%s) % 60)) -eq 0 ]; then
            log "Process health check: Bot PID $app_pid"
        fi
        
        sleep 5
    done
}

# 基本的な診断機能
run_basic_diagnostics() {
    log "=== BASIC DIAGNOSTICS ==="
    log "System: $(uname -a)"
    log "Node.js: $(node --version 2>/dev/null || echo 'Not available')"
    log "NPM: $(npm --version 2>/dev/null || echo 'Not available')"
    log "Container: $(hostname)"
    log "Memory: $(free -h | grep '^Mem:' | awk '{print "Used:" $3 " Available:" $7}' || echo 'unknown')"
    log "Disk: $(df -h / | tail -1 | awk '{print "Used:" $3 " Available:" $4}' || echo 'unknown')"
    log "=== DIAGNOSTICS COMPLETE ==="
}

# シグナルハンドラー（簡素化）
cleanup() {
    log "Received termination signal, shutting down gracefully..."
    
    # プロセスの優雅な終了
    if [ -n "$app_pid" ] && kill -0 $app_pid 2>/dev/null; then
        log "Sending SIGTERM to bot process (PID: $app_pid)..."
        kill -TERM $app_pid 2>/dev/null
        
        local wait_count=0
        while kill -0 $app_pid 2>/dev/null && [ $wait_count -lt 15 ]; do
            sleep 1
            wait_count=$((wait_count + 1))
        done
        
        if kill -0 $app_pid 2>/dev/null; then
            log "Bot process did not exit gracefully, force killing..."
            kill -KILL $app_pid 2>/dev/null
        fi
    fi
    
    # メッセージ重複防止スクリプトのクリーンアップ呼び出し
    if command -v cleanup_all_locks >/dev/null 2>&1; then
        cleanup_all_locks
    fi
    
    # 起動ロックの解放
    release_startup_lock
    
    log "Graceful shutdown completed"
    exit 0
}

# メイン実行
main() {
    # 診断情報の記録
    log "=== 起動診断情報 ==="
    log "プロセス ID: $$"
    log "起動時刻: $(date '+%Y-%m-%d %H:%M:%S')"
    log "作業ディレクトリ: $(pwd)"
    log "バックテストモード: ${BACKTEST_MODE:-false}"
    
    # ヘルパースクリプトの読み込み
    source_helper_scripts
    
    # 起動ロックの取得
    if ! acquire_startup_lock; then
        log "ERROR: Failed to acquire startup lock"
        exit 1
    fi
    
    # ロック解放のための終了時処理を設定
    trap release_startup_lock EXIT
    trap cleanup SIGTERM SIGINT
    
    if [ "$BACKTEST_MODE" = "true" ]; then
        # バックテストモード - 専用スクリプトに委譲
        log_startup_message "Starting backtest container with enhanced error handling"
        
        # バックテスト用の段階的起動プロセス
        pre_startup_checks
        check_database_connections
        
        log "Pre-startup checks completed for backtest mode"
        log "Backtest command arguments: $*"
        
        # バックテスト実行（外部スクリプト使用）
        local backtest_wrapper="$SCRIPT_DIR/backtest-wrapper.sh"
        if [ -f "$backtest_wrapper" ]; then
            log "Executing backtest using backtest-wrapper..."
            exec bash "$backtest_wrapper" "$@"
        else
            log "WARNING: Backtest wrapper not found, using fallback execution"
            if [ $# -eq 0 ]; then
                log "ERROR: No command arguments provided for backtest execution"
                send_startup_error_to_discord "Backtest container: No command arguments provided" "Command line: $0 (no args)"
                exit 1
            fi
            exec "$@"
        fi
    else
        # 通常モード
        log_startup_message "Starting strategy-runner container with enhanced error handling (container: $(hostname), pid: $$)"
        
        # 基本診断の実行
        run_basic_diagnostics
        
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