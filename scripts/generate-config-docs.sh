#!/bin/bash

# 設定ファイル自動ドキュメント生成スクリプト
# Usage: ./scripts/generate-config-docs.sh [target_file] [--update-readme]

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

# 現在の日時を取得
current_date=$(date +"%Y年%m月%d日")

# 設定値を抽出してJSON形式で出力
extract_exchange_settings() {
    node -e "
        const { EXCHANGE_SETTINGS } = require('./src/common/const.js');
        console.log(JSON.stringify(EXCHANGE_SETTINGS, null, 2));
    "
}

extract_trading_settings() {
    node -e "
        const { TRADING_SETTINGS } = require('./src/common/const.js');
        console.log(JSON.stringify(TRADING_SETTINGS, null, 2));
    "
}

extract_order_settings() {
    node -e "
        const { ORDER_MANAGEMENT_SETTINGS } = require('./src/common/const.js');
        console.log(JSON.stringify(ORDER_MANAGEMENT_SETTINGS, null, 2));
    "
}

# Markdownフォーマットで設定値を生成
generate_config_markdown() {
    log_info "設定値を抽出しています..."
    
    local exchange_settings=$(extract_exchange_settings)
    local trading_settings=$(extract_trading_settings)
    local order_settings=$(extract_order_settings)
    
    cat << EOF
#### 設定値の参照

> ⚠️ **重要な警告**: 以下は自動生成された参考値です（生成日時: ${current_date}）。
> 
> 実際のエラーログとの乖離が発生する可能性があります。詳細なトラブルシューティングは[🚨 緊急対応・トラブルシューティング](#-緊急対応トラブルシューティング)を参照してください。
> 
> **必須**: 最新の設定値は必ず実際の設定ファイルやソースコードを直接確認してください。

**主要な設定ファイル**
- **API制限設定**: \`src/common/const.js\` の \`EXCHANGE_SETTINGS\`
- **取引設定**: \`src/common/const.js\` の \`TRADING_SETTINGS\`
- **注文管理設定**: \`src/common/const.js\` の \`ORDER_MANAGEMENT_SETTINGS\`

**自動抽出された設定値（${current_date}時点）**

\`\`\`javascript
// src/common/const.js - EXCHANGE_SETTINGS（自動生成）
const EXCHANGE_SETTINGS = ${exchange_settings};

// src/common/const.js - TRADING_SETTINGS（自動生成）
const TRADING_SETTINGS = ${trading_settings};

// src/common/const.js - ORDER_MANAGEMENT_SETTINGS（自動生成）
const ORDER_MANAGEMENT_SETTINGS = ${order_settings};
\`\`\`

> **注意**: この情報は自動生成されており、\`scripts/generate-config-docs.sh\`により更新できます。

EOF
}

# READMEの設定セクションを更新
update_readme_config_section() {
    local temp_file=$(mktemp)
    local new_config_content=$(generate_config_markdown)
    local in_config_section=false
    local start_marker="#### 設定値の参照"
    local end_marker="### 🔍 **設定値の確認方法（重要）**"
    
    log_info "README.mdの設定セクションを更新しています..."
    
    while IFS= read -r line; do
        if [[ "$line" == *"$start_marker"* ]]; then
            # 設定セクション開始 - 新しい内容に置換
            echo "$new_config_content"
            in_config_section=true
        elif [[ "$line" == *"$end_marker"* ]]; then
            # 設定セクション終了 - 通常の処理に戻る
            echo "$line"
            in_config_section=false
        elif [[ "$in_config_section" == false ]]; then
            # 設定セクション外 - そのまま出力
            echo "$line"
        fi
        # 設定セクション内の行はスキップ（新しい内容で置換済み）
    done < README.md > "$temp_file"
    
    # 更新されたファイルを元のファイルに置換
    mv "$temp_file" README.md
    log_success "README.mdの設定セクションが更新されました"
}

# 独立したドキュメントファイルを生成
generate_standalone_docs() {
    local output_file="${1:-docs/current-config.md}"
    local dir=$(dirname "$output_file")
    
    # ディレクトリが存在しない場合は作成
    mkdir -p "$dir"
    
    log_info "独立した設定ドキュメントを生成しています: $output_file"
    
    cat << EOF > "$output_file"
# 現在の設定値 (自動生成)

**生成日時**: ${current_date}  
**生成元**: \`src/common/const.js\`  
**生成コマンド**: \`./scripts/generate-config-docs.sh\`

## 概要

この文書は設定ファイルから自動生成された、現在の設定値の完全なリストです。
手動での編集は推奨されません。設定を変更する場合は、ソースファイルを直接編集してください。

## 設定詳細

$(generate_config_markdown)

## 更新方法

このドキュメントを更新するには：

\`\`\`bash
# 独立ドキュメントのみ更新
./scripts/generate-config-docs.sh docs/current-config.md

# README.mdも同時に更新
./scripts/generate-config-docs.sh docs/current-config.md --update-readme
\`\`\`

## 検証方法

設定値の整合性を確認するには：

\`\`\`bash
# 基本検証
./scripts/validate-config.sh

# README整合性も含む完全検証
./scripts/validate-config.sh --check-readme-consistency
\`\`\`

---
*このファイルは自動生成されています。手動での編集は避けてください。*
EOF
    
    log_success "独立ドキュメントが生成されました: $output_file"
}

# メイン処理
main() {
    local target_file="${1:-docs/current-config.md}"
    local update_readme=false
    
    # 引数解析
    for arg in "$@"; do
        case $arg in
            --update-readme)
                update_readme=true
                shift
                ;;
            --help|-h)
                cat << EOF
設定ファイル自動ドキュメント生成スクリプト

使用方法:
  $0 [target_file] [--update-readme]

引数:
  target_file     出力ファイルパス (デフォルト: docs/current-config.md)
  --update-readme README.mdの設定セクションも更新

例:
  $0                                    # 基本的な使用
  $0 docs/config.md                    # 出力先指定
  $0 --update-readme                   # READMEも更新
  $0 docs/config.md --update-readme    # 両方実行

EOF
                exit 0
                ;;
        esac
    done
    
    log_info "設定ドキュメント生成開始..."
    
    # 必須ファイルの存在確認
    if [[ ! -f "src/common/const.js" ]]; then
        log_error "設定ファイルが見つかりません: src/common/const.js"
        exit 1
    fi
    
    if ! command -v node >/dev/null 2>&1; then
        log_error "Node.jsが見つかりません。設定値の抽出にはNode.jsが必要です。"
        exit 1
    fi
    
    # 独立ドキュメントを生成
    generate_standalone_docs "$target_file"
    
    # READMEも更新する場合
    if [[ "$update_readme" == true ]]; then
        if [[ ! -f "README.md" ]]; then
            log_error "README.mdが見つかりません"
            exit 1
        fi
        # 自動修正の安全確認
    echo "⚠️  README.mdの自動修正を実行しようとしています"
    echo "設定の意図的な変更が上書きされる可能性があります"
    
    # AUTOMATED_RUN環境変数の厳格な検証
    if [[ -n "$AUTOMATED_RUN" ]]; then
        # 許可された環境でのみ自動実行を許可
        local allowed_contexts=(
            "github-actions"    # GitHub Actions
            "jenkins"          # Jenkins CI
            "gitlab-ci"        # GitLab CI
            "local-dev"        # 開発環境（要注意）
        )
        
        local context_valid=false
        for context in "${allowed_contexts[@]}"; do
            if [[ "$AUTOMATED_RUN" == "$context" ]]; then
                context_valid=true
                break
            fi
        done
        
        if [[ "$context_valid" == false ]]; then
            log_error "不正なAUTOMATED_RUN値: $AUTOMATED_RUN"
            log_error "許可された値: ${allowed_contexts[*]}"
            exit 1
        fi
        
        # CI環境の追加検証
        case "$AUTOMATED_RUN" in
            "github-actions")
                if [[ -z "$GITHUB_ACTIONS" || -z "$GITHUB_WORKFLOW" ]]; then
                    log_error "GitHub Actions環境の検証に失敗"
                    exit 1
                fi
                log_info "GitHub Actions環境で自動実行: $GITHUB_WORKFLOW"
                ;;
            "jenkins")
                if [[ -z "$JENKINS_URL" || -z "$BUILD_NUMBER" ]]; then
                    log_error "Jenkins環境の検証に失敗"
                    exit 1
                fi
                log_info "Jenkins環境で自動実行: Build #$BUILD_NUMBER"
                ;;
            "gitlab-ci")
                if [[ -z "$GITLAB_CI" || -z "$CI_PIPELINE_ID" ]]; then
                    log_error "GitLab CI環境の検証に失敗"
                    exit 1
                fi
                log_info "GitLab CI環境で自動実行: Pipeline #$CI_PIPELINE_ID"
                ;;
            "local-dev")
                log_warn "⚠️  開発環境での自動実行が許可されました"
                log_warn "本番環境では使用しないでください"
                ;;
        esac
        
        # 実行ログの記録
        echo "$(date -Iseconds) AUTOMATED_RUN=${AUTOMATED_RUN} user=$(whoami) pwd=$(pwd)" >> ~/.config-docs-automation.log
        
    else
        # 人間による確認
        read -p "続行しますか？ (y/N): " confirm
        if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
            echo "キャンセルされました"
            exit 0
        fi
        
        # 手動実行ログの記録
        echo "$(date -Iseconds) MANUAL_RUN user=$(whoami) pwd=$(pwd)" >> ~/.config-docs-manual.log
    fi
    
    update_readme_config_section
    fi
    
    log_success "ドキュメント生成完了"
    
    # 検証スクリプトの実行を推奨
    log_info "設定値の検証を実行することを推奨します:"
    echo "  ./scripts/validate-config.sh --check-readme-consistency"
}

# 実行権限チェック
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi