/**
 * システム共通定数定義
 * マジックナンバーの排除とコード可読性向上のため
 */

// 時間関連定数（ミリ秒）
const TIME_CONSTANTS = {
  // 基本時間単位
  SECOND: 1000,
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
  WEEK: 7 * 24 * 60 * 60 * 1000,
  MONTH: 30 * 24 * 60 * 60 * 1000,

  // API関連のタイムアウト
  API_TIMEOUT: 30000,          // 30秒
  API_RETRY_DELAY: 1000,       // 1秒
  API_RATE_LIMIT_DELAY: 5000,  // 5秒

  // データ収集・監視間隔
  BALANCE_CHECK_INTERVAL: 60000,     // 1分間隔
  DATA_COLLECTION_INTERVAL: 60000,   // 1分間隔
  MARKET_DATA_REFRESH: 5000,         // 5秒
  HEALTH_CHECK_INTERVAL: 30000,      // 30秒間隔

  // システム監視
  STRATEGY_REVIEW_INTERVAL: 15 * 60 * 1000,  // 15分間隔
  PERFORMANCE_REVIEW_INTERVAL: 60 * 60 * 1000, // 1時間間隔
  DAILY_SUMMARY_INTERVAL: 30 * 60 * 1000,   // 30分間隔

  // データ保持期間
  DATA_RETENTION_PERIOD: 30 * 24 * 60 * 60 * 1000,  // 30日
  BACKUP_INTERVAL: 24 * 60 * 60 * 1000,             // 24時間
  LOG_RETENTION_PERIOD: 7 * 24 * 60 * 60 * 1000,    // 7日

  // 緊急停止・復旧
  EMERGENCY_HALT_COOLDOWN: 300000,   // 5分
  TRADING_RESUME_DELAY: 60000,       // 1分
  ERROR_RECOVERY_DELAY: 30000        // 30秒
};

// 数値精度・閾値定数
const PRECISION_CONSTANTS = {
  // 通貨精度（小数点以下桁数）
  BTC_PRECISION: 8,
  ETH_PRECISION: 8,
  ALT_COIN_PRECISION: 6,
  JPY_PRECISION: 0,

  // 残高比較閾値
  BALANCE_ABSOLUTE_THRESHOLD: 0.001,      // 絶対値閾値
  BALANCE_PERCENTAGE_THRESHOLD: 1.0,      // パーセント閾値（1%）
  BALANCE_WARNING_THRESHOLD: 0.5,         // 警告閾値（0.5%）
  BALANCE_CRITICAL_THRESHOLD: 5.0,        // 緊急閾値（5%）

  // 取引関連閾値
  MIN_TRADE_AMOUNT: 0.0001,               // 最小取引量
  MAX_POSITION_SIZE: 0.1,                 // 最大ポジションサイズ（資金の10%）
  STOP_LOSS_THRESHOLD: 0.05,              // ストップロス閾値（5%）
  TAKE_PROFIT_THRESHOLD: 0.02,            // 利確閾値（2%）

  // 市場分析閾値
  HIGH_VOLATILITY_THRESHOLD: 0.7,         // 高ボラティリティ閾値
  TREND_STRENGTH_THRESHOLD: 0.7,          // トレンド強度閾値
  MOMENTUM_THRESHOLD: 0.3,                // モメンタム閾値
  LOW_VOLATILITY_THRESHOLD: 0.3,          // 低ボラティリティ閾値
  TREND_CONFIDENCE_BASE: 0.4,             // トレンド信頼度ベース

  // パフォーマンス関連
  UNDERPERFORMANCE_THRESHOLD: 0.1,        // アンダーパフォーマンス閾値（10%）
  VOLATILITY_CHANGE_THRESHOLD: 0.2,       // ボラティリティ変化閾値（20%）
  TREND_CHANGE_THRESHOLD: 0.15,           // トレンド変化閾値（15%）

  // 重み付け係数
  PROFITABILITY_WEIGHT: 0.4,              // 収益性重み（40%）
  STABILITY_WEIGHT: 0.3,                  // 安定性重み（30%）
  DRAWDOWN_WEIGHT: 0.2,                   // ドローダウン重み（20%）
  SHARPE_RATIO_WEIGHT: 0.1                // シャープレシオ重み（10%）
};

// システム制限値
const SYSTEM_LIMITS = {
  // データ量制限
  MAX_AUDIT_LOG_SIZE: 1000,               // 監査ログ最大サイズ
  MAX_ERROR_LOG_SIZE: 500,                // エラーログ最大サイズ
  MAX_CACHE_SIZE: 100,                    // キャッシュ最大サイズ
  MAX_CONCURRENT_REQUESTS: 5,             // 最大同時リクエスト数

  // 自動修正制限
  MAX_AUTO_CORRECTIONS_PER_DAY: 3,        // 1日あたりの最大自動修正回数
  MAX_CONSECUTIVE_FAILURES: 3,            // 最大連続失敗回数
  MAX_RETRY_ATTEMPTS: 3,                  // 最大リトライ回数

  // 取引制限
  MAX_TRADE_AMOUNT: 1000000,              // 最大取引金額（JPY）
  MAX_DAILY_TRADES: 100,                  // 1日あたりの最大取引回数
  MAX_OPEN_POSITIONS: 10,                 // 最大オープンポジション数

  // 価格範囲（例：BTC基準価格）
  BTC_BASE_PRICE: 5000000,                // BTC基準価格（5,000,000円）
  BTC_PRICE_VARIATION: 100000,            // BTC価格変動幅（100,000円）

  // スコア範囲
  BASE_SCORE_RANGE: 20,                   // ベーススコア範囲（±20）
  MIN_BASE_SCORE: 40,                     // 最小ベーススコア
  MAX_BASE_SCORE: 60,                     // 最大ベーススコア

  // パフォーマンス乗数制限
  MAX_VALUE_MULTIPLIER: 1.1,              // 最大価値乗数
  VALUE_MULTIPLIER_DIVISOR: 10000         // 価値乗数除数
};

