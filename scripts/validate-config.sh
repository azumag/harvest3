#!/bin/bash

# 設定値検証スクリプト - ソースコード設定の検証
# Usage: ./scripts/validate-config.sh

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

# 環境変数チェック関数
check_env_var() {
    local var_name="$1"
    local var_value="$2"
    if [[ -n "$var_value" ]]; then
        log_info "  $var_name=$var_value (設定済み)"
        return 0
    else
        echo "  $var_name=未設定"
        return 1
    fi
}

# メイン検証
main() {
    log_info "設定値検証開始..."
    log_info "ソースコード検証モード"
    
    local exit_code=0
    
    # 1. 基本ファイル存在チェック
    log_info "1. 必須ファイル存在チェック"
    for file in "src/common/const.js" "src/config.js"; do
        if [[ ! -f "$file" ]]; then
            log_error "必須ファイルが見つかりません: $file"
            exit_code=1
        else
            log_success "✓ $file"
        fi
    done
    
    # 2. const.js設定値チェック
    log_info "2. const.js設定値取得"
    
    # 設定値配列を使用してDRY原則に準拠
    declare -a CONFIG_KEYS=("RATE_LIMIT" "TIMEOUT" "MAX_THROTTLE_QUEUE_SIZE" "MAX_CONCURRENT_PAIRS" "BACKOFF_INITIAL_DELAY")
    
    for key in "${CONFIG_KEYS[@]}"; do
        local value=$(extract_const_value "$key")
        echo "  $key: $value"
        
        # 基本的な妥当性チェック
        if [[ ! "$value" =~ ^[0-9]+$ ]]; then
            log_warn "$key の値が数値ではありません: $value"
        fi
    done
    
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
    
    # 4. 環境変数チェック
    log_info "4. 環境変数チェック"
    local env_unset_count=0
    
    # 環境変数配列を使用してDRY原則に準拠
    declare -a ENV_VAR_NAMES=("EXCHANGE_RATE_LIMIT" "EXCHANGE_MAX_CONCURRENT_PAIRS" "EXCHANGE_EXECUTION_DELAY_MS")
    
    for var_name in "${ENV_VAR_NAMES[@]}"; do
        local var_value
        case "$var_name" in
            "EXCHANGE_RATE_LIMIT") var_value="${EXCHANGE_RATE_LIMIT:-}" ;;
            "EXCHANGE_MAX_CONCURRENT_PAIRS") var_value="${EXCHANGE_MAX_CONCURRENT_PAIRS:-}" ;;
            "EXCHANGE_EXECUTION_DELAY_MS") var_value="${EXCHANGE_EXECUTION_DELAY_MS:-}" ;;
        esac
        
        if ! check_env_var "$var_name" "$var_value"; then
            env_unset_count=$((env_unset_count + 1))
        fi
    done
    
    # CI環境や開発環境では環境変数未設定は警告のみ
    if [[ $env_unset_count -gt 0 ]]; then
        if [[ "${CI:-}" == "true" ]]; then
            log_warn "CI環境: ${env_unset_count}個の環境変数が未設定ですが、これは正常です"
        else
            log_warn "開発環境: ${env_unset_count}個の環境変数が未設定ですが、これは正常です"
        fi
    fi
    
    # 5. 最終結果
    if [[ $exit_code -eq 0 ]]; then
        log_success "設定値検証完了: 問題は検出されませんでした"
    else
        log_error "設定値検証完了: 問題が検出されました"
    fi
    
    return $exit_code
}

# 実行権限チェック
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
    exit $?
fi