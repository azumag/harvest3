
// Bitbankでサポートされているタイムフレームのみを使用
// 4h, 8h, 12h, 1d, 1wはBitbank APIでサポートされていないため除外
const OHLCVTimeFrames = ['1m', '5m', '15m', '30m', '1h'];
// const OHLCVTimeFrames = ["1d"]; // 古い設定（使用不可）

// API/Exchange設定定数 - 改善されたスロットリング制御
const EXCHANGE_SETTINGS = {
  RATE_LIMIT: 1000, // 1秒間隔に戻す（適切な負荷制御）
  TIMEOUT: 60000, // 60秒タイムアウト（適切な応答時間）
  MAX_THROTTLE_QUEUE_SIZE: 500, // キューサイズを適切に拡大（安定性確保）
  RECV_WINDOW: 60000,
  // 新しい設定: 段階的バックオフ
  BACKOFF_ENABLED: true,
  BACKOFF_INITIAL_DELAY: 1000, // 初期遅延 1秒
  BACKOFF_MAX_DELAY: 30000, // 最大遅延 30秒
  BACKOFF_MULTIPLIER: 2, // 遅延倍数
  // 新しい設定: 接続監視
  HEALTH_CHECK_INTERVAL: 60000, // 1分間隔でヘルスチェック
  MAX_CONSECUTIVE_FAILURES: 5 // 連続失敗回数の閾値
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
    // 'ATOM/',
  ]
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
  'MONA/JPY': 0.1,
};

// 注文管理設定定数
const ORDER_MANAGEMENT_SETTINGS = {
  MAX_SLIPPAGE: 0.005, // 0.5%
  ORDER_TIMEOUT: 60000, // 60秒
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000, // 1秒
};

module.exports = {
  OHLCVTimeFrames,
  EXCHANGE_SETTINGS,
  TRADING_SETTINGS,
  BITFLYER_MIN_TRADE_AMOUNTS,
  ORDER_MANAGEMENT_SETTINGS,
};