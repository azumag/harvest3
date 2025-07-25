#!/bin/bash

# NPM依存関係管理専用スクリプト
# Issue #5290: entrypoint.shリファクタリング - NPM関連機能を分離
# KISS原則に基づく単一責任実装

set -e

# NPM設定（環境変数で上書き可能）
NPM_ERROR_SUPPRESS_DURATION=${NPM_ERROR_SUPPRESS_DURATION:-60}
MAX_NPM_ATTEMPTS=${MAX_NPM_ATTEMPTS:-3}
NPM_REGISTRY_TIMEOUT=${NPM_REGISTRY_TIMEOUT:-10}

# ログ関数
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [NPM-HANDLER] $1"
}

# 既存依存関係チェック関数
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

# npmキャッシュクリーンアップ
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
    
    return 0
}

# シンプルなコンテナ再起動検出
check_container_recently_restarted() {
    if [ -f /proc/uptime ]; then
        local uptime_seconds=$(cat /proc/uptime | cut -d' ' -f1 | cut -d'.' -f1)
        # 60秒以内の場合は最近再起動したと判定
        if [ "$uptime_seconds" -lt 60 ]; then
            return 0  # 最近再起動した
        fi
    fi
    return 1  # 安定稼働中
}

# npm install リトライ処理（簡素化版）
retry_npm_install_with_backoff() {
    local max_npm_attempts=$MAX_NPM_ATTEMPTS
    local npm_install_attempts=0
    local npm_install_success=false
    local max_container_restarts=3
    
    # 簡素化されたPID基準の再起動検出
    local restart_count=1
    if check_container_recently_restarted; then
        restart_count=2
        log "Container recently restarted, adjusting retry strategy"
    fi
    
    log "Container restart assessment: attempt $restart_count (uptime-based detection)"
    
    # 最大再起動回数に達した場合は依存関係チェックを緩和
    if [ $restart_count -gt $max_container_restarts ]; then
        log "WARNING: Maximum container restart count exceeded. Attempting minimal dependency install..."
        max_npm_attempts=1
    fi
    
    # npm install事前チェック
    log "Pre-install system check:"
    log "  Disk space available: $(df -h . | tail -1 | awk '{print $4}' || echo 'unknown')"
    log "  Available memory: $(free -h | grep '^Mem:' | awk '{print $7}' || echo 'unknown')"
    log "  npm registry ping test..."
    
    # npm registry接続テスト
    if ! timeout 5 npm ping >/dev/null 2>&1; then
        log "WARNING: npm registry ping failed - using offline-first approach"
    fi
    
    while [ $npm_install_attempts -lt $max_npm_attempts ] && [ "$npm_install_success" = false ]; do
        npm_install_attempts=$((npm_install_attempts + 1))
        local attempt_log="/tmp/npm-install-error-${npm_install_attempts}.log"
        local timeout_seconds=$((120 + npm_install_attempts * 60))
        
        log "Attempting npm install (attempt $npm_install_attempts/$max_npm_attempts, timeout: ${timeout_seconds}s)..."
        
        # 各試行で異なるオプションを使用
        local npm_options="--no-audit --no-fund --prefer-offline"
        case $npm_install_attempts in
            1) npm_options="$npm_options --no-optional" ;;
            2) npm_options="$npm_options --legacy-peer-deps --no-optional" ;;
            3) npm_options="$npm_options --force --no-optional" ;;
        esac
        
        # セキュリティ: npmオプションの検証
        if ! echo "$npm_options" | grep -E '^[a-zA-Z0-9 \-]+$' >/dev/null; then
            log "ERROR: Invalid npm options detected, using safe defaults"
            npm_options="--no-audit --no-fund --prefer-offline --no-optional"
        fi
        
        log "  Using npm options: $npm_options"
        
        # 簡素化されたタイムアウト処理
        log "Starting npm install with ${timeout_seconds}s timeout..."
        if timeout "${timeout_seconds}" npm install $npm_options 2>"$attempt_log"; then
            log "npm install completed successfully on attempt $npm_install_attempts"
            npm_install_success=true
            break
        else
            log "npm install attempt $npm_install_attempts failed, error details:"
            if [ -f "$attempt_log" ]; then
                cat "$attempt_log" | head -15 | while read line; do
                    log "  npm error: $line"
                done
            fi
            
            # 最後の試行でない場合のみリトライ準備
            if [ $npm_install_attempts -lt $max_npm_attempts ]; then
                local retry_delay=$((npm_install_attempts * 15))
                log "Cleaning npm cache and retrying..."
                log "Waiting ${retry_delay}s before retry..."
                
                cleanup_npm_cache || log "Cache cleanup warnings (non-critical)"
                sleep $retry_delay
            fi
        fi
    done
    
    # リトライ結果の処理
    if [ "$npm_install_success" = false ]; then
        # 最大再起動回数に達した場合は依存関係を部分的に無視して続行
        if [ $restart_count -le $max_container_restarts ]; then
            local error_msg="npm install failed after cache clean and $max_npm_attempts attempts"
            log "ERROR: $error_msg"
            return 1
        else
            log "WARNING: Maximum restart attempts reached. Continuing with partial dependencies..."
            log "This may cause runtime errors, but prevents infinite restart loop"
            return 0
        fi
    fi
    
    return 0
}

# critical dependencies検証
verify_critical_dependencies() {
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
                rm -f "$dep_specific_install" 2>/dev/null || true
                rm -f "$dep_specific_check" 2>/dev/null || true
                return 1
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
                rm -f "$dep_specific_install" 2>/dev/null || true
                rm -f "$dep_specific_check" 2>/dev/null || true
                return 1
            else
                log "$dep_name successfully installed and verified"
            fi
            
            rm -f "$dep_specific_install" 2>/dev/null || true
        else
            log "$dep_name OK"
        fi
        
        rm -f "$dep_specific_check" 2>/dev/null || true
    done
    
    return 0
}

