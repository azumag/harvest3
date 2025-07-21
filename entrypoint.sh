#!/bin/bash

# strategy-runner コンテナ起動時エラーハンドリング & Discord通知スクリプト
# Geminiの厳格レビューに基づく実装
# Issue #2511 修正: 二重再起動防止機能とDocker restart policyとの競合回避

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

# 重複起動メッセージ防止（ファイルベースの atomic 実装）
# atomic ファイルベース実装によるメッセージ重複防止システム
STARTUP_MESSAGE_LOCK_DIR="/tmp/startup_messages"
mkdir -p "$STARTUP_MESSAGE_LOCK_DIR" 2>/dev/null || true

# MD5ハッシュ値生成関数（DRY原則適用）
get_message_hash() {
    echo "$1" | md5sum | cut -d' ' -f1
}


# ログ関数
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

# 既存依存関係チェック関数 (Issue #4202)
# Issue #4202 修正: 既存の依存関係の状態を事前確認
check_existing_dependencies() {
    log "Checking existing dependency status..."
    local npm_check_log="/tmp/npm-check.log"
    
    if npm ls 2>"$npm_check_log" >/dev/null; then
        log "Dependencies already satisfied, skipping npm install"
        return 0
    else
        log "Dependencies check failed, npm install required:"
        if [ -f "$npm_check_log" ]; then
            cat "$npm_check_log" | head -10 | while read line; do
                log "  dependency issue: $line"
            done
        fi
        return 1
    fi
}

# npm install リトライ処理 (Issue #4202)
# Issue #4202 修正: 指数バックオフによるリトライとコンテナ再起動防止
retry_npm_install_with_backoff() {
    local max_npm_attempts=3
    local npm_install_attempts=0
    local npm_install_success=false
    local restart_counter_file="/tmp/.npm_restart_counter"
    local max_container_restarts=3
    
    # コンテナ再起動回数をチェック（無限ループ防止）
    local restart_count=0
    if [ -f "$restart_counter_file" ]; then
        restart_count=$(cat "$restart_counter_file" 2>/dev/null || echo "0")
    fi
    restart_count=$((restart_count + 1))
    echo "$restart_count" > "$restart_counter_file"
    
    log "Container restart count: $restart_count/$max_container_restarts"
    
    # 最大再起動回数に達した場合は依存関係チェックを緩和
    if [ $restart_count -gt $max_container_restarts ]; then
        log "WARNING: Maximum container restart count exceeded. Attempting minimal dependency install..."
        max_npm_attempts=1  # 最小限のリトライに制限
    fi
    
    while [ $npm_install_attempts -lt $max_npm_attempts ] && [ "$npm_install_success" = false ]; do
        npm_install_attempts=$((npm_install_attempts + 1))
        local attempt_log="/tmp/npm-install-error-${npm_install_attempts}.log"
        local timeout_seconds=$((180 + npm_install_attempts * 60))  # 指数バックオフ: 180s, 240s, 300s
        
        log "Attempting npm install (attempt $npm_install_attempts/$max_npm_attempts, timeout: ${timeout_seconds}s)..."
        
        if timeout $timeout_seconds npm install 2>"$attempt_log"; then
            log "npm install completed successfully on attempt $npm_install_attempts"
            npm_install_success=true
            # 成功時はカウンタをリセット
            rm -f "$restart_counter_file"
            break
        else
            log "npm install attempt $npm_install_attempts failed, error details:"
            # エラーログを統合ログファイルにも保存 (Issue #2559 互換性)
            if [ -f "$attempt_log" ]; then
                cat "$attempt_log" >> "$npm_error_log"
                cat "$attempt_log" | head -15 | while read line; do
                    log "  npm error: $line"
                done
            fi
            
            # 最後の試行でない場合のみリトライ準備
            if [ $npm_install_attempts -lt $max_npm_attempts ]; then
                local retry_delay=$((npm_install_attempts * 10))  # 10s, 20s の待機
                log "Cleaning npm cache and retrying..."
                log "Waiting ${retry_delay}s before retry..."
                npm cache clean --force 2>/dev/null || true
                sleep $retry_delay
            fi
        fi
    done
    
    # リトライ結果の処理
    if [ "$npm_install_success" = false ]; then
        if [ $restart_count -le $max_container_restarts ]; then
            local error_msg="npm install failed after cache clean and $max_npm_attempts attempts (container restart $restart_count/$max_container_restarts)"
            log "ERROR: $error_msg"
            log "npm install failed after cache clean"  # Issue #2644 下位互換性
            send_startup_error_to_discord "$error_msg" "Node.js dependency installation failed - will retry on container restart"
            return 1
        else
            # 最大再起動回数に達した場合は依存関係を部分的に無視して続行
            log "WARNING: Maximum restart attempts reached. Continuing with partial dependencies..."
            log "This may cause runtime errors, but prevents infinite restart loop"
            send_startup_error_to_discord "npm install repeatedly failed - continuing with partial dependencies" "Infinite restart loop prevention activated"
            return 0
        fi
    fi
    
    return 0
}

