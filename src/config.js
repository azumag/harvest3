const ccxt = require('ccxt');
const dotenv = require('dotenv');
dotenv.config(); // .envファイルから環境変数を読み込む

// APIキーとシークレットを設定
const BBApiKey = process.env.BB_API_KEY;
const BBApiSecret = process.env.BB_API_SECRET;

const BFApiKey = process.env.BF_API_KEY;
const BFApiSecret = process.env.BF_API_SECRET;

const discordErrorWebhookUrl = process.env.DISCORD_ERROR_WEBHOOK_URL; // Discord Webhook URL
const discordOrderWebhookUrl = process.env.DISCORD_ORDER_WEBHOOK_URL; // Discord Webhook URL
const discordResultWebhookUrl = process.env.DISCORD_RESULT_WEBHOOK_URL; // Discord Webhook URL

const exchangeBB = new ccxt.bitbank({
    apiKey: BBApiKey,
    secret: BBApiSecret,
    enableRateLimit: true,
    rateLimit: 1000, // 1リクエストあたり1000ミリ秒（1秒）の制限
    options: {
        'maxThrottleQueueSize': 2000 // スロットルキューの最大サイズを増やす
    }
});

const exchangeBF = new ccxt.bitflyer({
    apiKey: BFApiKey,
    secret: BFApiSecret,
    enableRateLimit: true,
    rateLimit: 1000 // 1リクエストあたり1000ミリ秒（1秒）の制限
});

const bitflyerMinTradeAmounts = {
  'BTC/JPY': 0.001,
  'ELF/JPY': 0.01,
  'ETH/BTC': 0.01,
  'BCH/BTC': 0.01,
  'ETH/JPY': 0.01,
  'XRP/JPY': 0.1,
  'XLM/JPY': 0.1,
  'MONA/JPY': 0.1,
};

// 設定パラメータ
const config = {
  // 共通設定
  amount: 0.0001,  // 注文するBTCの量（固定値、tradePercentageが優先される）
  profitMargin: 0.003,  // 目標利益率（取引料を考慮）
  maxHistoryLength: 100,  // スプレッド履歴の最大長
  tradePercentage: 0.01,  // 資金の%で取引
  sellPercentage: 0.1,   // 売却時の資金の%
  tradeCost: 0.0012, // 手数料暫定（bitbank)
  cancelOrderThreshold: 10, // 一銘柄ごとの注文限度数
  safetyJPYAmount: 2000, // JPY残高がこの額を下回ったら購入しない(HFTのときのみ)
  amountPrecision: 8, // 取引量の小数点以下の桁数（デフォルト値）
  
  // 戦略固有の設定
  strategies: {
    // トレンドフォロー戦略
    MA: {
      enabled: process.env.STRATEGY_MA_ENABLED === 'true',
      shortPeriod: 5,
      longPeriod: 20
    },
    MACD: {
      enabled: process.env.STRATEGY_MACD_ENABLED === 'true',
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9
    },
    RSI: {
      enabled: process.env.STRATEGY_RSI_ENABLED === 'true',
      period: 14,
      oversoldThreshold: 30,
      overboughtThreshold: 70
    },
    BOLLINGER_BANDS: {
      enabled: process.env.STRATEGY_BOLLINGER_BANDS_ENABLED === 'true',
      period: 20,
      stdDev: 2
    },
    
    // 逆張り戦略
    MEAN_REVERSION: {
      enabled: process.env.STRATEGY_MEAN_REVERSION_ENABLED === 'true',
      period: 20,
      deviationThreshold: 3
    },
    OSCILLATOR: {
      enabled: process.env.STRATEGY_OSCILLATOR_ENABLED === 'true',
      period: 14,
      oversoldThreshold: 20,
      overboughtThreshold: 80
    },
    
    // アービトラージ戦略
    INTER_EXCHANGE_ARBITRAGE: {
      enabled: process.env.STRATEGY_ARBITRAGE_ENABLED === 'true',
      minProfitPercent: 1.0
    },
    
    // 高頻度取引戦略
    HFT: {
      enabled: process.env.STRATEGY_HIGH_FREQUENCY_ENABLED === 'true',
      interval: 1000,
      priceThreshold: 0.05,
      maxOrdersPerMinute: 10
    },
    SCALPING: {
      enabled: process.env.STRATEGY_SCALPING_ENABLED === 'false'
    },
    
    // マーケットメイキング戦略
    MARKET_MAKING: {
      enabled: process.env.STRATEGY_MARKET_MAKING_ENABLED === 'true',
      rangePeriod: 300000, // レンジ判定期間（ミリ秒）: 5分
      rangeThreshold: 1.0, // レンジ判定閾値（%）: 1%
      spreadWidth: 0.5, // スプレッド幅（%）: 0.5%
      reorderInterval: 60000, // 再発注間隔（ミリ秒）: 1分
      maxPositionCount: 4, // 最大ポジション数
      adjustmentValue: 0 // 微調整値
    },

    INYO: {
      enabled: process.env.STRATEGY_INYO_ENABLED === 'true'
    },
  }
};

module.exports = {
  BBApiKey,
  BBApiSecret,
  BFApiKey,
  BFApiSecret,
  discordErrorWebhookUrl,
  discordOrderWebhookUrl,
  discordResultWebhookUrl,
  exchangeBB,
  exchangeBF,
  bitflyerMinTradeAmounts,
  config
};