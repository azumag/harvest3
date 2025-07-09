#!/bin/bash

# リアルタイムファイル監視・同期スクリプト
# inotifyを使用してファイル変更を監視し、自動同期を実行

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$(dirname "$SCRIPT_DIR")"

# 設定
WATCH_DIRS=("src" "strategies" "scripts")
SYNC_SCRIPT="${SCRIPT_DIR}/sync-to-containers.sh"
DEBOUNCE_TIME=2  # 連続変更の抑制時間（秒）

echo "👀 Starting file watcher for automatic synchronization..."
echo "📁 Watching directories: ${WATCH_DIRS[*]}"
echo "⏱️  Debounce time: ${DEBOUNCE_TIME} seconds"
echo ""

# 必要なツールの確認
check_dependencies() {
    local missing_deps=()
    
    if ! command -v inotifywait >/dev/null 2>&1; then
        missing_deps+=("inotify-tools")
    fi
    
    if [ ${#missing_deps[@]} -gt 0 ]; then
        echo "❌ Missing dependencies: ${missing_deps[*]}"
        echo "📦 Installing dependencies..."
        
        # パッケージマネージャーの検出と自動インストール
        if command -v apt-get >/dev/null 2>&1; then
            sudo apt-get update && sudo apt-get install -y "${missing_deps[@]}"
        elif command -v yum >/dev/null 2>&1; then
            sudo yum install -y "${missing_deps[@]}"
        elif command -v apk >/dev/null 2>&1; then
            sudo apk add --no-cache "${missing_deps[@]}"
        else
            echo "❌ Unable to auto-install dependencies. Please install manually: ${missing_deps[*]}"
            exit 1
        fi
    fi
}

# デバウンス処理用の変数
declare -A last_sync_time

# 同期実行（デバウンス付き）
trigger_sync() {
    local changed_dir="$1"
    local current_time=$(date +%s)
    local last_time=${last_sync_time[$changed_dir]:-0}
    
    # デバウンス時間内の変更は無視
    if [ $((current_time - last_time)) -lt $DEBOUNCE_TIME ]; then
        echo "⏳ Skipping sync for ${changed_dir} (debounce)"
        return 0
    fi
    
    echo "🔄 Change detected in ${changed_dir}, triggering sync..."
    last_sync_time[$changed_dir]=$current_time
    
    # バックグラウンドで同期実行
    (
        if [ -x "$SYNC_SCRIPT" ]; then
            "$SYNC_SCRIPT" --dir "$changed_dir" 2>&1 | sed 's/^/  /'
        else
            echo "❌ Sync script not found or not executable: $SYNC_SCRIPT"
        fi
    ) &
}

# メイン監視ループ
start_watching() {
    local watch_paths=()
    
    # 監視対象パスの構築
    for dir in "${WATCH_DIRS[@]}"; do
        if [ -d "${WORKSPACE_DIR}/${dir}" ]; then
            watch_paths+=("${WORKSPACE_DIR}/${dir}")
            echo "👁️  Watching: ${WORKSPACE_DIR}/${dir}"
        else
            echo "⚠️  Directory not found: ${WORKSPACE_DIR}/${dir}"
        fi
    done
    
    if [ ${#watch_paths[@]} -eq 0 ]; then
        echo "❌ No valid directories to watch"
        exit 1
    fi
    
    echo ""
    echo "🚀 File watcher started. Press Ctrl+C to stop."
    echo ""
    
    # inotifywaitでファイル変更を監視
    inotifywait -m -r -e create,modify,delete,move \
        --format '%w%f %e' \
        "${watch_paths[@]}" 2>/dev/null | \
    while read -r filepath events; do
        # 変更されたディレクトリを特定
        for dir in "${WATCH_DIRS[@]}"; do
            if [[ "$filepath" == *"/${dir}/"* ]]; then
                echo "📝 File changed: $(basename "$filepath") (${events})"
                trigger_sync "$dir"
                break
            fi
        done
    done
}

# 終了処理
cleanup() {
    echo ""
    echo "🛑 File watcher stopped"
    
    # バックグラウンドジョブを終了
    jobs -p | xargs -r kill 2>/dev/null || true
    
    exit 0
}

# シグナルハンドリング
trap cleanup SIGINT SIGTERM

# メイン処理
main() {
    case "${1:-}" in
        --help)
            echo "Usage: $0 [--help]"
            echo ""
            echo "Real-time file watcher for automatic container synchronization"
            echo ""
            echo "Options:"
            echo "  --help    Show this help message"
            echo ""
            echo "Configuration:"
            echo "  WATCH_DIRS: ${WATCH_DIRS[*]}"
            echo "  DEBOUNCE_TIME: ${DEBOUNCE_TIME} seconds"
            exit 0
            ;;
        "")
            check_dependencies
            start_watching
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
}

# スクリプト実行
main "$@"