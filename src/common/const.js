// Bitbankでサポートされているタイムフレームのみを使用
// 4h, 8h, 12h, 1d, 1wはBitbank APIでサポートされていないため除外
const OHLCVTimeFrames = ['1m', '5m', '15m', '30m', '1h'];
// const OHLCVTimeFrames = ["1d"]; // 古い設定（使用不可）

// 環境変数の安全な解析関数
function parseEnvInt(envVar, defaultValue, minValue = 0) {
  if (!envVar) {
    return defaultValue;
  }
  const parsed = parseInt(envVar);
  if (isNaN(parsed) || parsed < minValue) {
    console.warn(`[Config] Invalid environment variable: ${envVar}, using default: ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}

// API/Exchange設定定数 - 改善されたスロットリング制御
// bitbank API制限: 取得系 10回/秒、更新系 6回/秒
// 実測値: 5秒間隔で安定、8秒間隔で確実に問題回避
// TODO: 実データ分析システムを活用し、安定性を保ちつつパフォーマンス最適化を継続検討（目標: 5-6秒）
const EXCHANGE_SETTINGS = {
  // 環境変数対応: バリデーション付きで安全に解析
  RATE_LIMIT: parseEnvInt(process.env.EXCHANGE_RATE_LIMIT, 15000, 1000), // 緊急対応: 15秒間隔（最小1秒制限）
  TIMEOUT: parseEnvInt(process.env.EXCHANGE_TIMEOUT, 60000, 5000), // 60秒タイムアウト（最小5秒制限）
  MAX_THROTTLE_QUEUE_SIZE: parseEnvInt(process.env.EXCHANGE_MAX_THROTTLE_QUEUE_SIZE, 5000, 100), // 最小100に制限
  RECV_WINDOW: 60000,
  // 新しい設定: 段階的バックオフ
  BACKOFF_ENABLED: true,
  BACKOFF_INITIAL_DELAY: 5000, // 初期遅延 5秒に拡大（緊急対応）
  BACKOFF_MAX_DELAY: 120000, // 最大遅延 2分に拡大
  BACKOFF_MULTIPLIER: 3, // 遅延倍数を3に拡大
  // 新しい設定: 接続監視
  HEALTH_CHECK_INTERVAL: 60000, // 1分間隔でヘルスチェック
  MAX_CONSECUTIVE_FAILURES: 2, // 連続失敗回数の閾値を2に削減（即座に発見）
  // 新しい設定: 並列実行制限（API負荷軽減）
  MAX_CONCURRENT_PAIRS: parseEnvInt(process.env.EXCHANGE_MAX_CONCURRENT_PAIRS, 1, 1), // 緊急対応: 同時処理を1に制限（最小1、最大並列数制限）
  EXECUTION_DELAY_MS: parseEnvInt(process.env.EXCHANGE_EXECUTION_DELAY_MS, 5000, 1000) // 各ペア処理間の遅延（最小1秒制限）
};

// リスク管理設定定数
const RISK_MANAGEMENT_SETTINGS = {
  DEFAULT_STOP_LOSS_PERCENT: parseFloat(process.env.DEFAULT_STOP_LOSS_PERCENT) || 0.02, // 2%
  TIME_BASED_STOP_HOURS: parseEnvInt(process.env.TIME_BASED_STOP_HOURS, 24, 1), // 24時間
  MAX_POSITION_SIZE_PERCENT: parseFloat(process.env.MAX_POSITION_SIZE_PERCENT) || 0.05, // 5%
  MAX_DAILY_LOSS_PERCENT: parseFloat(process.env.MAX_DAILY_LOSS_PERCENT) || 0.10 // 10%
};

// 監視システム設定定数
const MONITORING_SETTINGS = {
  SYSTEM_MONITOR_INTERVAL: parseEnvInt(process.env.SYSTEM_MONITOR_INTERVAL, 300000, 60000), // 5分間隔
  REDIS_CONNECTION_TIMEOUT: parseEnvInt(process.env.REDIS_CONNECTION_TIMEOUT, 10000, 5000), // 10秒
  THROTTLE_MONITOR_INTERVAL: parseEnvInt(process.env.THROTTLE_MONITOR_INTERVAL, 5000, 1000), // 5秒
  HEARTBEAT_INTERVAL: parseEnvInt(process.env.HEARTBEAT_INTERVAL, 60000, 30000), // 1分間隔
  ALERT_COOLDOWN_MS: parseEnvInt(process.env.ALERT_COOLDOWN_MS, 300000, 60000) // 5分間
};

// 通知設定定数
const NOTIFICATION_SETTINGS = {
  DEDUPLICATION_WINDOW_MS: parseEnvInt(process.env.NOTIFICATION_DEDUPLICATION_WINDOW, 3600000, 60000), // 1時間
  RATE_LIMIT_WINDOW_MS: parseEnvInt(process.env.NOTIFICATION_RATE_LIMIT_WINDOW, 60000, 30000), // 1分間
  MAX_NOTIFICATIONS_PER_WINDOW: parseEnvInt(process.env.MAX_NOTIFICATIONS_PER_WINDOW, 10, 1), // 10通知/分
  RETRY_ATTEMPTS: parseEnvInt(process.env.NOTIFICATION_RETRY_ATTEMPTS, 3, 1), // 3回
  RETRY_DELAY_MS: parseEnvInt(process.env.NOTIFICATION_RETRY_DELAY, 5000, 1000) // 5秒
};

// 戦略設定定数
const STRATEGY_SETTINGS = {
  RSI_OVERSOLD_THRESHOLD: parseEnvInt(process.env.RSI_OVERSOLD_THRESHOLD, 20, 1), // 20
  RSI_OVERBOUGHT_THRESHOLD: parseEnvInt(process.env.RSI_OVERBOUGHT_THRESHOLD, 80, 1), // 80
  BOLLINGER_BAND_PERIOD: parseEnvInt(process.env.BOLLINGER_BAND_PERIOD, 20, 5), // 20期間
  BOLLINGER_BAND_DEVIATION: parseFloat(process.env.BOLLINGER_BAND_DEVIATION) || 2.0, // 2標準偏差
  VOLUME_THRESHOLD_MULTIPLIER: parseFloat(process.env.VOLUME_THRESHOLD_MULTIPLIER) || 1.5, // 1.5倍
  MOMENTUM_LOOKBACK_PERIODS: parseEnvInt(process.env.MOMENTUM_LOOKBACK_PERIODS, 14, 1) // 14期間
};

// 取引設定定数
const TRADING_SETTINGS = {
  DEFAULT_AMOUNT: 0.0001, // 最小取引単位
  TRADE_PERCENTAGE: 0.01, // 資金の%で取引（動的サイジング無効時）
  EXCLUDE_SYMBOLS: [
    'ELF/',
    'MATIC/',
    'RNDR/',
    'BCH/',  // ゼロボリューム・データ不足のため除外
    'ASTR/' // bitbank APIエラー10009のため除外
    // 'ATOM/',
  ]
};

// 取引実行精度定数
const TRADING_EXECUTION_CONSTANTS = {
  // ボリューム正規化
  VOLUME_NORMALIZATION_BASE: 1000,      // ボリューム正規化の基準値
  
  // 実行確率
  BASE_EXECUTION_PROBABILITY: 0.85,     // 基本実行確率（85%）
  MAX_EXECUTION_PROBABILITY: 0.99,      // 最大実行確率（99%）
  
  // スリッページ設定
  BASE_SLIPPAGE_PERCENT: 0.0001,        // 基本スリッページ（0.01%）
  MAX_SLIPPAGE_PERCENT: 0.001,          // 最大スリッページ（0.1%）
  
  // スプレッド設定
  BASE_SPREAD_PERCENT: 0.0002,          // 基本スプレッド（0.02%）
  MAX_SPREAD_PERCENT: 0.002,            // 最大スプレッド（0.2%）
  
  // スプレッド計算係数
  SPREAD_VOLATILITY_MULTIPLIER: 2,      // ボラティリティによるスプレッド拡大係数
  SPREAD_DIVISOR: 2                     // スプレッドを半分に分割する係数
};

// ポジション制御定数
const POSITION_CONTROL_CONSTANTS = {
  // 固定ストップロス設定
  FIXED_STOP_LOSS_PERCENT: 0.03,        // 固定ストップロス（3%）
  
  // トレーリングストップ設定
  TRAILING_STOP_TRIGGER_PERCENT: 0.02,  // トレーリングストップ発動閾値（2%利益）
  TRAILING_STOP_DISTANCE_PERCENT: 0.02, // トレーリングストップ距離（2%）
  
  // 時間ベース設定
  TIME_BASED_STOP_HOURS: 24,            // 時間ベースストップ（24時間）
  POSITION_AGE_DIVISOR: 1000 * 60 * 60  // ポジション年齢計算用除数（ミリ秒→時間）
};

// ポートフォリオレベル制御定数
const PORTFOLIO_CONTROL_CONSTANTS = {
  // グローバル制限
  MAX_TOTAL_POSITIONS: 200,              // 最大総ポジション数
  MAX_TOTAL_VALUE: 1000000,             // 最大総価値（¥100万）
  
  // 配分制限
  MAX_SINGLE_STRATEGY_RATIO: 0.35,      // 単一戦略最大割合（35%）
  MAX_SINGLE_CURRENCY_RATIO: 0.10,      // 単一通貨最大割合（10%）
  
  // リスク制限
  MAX_DRAWDOWN: 0.15,                   // 最大ドローダウン（15%）
  MAX_DAILY_LOSS: 0.05,                 // 日次最大損失（5%）
  MAX_LONG_RATIO: 0.75,                 // ロングポジション最大割合（75%）
  MAX_CORRELATION: 0.8,                 // 戦略間最大相関（80%）
  VOLATILITY_THRESHOLD: 0.3,            // ボラティリティ閾値（30%）
  
  // 戦略配分目標値
  STRATEGY_ALLOCATION: {
    BOLLINGER_BANDS_CONSERVATIVE: { min: 0.25, max: 0.35, target: 0.30 },
    BOLLINGER_BANDS_AGGRESSIVE: { min: 0.15, max: 0.25, target: 0.20 },
    MULTI_INDICATOR: { min: 0.20, max: 0.30, target: 0.25 },
    MEAN_REVERSION: { min: 0.10, max: 0.20, target: 0.15 },
    MACD: { min: 0.05, max: 0.15, target: 0.10 },
    TECHNICAL_MOMENTUM: { min: 0.00, max: 0.10, target: 0.05 }
  }
};

// bitFlyer最小取引数量
const BITFLYER_MIN_TRADE_AMOUNTS = {
  'BTC/JPY': 0.001,
  'ELF/JPY': 0.01,
  'ETH/BTC': 0.01,
  'BCH/BTC': 0.01,
  'ETH/JPY': 0.01,
  'XRP/JPY': 0.1,
  'XLM/JPY': 0.1,
  'MONA/JPY': 0.1
};

// 注文管理設定定数
const ORDER_MANAGEMENT_SETTINGS = {
  DEFAULT_SLIPPAGE_TOLERANCE: parseFloat(process.env.DEFAULT_SLIPPAGE_TOLERANCE) || 0.005, // 0.5%
  ORDER_TIMEOUT: parseEnvInt(process.env.ORDER_TIMEOUT, 60000, 5000), // 60秒
  ORDER_MAX_RETRIES: parseEnvInt(process.env.ORDER_MAX_RETRIES, 3, 1), // 3回
  ORDER_RETRY_DELAY: parseEnvInt(process.env.ORDER_RETRY_DELAY, 1000, 500), // 1秒
  POSITION_TIMEOUT_HOURS: parseEnvInt(process.env.POSITION_TIMEOUT_HOURS, 24, 1) // 24時間
};

module.exports = {
  OHLCVTimeFrames,
  EXCHANGE_SETTINGS,
  TRADING_SETTINGS,
  TRADING_EXECUTION_CONSTANTS,
  POSITION_CONTROL_CONSTANTS,
  PORTFOLIO_CONTROL_CONSTANTS,
  BITFLYER_MIN_TRADE_AMOUNTS,
  ORDER_MANAGEMENT_SETTINGS,
  RISK_MANAGEMENT_SETTINGS,
  MONITORING_SETTINGS,
  NOTIFICATION_SETTINGS,
  STRATEGY_SETTINGS
};