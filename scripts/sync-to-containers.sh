#!/bin/bash

# ファイル同期スクリプト
# devcontainerからDockerコンテナへの確実なファイル同期

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$(dirname "$SCRIPT_DIR")"

echo "🔄 Starting file synchronization to containers..."

# コンテナリスト
CONTAINERS=("strategy-runner" "backtest" "hft" "trade_viewer")

# 同期対象ディレクトリ
SYNC_DIRS=("src" "strategies" "scripts" "test" "data")

# 各コンテナの状態確認
check_container_status() {
    local container_name=$1
    if docker ps --format "table {{.Names}}" | grep -q "^${container_name}$"; then
        echo "✅ Container ${container_name} is running"
        return 0
    else
        echo "❌ Container ${container_name} is not running"
        return 1
    fi
}

# ファイル同期実行
sync_to_container() {
    local container_name=$1
    local sync_dir=$2
    
    if [ ! -d "${WORKSPACE_DIR}/${sync_dir}" ]; then
        echo "⚠️  Directory ${sync_dir} does not exist, skipping..."
        return 0
    fi
    
    echo "📋 Syncing ${sync_dir} to ${container_name}..."
    
    # rsyncを使った同期（削除同期も含む）
    docker exec "${container_name}" mkdir -p "/usr/src/app/${sync_dir}" || true
    
    # タイムスタンプベースの同期
    rsync -av --delete \
        "${WORKSPACE_DIR}/${sync_dir}/" \
        "$(docker exec "${container_name}" sh -c "echo '/usr/src/app/${sync_dir}/'")" 2>/dev/null || \
        echo "⚠️  Direct rsync failed, using docker cp fallback..."
    
    # rsyncが失敗した場合のfallback
    if [ $? -ne 0 ]; then
        echo "🔄 Using docker cp for ${sync_dir} to ${container_name}..."
        docker cp "${WORKSPACE_DIR}/${sync_dir}/." "${container_name}:/usr/src/app/${sync_dir}/"
    fi
}

# メイン同期処理
main() {
    local container_filter=""
    local dir_filter=""
    
    # 引数処理
    while [[ $# -gt 0 ]]; do
        case $1 in
            --container)
                container_filter="$2"
                shift 2
                ;;
            --dir)
                dir_filter="$2"
                shift 2
                ;;
            --help)
                echo "Usage: $0 [--container CONTAINER_NAME] [--dir DIRECTORY_NAME]"
                echo "  --container: 特定のコンテナのみ同期"
                echo "  --dir: 特定のディレクトリのみ同期"
                exit 0
                ;;
            *)
                echo "Unknown option: $1"
                exit 1
                ;;
        esac
    done
    
    # コンテナリストのフィルタリング
    if [ -n "$container_filter" ]; then
        CONTAINERS=("$container_filter")
    fi
    
    # ディレクトリリストのフィルタリング
    if [ -n "$dir_filter" ]; then
        SYNC_DIRS=("$dir_filter")
    fi
    
    echo "🎯 Target containers: ${CONTAINERS[*]}"
    echo "📁 Target directories: ${SYNC_DIRS[*]}"
    echo ""
    
    # 各コンテナに対して同期実行
    for container in "${CONTAINERS[@]}"; do
        if check_container_status "$container"; then
            for dir in "${SYNC_DIRS[@]}"; do
                sync_to_container "$container" "$dir"
            done
            echo "✅ Sync completed for ${container}"
        else
            echo "⏭️  Skipping ${container} (not running)"
        fi
        echo ""
    done
    
    echo "🎉 File synchronization completed!"
}

# スクリプト実行
main "$@"