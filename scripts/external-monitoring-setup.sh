#!/bin/bash

# 外部監視システムセットアップスクリプト
# Dead Man's Switch用の外部監視フローを確立

set -e

# 色定義
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }

HEARTBEAT_FILE="/tmp/system-monitor-heartbeat"
ALERT_THRESHOLD=300  # 5分
CHECK_INTERVAL=60    # 1分間隔

# 外部監視の具体的な実装
setup_external_monitoring() {
    log_info "外部監視システムのセットアップ開始..."
    
    # 1. Systemdサービスとしての監視設定
    create_systemd_service
    
    # 2. Cronベースの冗長監視
    setup_cron_monitoring
    
    # 3. Discord/Slack通知設定
    setup_notification_channels
    
    # 4. ログベースの監視
    setup_log_monitoring
}

# Systemdサービス作成
create_systemd_service() {
    if ! command -v systemctl >/dev/null 2>&1; then
        log_warn "systemctl が見つかりません。Systemd監視をスキップします。"
        return
    fi
    
    log_info "Systemd監視サービスを作成中..."
    
    # 監視スクリプトの作成
    cat > /tmp/heartbeat-monitor.sh << 'EOF'
#!/bin/bash

HEARTBEAT_FILE="/tmp/system-monitor-heartbeat"
ALERT_THRESHOLD=300
LOG_FILE="/var/log/heartbeat-monitor.log"

check_heartbeat() {
    local now=$(date +%s)
    
    if [[ ! -f "$HEARTBEAT_FILE" ]]; then
        echo "$(date): CRITICAL - ハートビートファイルが見つかりません" >> "$LOG_FILE"
        send_alert "CRITICAL: SystemMonitor heartbeat file missing"
        return 1
    fi
    
    local last_heartbeat=$(jq -r '.timestamp' "$HEARTBEAT_FILE" 2>/dev/null || echo "0")
    local age=$((now - last_heartbeat / 1000))
    
    if [[ $age -gt $ALERT_THRESHOLD ]]; then
        echo "$(date): CRITICAL - SystemMonitor停止検知 (${age}秒前)" >> "$LOG_FILE"
        send_alert "CRITICAL: SystemMonitor down for ${age} seconds"
        return 1
    else
        echo "$(date): OK - SystemMonitor正常 (${age}秒前)" >> "$LOG_FILE"
        return 0
    fi
}

send_alert() {
    local message="$1"
    
    # Discord通知（環境変数が設定されている場合）
    if [[ -n "$DISCORD_MONITOR_WEBHOOK_URL" ]]; then
        curl -X POST "$DISCORD_MONITOR_WEBHOOK_URL" \
             -H "Content-Type: application/json" \
             -d "{\"content\": \"🚨 **External Monitor Alert**\n$message\n\nTime: $(date)\nHost: $(hostname)\"}" \
             2>/dev/null || echo "Discord通知失敗" >> "$LOG_FILE"
    fi
    
    # syslogにも記録
    logger -p daemon.crit "HeartbeatMonitor: $message"
    
    # 標準出力（systemdログ用）
    echo "ALERT: $message"
}

# メイン処理
check_heartbeat
EOF
    
    chmod +x /tmp/heartbeat-monitor.sh
    
    # Systemdサービス定義
    cat > /tmp/heartbeat-monitor.service << EOF
[Unit]
Description=SystemMonitor Heartbeat External Monitor
After=network.target

[Service]
Type=oneshot
ExecStart=/tmp/heartbeat-monitor.sh
User=root
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
    
    # Systemdタイマー定義
    cat > /tmp/heartbeat-monitor.timer << EOF
[Unit]
Description=Run SystemMonitor Heartbeat Check every minute
Requires=heartbeat-monitor.service

[Timer]
OnCalendar=*:*:00
Persistent=true

[Install]
WantedBy=timers.target
EOF
    
    log_success "Systemd設定ファイルを生成しました"
    echo "  サービス: /tmp/heartbeat-monitor.service"
    echo "  タイマー: /tmp/heartbeat-monitor.timer"
    echo "  スクリプト: /tmp/heartbeat-monitor.sh"
    echo ""
    echo "インストール手順:"
    echo "  sudo cp /tmp/heartbeat-monitor.* /etc/systemd/system/"
    echo "  sudo cp /tmp/heartbeat-monitor.sh /usr/local/bin/"
    echo "  sudo systemctl daemon-reload"
    echo "  sudo systemctl enable heartbeat-monitor.timer"
    echo "  sudo systemctl start heartbeat-monitor.timer"
}

