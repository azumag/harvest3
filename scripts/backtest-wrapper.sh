#!/bin/bash

# バックテスト専用ラッパースクリプト
# Issue #5290: entrypoint.shリファクタリング - バックテスト専用機能を分離
# KISS原則に基づく単一責任実装

set -e

# バックテスト固有設定
BACKTEST_STARTUP_LOCK_TIMEOUT=${BACKTEST_STARTUP_LOCK_TIMEOUT:-60}
BACKTEST_VALIDATION_TIMEOUT=${BACKTEST_VALIDATION_TIMEOUT:-30}

# ログ関数
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [BACKTEST-WRAPPER] $1"
}

# Discord通知関数（エラー用）
send_backtest_error_to_discord() {
    local error_message="$1"
    local error_details="$2"
    
    if [ -z "$DISCORD_ERROR_WEBHOOK_URL" ]; then
        log "WARNING: DISCORD_ERROR_WEBHOOK_URL not set, skipping Discord notification"
        return 0
    fi
    
    local discord_message="🚨 **Backtest Container Error**
\`\`\`
Container: $(hostname)
Error: ${error_message}
Details: ${error_details}
Time: $(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")
\`\`\`"

    # Node.js経由でDiscord通知送信
    if command -v node >/dev/null 2>&1; then
        local temp_script=$(mktemp "/tmp/discord_notify_backtest_XXXXXX.js")
        trap "rm -f \"$temp_script\"" EXIT ERR
        
        cat > "$temp_script" << 'EOF'
const fs = require('fs');

async function sendDiscordNotification() {
    try {
        if (!fs.existsSync('package.json')) {
            console.error('package.json not found');
            return false;
        }
        
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
        
        if node "$temp_script" "$discord_message" "10" 2>/dev/null; then
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

# バックテストコマンド検証
validate_backtest_command() {
    local cmd_args=("$@")
    
    log "Validating backtest command arguments..."
    log "Command: ${cmd_args[*]}"
    
    # 引数が存在するかチェック
    if [ ${#cmd_args[@]} -eq 0 ]; then
        log "ERROR: No command arguments provided for backtest execution"
        send_backtest_error_to_discord "Backtest container: No command arguments provided" "Command line: (no args)"
        return 1
    fi
    
    # npm run backtestコマンドの場合の特別な検証
    if [ "${cmd_args[0]}" = "npm" ] && [ "${cmd_args[1]}" = "run" ] && [ "${cmd_args[2]}" = "backtest" ]; then
        log "Validating npm run backtest command..."
        
        # package.jsonのbacktestスクリプト存在確認
        if [ -f "package.json" ]; then
            if grep -q '"backtest"' package.json; then
                log "✓ Backtest script found in package.json"
            else
                log "⚠ WARNING: Backtest script not found in package.json"
                log "Available scripts:"
                if command -v node >/dev/null 2>&1; then
                    node -e "
                        try {
                            const pkg = require('./package.json');
                            const scripts = pkg.scripts || {};
                            Object.keys(scripts).forEach(key => {
                                console.log('  ' + key + ': ' + scripts[key]);
                            });
                        } catch (e) {
                            console.log('  Error reading package.json scripts');
                        }
                    " 2>/dev/null || log "  Could not read package.json scripts"
                fi
            fi
        else
            log "⚠ WARNING: package.json not found"
            return 1
        fi
        
        # backtestRunner.jsファイル存在確認
        if [ -f "src/backtestRunner.js" ]; then
            log "✓ Backtest runner found: src/backtestRunner.js"
        else
            log "⚠ WARNING: Backtest runner not found: src/backtestRunner.js"
            log "Checking for alternative backtest files..."
            
            # 代替のバックテストファイルを探す
            local backtest_files=(
                "src/backtest.js"
                "src/backtesting.js"
                "backtest.js"
                "backtesting.js"
            )
            
            local found_alternative=false
            for file in "${backtest_files[@]}"; do
                if [ -f "$file" ]; then
                    log "✓ Found alternative backtest file: $file"
                    found_alternative=true
                    break
                fi
            done
            
            if [ "$found_alternative" = false ]; then
                log "⚠ WARNING: No backtest files found"
            fi
        fi
        
        # バックテスト用設定ファイルの確認
        local config_files=(
            "config/backtest.json"
            "config/backtest.js"
            "backtest.config.js"
            "backtest.config.json"
        )
        
        for config_file in "${config_files[@]}"; do
            if [ -f "$config_file" ]; then
                log "✓ Found backtest config: $config_file"
            fi
        done
    fi
    
    # 実行権限の確認
    local executable="${cmd_args[0]}"
    if ! command -v "$executable" >/dev/null 2>&1; then
        log "ERROR: Executable '$executable' not found in PATH"
        send_backtest_error_to_discord "Backtest executable not found" "Executable: $executable"
        return 1
    fi
    
    log "✓ Backtest command validation passed"
    return 0
}

# バックテスト環境の事前チェック
check_backtest_environment() {
    log "Checking backtest environment..."
    
    # 作業ディレクトリの確認
    log "Working directory: $(pwd)"
    log "Directory contents:"
    ls -la | head -10 | while read line; do
        log "  $line"
    done
    
    # Node.js環境の確認
    if command -v node >/dev/null 2>&1; then
        log "✓ Node.js version: $(node --version)"
    else
        log "⚠ WARNING: Node.js not found"
        return 1
    fi
    
    if command -v npm >/dev/null 2>&1; then
        log "✓ npm version: $(npm --version)"
    else
        log "⚠ WARNING: npm not found"
        return 1
    fi
    
    # メモリとディスク容量の確認
    log "System resources:"
    log "  Memory: $(free -h | grep '^Mem:' | awk '{print "Used:" $3 " / Available:" $7}' || echo 'unknown')"
    log "  Disk space: $(df -h . | tail -1 | awk '{print "Used:" $3 " / Available:" $4}' || echo 'unknown')"
    
    # 重要なディレクトリの存在確認
    local important_dirs=("src" "config" "data")
    for dir in "${important_dirs[@]}"; do
        if [ -d "$dir" ]; then
            log "✓ Directory exists: $dir"
        else
            log "  Directory missing: $dir (may be optional)"
        fi
    done
    
    log "✓ Backtest environment check completed"
    return 0
}

# バックテスト実行の前処理
prepare_backtest_execution() {
    log "Preparing backtest execution..."
    
    # バックテスト開始時刻を記録
    echo "$(date +%s)" > /tmp/backtest-start-time.marker
    chmod 600 /tmp/backtest-start-time.marker
    log "Backtest start time recorded"
    
    # バックテスト用一時ディレクトリの作成
    local backtest_temp_dir="/tmp/backtest-$$"
    mkdir -p "$backtest_temp_dir"
    chmod 700 "$backtest_temp_dir"
    log "Created backtest temp directory: $backtest_temp_dir"
    
    # クリーンアップのための trap 設定
    trap "cleanup_backtest_execution '$backtest_temp_dir'" EXIT ERR
    
    log "✓ Backtest execution preparation completed"
    return 0
}

# バックテスト実行のクリーンアップ
cleanup_backtest_execution() {
    local temp_dir="$1"
    
    log "Cleaning up backtest execution..."
    
    # 一時ディレクトリのクリーンアップ
    if [ -n "$temp_dir" ] && [ -d "$temp_dir" ]; then
        rm -rf "$temp_dir" 2>/dev/null || true
        log "Removed backtest temp directory: $temp_dir"
    fi
    
    # バックテスト開始時刻マーカーのクリーンアップ
    if [ -f "/tmp/backtest-start-time.marker" ]; then
        rm -f "/tmp/backtest-start-time.marker" 2>/dev/null || true
        log "Removed backtest start time marker"
    fi
    
    log "✓ Backtest execution cleanup completed"
}

# バックテスト実行監視
monitor_backtest_execution() {
    local cmd_args=("$@")
    local monitor_pid=$$
    
    log "Starting backtest execution monitoring..."
    log "Monitor PID: $monitor_pid"
    log "Command: ${cmd_args[*]}"
    
    # バックグラウンドで実行時間を記録
    (
        local start_time=$(date +%s)
        while kill -0 $monitor_pid 2>/dev/null; do
            sleep 30
            local current_time=$(date +%s)
            local elapsed=$((current_time - start_time))
            local elapsed_min=$((elapsed / 60))
            log "Backtest running for ${elapsed_min} minutes (${elapsed}s)"
        done
    ) &
    local monitor_bg_pid=$!
    
    # バックテストコマンドを実行
    log "Executing backtest command..."
    local exit_code=0
    
    # execを使用してプロセスを置き換え（元のentrypoint.shと同じ動作）
    exec "${cmd_args[@]}"
    
    # この行には到達しないが、万が一のためのクリーンアップ
    kill $monitor_bg_pid 2>/dev/null || true
    
    return $exit_code
}

# 統合されたバックテスト前処理
run_backtest_pre_checks() {
    log "Running comprehensive backtest pre-checks..."
    
    # 環境チェック
    if ! check_backtest_environment; then
        log "ERROR: Backtest environment check failed"
        return 1
    fi
    
    # コマンド検証
    if ! validate_backtest_command "$@"; then
        log "ERROR: Backtest command validation failed"
        return 1
    fi
    
    # 実行準備
    if ! prepare_backtest_execution; then
        log "ERROR: Backtest execution preparation failed"
        return 1
    fi
    
    log "✓ All backtest pre-checks passed"
    return 0
}

# メイン関数
main() {
    local cmd_args=("$@")
    
    log "Starting backtest wrapper..."
    log "Arguments: ${cmd_args[*]}"
    
    # バックテスト用環境変数の設定
    export BACKTEST_MODE=true
    log "Set BACKTEST_MODE=true"
    
    # 事前チェック実行
    if ! run_backtest_pre_checks "${cmd_args[@]}"; then
        log "FATAL: Backtest pre-checks failed"
        send_backtest_error_to_discord "Backtest pre-checks failed" "See logs for details"
        exit 1
    fi
    
    # バックテスト実行（監視付き）
    log "Starting monitored backtest execution..."
    monitor_backtest_execution "${cmd_args[@]}"
    
    # この行には到達しない（exec により）
}

# スクリプトが直接実行された場合のみmainを呼び出し
if [ "${BASH_SOURCE[0]}" == "${0}" ]; then
    if [ $# -eq 0 ]; then
        log "Usage: $0 <backtest_command> [args...]"
        log "Example: $0 npm run backtest"
        exit 1
    fi
    main "$@"
fi