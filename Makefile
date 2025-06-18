# Docker Compose操作のMakefile
# ボリュームマウントを確実に反映させる

.PHONY: restart-backtest restart-bot restart-all rebuild-all bot-restart bot-quick-restart restart-webui bot-logs bot-status bot-exec help

# バックテストコンテナを確実に再起動（ボリューム再マウント）
restart-backtest:
	@echo "バックテストコンテナを再起動中..."
	docker compose down backtest
	docker compose up -d backtest
	@echo "バックテストコンテナの再起動完了"

# 戦略実行コンテナを確実に再起動
restart-bot:
	@echo "戦略実行コンテナを再起動中..."
	docker compose down bot
	docker compose up -d bot
	@echo "戦略実行コンテナの再起動完了"

# 全てのコンテナを再起動
restart-all:
	@echo "全コンテナを再起動中..."
	docker compose down
	docker compose up -d
	@echo "全コンテナの再起動完了"

# 全てのイメージを再ビルドして起動
rebuild-all:
	@echo "全イメージを再ビルド中..."
	docker compose down
	docker compose build --no-cache
	docker compose up -d
	@echo "再ビルド完了"

# ファイル変更後のクイック再起動（バックテスト用）
quick-restart-backtest:
	@echo "バックテストのクイック再起動中..."
	docker compose restart backtest
	@echo "クイック再起動完了"

# ファイル変更後のクイック再起動（戦略実行用）
quick-restart-bot:
	@echo "戦略実行のクイック再起動中..."
	docker compose restart bot
	@echo "クイック再起動完了"

# === Bot Container専用コマンド ===
# Botコンテナ再起動（完全停止・再起動）
bot-restart:
	@echo "Botコンテナ再起動中..."
	docker compose down bot
	docker compose up -d bot
	@echo "Botコンテナ再起動完了"

# Botコンテナクイック再起動（軽量）
bot-quick-restart:
	@echo "Botコンテナクイック再起動中..."
	docker compose restart bot
	@echo "Botコンテナクイック再起動完了"

# WebUIコンテナ再起動
restart-webui:
	@echo "WebUIコンテナ再起動中..."
	docker compose restart web-ui
	@echo "WebUIコンテナ再起動完了"

# Botコンテナログ表示
bot-logs:
	@echo "Botコンテナのログを表示中..."
	docker compose logs -f bot

# Botコンテナステータス確認
bot-status:
	@echo "Botコンテナステータス:"
	docker compose ps bot

# Botコンテナ内でコマンド実行用
bot-exec:
	@echo "Botコンテナ内でシェルを開きます..."
	docker compose exec bot /bin/bash

# ヘルプ表示
help:
	@echo "=== Docker Compose 操作コマンド ==="
	@echo ""
	@echo "【基本的な再起動コマンド】"
	@echo "  restart-all         : 全コンテナを再起動"
	@echo "  restart-backtest    : バックテストコンテナ再起動"
	@echo "  restart-bot         : Botコンテナ再起動（完全停止・再起動）"
	@echo "  restart-webui       : WebUIコンテナ再起動"
	@echo ""
	@echo "【Bot専用コマンド】"
	@echo "  bot-restart         : Botコンテナ再起動（完全停止・再起動）"
	@echo "  bot-quick-restart   : Botコンテナクイック再起動（軽量）"
	@echo "  bot-logs           : Botコンテナのログを表示"
	@echo "  bot-status         : Botコンテナの状態確認"
	@echo "  bot-exec           : Botコンテナ内でシェルを開く"
	@echo ""
	@echo "【クイック再起動（軽量）】"
	@echo "  quick-restart-backtest : バックテストのクイック再起動"
	@echo "  quick-restart-bot      : Botのクイック再起動"
	@echo ""
	@echo "【その他】"
	@echo "  rebuild-all        : 全イメージを再ビルドして起動"
	@echo "  help              : このヘルプを表示"