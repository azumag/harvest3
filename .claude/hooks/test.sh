#!/bin/bash

# Claudeワークフロー テストフック
# CI実行前のローカル検証を行う

set -e  # エラー時に停止

echo "🔧 Linting..."
npm run lint

echo "🧪 Running tests..."
npm test