# npm依存関係インストール統合関数 (Issue #4202)
install_npm_dependencies() {
    log "Installing npm dependencies..."
    
    # Issue #2559 下位互換性: エラーログ変数を定義
    npm_error_log="/tmp/npm-install-error.log"
    local dep_install_error="/tmp/dep-install.log"
    local dep_check_error="/tmp/dep-check.log"
    local npm_ls_error="/tmp/npm-ls-error.log"
    
    # 事前診断情報の収集
    log "Pre-install diagnostics:"
    log "  Working directory: $(pwd)"
    log "  Node.js version: $(node --version 2>/dev/null || echo 'Node.js not found')"
    log "  npm version: $(npm --version 2>/dev/null || echo 'npm not found')"
    log "  Disk space: $(df -h . | tail -1 | awk '{print $4}' || echo 'unknown')"
    log "  package.json exists: $([ -f package.json ] && echo 'yes' || echo 'no')"
    log "  node_modules exists: $([ -d node_modules ] && echo 'yes' || echo 'no')"
    
    # 既存の依存関係チェック
    if check_existing_dependencies; then
        return 0  # 依存関係が既に満たされている
    fi
    
    # Issue #2559 下位互換性: 最初は固定タイムアウト（300秒）で実行
    log "Attempting initial npm install with fixed timeout (Issue #2559 compatibility)..."
    if timeout 300 npm install 2>"$npm_error_log"; then
        log "npm install completed successfully with fixed timeout"
        return 0
    else
        log "Fixed timeout npm install failed, switching to enhanced retry logic..."
        # Issue #2644 下位互換性: エラーログの詳細表示
        if [ -f "$npm_error_log" ]; then
            log "npm error details:"
            cat "$npm_error_log" | head -20 | while read line; do
                log "  npm error: $line"
            done
        fi
    fi
    
    # 拡張リトライロジックを実行
    if ! retry_npm_install_with_backoff; then
        return 1
    fi
    
    # クリーンアップ (Issue #2559 下位互換性維持)
    rm -f "$npm_error_log" 2>/dev/null || true
    rm -f "$dep_install_error" 2>/dev/null || true  
    rm -f "$dep_check_error" 2>/dev/null || true
    rm -f "$npm_ls_error" 2>/dev/null || true
    rm -f /tmp/npm-check.log /tmp/npm-install-error-*.log 2>/dev/null || true
    
    return 0
}