# npm依存関係インストール統合関数
install_npm_dependencies() {
    log "Installing npm dependencies..."
    
    # 事前診断情報の収集
    log "Pre-install diagnostics:"
    log "  Working directory: $(pwd)"
    log "  Node.js version: $(node --version 2>/dev/null || echo 'Node.js not found')"
    log "  npm version: $(npm --version 2>/dev/null || echo 'npm not found')"
    log "  Disk space: $(df -h . | tail -1 | awk '{print $4}' || echo 'unknown')"
    log "  Memory available: $(free -h | grep '^Mem:' | awk '{print $7}' || echo 'unknown')"
    log "  package.json exists: $([ -f package.json ] && echo 'yes' || echo 'no')"
    log "  node_modules exists: $([ -d node_modules ] && echo 'yes' || echo 'no')"
    log "  npm cache size: $(du -sh ~/.npm 2>/dev/null | cut -f1 || echo 'unknown')"
    
    # ネットワーク接続性テスト
    log "Network connectivity test:"
    if timeout $NPM_REGISTRY_TIMEOUT npm ping >/dev/null 2>&1; then
        log "  npm registry connectivity: OK"
    else
        log "  npm registry connectivity: FAILED - will try alternative approaches"
    fi
    
    # 既存の依存関係チェック
    if check_existing_dependencies; then
        return 0
    fi
    
    # npmキャッシュクリーンアップ（予防的対策）
    log "Cleaning npm cache to prevent stale cache issues..."
    npm cache clean --force 2>/dev/null || log "  npm cache clean failed (non-critical)"
    
    # npmレジストリ設定の最適化
    log "Optimizing npm configuration for stability..."
    npm config set fetch-retry-mintimeout 20000 2>/dev/null || true
    npm config set fetch-retry-maxtimeout 120000 2>/dev/null || true
    npm config set fetch-retries 5 2>/dev/null || true
    npm config set network-timeout 300000 2>/dev/null || true
    
    # 固定タイムアウトで実行
    local npm_error_log="/tmp/npm-install-error.log"
    log "Attempting initial npm install with fixed timeout..."
    if timeout 300 npm install --no-audit --no-fund --prefer-offline 2>"$npm_error_log"; then
        log "npm install completed successfully with fixed timeout"
        rm -f "$npm_error_log" 2>/dev/null || true
        return 0
    else
        log "Fixed timeout npm install failed, switching to enhanced retry logic..."
        if [ -f "$npm_error_log" ]; then
            log "npm error details:"
            cat "$npm_error_log" | head -20 | while read line; do
                log "  npm error: $line"
            done
        fi
        rm -f "$npm_error_log" 2>/dev/null || true
    fi
    
    # 拡張リトライロジックを実行
    if ! retry_npm_install_with_backoff; then
        # 最終的なフォールバック戦略
        log "All npm install attempts failed. Attempting final fallback strategy..."
        
        # 重要な依存関係のみインストールを試行
        local critical_deps="ccxt express mongodb redis axios moment"
        log "Attempting to install critical dependencies only: $critical_deps"
        
        if timeout 180 npm install $critical_deps --no-audit --no-fund --prefer-offline 2>/dev/null; then
            log "Critical dependencies installed successfully - continuing with limited functionality"
            log "Warning: Some features may not work due to incomplete dependency installation"
            return 0
        else
            log "Even critical dependency installation failed"
            return 1
        fi
    fi
    
    # critical dependencies検証
    if ! verify_critical_dependencies; then
        log "Critical dependencies verification failed"
        return 1
    fi
    
    # 最終的な依存関係の検証
    log "Performing final dependency validation..."
    local npm_ls_error="/tmp/npm-ls-error.log"
    
    if ! npm ls 2>"$npm_ls_error" >/dev/null; then
        local error_msg="npm dependencies validation failed"
        log "ERROR: $error_msg"
        log "npm ls error details:"
        if [ -f "$npm_ls_error" ] && [ -s "$npm_ls_error" ]; then
            cat "$npm_ls_error" | head -15 | while read line; do
                log "  npm ls error: $line"
            done
        else
            log "  npm ls error log file not found or empty"
        fi
        rm -f "$npm_ls_error" 2>/dev/null || true
        return 1
    fi
    
    rm -f "$npm_ls_error" 2>/dev/null || true
    log "All dependencies successfully installed and validated"
    
    return 0
}

# クリーンアップ
cleanup_npm_temp_files() {
    log "Cleaning up temporary npm files..."
    rm -f /tmp/npm-check.log /tmp/npm-install-error-*.log /tmp/dep-*.log 2>/dev/null || true
}

# メイン関数
main() {
    log "Starting NPM dependency management..."
    
    # 引数処理
    case "${1:-install}" in
        "install")
            if install_npm_dependencies; then
                log "NPM dependency installation completed successfully"
                cleanup_npm_temp_files
                exit 0
            else
                log "NPM dependency installation failed"
                cleanup_npm_temp_files
                exit 1
            fi
            ;;
        "check")
            if check_existing_dependencies; then
                log "Dependencies are satisfied"
                exit 0
            else
                log "Dependencies need installation"
                exit 1
            fi
            ;;
        "verify")
            if verify_critical_dependencies; then
                log "Critical dependencies verified"
                exit 0
            else
                log "Critical dependencies verification failed"
                exit 1
            fi
            ;;
        *)
            log "Usage: $0 [install|check|verify]"
            exit 1
            ;;
    esac
}

# スクリプトが直接実行された場合のみmainを呼び出し
if [ "${BASH_SOURCE[0]}" == "${0}" ]; then
    main "$@"
fi