
// Bitbankでサポートされているタイムフレームのみを使用
// 4h, 8h, 12h, 1d, 1wはBitbank APIでサポートされていないため除外
const OHLCVTimeFrames = ['1m', '5m', '15m', '30m', '1h'];
// const OHLCVTimeFrames = ["1d"]; // 古い設定（使用不可）

// API/Exchange設定定数 - 極限緊急スロットリング制御
const EXCHANGE_SETTINGS = {
  RATE_LIMIT: 10000, // 10秒間隔に拡大（極限緊急API負荷軽減）
  TIMEOUT: 120000, // 120秒タイムアウト（極限緊急時延長）
  MAX_THROTTLE_QUEUE_SIZE: 10, // キューサイズを極限まで削減（極限緊急制御）
  RECV_WINDOW: 120000
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