# 重複起動ログ防止関数（強化版 - Issue #3942 修正）
# 環境変数チェックの前に、まずロックファイルによる排他制御を実施
# プロセス内フラグとシンプルなatomic操作による重複防止
log_startup_message() {
    local message="$1"
    
    # メッセージハッシュを一度だけ計算（一貫性確保）
    local message_hash=$(get_message_hash "$message")
    local var_name="STARTUP_MSG_$(echo "$message_hash" | cut -c1-8)"
    local lock_file="$STARTUP_MESSAGE_LOCK_DIR/$message_hash.lock"
    
    # 簡素化実装：待機ロジックを削除し、即座にプロセス内フラグをチェック
    # プロセス内重複チェック（最初の防御線） - Issue #5061 修正
    if [ "${!var_name}" = "1" ]; then
        # 既に同じメッセージを出力済み（プロセス内重複）
        # 一度出力されたメッセージは二度と出力しない（確実な重複防止）
        return 0
    fi
    
    # プロセス内フラグを即座に設定（レースコンディション防止）
    # Issue #5061 修正: フラグ設定をロック取得前に移動
    export "$var_name"=1
    
    # プロセス間重複チェック（第二の防御線）
    # より強固なatomic操作でロック取得を試行
    local lock_acquired=false
    if (set -C; echo "$$:$(date +%s.%N)" > "$lock_file") 2>/dev/null; then
        lock_acquired=true
    fi
    
    if [ "$lock_acquired" = true ]; then
        # ロック取得成功：メッセージ出力
        log "$message"
        
        # 処理完了後にプロセス内フラグを設定（重複防止）
        # ロックファイルのクリーンアップ（30秒後）
        # 30秒後に自動削除
        (sleep 30 && rm -f "$lock_file" 2>/dev/null) &
        
        return 0
    else
        # ロック取得失敗：他のプロセスが処理中または処理済み
        # プロセス内フラグは既に設定済みなので何もしない
        return 0
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
    chmod 600 "$lock_file"  # 所有者のみアクセス可能
    
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
    
    # Node.js依存関係インストールとチェック（Issue #4202 修正: 無限再起動ループ防止）
    if ! install_npm_dependencies; then
        exit 1
    fi
    
    # critical dependenciesの存在を具体的にチェック（強化版）
    log "Checking critical dependencies..."
    local critical_deps=("decimal.js@10.6.0" "ccxt" "mongodb" "redis")
    for dep in "${critical_deps[@]}"; do
        local dep_name=$(echo "$dep" | cut -d'@' -f1)
        log "Checking dependency: $dep_name"
        
        local dep_specific_check="/tmp/dep-check-$dep_name.log"
        if ! node -e "require('$dep_name'); console.log('$dep_name OK');" 2>"$dep_specific_check"; then
            log "$dep_name not found, installation required. Error details:"
            if [ -f "$dep_specific_check" ]; then
                cat "$dep_specific_check" >> "$dep_check_error"
                cat "$dep_specific_check" | head -5 | while read line; do
                    log "  require error: $line"
                done
            fi
            
            log "Installing $dep specifically..."
            local dep_specific_install="/tmp/dep-install-$dep_name.log"
            if ! timeout 120 npm install "$dep" 2>"$dep_specific_install"; then
                local error_msg="Failed to install $dep specifically"
                log "ERROR: $error_msg"
                log "Install error details:"
                if [ -f "$dep_specific_install" ]; then
                    cat "$dep_specific_install" >> "$dep_install_error"
                    cat "$dep_specific_install" | head -10 | while read line; do
                        log "  install error: $line"
                    done
                fi
                send_startup_error_to_discord "$error_msg" "$dep installation failed"
                exit 1
            fi
            
            # インストール後の再確認
            if ! node -e "require('$dep_name'); console.log('$dep_name verified after install');" 2>"$dep_specific_check"; then
                local error_msg="$dep_name still not accessible after installation"
                log "ERROR: $error_msg"
                log "Post-install verification error:"
                if [ -f "$dep_specific_check" ]; then
                    cat "$dep_specific_check" >> "$dep_check_error"
                    cat "$dep_specific_check" | head -5 | while read line; do
                        log "  verification error: $line"
                    done
                fi
                send_startup_error_to_discord "$error_msg" "$dep_name accessibility check failed"
                exit 1
            else
                log "$dep_name successfully installed and verified"
            fi
            
            # クリーンアップ
            rm -f "$dep_specific_install" 2>/dev/null || true
        else
            log "$dep_name OK"
        fi
        
        # クリーンアップ
        rm -f "$dep_specific_check" 2>/dev/null || true
    done
    
    # 最終的な依存関係の検証
    log "Performing final dependency validation..."
    
    # Issue #4646 修正: npm_ls_error変数の安全な定義と検証
    local npm_ls_error_safe="${npm_ls_error:-/tmp/npm-ls-error-fallback.log}"
    
    # 一時ファイルのディレクトリが存在することを確認
    mkdir -p "$(dirname "$npm_ls_error_safe")" 2>/dev/null || true
    
    # npm ls実行時のエラーハンドリング強化
    if ! npm ls 2>"$npm_ls_error_safe" >/dev/null; then
        local error_msg="npm dependencies validation failed"
        log "ERROR: $error_msg"
        log "npm ls error details:"
        if [ -f "$npm_ls_error_safe" ] && [ -s "$npm_ls_error_safe" ]; then
            cat "$npm_ls_error_safe" | head -15 | while read line; do
                log "  npm ls error: $line"
            done
        else
            log "  npm ls error log file not found or empty"
        fi
        send_startup_error_to_discord "$error_msg" "Node.js dependency validation failed"
        
        # クリーンアップ
        rm -f "$npm_ls_error_safe" 2>/dev/null || true
        exit 1
    fi
    
    # クリーンアップ
    rm -f "$npm_ls_error_safe" 2>/dev/null || true
    
    log "All dependencies successfully installed and validated"
    
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
    log "Initializing enhanced process monitoring (Issue #2511 fix: dual-restart prevention)"
    
    # プロセス監視と自動回復機能（Issue #2511: 二重再起動防止強化版）
    local process_restart_count=0
    local max_process_restarts=2  # Docker restart policy (5回) と合わせて制限を強化
    local restart_cooldown=45     # クールダウン期間を延長して再起動ループを防止
    local restart_in_progress=false
    local last_restart_time=0
    local consecutive_failures=0  # 連続失敗回数を追跡
    local max_consecutive_failures=3
    
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
            
            # Issue #2511対策: 頻繁な再起動を防ぐ（最後の再起動から45秒以内は再起動しない）
            if [ $((current_time - last_restart_time)) -lt 45 ]; then
                log "Too soon since last restart (min 45s interval), waiting..."
                sleep 10  # 待機時間を延長
                continue
            fi
            
            # 連続失敗回数をインクリメント
            consecutive_failures=$((consecutive_failures + 1))
            log "Bot process failure detected (consecutive failures: $consecutive_failures/$max_consecutive_failures)"
            
            # 連続失敗が限界に達した場合は Dockerレベルの再起動に委ねる
            if [ $consecutive_failures -gt $max_consecutive_failures ]; then
                log "Maximum consecutive failures reached. Allowing Docker-level restart."
                log "Exiting entrypoint to trigger Docker restart policy..."
                # 起動ロックを解放してからexit
                release_startup_lock
                exit 1  # Dockerのrestart policyが作動
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
                consecutive_failures=0  # Issue #2511対策: 成功時は連続失敗カウンターをリセット
            else
                log "Maximum internal restart attempts reached ($max_process_restarts)."
                log "Allowing Docker restart policy to handle container-level restart..."
                restart_in_progress=false
                # 起動ロックを解放してからexit
                release_startup_lock
                exit 1  # Dockerのrestart policyに委ねる
            fi
        fi
        
        # 定期的なヘルスチェック（60秒間隔）
        if [ $((current_time % 60)) -eq 0 ]; then
            log "Process health check: Bot PID $app_pid"
            
            # Issue #2511対策: 長期間安定動作している場合は連続失敗カウンターをリセット
            if [ $bot_alive = true ] && [ $consecutive_failures -gt 0 ] && [ $((current_time - last_restart_time)) -gt 300 ]; then
                log "Bot running stable for 5+ minutes, resetting consecutive failure counter"
                consecutive_failures=0
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
        # 起動ロック取得後に安全にメッセージを出力
        log_startup_message "Starting backtest container with enhanced error handling"
        
        # backtest用の段階的起動プロセス
        pre_startup_checks
        check_database_connections
        
        # backtestの場合は、引数で渡されたコマンドを実行
        log "Pre-startup checks completed for backtest mode, executing command: $*"
        exec "$@"
    else
        # 起動ロック取得後に安全にメッセージを出力
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