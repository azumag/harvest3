/**
 * システム設定値管理 - Issue #211
 * ハードコードされた設定値を集約し、環境変数対応で外部化
 */

// 環境変数の安全な解析
function parseEnvInt(envVar, defaultValue, minValue = 0) {
  const value = process.env[envVar];
  if (!value) {
    return defaultValue;
  }
  const parsed = parseInt(value);
  if (isNaN(parsed) || parsed < minValue) {
    console.warn(`[Config] Invalid ${envVar}: ${value}, using default: ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}

function parseEnvFloat(envVar, defaultValue, minValue = 0) {
  const value = process.env[envVar];
  if (!value) {
    return defaultValue;
  }
  const parsed = parseFloat(value);
  if (isNaN(parsed) || parsed < minValue) {
    console.warn(`[Config] Invalid ${envVar}: ${value}, using default: ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}

function parseEnvBool(envVar, defaultValue) {
  const value = process.env[envVar];
  if (!value) {
    return defaultValue;
  }
  return value.toLowerCase() === 'true';
}

// 取引所設定（最優先度）
const EXCHANGE_SETTINGS = {
  // API制限設定
  BITFLYER_RATE_LIMIT: parseEnvInt('BITFLYER_RATE_LIMIT', 1000, 100), // 1秒
  BITBANK_RATE_LIMIT: parseEnvInt('BITBANK_RATE_LIMIT', 1000, 500), // 1秒（CCXT標準）

  // タイムアウト設定
  API_TIMEOUT: parseEnvInt('API_TIMEOUT', 60000, 5000), // 60秒

  // 再試行設定
  MAX_RETRIES: parseEnvInt('MAX_RETRIES', 3, 1),
  RETRY_DELAY: parseEnvInt('RETRY_DELAY', 1000, 100), // 1秒

  // キューサイズ制限
  MAX_THROTTLE_QUEUE_SIZE: parseEnvInt('MAX_THROTTLE_QUEUE_SIZE', 5000, 100)
};

// データベース接続設定（最優先度）
const DATABASE_SETTINGS = {
  // Redis設定
  REDIS: {
    RECONNECT_DELAY: parseEnvInt('REDIS_RECONNECT_DELAY', 1000, 100), // 1秒
    MAX_RETRY_ATTEMPTS: parseEnvInt('REDIS_MAX_RETRY_ATTEMPTS', 5, 1),
    RETRY_DELAY_MAX: parseEnvInt('REDIS_RETRY_DELAY_MAX', 3000, 1000), // 3秒
    CONNECTION_TIMEOUT: parseEnvInt('REDIS_CONNECTION_TIMEOUT', 3600000, 60000), // 1時間
    RECONNECTION_INTERVAL: parseEnvInt('REDIS_RECONNECTION_INTERVAL', 5000, 1000), // 5秒
    DEFAULT_URL: process.env.NODE_ENV === 'production'
      ? process.env.REDIS_URL // 本番環境では環境変数必須
      : (process.env.REDIS_URL || 'redis://localhost:6379') // 開発環境のみデフォルト値許可
  },

  // MongoDB設定
  MONGODB: {
    SERVER_SELECTION_TIMEOUT: parseEnvInt('MONGODB_SERVER_SELECTION_TIMEOUT', 30000, 5000), // 30秒
    CONNECT_TIMEOUT: parseEnvInt('MONGODB_CONNECT_TIMEOUT', 15000, 5000), // 15秒
    SOCKET_TIMEOUT: parseEnvInt('MONGODB_SOCKET_TIMEOUT', 45000, 10000), // 45秒
    MAX_POOL_SIZE: parseEnvInt('MONGODB_MAX_POOL_SIZE', 10, 1),
    MIN_POOL_SIZE: parseEnvInt('MONGODB_MIN_POOL_SIZE', 2, 1),
    MAX_IDLE_TIME: parseEnvInt('MONGODB_MAX_IDLE_TIME', 30000, 5000), // 30秒
    HEARTBEAT_FREQUENCY: parseEnvInt('MONGODB_HEARTBEAT_FREQUENCY', 10000, 1000), // 10秒
    MAX_CONNECTING: parseEnvInt('MONGODB_MAX_CONNECTING', 5, 1)
  }
};

// システム監視設定（高優先度）
const MONITORING_SETTINGS = {
  // バランス監視
  BALANCE_CHECK_INTERVAL: parseEnvInt('BALANCE_CHECK_INTERVAL', 300000, 60000), // 5分
  BALANCE_CHECK_TIMEOUT: parseEnvInt('BALANCE_CHECK_TIMEOUT', 30000, 5000), // 30秒
  MAX_CONSECUTIVE_FAILURES: parseEnvInt('MAX_CONSECUTIVE_FAILURES', 3, 1),
  FAILURE_ALERT_THRESHOLD: parseEnvInt('FAILURE_ALERT_THRESHOLD', 5, 1),

  // システム自己修復
  COMPREHENSIVE_CLEANUP_INTERVAL: parseEnvInt('COMPREHENSIVE_CLEANUP_INTERVAL', 600000, 60000), // 10分
  SELF_HEALING_INTERVAL: parseEnvInt('SELF_HEALING_INTERVAL', 1800000, 300000), // 30分

  // 実行中タスク待機
  TASK_WAIT_INTERVAL: parseEnvInt('TASK_WAIT_INTERVAL', 100, 10) // 100ms
};

// リスク管理設定（高優先度）
const RISK_MANAGEMENT_SETTINGS = {
  // ストップロス設定
  FIXED_STOP_LOSS_PERCENT: parseEnvFloat('FIXED_STOP_LOSS_PERCENT', 0.02, 0.001), // 2%
  TRAILING_STOP_TRIGGER_PERCENT: parseEnvFloat('TRAILING_STOP_TRIGGER_PERCENT', 0.01, 0.001), // 1%

  // 損失制限
  DAILY_MAX_LOSS_PERCENT: parseEnvFloat('DAILY_MAX_LOSS_PERCENT', 0.05, 0.001), // 5%
  WEEKLY_MAX_LOSS_PERCENT: parseEnvFloat('WEEKLY_MAX_LOSS_PERCENT', 0.10, 0.001), // 10%
  MONTHLY_MAX_LOSS_PERCENT: parseEnvFloat('MONTHLY_MAX_LOSS_PERCENT', 0.15, 0.001), // 15%

  // 価格変動閾値
  SIGNIFICANT_PRICE_INCREASE_THRESHOLD: parseEnvFloat('SIGNIFICANT_PRICE_INCREASE_THRESHOLD', 1.0, 0.1) // 1%
};

// パフォーマンス調整設定（高優先度）
const PERFORMANCE_SETTINGS = {
  // 分析期間
  LOOKBACK_DAYS: parseEnvInt('PERFORMANCE_LOOKBACK_DAYS', 30, 1),

  // バックテスト動的期間
  BUFFER_PERCENT: parseEnvFloat('BACKTEST_BUFFER_PERCENT', 0.3, 0.1), // 30%

  // 計算時間制限
  MAX_CALCULATION_TIME: parseEnvInt('MAX_CALCULATION_TIME', 5000, 1000), // 5秒
  OPTIMIZATION_INTERVAL: parseEnvInt('OPTIMIZATION_INTERVAL', 86400000, 3600000), // 24時間

  // A/Bテスト期間
  TEST_DURATION: parseEnvInt('AB_TEST_DURATION', 604800000, 86400000) // 7日
};

// WebSocket・HFT設定（中優先度）
const HFT_SETTINGS = {
  // WebSocket接続
  WEBSOCKET: {
    RECONNECTION_ATTEMPTS: parseEnvInt('WS_RECONNECTION_ATTEMPTS', 5, 1),
    RECONNECTION_DELAY: parseEnvInt('WS_RECONNECTION_DELAY', 1000, 100), // 1秒
    TIMEOUT: parseEnvInt('WS_TIMEOUT', 10000, 1000), // 10秒

    // エンドポイント
    PUBLIC_ENDPOINT: process.env.WS_PUBLIC_ENDPOINT || 'wss://stream.bitbank.cc',
    PRIVATE_ENDPOINT: process.env.WS_PRIVATE_ENDPOINT || 'wss://private-ws.bitbank.cc'
  },

  // HFT戦略パラメータ
  STRATEGY: {
    PRICE_THRESHOLD: parseEnvFloat('HFT_PRICE_THRESHOLD', 0.001, 0.0001), // 0.1%
    ORDER_BOOK_DEPTH: parseEnvInt('HFT_ORDER_BOOK_DEPTH', 15, 5),
    EVALUATION_INTERVAL: parseEnvInt('HFT_EVALUATION_INTERVAL', 100, 10), // 100ms
    TRADE_PERCENTAGE: parseEnvFloat('HFT_TRADE_PERCENTAGE', 0.001, 0.0001) // 0.1%
  }
};

// 通貨ペア・取引設定（中優先度）
const TRADING_SETTINGS = {
  // 通貨ペア
  TRADING_PAIRS: (process.env.TRADING_PAIRS || 'btc_jpy,xrp_jpy,eth_jpy').split(','),

  // 重要通貨リスト（残高監視で重要視する通貨）
  IMPORTANT_CURRENCIES: (process.env.IMPORTANT_CURRENCIES || 'BTC,ETH,XRP,LTC,BCH').split(','),

  // Iceberg注文しきい値
  ICEBERG_THRESHOLDS: {
    BTC: parseEnvFloat('ICEBERG_THRESHOLD_BTC', 0.1, 0.01),
    ETH: parseEnvFloat('ICEBERG_THRESHOLD_ETH', 1.0, 0.1),
    DEFAULT: parseEnvFloat('ICEBERG_THRESHOLD_DEFAULT', 10.0, 1.0)
  }
};

// 設定検証
function validateSettings() {
  const warnings = [];

  // 重要な設定値のチェック（Issue #210: CCXT標準機能では1秒間隔が適切）
  if (EXCHANGE_SETTINGS.BITBANK_RATE_LIMIT < 500) {
    warnings.push('BITBANK_RATE_LIMIT が 500ms未満です。API制限エラーの可能性があります。');
  }

  if (DATABASE_SETTINGS.MONGODB.MAX_POOL_SIZE < DATABASE_SETTINGS.MONGODB.MIN_POOL_SIZE) {
    warnings.push('MongoDB MAX_POOL_SIZE が MIN_POOL_SIZE より小さく設定されています。');
  }

  if (RISK_MANAGEMENT_SETTINGS.DAILY_MAX_LOSS_PERCENT > 0.1) {
    warnings.push('日次最大損失率が10%を超えています。リスクが高すぎる可能性があります。');
  }

  if (warnings.length > 0) {
    console.warn('[Settings] 設定警告:');
    warnings.forEach(warning => console.warn(`  - ${warning}`));
  }

  return warnings.length === 0;
}

// 設定の統合エクスポート
const SETTINGS = {
  EXCHANGE: EXCHANGE_SETTINGS,
  DATABASE: DATABASE_SETTINGS,
  MONITORING: MONITORING_SETTINGS,
  RISK_MANAGEMENT: RISK_MANAGEMENT_SETTINGS,
  PERFORMANCE: PERFORMANCE_SETTINGS,
  HFT: HFT_SETTINGS,
  TRADING: TRADING_SETTINGS
};

// 設定検証の実行
validateSettings();

module.exports = {
  SETTINGS,
  EXCHANGE_SETTINGS,
  DATABASE_SETTINGS,
  MONITORING_SETTINGS,
  RISK_MANAGEMENT_SETTINGS,
  PERFORMANCE_SETTINGS,
  HFT_SETTINGS,
  TRADING_SETTINGS,
  validateSettings
};