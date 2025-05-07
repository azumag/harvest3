const ccxt = require('ccxt');
const dotenv = require('dotenv');
dotenv.config(); // .envファイルから環境変数を読み込む

// strategies 
const { maStrategy, macdStrategy, rsiStrategy, bollingerBandsStrategy } = require('./strategies/trendFollowing');
const { meanReversionStrategy, oscillatorStrategy } = require('./strategies/meanReversion');
// const { highFrequencyTrading } = require('./strategies/highFrequencyTrading');

// APIキーとシークレットを設定
// TODO: move to const.js
const BBApiKey = process.env.BB_API_KEY;
const BBApiSecret = process.env.BB_API_SECRET;

const BFApiKey = process.env.BF_API_KEY;
const BFApiSecret = process.env.BF_API_SECRET;

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

  global: {
    // 共通設定
    amount: 0.0001,  // 最小取引単位
    tradePercentage: 0.01,  // 資金の%で取引

    // 除外シンボル
    excludeSymbols: [
      'ELF/',
      'MATIC/',
      'RNDR/',
    ],
  },
  
  // 戦略固有の デフォルト設定
  strategies: {

    // 高頻度取引戦略 (bitbank WebSocket)
    HFT: {
      enabled: process.env.STRATEGY_HFT_BB_WS_ENABLED === 'true', // .envで制御できるようにする
      // interval, priceThreshold, orderBookDepth などのパラメータは src/hft/config.js で管理
      function: require('./hft').startHFTStrategy, // 新しいHFT戦略のエントリポイント
      atomicExec: true,
      exchanges: [exchangeBB], // bitbank を使用
    },

    RSI: {
      enabled: true,
      period: 14,
      oversoldThreshold: 30,
      overboughtThreshold: 70,
      ohlcvInterval: '15m',
      function: rsiStrategy,
      exchanges: [exchangeBB]
    },

    // 逆張り戦略
    MEAN_REVERSION: {
      enabled: true,
      period: 20,
      ohlcvInterval: '15m',
      deviationThreshold: 3,
      function: meanReversionStrategy,
      exchanges: [exchangeBB]
    },

    MACD: {
      enabled: true,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      ohlcvInterval: '15m',
      function: macdStrategy,
      exchanges: [exchangeBB]
    },

    BOLLINGER_BANDS: {
      enabled: true,
      period: 20,
      stdDev: 2,
      ohlcvInterval: '15m',
      function: bollingerBandsStrategy,
      exchanges: [exchangeBB]
    }, 

    // トレンドフォロー戦略
    MA: {
      enabled: true,
      shortPeriod: 5,
      longPeriod: 20,
      ohlcvInterval: '15m',
      function: maStrategy,
      exchanges: [exchangeBB]
    },

    OSCILLATOR: {
      enabled: true,
      period: 20,
      oversoldThreshold: 20,
      overboughtThreshold: 80,
      ohlcvInterval: '15m',
      function: oscillatorStrategy,
      exchanges: [exchangeBB],
    },

    // BOLLINGER_BANDS: {
    //   enabled: true,
    //   period: 20,
    //   stdDev: 2,
    //   ohlcvInterval: '15m',
    //   function: bollingerBandsStrategy,
    //   exchanges: [exchangeBB]
    // },

    // アービトラージ戦略
    // INTER_EXCHANGE_ARBITRAGE: {
    //   enabled: process.env.STRATEGY_ARBITRAGE_ENABLED === 'true',
    //   minProfitPercent: 1.0,
    //   function: interExchangeArbitrage,
    //   exchanges: [exchangeBB, exchangeBF],
    // },

    // SCALPING: {
    //   enabled: process.env.STRATEGY_SCALPING_ENABLED === 'true',
    //   function: scalpingStrategy,
    //   exchanges: [exchangeBB],
    // },

    // マーケットメイキング戦略
    // MARKET_MAKING: {
    //   enabled: process.env.STRATEGY_MARKET_MAKING_ENABLED === 'true',
    //   rangePeriod: 300000, // レンジ判定期間（ミリ秒）: 5分
    //   rangeThreshold: 1.0, // レンジ判定閾値（%）: 1%
    //   spreadWidth: 0.5, // スプレッド幅（%）: 0.5%
    //   reorderInterval: 60000, // 再発注間隔（ミリ秒）: 1分
    //   maxPositionCount: 4, // 最大ポジション数
    //   adjustmentValue: 0, // 微調整値,
    //   function: passiveMarketMaking,
    //   exchanges: [exchangeBB],
    // },

    // INYO: {
    //   enabled: process.env.STRATEGY_INYO_ENABLED === 'true',
    //   function: inyoStrategy,
    //   exchanges: [exchangeBB],
    // },

  },

  exchanges: {
    'bitbank': {
      apiKey: BBApiKey,
      secret: BBApiSecret,
      module: 'bitbank',
      instance: exchangeBB,
    },
    // 'bitflyer': {
    //   apiKey: BFApiKey,
    //   secret: BFApiSecret,
    //   module: 'bitflyer',
    //   instance: exchangeBF,
    // }
  }
};

module.exports = {
  BBApiKey,
  BBApiSecret,
  BFApiKey,
  BFApiSecret,
  exchangeBB,
  exchangeBF,
  bitflyerMinTradeAmounts,
  config
};