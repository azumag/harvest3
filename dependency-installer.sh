#!/bin/bash

# dependency-installer.sh
# npm依存関係管理・キャッシュクリーンアップ機能
# Issue #5351: entrypoint.shリファクタリング - 単一責任の原則適用

# Issue #5186: YAGNI原則適用 - 簡素化されたPIDベース再起動検出
# シンプルなPIDベース再起動検出関数
check_container_recently_restarted() {
    # /proc/uptimeを使用してコンテナの稼働時間をチェック
    if [ -f /proc/uptime ]; then
        local uptime_seconds=$(cat /proc/uptime | cut -d' ' -f1 | cut -d'.' -f1)
        # 60秒以内の場合は最近再起動したと判定
        if [ "$uptime_seconds" -lt 60 ]; then
            return 0  # 最近再起動した
        fi
    fi
    return 1  # 安定稼働中
}

# Issue #5292レビュー対応: キャッシュクリーンアップの改善
cleanup_npm_cache() {
    local cleanup_success=true
    
    log "Cleaning npm cache for stability..."
    
    if ! npm cache clean --force 2>/dev/null; then
        log "WARNING: npm cache clean failed"
        cleanup_success=false
    fi
    
    if ! rm -rf ~/.npm/_cacache 2>/dev/null; then
        log "WARNING: _cacache removal failed"
        cleanup_success=false
    fi
    
    if [ "$cleanup_success" = "true" ]; then
        log "npm cache cleanup completed successfully"
    else
        log "npm cache cleanup completed with warnings"
    fi
    
    return $cleanup_success
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
# Issue #5292: タイムアウトとエラー処理の強化
# Issue #5186: YAGNI原則適用による簡素化
retry_npm_install_with_backoff() {
    local max_npm_attempts=3
    local npm_install_attempts=0
    local npm_install_success=false
    local max_container_restarts=3
    
    # Issue #5186: 簡素化されたPID基準の再起動検出
    local restart_count=1  # デフォルトは1回目の試行
    if check_container_recently_restarted; then
        restart_count=2  # 最近再起動した場合は2回目とみなす
        log "Container recently restarted, adjusting retry strategy"
    fi
    
    log "Container restart assessment: attempt $restart_count (uptime-based detection)"
    
    # 最大再起動回数に達した場合は依存関係チェックを緩和
    if [ $restart_count -gt $max_container_restarts ]; then
        log "WARNING: Maximum container restart count exceeded. Attempting minimal dependency install..."
        max_npm_attempts=1  # 最小限のリトライに制限
    fi
    
    # Issue #5292: npm install事前チェック強化
    log "Pre-install system check:"
    log "  Disk space available: $(df -h . | tail -1 | awk '{print $4}' || echo 'unknown')"
    log "  Available memory: $(free -h | grep '^Mem:' | awk '{print $7}' || echo 'unknown')"
    log "  npm registry ping test..."
    
    # npm registry接続テスト（5秒タイムアウト）
    if ! timeout 5 npm ping >/dev/null 2>&1; then
        log "WARNING: npm registry ping failed - using offline-first approach"
    fi
    
    while [ $npm_install_attempts -lt $max_npm_attempts ] && [ "$npm_install_success" = false ]; do
        npm_install_attempts=$((npm_install_attempts + 1))
        local attempt_log="/tmp/npm-install-error-${npm_install_attempts}.log"
        # Issue #5292: タイムアウトを短縮して早期検出（120s, 180s, 240s）
        local timeout_seconds=$((120 + npm_install_attempts * 60))
        
        log "Attempting npm install (attempt $npm_install_attempts/$max_npm_attempts, timeout: ${timeout_seconds}s)..."
        
        # Issue #5219: 各試行で異なるオプションを使用（セキュリティ強化：シェルインジェクション対策）
        local npm_options="--no-audit --no-fund --prefer-offline"
        case $npm_install_attempts in
            1) npm_options="$npm_options --no-optional" ;;
            2) npm_options="$npm_options --legacy-peer-deps --no-optional" ;;
            3) npm_options="$npm_options --force --no-optional" ;;
        esac
        
        # セキュリティ: npmオプションの検証（許可された文字のみ）
        if ! echo "$npm_options" | grep -E '^[a-zA-Z0-9 \-]+$' >/dev/null; then
            log "ERROR: Invalid npm options detected, using safe defaults"
            npm_options="--no-audit --no-fund --prefer-offline --no-optional"
        fi
        
        log "  Using npm options: $npm_options"
        
        # Issue #5186: YAGNI原則適用 - 簡素化されたタイムアウト処理
        # 複雑なプロセス監視を単純なtimeoutコマンドに置き換え
        log "Starting npm install with ${timeout_seconds}s timeout..."
        if ! timeout "${timeout_seconds}" npm install $npm_options 2>"$attempt_log"; then
            return 1
        fi
        
        if [ $? -eq 0 ]; then
            log "npm install completed successfully on attempt $npm_install_attempts"
            npm_install_success=true
            # Issue #5186: 簡素化によりファイルベースカウンタ管理不要
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
                local retry_delay=$((npm_install_attempts * 15))  # Issue #5292レビュー対応: 15s, 30s の待機（延長）
                log "Cleaning npm cache and retrying..."
                log "Waiting ${retry_delay}s before retry..."
                
                # Issue #5292レビュー対応: 改善されたキャッシュクリーンアップ
                cleanup_npm_cache || log "Cache cleanup warnings (non-critical)"
                
                sleep $retry_delay
            fi
        fi
    done
    
    # リトライ結果の処理
    if [ "$npm_install_success" = false ]; then
        # Issue #5159: NPMエラー発生時刻を記録（改良版）
        if [ "$BACKTEST_MODE" = "true" ]; then
            local npm_error_marker="/tmp/backtest-npm-error-detection.state"
            echo "$(date +%s)" > "$npm_error_marker"
            chmod 600 "$npm_error_marker"
            log "NPM error recorded for Issue #5159 duplicate message prevention"
            
            # NPMエラー時は明示的にDiscord通知を送信
            send_startup_error_to_discord "NPM installation failed (Issue #5159)" \
                "Container will restart - duplicate message prevention active"
        fi
        
        # Issue #5186: 簡素化された再起動制限チェック
        if [ $restart_count -le $max_container_restarts ]; then
            local error_msg="npm install failed after cache clean and $max_npm_attempts attempts"
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
    
    # Issue #5219: 事前診断情報の収集（強化版）
    log "Pre-install diagnostics:"
    log "  Working directory: $(pwd)"
    log "  Node.js version: $(node --version 2>/dev/null || echo 'Node.js not found')"
    log "  npm version: $(npm --version 2>/dev/null || echo 'npm not found')"
    log "  Disk space: $(df -h . | tail -1 | awk '{print $4}' || echo 'unknown')"
    log "  Memory available: $(free -h | grep '^Mem:' | awk '{print $7}' || echo 'unknown')"
    log "  package.json exists: $([ -f package.json ] && echo 'yes' || echo 'no')"
    log "  node_modules exists: $([ -d node_modules ] && echo 'yes' || echo 'no')"
    log "  npm cache size: $(du -sh ~/.npm 2>/dev/null | cut -f1 || echo 'unknown')"
    
    # Issue #5219: ネットワーク接続性テスト
    log "Network connectivity test:"
    if timeout 10 npm ping >/dev/null 2>&1; then
        log "  npm registry connectivity: OK"
    else
        log "  npm registry connectivity: FAILED - will try alternative approaches"
    fi
    
    # 既存の依存関係チェック
    if check_existing_dependencies; then
        return 0  # 依存関係が既に満たされている
    fi
    
    # Issue #5219: npmキャッシュクリーンアップ（予防的対策）
    log "Cleaning npm cache to prevent stale cache issues..."
    npm cache clean --force 2>/dev/null || log "  npm cache clean failed (non-critical)"
    
    # Issue #5219: npmレジストリ設定の最適化
    log "Optimizing npm configuration for stability..."
    npm config set fetch-retry-mintimeout 20000 2>/dev/null || true
    npm config set fetch-retry-maxtimeout 120000 2>/dev/null || true
    npm config set fetch-retries 5 2>/dev/null || true
    npm config set network-timeout 300000 2>/dev/null || true
    
    # Issue #2559 下位互換性: 最初は固定タイムアウト（300秒）で実行
    log "Attempting initial npm install with fixed timeout (Issue #2559 compatibility)..."
    if timeout 300 npm install --no-audit --no-fund --prefer-offline 2>"$npm_error_log"; then
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
    
    # Issue #5219: 拡張リトライロジックを実行（改良版）
    if ! retry_npm_install_with_backoff; then
        # Issue #5219: 最終的なフォールバック戦略
        log "All npm install attempts failed. Attempting final fallback strategy..."
        
        # 練習モードで重要な依存関係のみインストールを試行
        local critical_deps="ccxt express mongodb redis axios moment"
        log "Attempting to install critical dependencies only: $critical_deps"
        
        if timeout 180 npm install $critical_deps --no-audit --no-fund --prefer-offline 2>/dev/null; then
            log "Critical dependencies installed successfully - continuing with limited functionality"
            log "Warning: Some features may not work due to incomplete dependency installation"
            return 0
        else
            log "Even critical dependency installation failed - container will restart"
            return 1
        fi
    fi
    
    # クリーンアップ (Issue #2559 下位互換性維持)
    rm -f "$npm_error_log" 2>/dev/null || true
    rm -f "$dep_install_error" 2>/dev/null || true  
    rm -f "$dep_check_error" 2>/dev/null || true
    rm -f "$npm_ls_error" 2>/dev/null || true
    rm -f /tmp/npm-check.log /tmp/npm-install-error-*.log 2>/dev/null || true
    
    return 0
}