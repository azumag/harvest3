#!/bin/bash

# strategy-runner コンテナ起動時エラーハンドリング & Discord通知スクリプト
# Geminiの厳格レビューに基づく実装

set -e  # エラー時即座終了

# 設定（環境変数で上書き可能）
CONTAINER_NAME="strategy-runner"
MAX_STARTUP_TIME=${MAX_STARTUP_TIME:-60}  # 最大起動時間（秒）
HEALTH_CHECK_INTERVAL=${HEALTH_CHECK_INTERVAL:-5}  # ヘルスチェック間隔（秒）
API_STARTUP_TIMEOUT=${API_STARTUP_TIMEOUT:-60}  # APIサーバー起動タイムアウト（秒）
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
        return
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
        node -e "
            const { execSync } = require('child_process');
            const fs = require('fs');
            
            try {
                // package.jsonの存在確認
                if (!fs.existsSync('package.json')) {
                    console.error('package.json not found');
                    process.exit(1);
                }
                
                // axiosの利用可能性確認
                try {
                    require('axios');
                } catch (e) {
                    console.error('axios module not available:', e.message);
                    process.exit(1);
                }
                
                const axios = require('axios');
                const webhookUrl = process.env.DISCORD_ERROR_WEBHOOK_URL;
                const message = { content: \`${discord_message}\` };
                
                axios.post(webhookUrl, message, { timeout: ${DISCORD_NOTIFICATION_TIMEOUT}000 })
                    .then(() => console.log('Discord notification sent successfully'))
                    .catch(err => {
                        console.error('Discord notification failed:', err.message);
                        process.exit(1);
                    });
            } catch (error) {
                console.error('Discord notification script error:', error.message);
                process.exit(1);
            }
        " 2>/dev/null || log "ERROR: Failed to send Discord notification"
    else
        log "ERROR: Node.js not available for Discord notification"
    fi
}

# 起動前チェック
pre_startup_checks() {
    log "Performing pre-startup checks..."
    
    # 必須環境変数チェック
    local required_vars=("REDIS_URL" "MONGO_URL" "MONGO_DB_NAME")
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
    
    # decimal.jsの存在を具体的にチェック
    if ! node -e "require('decimal.js'); console.log('decimal.js OK');" 2>/dev/null; then
        log "decimal.js not found, installing specifically..."
        if ! npm install decimal.js@10.6.0; then
            local error_msg="Failed to install decimal.js specifically"
            log "ERROR: $error_msg"
            send_startup_error_to_discord "$error_msg" "decimal.js installation failed"
            exit 1
        fi
    fi
    
    if ! npm ls > /dev/null 2>&1; then
        local error_msg="npm dependencies validation failed"
        log "ERROR: $error_msg"
        send_startup_error_to_discord "$error_msg" "Node.js dependency validation failed"
        exit 1
    fi
    
    log "Pre-startup checks completed successfully"
}

# データベース接続チェック
check_database_connections() {
    log "Checking database connections..."
    
    # Redis接続チェック
    if ! node -e "
        const redis = require('redis');
        const client = redis.createClient({url: process.env.REDIS_URL});
        client.connect()
            .then(() => { console.log('Redis connection OK'); process.exit(0); })
            .catch(err => { console.error('Redis connection failed:', err.message); process.exit(1); });
        setTimeout(() => { console.error('Redis connection timeout'); process.exit(1); }, ${DATABASE_CONNECTION_TIMEOUT}000);
    " 2>/dev/null; then
        local error_msg="Redis connection failed"
        log "ERROR: $error_msg"
        send_startup_error_to_discord "$error_msg" "Database connectivity check failed"
        exit 1
    fi
    
    # MongoDB接続チェック
    if ! node -e "
        const { MongoClient } = require('mongodb');
        const client = new MongoClient(process.env.MONGO_URL);
        client.connect()
            .then(() => { console.log('MongoDB connection OK'); return client.close(); })
            .then(() => process.exit(0))
            .catch(err => { console.error('MongoDB connection failed:', err.message); process.exit(1); });
        setTimeout(() => { console.error('MongoDB connection timeout'); process.exit(1); }, ${DATABASE_CONNECTION_TIMEOUT}000);
    " 2>/dev/null; then
        local error_msg="MongoDB connection failed"
        log "ERROR: $error_msg"
        send_startup_error_to_discord "$error_msg" "Database connectivity check failed"
        exit 1
    fi
    
    log "Database connections verified successfully"
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
    
    # 両方のプロセスを監視
    while true; do
        if ! kill -0 $app_pid 2>/dev/null; then
            log "Bot process died, exiting..."
            kill $api_pid 2>/dev/null
            exit 1
        fi
        if ! kill -0 $api_pid 2>/dev/null; then
            log "API process died, exiting..."
            kill $app_pid 2>/dev/null
            exit 1
        fi
        sleep 5
    done
}

# シグナルハンドラー
cleanup() {
    log "Received termination signal, shutting down gracefully..."
    # 必要に応じてクリーンアップ処理
    exit 0
}

trap cleanup SIGTERM SIGINT

# メイン実行
main() {
    log "Starting strategy-runner container with enhanced error handling"
    
    # 段階的起動プロセス
    pre_startup_checks
    check_database_connections
    start_application
}

# エラーハンドリング付きメイン実行
if ! main; then
    exit_code=$?
    log "FATAL: Container startup failed with exit code $exit_code"
    send_startup_error_to_discord "Container startup failed" "Exit code: $exit_code"
    exit $exit_code
fi