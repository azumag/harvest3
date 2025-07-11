/**
 * Balance Monitor Configuration
 * Issue #234: 残高整合性監視の設定管理
 */

module.exports = {
  // 乖離閾値（JPY）
  threshold: parseFloat(process.env.BALANCE_THRESHOLD) || 1.0,
  
  // ログファイルパス
  logFile: process.env.BALANCE_LOG_FILE || '/tmp/balance-monitor.log',
  alertLog: process.env.BALANCE_ALERT_LOG || '/tmp/balance-alert.log',
  
  // ログローテーション設定
  maxLogLines: parseInt(process.env.BALANCE_MAX_LOG_LINES) || 1000,
  
  // Discord通知設定
  discord: {
    webhookUrl: process.env.DISCORD_WEBHOOK_URL,
    enabled: !!process.env.DISCORD_WEBHOOK_URL
  },
  
  // 通貨設定
  currency: process.env.BALANCE_CURRENCY || 'JPY',
  exchange: process.env.BALANCE_EXCHANGE || 'bitbank',
  
  // Redis設定
  redis: {
    key: process.env.REDIS_BALANCE_KEY || 'balance:bitbank:JPY'
  },
  
  // デバッグ設定
  debug: process.env.NODE_ENV === 'development' || process.env.BALANCE_DEBUG === 'true'
};