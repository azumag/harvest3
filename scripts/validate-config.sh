#!/bin/bash

# 設定値検証スクリプト - ドキュメントと実装の乖離を自動検知
# Usage: ./scripts/validate-config.sh [--check-readme-consistency]

set -e

# 色定義
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ログ関数
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }

# 設定値抽出関数
extract_const_value() {
    local key="$1"
    # parseEnvInt関数からデフォルト値を抽出
    local line=$(grep "${key}:" src/common/const.js | head -1)
    
    if [[ $line =~ parseEnvInt\([^,]+,\ *([0-9]+) ]]; then
        echo "${BASH_REMATCH[1]}"
    else
        # parseEnvIntでない場合は通常の値抽出
        echo "$line" | sed 's/.*: *//' | sed 's/[,;].*$//' | sed 's|//.*$||' | sed 's/[ \t]*$//'
    fi
}

extract_readme_value() {
    local key="$1"
    # README.mdから数値設定値を抽出
    local line=$(grep -A 30 "EXCHANGE_SETTINGS.*参考値" README.md | grep "${key}:" | head -1)
    
    if [[ $line =~ ${key}:\ *([0-9]+) ]]; then
        echo "${BASH_REMATCH[1]}"
    else
        # フォールバック: 従来の方法
        echo "$line" | sed 's/.*: *//' | sed 's/[,;].*$//' | sed 's|//.*$||' | sed 's/[ \t]*$//'
    fi
}

# メイン検証
main() {
    log_info "設定値検証開始..."
    
    local exit_code=0
    local check_readme=false
    
    # 引数チェック
    if [[ "$1" == "--check-readme-consistency" ]]; then
        check_readme=true
        log_info "README整合性チェックモード"
    fi
    
    # 1. 基本ファイル存在チェック
    log_info "1. 必須ファイル存在チェック"
    for file in "src/common/const.js" "src/config.js" "README.md"; do
        if [[ ! -f "$file" ]]; then
            log_error "必須ファイルが見つかりません: $file"
            exit_code=1
        else
            log_success "✓ $file"
        fi
    done
    
    # 2. const.js設定値チェック
    log_info "2. const.js設定値取得"
    
    local rate_limit=$(extract_const_value "RATE_LIMIT")
    local timeout=$(extract_const_value "TIMEOUT")
    local max_throttle=$(extract_const_value "MAX_THROTTLE_QUEUE_SIZE")
    local max_concurrent=$(extract_const_value "MAX_CONCURRENT_PAIRS")
    local backoff_delay=$(extract_const_value "BACKOFF_INITIAL_DELAY")
    
    echo "  RATE_LIMIT: ${rate_limit}"
    echo "  TIMEOUT: ${timeout}"
    echo "  MAX_THROTTLE_QUEUE_SIZE: ${max_throttle}"
    echo "  MAX_CONCURRENT_PAIRS: ${max_concurrent}"
    echo "  BACKOFF_INITIAL_DELAY: ${backoff_delay}"
    
    # 3. config.js適用チェック
    log_info "3. config.js適用状況チェック"
    
    local config_throttle_count=$(grep -c "maxThrottleQueueSize" src/config.js || true)
    local config_rate_count=$(grep -c "rateLimit.*EXCHANGE_SETTINGS\|RATE_LIMIT" src/config.js || true)
    
    if [[ $config_throttle_count -lt 1 ]]; then
        log_warn "maxThrottleQueueSizeの設定がconfig.jsに見つかりません"
        exit_code=1
    else
        log_success "✓ maxThrottleQueueSize設定が見つかりました (${config_throttle_count}箇所)"
    fi
    
    # 4. README整合性チェック（オプション）
    if [[ "$check_readme" == "true" ]]; then
        log_info "4. README整合性チェック"
        
        local readme_rate=$(extract_readme_value "RATE_LIMIT")
        local readme_timeout=$(extract_readme_value "TIMEOUT")
        local readme_throttle=$(extract_readme_value "MAX_THROTTLE_QUEUE_SIZE")
        local readme_concurrent=$(extract_readme_value "MAX_CONCURRENT_PAIRS")
        
        echo "README値:"
        echo "  RATE_LIMIT: ${readme_rate}"
        echo "  TIMEOUT: ${readme_timeout}"
        echo "  MAX_THROTTLE_QUEUE_SIZE: ${readme_throttle}"
        echo "  MAX_CONCURRENT_PAIRS: ${readme_concurrent}"
        
        # 乖離チェック
        check_consistency "RATE_LIMIT" "$rate_limit" "$readme_rate" || exit_code=1
        check_consistency "TIMEOUT" "$timeout" "$readme_timeout" || exit_code=1
        check_consistency "MAX_THROTTLE_QUEUE_SIZE" "$max_throttle" "$readme_throttle" || exit_code=1
        check_consistency "MAX_CONCURRENT_PAIRS" "$max_concurrent" "$readme_concurrent" || exit_code=1
    fi
    
    # 5. ランタイム設定チェック（Node.jsが利用可能な場合）
    if command -v node >/dev/null 2>&1; then
        log_info "5. ランタイム設定チェック"
        
        # 設定値を実際に読み込んでチェック
        local runtime_check
        runtime_check=$(timeout 10s node -e "
            try {
                const { EXCHANGE_SETTINGS } = require('./src/common/const.js');
                console.log('MAX_THROTTLE_QUEUE_SIZE=' + EXCHANGE_SETTINGS.MAX_THROTTLE_QUEUE_SIZE);
                console.log('RATE_LIMIT=' + EXCHANGE_SETTINGS.RATE_LIMIT);
                console.log('MAX_CONCURRENT_PAIRS=' + EXCHANGE_SETTINGS.MAX_CONCURRENT_PAIRS);
            } catch (error) {
                console.error('ERROR: ' + error.message);
                process.exit(1);
            }
        " 2>&1)
        
        if [[ $? -eq 0 ]]; then
            log_success "✓ ランタイム設定読み込み成功"
            echo "$runtime_check" | while IFS= read -r line; do
                echo "  $line"
            done
        else
            log_error "ランタイム設定読み込み失敗"
            echo "$runtime_check"
            exit_code=1
        fi
    else
        log_warn "Node.jsが見つかりません。ランタイムチェックをスキップします。"
    fi
    
    # 6. 環境変数チェック
    log_info "6. 環境変数チェック"
    local env_unset_count=0
    
    # 各環境変数を個別にチェック
    if [[ -n "${EXCHANGE_RATE_LIMIT:-}" ]]; then
        log_info "  EXCHANGE_RATE_LIMIT=${EXCHANGE_RATE_LIMIT} (設定済み)"
    else
        echo "  EXCHANGE_RATE_LIMIT=未設定"
        env_unset_count=$((env_unset_count + 1))
    fi
    
    if [[ -n "${EXCHANGE_MAX_CONCURRENT_PAIRS:-}" ]]; then
        log_info "  EXCHANGE_MAX_CONCURRENT_PAIRS=${EXCHANGE_MAX_CONCURRENT_PAIRS} (設定済み)"
    else
        echo "  EXCHANGE_MAX_CONCURRENT_PAIRS=未設定"
        env_unset_count=$((env_unset_count + 1))
    fi
    
    if [[ -n "${EXCHANGE_EXECUTION_DELAY_MS:-}" ]]; then
        log_info "  EXCHANGE_EXECUTION_DELAY_MS=${EXCHANGE_EXECUTION_DELAY_MS} (設定済み)"
    else
        echo "  EXCHANGE_EXECUTION_DELAY_MS=未設定"
        env_unset_count=$((env_unset_count + 1))
    fi
    
    # CI環境や開発環境では環境変数未設定は警告のみ
    if [[ $env_unset_count -gt 0 ]]; then
        if [[ "${CI:-}" == "true" ]]; then
            log_warn "CI環境: ${env_unset_count}個の環境変数が未設定ですが、これは正常です"
        else
            log_warn "開発環境: ${env_unset_count}個の環境変数が未設定ですが、これは正常です"
        fi
    fi
    
    # 7. 最終結果
    if [[ $exit_code -eq 0 ]]; then
        log_success "設定値検証完了: 問題は検出されませんでした"
    else
        log_error "設定値検証完了: 問題が検出されました"
    fi
    
    return $exit_code
}

# 整合性チェック関数
check_consistency() {
    local key="$1"
    local const_val="$2"
    local readme_val="$3"
    
    if [[ "$const_val" != "$readme_val" ]]; then
        log_error "設定値乖離検出: ${key}"
        echo "  const.js: ${const_val}"
        echo "  README.md: ${readme_val}"
        return 1
    else
        log_success "✓ ${key}: 整合性OK"
        return 0
    fi
}

# 実行権限チェック
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
    exit $?
fi