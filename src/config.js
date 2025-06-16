const ccxt = require('ccxt');
const dotenv = require('dotenv');
dotenv.config(); // .envファイルから環境変数を読み込む

// strategies 
const { maStrategy, macdStrategy, rsiStrategy, bollingerBandsStrategy } = require('./strategies/trendFollowing');
const { meanReversionStrategy, oscillatorStrategy } = require('./strategies/meanReversion');
const { mutualInformationStrategy } = require('./strategies/mutualInformation');
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
    tradePercentage: 0.01,  // 資金の%で取引（動的サイジング無効時）

    // 除外シンボル
    excludeSymbols: [
      'ELF/',
      'MATIC/',
      'RNDR/',
      // 'ATOM/',
    ],
    
    // 動的ポジションサイジング設定
    dynamicPositionSizing: {
      enabled: true,
      baseRiskPerTrade: 0.01, // 1%
      atrPeriod: 14,
      atrMultiplier: 2,
      maxPositionPercent: 0.1, // 10%
      minPositionPercent: 0.001, // 0.1%
      
      // Kelly基準設定
      kellyEnabled: false, // Phase 1では無効
      kellyFraction: 0.25,
      
      // パフォーマンス調整
      performanceAdjustment: true,
      lookbackDays: 30
    }
  },
  
  // 戦略固有の デフォルト設定
  strategies: {

    // 高頻度取引戦略 (bitbank WebSocket)
    HFT: {
      enabled: process.env.STRATEGY_HFT_BB_WS_ENABLED === 'true',
      function: require('./hft').startHFTStrategy,
      atomicExec: true,
      exchanges: [exchangeBB],
    },

    MUTUAL_INFO: {
      enabled: true,
      threshold: 0.5,
      ohlcvInterval: '5m',
      deviationThreshold: 3,
      useReturns: true,
      referenceSymbols: 'all', // すべてのシンボルを参照シンボルとして使用
      function: mutualInformationStrategy,
      exchanges: [exchangeBB],
      enableRiskManagement: true,
      
      // リスク管理設定（実装に合わせた形式）
      riskSettings: {
        fixedStopLossPercent: 0.02,        // 2%の固定ストップロス
        trailingStopTriggerPercent: 0.01,  // 1%の利益でトレーリング発動
        trailingStopDistancePercent: 0.01, // 最高値から1%でトレーリング
        timeBasedStopHours: 24,            // 24時間でタイムストップ
        dailyMaxLossPercent: 0.05,         // 日次最大損失5%
        weeklyMaxLossPercent: 0.10,        // 週次最大損失10%
        monthlyMaxLossPercent: 0.15,       // 月次最大損失15%
        maxPositionsPerPair: 3,            // 同一ペアの最大ポジション
        maxTotalPositions: 10,             // 全体の最大ポジション
      }
    },

    // 逆張り戦略
    MEAN_REVERSION: {
      enabled: true,
      period: 20,
      ohlcvInterval: '15m',
      deviationThreshold: 3,
      function: meanReversionStrategy,
      exchanges: [exchangeBB],
      enableRiskManagement: true,
      
      // リスク管理設定（実装に合わせた形式）
      riskSettings: {
        fixedStopLossPercent: 0.018,       // 1.8%の固定ストップロス
        trailingStopTriggerPercent: 0.012, // 1.2%の利益でトレーリング発動
        trailingStopDistancePercent: 0.012, // 最高値から1.2%でトレーリング
        timeBasedStopHours: 20,            // 20時間でタイムストップ
        dailyMaxLossPercent: 0.04,         // 日次最大損失4%
        weeklyMaxLossPercent: 0.08,        // 週次最大損失8%
        monthlyMaxLossPercent: 0.12,       // 月次最大損失12%
        maxPositionsPerPair: 2,            // 同一ペアの最大ポジション
        maxTotalPositions: 8,              // 全体の最大ポジション
      }
    },

    MACD: {
      enabled: true,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      ohlcvInterval: '15m',
      function: macdStrategy,
      exchanges: [exchangeBB],
      enableRiskManagement: true,
      
      // リスク管理設定（実装に合わせた形式）
      riskSettings: {
        fixedStopLossPercent: 0.022,       // 2.2%の固定ストップロス
        trailingStopTriggerPercent: 0.018, // 1.8%の利益でトレーリング発動
        trailingStopDistancePercent: 0.018, // 最高値から1.8%でトレーリング
        timeBasedStopHours: 36,            // 36時間でタイムストップ
        dailyMaxLossPercent: 0.06,         // 日次最大損失6%
        weeklyMaxLossPercent: 0.12,        // 週次最大損失12%
        monthlyMaxLossPercent: 0.18,       // 月次最大損失18%
        maxPositionsPerPair: 4,            // 同一ペアの最大ポジション
        maxTotalPositions: 12,             // 全体の最大ポジション
      }
    },

    BOLLINGER_BANDS: {
      enabled: true,
      period: 20,
      stdDev: 2,
      ohlcvInterval: '15m',
      function: bollingerBandsStrategy,
      exchanges: [exchangeBB],
      enableRiskManagement: true,
      
      // リスク管理設定（実装に合わせた形式）
      riskSettings: {
        fixedStopLossPercent: 0.019,       // 1.9%の固定ストップロス
        trailingStopTriggerPercent: 0.014, // 1.4%の利益でトレーリング発動
        trailingStopDistancePercent: 0.014, // 最高値から1.4%でトレーリング
        timeBasedStopHours: 28,            // 28時間でタイムストップ
        dailyMaxLossPercent: 0.045,        // 日次最大損失4.5%
        weeklyMaxLossPercent: 0.09,        // 週次最大損失9%
        monthlyMaxLossPercent: 0.135,      // 月次最大損失13.5%
        maxPositionsPerPair: 3,            // 同一ペアの最大ポジション
        maxTotalPositions: 9,              // 全体の最大ポジション
      }
    }, 

    // トレンドフォロー戦略
    MA: {
      enabled: true,
      shortPeriod: 5,
      longPeriod: 20,
      ohlcvInterval: '15m',
      function: maStrategy,
      exchanges: [exchangeBB],
      enableRiskManagement: true,
      
      // リスク管理設定（実装に合わせた形式）
      riskSettings: {
        fixedStopLossPercent: 0.02,        // 2%の固定ストップロス
        trailingStopTriggerPercent: 0.016, // 1.6%の利益でトレーリング発動
        trailingStopDistancePercent: 0.016, // 最高値から1.6%でトレーリング
        timeBasedStopHours: 30,            // 30時間でタイムストップ
        dailyMaxLossPercent: 0.055,        // 日次最大損失5.5%
        weeklyMaxLossPercent: 0.11,        // 週次最大損失11%
        monthlyMaxLossPercent: 0.165,      // 月次最大損失16.5%
        maxPositionsPerPair: 3,            // 同一ペアの最大ポジション
        maxTotalPositions: 10,             // 全体の最大ポジション
      }
    },

    OSCILLATOR: {
      enabled: true,
      period: 20,
      oversoldThreshold: 20,
      overboughtThreshold: 80,
      ohlcvInterval: '15m',
      function: oscillatorStrategy,
      exchanges: [exchangeBB],
      enableRiskManagement: true,
      
      // リスク管理設定（実装に合わせた形式）
      riskSettings: {
        fixedStopLossPercent: 0.017,       // 1.7%の固定ストップロス
        trailingStopTriggerPercent: 0.013, // 1.3%の利益でトレーリング発動
        trailingStopDistancePercent: 0.013, // 最高値から1.3%でトレーリング
        timeBasedStopHours: 18,            // 18時間でタイムストップ
        dailyMaxLossPercent: 0.042,        // 日次最大損失4.2%
        weeklyMaxLossPercent: 0.084,       // 週次最大損失8.4%
        monthlyMaxLossPercent: 0.126,      // 月次最大損失12.6%
        maxPositionsPerPair: 2,            // 同一ペアの最大ポジション
        maxTotalPositions: 8,              // 全体の最大ポジション
      }
    },

    RSI: {
      enabled: true,
      period: 14,
      oversoldThreshold: 30,
      overboughtThreshold: 70,
      ohlcvInterval: '15m',
      function: rsiStrategy,
      exchanges: [exchangeBB],
      enableRiskManagement: true,
      
      // リスク管理設定（実装に合わせた形式）
      riskSettings: {
        fixedStopLossPercent: 0.0195,      // 1.95%の固定ストップロス
        trailingStopTriggerPercent: 0.0145, // 1.45%の利益でトレーリング発動
        trailingStopDistancePercent: 0.0145, // 最高値から1.45%でトレーリング
        timeBasedStopHours: 26,            // 26時間でタイムストップ
        dailyMaxLossPercent: 0.048,        // 日次最大損失4.8%
        weeklyMaxLossPercent: 0.096,       // 週次最大損失9.6%
        monthlyMaxLossPercent: 0.144,      // 月次最大損失14.4%
        maxPositionsPerPair: 3,            // 同一ペアの最大ポジション
        maxTotalPositions: 9,              // 全体の最大ポジション
      }
    },

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