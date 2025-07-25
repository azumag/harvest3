#!/bin/bash

# startup-manager.sh
# 起動制御・アプリケーション起動・診断機能
# Issue #5351: entrypoint.shリファクタリング - 単一責任の原則適用

# 依存関係の読み込み
source dependency-installer.sh
source database-connector.sh
source notification-service.sh
source lock-manager.sh

set -e

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
    
    local npm_ls_error_safe="/tmp/npm-ls-error-fallback.log"
    
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
    
    # バックグラウンドプロセスのクリーンアップ
    cleanup_background_processes
    
    # 起動ロックの解放
    release_startup_lock
    
    # Issue #5127: backtest関連のクリーンアップ
    if [ "$BACKTEST_MODE" = "true" ]; then
        cleanup_backtest_locks
    fi
    
    # Issue #5150: startup message lock のクリーンアップ
    cleanup_startup_message_locks
    
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