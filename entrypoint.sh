#!/bin/bash

# strategy-runner コンテナ起動時エラーハンドリング & Discord通知スクリプト
# Geminiの厳格レビューに基づく実装

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
STARTUP_LOCK_FILE="/tmp/strategy-runner-startup.lock"  # 起動ロックファイル
STARTUP_LOCK_TIMEOUT=${STARTUP_LOCK_TIMEOUT:-30}  # 起動ロックタイムアウト（秒）

# 重複起動メッセージ防止（シンプルな環境変数ベース）
STARTUP_MESSAGE_SENT=""

# ログ関数
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
    # stdout の即座フラッシュを保証
    exec 1>&1
}

# 重複起動ログ防止関数（シンプル版）
log_startup_message() {
    local message="$1"
    if [ "$STARTUP_MESSAGE_SENT" != "$message" ]; then
        STARTUP_MESSAGE_SENT="$message"
        log "$message"
    fi
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
    
    # Node.js依存関係インストールとチェック
    log "Installing npm dependencies..."
    
    # npm installを実行し、失敗した場合はキャッシュクリアして再試行
    if ! npm install; then
        log "Initial npm install failed, cleaning cache and retrying..."
        npm cache clean --force
        if ! npm install; then
            local error_msg="npm install failed after cache clean"
            log "ERROR: $error_msg"
            send_startup_error_to_discord "$error_msg" "Node.js dependency installation failed"
            exit 1
        fi
    fi
    
    # decimal.jsの存在を具体的にチェック（強化版）
    log "Checking critical dependencies..."
    local critical_deps=("decimal.js@10.6.0" "ccxt" "mongodb" "redis")
    for dep in "${critical_deps[@]}"; do
        local dep_name=$(echo "$dep" | cut -d'@' -f1)
        if ! node -e "require('$dep_name'); console.log('$dep_name OK');" 2>/dev/null; then
            log "$dep_name not found, installing specifically..."
            if ! npm install "$dep"; then
                local error_msg="Failed to install $dep specifically"
                log "ERROR: $error_msg"
                send_startup_error_to_discord "$error_msg" "$dep installation failed"
                exit 1
            fi
            
            # インストール後の再確認
            if ! node -e "require('$dep_name'); console.log('$dep_name verified after install');" 2>/dev/null; then
                local error_msg="$dep_name still not accessible after installation"
                log "ERROR: $error_msg"
                send_startup_error_to_discord "$error_msg" "$dep_name accessibility check failed"
                exit 1
            fi
        fi
    done
    
    if ! npm ls > /dev/null 2>&1; then
        local error_msg="npm dependencies validation failed"
        log "ERROR: $error_msg"
        send_startup_error_to_discord "$error_msg" "Node.js dependency validation failed"
        exit 1
    fi
    
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
    
    # プロセス監視と自動回復機能（レースコンディション対策版）
    local process_restart_count=0
    local max_process_restarts=3
    local restart_cooldown=30
    local restart_in_progress=false
    local last_restart_time=0
    
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
            
            # 頻繁な再起動を防ぐ（最後の再起動から30秒以内は再起動しない）
            if [ $((current_time - last_restart_time)) -lt 30 ]; then
                log "Too soon since last restart, waiting..."
                sleep 5
                continue
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
            else
                log "Maximum restart attempts reached, exiting..."
                restart_in_progress=false
                exit 1
            fi
        fi
        
        # 定期的なヘルスチェック（60秒間隔）
        if [ $((current_time % 60)) -eq 0 ]; then
            log "Process health check: Bot PID $app_pid"
        fi
        
        sleep 5
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
    
    # 起動ロックの解放
    release_startup_lock
    
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
    
    # 起動ロックの取得（重複起動防止）
    if ! acquire_startup_lock; then
        log "ERROR: Failed to acquire startup lock"
        exit 1
    fi
    
    # ロック解放のための終了時処理を設定
    trap release_startup_lock EXIT
    
    if [ "$BACKTEST_MODE" = "true" ]; then
        log_startup_message "Starting backtest container with enhanced error handling"
        
        # backtest用の段階的起動プロセス
        pre_startup_checks
        check_database_connections
        
        # backtestの場合は、引数で渡されたコマンドを実行
        log "Pre-startup checks completed for backtest mode, executing command: $*"
        exec "$@"
    else
        log_startup_message "Starting strategy-runner container with enhanced error handling"
        
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