# Cron監視設定
setup_cron_monitoring() {
    log_info "Cron冗長監視を設定中..."
    
    cat > /tmp/heartbeat-cron.sh << 'EOF'
#!/bin/bash
# Cron用ハートビート監視スクリプト

HEARTBEAT_FILE="/tmp/system-monitor-heartbeat"
ALERT_THRESHOLD=300
LOG_FILE="/var/log/heartbeat-cron.log"

check_heartbeat() {
    local now=$(date +%s)
    
    if [[ ! -f "$HEARTBEAT_FILE" ]]; then
        echo "$(date): CRON-MONITOR: ハートビートファイルなし" >> "$LOG_FILE"
        # 緊急時の通知
        if command -v mail >/dev/null 2>&1 && [[ -n "$ALERT_EMAIL" ]]; then
            echo "SystemMonitor heartbeat missing on $(hostname)" | mail -s "CRITICAL: SystemMonitor Down" "$ALERT_EMAIL"
        fi
        return 1
    fi
    
    local last_heartbeat=$(jq -r '.timestamp' "$HEARTBEAT_FILE" 2>/dev/null || echo "0")
    local age=$((now - last_heartbeat / 1000))
    
    if [[ $age -gt $ALERT_THRESHOLD ]]; then
        echo "$(date): CRON-MONITOR: 停止検知 ${age}秒" >> "$LOG_FILE"
        if command -v mail >/dev/null 2>&1 && [[ -n "$ALERT_EMAIL" ]]; then
            echo "SystemMonitor down for ${age} seconds on $(hostname)" | mail -s "CRITICAL: SystemMonitor Down" "$ALERT_EMAIL"
        fi
        return 1
    fi
    
    return 0
}

check_heartbeat
EOF
    
    chmod +x /tmp/heartbeat-cron.sh
    
    log_success "Cron監視スクリプトを生成: /tmp/heartbeat-cron.sh"
    echo "Crontab設定例:"
    echo "  # SystemMonitor外部監視（毎分実行）"
    echo "  * * * * * /tmp/heartbeat-cron.sh"
}

# 通知チャンネル設定
setup_notification_channels() {
    log_info "通知チャンネルを設定中..."
    
    # 設定テンプレート作成
    cat > /tmp/external-monitor.env << 'EOF'
# 外部監視用環境変数設定

# Discord通知
DISCORD_MONITOR_WEBHOOK_URL="https://discord.com/api/webhooks/YOUR_WEBHOOK_URL"

# メール通知
ALERT_EMAIL="admin@yourdomain.com"

# Slack通知（オプション）
SLACK_WEBHOOK_URL="https://hooks.slack.com/services/YOUR_SLACK_WEBHOOK"

# PagerDuty（オプション）
PAGERDUTY_INTEGRATION_KEY="your_pagerduty_key"
EOF
    
    log_success "通知設定テンプレートを生成: /tmp/external-monitor.env"
    echo "環境変数を設定して通知を有効化してください"
}

# ログ監視設定
setup_log_monitoring() {
    log_info "ログベース監視を設定中..."
    
    # rsyslog設定
    cat > /tmp/30-heartbeat-monitor.conf << 'EOF'
# SystemMonitor外部監視ログ設定
:programname, isequal, "HeartbeatMonitor" /var/log/heartbeat-monitor.log
& stop
EOF
    
    # logrotate設定
    cat > /tmp/heartbeat-monitor.logrotate << 'EOF'
/var/log/heartbeat-monitor.log {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    notifempty
    create 644 root root
}
EOF
    
    log_success "ログ設定を生成:"
    echo "  rsyslog: /tmp/30-heartbeat-monitor.conf"
    echo "  logrotate: /tmp/heartbeat-monitor.logrotate"
}

# テスト実行
test_external_monitoring() {
    log_info "外部監視テストを実行中..."
    
    # テスト用の古いハートビートファイルを作成
    echo '{"timestamp": '$(( $(date +%s) * 1000 - 600000 ))', "status": "test"}' > "$HEARTBEAT_FILE"
    
    # テスト実行
    if [[ -f "/tmp/heartbeat-monitor.sh" ]]; then
        bash /tmp/heartbeat-monitor.sh
        echo "テスト結果を確認してください"
    fi
    
    # ファイルクリーンアップ
    rm -f "$HEARTBEAT_FILE"
}

# メイン実行
main() {
    echo "=== SystemMonitor外部監視セットアップ ==="
    echo ""
    
    setup_external_monitoring
    
    echo ""
    echo "=== セットアップ完了 ==="
    echo "次のステップ:"
    echo "1. 通知設定の環境変数を設定"
    echo "2. Systemdサービスのインストール（root権限必要）"
    echo "3. Cron設定の追加"
    echo "4. テスト実行: $0 --test"
    echo ""
    echo "設定ファイル確認:"
    echo "  ls -la /tmp/heartbeat-monitor*"
    echo "  ls -la /tmp/external-monitor.env"
}

# 引数処理
case "${1:-}" in
    --test)
        test_external_monitoring
        ;;
    *)
        main
        ;;
esac