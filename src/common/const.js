
// Bitbankでサポートされているタイムフレームのみを使用
// 4h, 8h, 12h, 1d, 1wはBitbank APIでサポートされていないため除外
const OHLCVTimeFrames = ['1m', '5m', '15m', '30m', '1h'];
// const OHLCVTimeFrames = ["1d"]; // 古い設定（使用不可）

// 環境変数の安全な解析関数
function parseEnvInt(envVar, defaultValue, minValue = 0) {
  if (!envVar) return defaultValue;
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

// 取引設定定数
const TRADING_SETTINGS = {
  DEFAULT_AMOUNT: 0.0001, // 最小取引単位
  TRADE_PERCENTAGE: 0.01, // 資金の%で取引（動的サイジング無効時）
  EXCLUDE_SYMBOLS: [
    'ELF/',
    'MATIC/',
    'RNDR/',
    'BCH/',  // ゼロボリューム・データ不足のため除外
    'ASTR/', // bitbank APIエラー10009のため除外
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