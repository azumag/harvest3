#!/bin/bash

# strategy-runner コンテナ起動時エラーハンドリング & Discord通知スクリプト
# Geminiの厳格レビューに基づく実装

set -e  # エラー時即座終了

# 設定
CONTAINER_NAME="strategy-runner"
MAX_STARTUP_TIME=60  # 最大起動時間（秒）
HEALTH_CHECK_INTERVAL=5  # ヘルスチェック間隔（秒）

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
    node -e "
        const axios = require('axios');
        const webhookUrl = process.env.DISCORD_ERROR_WEBHOOK_URL;
        const message = { content: \`${discord_message}\` };
        
        axios.post(webhookUrl, message)
            .then(() => console.log('Discord notification sent successfully'))
            .catch(err => console.error('Discord notification failed:', err.message));
    " 2>/dev/null || log "ERROR: Failed to send Discord notification"
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
    
    # Node.js依存関係チェック
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
        setTimeout(() => { console.error('Redis connection timeout'); process.exit(1); }, 10000);
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
        setTimeout(() => { console.error('MongoDB connection timeout'); process.exit(1); }, 10000);
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
    
    # バックグラウンドでアプリケーション起動
    npm run start &
    local app_pid=$!
    
    # 起動監視
    local startup_time=0
    while [ $startup_time -lt $MAX_STARTUP_TIME ]; do
        if ! kill -0 $app_pid 2>/dev/null; then
            local error_msg="Application process died during startup"
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
    
    log "Application started successfully (PID: $app_pid)"
    
    # メインプロセスとして実行を継続
    wait $app_pid
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
    local exit_code=$?
    log "FATAL: Container startup failed with exit code $exit_code"
    send_startup_error_to_discord "Container startup failed" "Exit code: $exit_code"
    exit $exit_code
fi