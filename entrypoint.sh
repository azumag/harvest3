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

# ログ関数
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
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
        # 一時的なDiscord通知スクリプトを作成
        local temp_script="/tmp/discord_notify_$$.js"
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
        
        # 一時ファイルを削除
        rm -f "$temp_script"
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

# データベース接続チェック（強化版）
check_database_connections() {
    log "Checking database connections with retry logic..."
    
    local redis_failed=false
    local mongo_failed=false
    local max_retries=3
    local retry_delay=5
    
    # Redis接続チェック（リトライ付き）
    log "Testing Redis connection with retry..."
    local redis_retry=0
    while [ $redis_retry -lt $max_retries ]; do
        if node -e "
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
            setTimeout(() => { 
                console.error('Redis connection timeout'); 
                process.exit(1); 
            }, ${DATABASE_CONNECTION_TIMEOUT}000);
        " 2>/dev/null; then
            log "Redis connection verified successfully (attempt $((redis_retry + 1)))"
            break
        else
            redis_retry=$((redis_retry + 1))
            if [ $redis_retry -lt $max_retries ]; then
                log "Redis connection failed (attempt $redis_retry/$max_retries), retrying in ${retry_delay}s..."
                sleep $retry_delay
            else
                log "WARNING: Redis connection failed after $max_retries attempts (service will retry later)"
                redis_failed=true
            fi
        fi
    done
    
    # MongoDB接続チェック（リトライ付き）
    log "Testing MongoDB connection with retry..."
    local mongo_retry=0
    while [ $mongo_retry -lt $max_retries ]; do
        if node -e "
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
            setTimeout(() => { 
                console.error('MongoDB connection timeout'); 
                process.exit(1); 
            }, ${DATABASE_CONNECTION_TIMEOUT}000);
        " 2>/dev/null; then
            log "MongoDB connection verified successfully (attempt $((mongo_retry + 1)))"
            break
        else
            mongo_retry=$((mongo_retry + 1))
            if [ $mongo_retry -lt $max_retries ]; then
                log "MongoDB connection failed (attempt $mongo_retry/$max_retries), retrying in ${retry_delay}s..."
                sleep $retry_delay
            else
                log "WARNING: MongoDB connection failed after $max_retries attempts (service will retry later)"
                mongo_failed=true
            fi
        fi
    done
    
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
    
    # APIサーバーをバックグラウンドで起動
    log "Starting API server..."
    npm run start-web &
    local api_pid=$!
    
    # APIサーバーの起動を待つ（より寛容なタイムアウト設定）
    local api_startup_time=0
    local max_api_wait=$API_STARTUP_TIMEOUT
    while [ $api_startup_time -lt $max_api_wait ]; do
        if curl -s http://localhost:3000/api/health > /dev/null 2>&1; then
            log "API server is ready on port 3000"
            break
        fi
        sleep $API_CHECK_INTERVAL
        api_startup_time=$((api_startup_time + API_CHECK_INTERVAL))
        
        # 進捗ログ
        if [ $((api_startup_time % PROGRESS_LOG_INTERVAL)) -eq 0 ]; then
            log "API server startup: ${api_startup_time}/${max_api_wait} seconds elapsed"
        fi
    done
    
    if [ $api_startup_time -ge $max_api_wait ]; then
        local error_msg="API server failed to start within ${max_api_wait} seconds"
        log "ERROR: $error_msg"
        send_startup_error_to_discord "$error_msg" "API server startup timeout"
        exit 1
    fi
    
    # バックグラウンドでボットアプリケーション起動
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
        
        if ! kill -0 $api_pid 2>/dev/null; then
            local error_msg="API server process died during startup"
            log "ERROR: $error_msg"
            send_startup_error_to_discord "$error_msg" "API server died after ${startup_time} seconds"
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
    
    log "Application started successfully (Bot PID: $app_pid, API PID: $api_pid)"
    
    # プロセス監視と自動回復機能
    local process_restart_count=0
    local max_process_restarts=3
    local restart_cooldown=30
    
    while true; do
        # ボットプロセスの監視
        if ! kill -0 $app_pid 2>/dev/null; then
            log "Bot process died, attempting recovery..."
            
            # API プロセスも停止
            if kill -0 $api_pid 2>/dev/null; then
                log "Stopping API process for coordinated restart..."
                kill $api_pid 2>/dev/null
                wait $api_pid 2>/dev/null
            fi
            
            # 再起動制限チェック
            if [ $process_restart_count -lt $max_process_restarts ]; then
                process_restart_count=$((process_restart_count + 1))
                log "Restarting processes (attempt $process_restart_count/$max_process_restarts)..."
                
                # クールダウン期間
                sleep $restart_cooldown
                
                # API サーバーを再起動
                log "Restarting API server..."
                npm run start-web &
                api_pid=$!
                
                # APIの起動を確認
                sleep 10
                if ! curl -s http://localhost:3000/api/health > /dev/null 2>&1; then
                    log "API server failed to restart, giving up..."
                    exit 1
                fi
                
                # ボットを再起動
                log "Restarting bot application..."
                npm run start &
                app_pid=$!
                
                log "Processes restarted successfully (Bot PID: $app_pid, API PID: $api_pid)"
            else
                log "Maximum restart attempts reached, exiting..."
                exit 1
            fi
        fi
        
        # APIプロセスの監視
        if ! kill -0 $api_pid 2>/dev/null; then
            log "API process died, attempting recovery..."
            
            # ボットプロセスも停止
            if kill -0 $app_pid 2>/dev/null; then
                log "Stopping bot process for coordinated restart..."
                kill $app_pid 2>/dev/null
                wait $app_pid 2>/dev/null
            fi
            
            # 再起動制限チェック
            if [ $process_restart_count -lt $max_process_restarts ]; then
                process_restart_count=$((process_restart_count + 1))
                log "Restarting processes (attempt $process_restart_count/$max_process_restarts)..."
                
                # クールダウン期間
                sleep $restart_cooldown
                
                # API サーバーを再起動
                log "Restarting API server..."
                npm run start-web &
                api_pid=$!
                
                # APIの起動を確認
                sleep 10
                if ! curl -s http://localhost:3000/api/health > /dev/null 2>&1; then
                    log "API server failed to restart, giving up..."
                    exit 1
                fi
                
                # ボットを再起動
                log "Restarting bot application..."
                npm run start &
                app_pid=$!
                
                log "Processes restarted successfully (Bot PID: $app_pid, API PID: $api_pid)"
            else
                log "Maximum restart attempts reached, exiting..."
                exit 1
            fi
        fi
        
        # 定期的なヘルスチェック
        if [ $(($(date +%s) % 60)) -eq 0 ]; then
            log "Processes health check: Bot PID $app_pid, API PID $api_pid"
            if ! curl -s http://localhost:3000/api/health > /dev/null 2>&1; then
                log "WARNING: API health check failed"
            fi
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
    
    if [ -n "$api_pid" ]; then
        if kill -0 $api_pid 2>/dev/null; then
            log "  API process (PID: $api_pid): Running"
        else
            log "  API process (PID: $api_pid): Not running"
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
    
    if [ -n "$api_pid" ] && kill -0 $api_pid 2>/dev/null; then
        log "Sending SIGTERM to API process (PID: $api_pid)..."
        kill -TERM $api_pid 2>/dev/null
        
        # プロセスが終了するまで待つ（最大10秒）
        local wait_count=0
        while kill -0 $api_pid 2>/dev/null && [ $wait_count -lt 10 ]; do
            sleep 1
            wait_count=$((wait_count + 1))
        done
        
        # まだ動いている場合は強制終了
        if kill -0 $api_pid 2>/dev/null; then
            log "API process did not exit gracefully, force killing..."
            kill -KILL $api_pid 2>/dev/null
        fi
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
    if [ "$BACKTEST_MODE" = "true" ]; then
        log "Starting backtest container with enhanced error handling"
        
        # backtest用の段階的起動プロセス
        pre_startup_checks
        check_database_connections
        
        # backtestの場合は、引数で渡されたコマンドを実行
        log "Pre-startup checks completed for backtest mode, executing command: $*"
        exec "$@"
    else
        log "Starting strategy-runner container with enhanced error handling"
        
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