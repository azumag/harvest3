#!/bin/bash

# 残高チェック手動実行スクリプト
# 使いやすいコマンド形式で残高チェックを実行

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$(dirname "$SCRIPT_DIR")"

echo "🔍 残高チェック手動実行を開始します..."
echo "📍 実行場所: $WORKSPACE_DIR"
echo ""

# 引数処理
QUIET_MODE=false
OUTPUT_FILE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --quiet|-q)
            QUIET_MODE=true
            shift
            ;;
        --output|-o)
            OUTPUT_FILE="$2"
            shift 2
            ;;
        --help|-h)
            echo "残高チェック手動実行スクリプト"
            echo ""
            echo "使用方法: $0 [オプション]"
            echo ""
            echo "オプション:"
            echo "  --quiet, -q     詳細ログを非表示"
            echo "  --output, -o    結果をファイルに出力"
            echo "  --help, -h      このヘルプを表示"
            echo ""
            echo "例:"
            echo "  $0                    # 通常実行"
            echo "  $0 --quiet           # 静粛モード"
            echo "  $0 -o result.json    # 結果をファイル出力"
            exit 0
            ;;
        *)
            echo "不明なオプション: $1"
            echo "ヘルプを表示するには --help を使用してください"
            exit 1
            ;;
    esac
done

# 実行時刻の記録
EXECUTION_TIME=$(date '+%Y-%m-%d %H:%M:%S')

if [ "$QUIET_MODE" = false ]; then
    echo "⏰ 実行時刻: $EXECUTION_TIME"
    echo ""
fi

# メイン実行
cd "$WORKSPACE_DIR"

if [ "$QUIET_MODE" = true ]; then
    # 静粛モード - 結果のみ表示
    RESULT=$(node test_balance_checker.js 2>/dev/null | grep -A 1000 "テスト結果:" | head -n -1)
    echo "$RESULT"
else
    # 通常モード - 全ログ表示
    node test_balance_checker.js
fi

# ファイル出力
if [ -n "$OUTPUT_FILE" ]; then
    echo "📄 結果を $OUTPUT_FILE に出力中..."
    {
        echo "{"
        echo "  \"executionTime\": \"$EXECUTION_TIME\","
        echo "  \"command\": \"manual-balance-check\","
        echo "  \"result\":"
        node test_balance_checker.js 2>/dev/null | grep -A 1000 "テスト結果:" | head -n -1 | sed 's/テスト結果: //'
        echo "}"
    } > "$OUTPUT_FILE"
    echo "✅ 結果を $OUTPUT_FILE に保存しました"
fi

echo ""
echo "🎉 残高チェック手動実行が完了しました"