// API関連定数
const API_CONSTANTS = {
  // HTTPステータスコード
  HTTP_OK: 200,
  HTTP_BAD_REQUEST: 400,
  HTTP_UNAUTHORIZED: 401,
  HTTP_FORBIDDEN: 403,
  HTTP_NOT_FOUND: 404,
  HTTP_TOO_MANY_REQUESTS: 429,
  HTTP_INTERNAL_SERVER_ERROR: 500,

  // レスポンス時間制限
  FAST_RESPONSE_TIME: 100,                // 高速レスポンス（100ms）
  NORMAL_RESPONSE_TIME: 1000,             // 通常レスポンス（1秒）
  SLOW_RESPONSE_TIME: 5000,               // 低速レスポンス（5秒）

  // データサイズ制限
  MAX_REQUEST_SIZE: 1024 * 1024,          // 最大リクエストサイズ（1MB）
  MAX_RESPONSE_SIZE: 10 * 1024 * 1024,    // 最大レスポンスサイズ（10MB）

  // 認証関連
  TOKEN_EXPIRY_BUFFER: 300000,            // トークン有効期限バッファ（5分）
  MAX_AUTH_ATTEMPTS: 3                    // 最大認証試行回数
};

// 文字列定数
const STRING_CONSTANTS = {
  // エラーメッセージ
  AUTHENTICATION_ERROR: 'authentication',
  AUTH_ERROR: 'auth',
  NOT_SUPPORTED_ERROR: 'not supported',
  RATE_LIMIT_ERROR: 'rate limit',
  INSUFFICIENT_FUNDS_ERROR: 'insufficient funds',

  // システム状態
  STATUS_RUNNING: 'running',
  STATUS_STOPPED: 'stopped',
  STATUS_ERROR: 'error',
  STATUS_MAINTENANCE: 'maintenance',

  // 取引側面
  SIDE_BUY: 'buy',
  SIDE_SELL: 'sell',

  // 注文ステータス
  ORDER_STATUS_OPEN: 'open',
  ORDER_STATUS_FILLED: 'filled',
  ORDER_STATUS_CANCELLED: 'cancelled',

  // 取引所ID
  EXCHANGE_BITBANK: 'bitbank',

  // ログレベル
  LOG_LEVEL_ERROR: 'error',
  LOG_LEVEL_WARN: 'warn',
  LOG_LEVEL_INFO: 'info',
  LOG_LEVEL_DEBUG: 'debug',
  LOG_LEVEL_SILENT: 'silent',
  LOG_LEVEL_VERBOSE: 'verbose'
};

// 通貨ペア定数
const CURRENCY_PAIRS = {
  // 主要通貨ペア
  MAJOR_PAIRS: [
    'BTC/JPY',
    'ETH/JPY',
    'XRP/JPY',
    'LTC/JPY',
    'BCH/JPY'
  ],

  // 拡張通貨ペア
  EXTENDED_PAIRS: [
    'SOL/JPY',
    'DOT/JPY',
    'XLM/JPY',
    'LINK/JPY',
    'GALA/JPY',
    'APE/JPY',
    'MANA/JPY',
    'SAND/JPY',
    'CHZ/JPY',
    'OAS/JPY'
  ],

  // 基軸通貨
  BASE_CURRENCIES: ['BTC', 'ETH', 'XRP', 'LTC', 'BCH', 'SOL', 'DOT', 'XLM', 'LINK'],
  QUOTE_CURRENCY: 'JPY'
};

// 計算式定数
const CALCULATION_CONSTANTS = {
  // パーセンテージ変換
  PERCENTAGE_MULTIPLIER: 100,

  // 円周率関連
  PI: Math.PI,
  TWO_PI: 2 * Math.PI,

  // 数学的定数
  GOLDEN_RATIO: 1.618,
  EULER_NUMBER: Math.E,

  // 統計関連
  STANDARD_DEVIATION_MULTIPLIER: 2,       // 標準偏差の2倍
  CONFIDENCE_INTERVAL_95: 1.96,           // 95%信頼区間
  CONFIDENCE_INTERVAL_99: 2.58            // 99%信頼区間
};

module.exports = {
  TIME_CONSTANTS,
  PRECISION_CONSTANTS,
  SYSTEM_LIMITS,
  API_CONSTANTS,
  STRING_CONSTANTS,
  CURRENCY_PAIRS,
  CALCULATION_CONSTANTS
};