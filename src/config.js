const ccxt = require('ccxt');
const dotenv = require('dotenv');
const { EXCHANGE_SETTINGS, TRADING_SETTINGS, BITFLYER_MIN_TRADE_AMOUNTS, ORDER_MANAGEMENT_SETTINGS } = require('./common/const');
dotenv.config(); // .envファイルから環境変数を読み込む

// strategies 
const { maStrategy, macdStrategy, rsiStrategy, bollingerBandsStrategy, multiIndicatorStrategy } = require('./strategies/trendFollowing');
const { meanReversionStrategy, oscillatorStrategy } = require('./strategies/meanReversion');
const { mutualInformationStrategy } = require('./strategies/mutualInformation');
// const { highFrequencyTrading } = require('./strategies/highFrequencyTrading');

// APIキーとシークレットを設定
// TODO: move to const.js
const BBApiKey = process.env.BB_API_KEY;
const BBApiSecret = process.env.BB_API_SECRET;

const BFApiKey = process.env.BF_API_KEY;
const BFApiSecret = process.env.BF_API_SECRET;

// 緊急対応: CCXTインスタンス作成と強制throttle設定
const exchangeBB = new ccxt.bitbank({
    apiKey: BBApiKey,
    secret: BBApiSecret,
    enableRateLimit: true,
    rateLimit: EXCHANGE_SETTINGS.RATE_LIMIT,
    timeout: EXCHANGE_SETTINGS.TIMEOUT,
    options: {
        'maxThrottleQueueSize': EXCHANGE_SETTINGS.MAX_THROTTLE_QUEUE_SIZE,
        'defaultType': 'spot',
        'recvWindow': EXCHANGE_SETTINGS.RECV_WINDOW,
        'adjustForTimeDifference': true
    }
});

// 緊急対応: throttle機能を完全に無効化してAPI制限を回避
// CCXTのthrottle機能が正常に動作しないため、独自制御に切り替え
console.log('[緊急対応] CCXTのthrottle機能を無効化');
exchangeBB.enableRateLimit = false;
exchangeBB.rateLimit = 0;

// 独自のAPI制限機能を実装
// TODO: 項目15対応 - CCXT標準機能への移行が完了するまでの一時的な実装
let lastApiCall = 0;
const originalThrottle = exchangeBB.throttle.bind(exchangeBB);
exchangeBB.throttle = async function(cost = 1) {
    const now = Date.now();
    const timeSinceLastCall = now - lastApiCall;
    // cost引数を考慮: コストが高いほど長く待機（緊急対応中は保守的に設定）
    const baseDelay = EXCHANGE_SETTINGS.RATE_LIMIT;
    const requiredDelay = baseDelay * Math.max(1, cost * 0.5); // costに比例して調整
    
    if (timeSinceLastCall < requiredDelay) {
        const sleepTime = requiredDelay - timeSinceLastCall;
        console.log(`[独自throttle] cost=${cost}, ${sleepTime}ms待機中...`);
        await new Promise(resolve => setTimeout(resolve, sleepTime));
    }
    
    lastApiCall = Date.now();
    return Promise.resolve();
};

// 設定確認ログ（シンプル化）
console.log('[緊急対応] 独自throttle制御実装完了');
console.log('  - enableRateLimit: false (CCXT throttle無効化)');
console.log('  - 独自制御間隔: ' + EXCHANGE_SETTINGS.RATE_LIMIT + 'ms');
console.log('  - timeout: ' + EXCHANGE_SETTINGS.TIMEOUT + 'ms');

const exchangeBF = new ccxt.bitflyer({
    apiKey: BFApiKey,
    secret: BFApiSecret,
    enableRateLimit: true,
    rateLimit: 1000 // 1リクエストあたり1000ミリ秒（1秒）の制限
});

const bitflyerMinTradeAmounts = BITFLYER_MIN_TRADE_AMOUNTS;

// 設定パラメータ
const config = {

  global: {
    // 共通設定
    amount: TRADING_SETTINGS.DEFAULT_AMOUNT,
    tradePercentage: TRADING_SETTINGS.TRADE_PERCENTAGE,

    // 除外シンボル
    excludeSymbols: TRADING_SETTINGS.EXCLUDE_SYMBOLS,
    
    // 動的ポジションサイジング設定
    // 市場状況と戦略パフォーマンスに基づいて取引サイズを自動調整
    // ATR（Average True Range）とKelly基準を使用してリスク管理を最適化
    dynamicPositionSizing: {
      enabled: true,
      baseRiskPerTrade: 0.01, // 1% - 基本リスク割合（ポートフォリオの1%をリスク）
      atrPeriod: 14, // ATR計算期間（14期間でボラティリティ測定）
      atrMultiplier: 2, // ATR倍数（ストップロス距離の計算に使用）
      maxPositionPercent: 0.1, // 10% - 単一ポジションの最大サイズ制限
      minPositionPercent: 0.001, // 0.1% - 単一ポジションの最小サイズ制限
      
      // OHLCV データ取得設定（ハードコード除去）
      ohlcv: {
        timeframe: '1h', // デフォルトタイムフレーム
        limit: 50        // デフォルト取得期間
      },
      
      // ボラティリティ調整設定
      volatility: {
        window: 20,               // ボラティリティ計算ウィンドウ（直近N本）
        threshold: 0.05,          // 高ボラティリティ閾値（5%）
        riskReductionFactor: 0.7  // 高ボラティリティ時のリスク削減率（30%削減）
      },
      
      // 市場状況別調整設定
      marketConditions: {
        trend: {
          strong: {
            atrMultiplierAdjustment: 1.2  // 強いトレンド時のATR倍数調整（20%増加）
          }
        }
      },
      
      // Kelly基準設定
      // TODO: 理解する
      kellyEnabled: false, // Phase 1では無効
      kellyFraction: 0.25,
      
      // パフォーマンス調整設定
      performanceAdjustment: {
        enabled: true,
        lookbackDays: 30,
        loss: {
          factor: 2,              // 損失率に対する調整係数
          maxReductionRatio: 0.7  // 最大削減率（70%）
        },
        profit: {
          factor: 0.5,            // 利益率に対する調整係数
          maxIncreaseRatio: 0.5   // 最大増加率（50%）
        }
      }
    },
    
    // バックテスト動的Period設定（Issue #184）
    backtest: {
      dynamicPeriods: {
        enabled: true,
        bufferPercent: 0.3,        // 30%バッファ
        minBuffer: 50,             // 最小バッファ
        maxBuffer: 500,            // 最大バッファ
        cacheDuration: 300000      // 5分間キャッシュ
      }
    },
    
    // 高度注文管理設定（Issue #147）
    advancedOrderManagement: {
      enabled: true,
      defaultUrgency: 'medium', // 基本緊急度レベル（low/medium/high）
      // 市場状況、ボラティリティ、ポートフォリオリスク、時間帯、戦略パフォーマンスにより動的調整
      // low: 時間重視、手数料優先（post_only使用）
      // medium: バランス型（limit注文使用） 
      // high: 実行優先（market注文使用）
      maxSlippage: ORDER_MANAGEMENT_SETTINGS.MAX_SLIPPAGE,
      orderTimeout: ORDER_MANAGEMENT_SETTINGS.ORDER_TIMEOUT,
      maxRetries: ORDER_MANAGEMENT_SETTINGS.MAX_RETRIES,
      retryDelay: ORDER_MANAGEMENT_SETTINGS.RETRY_DELAY,
      
      // 注文タイプ別設定
      // bitbank取引所でサポートされている注文タイプのみ有効化
      // 各注文タイプに緊急度レベルを割り当て、市場状況に応じて自動選択
      orderTypes: {
        market: {
          enabled: true,
          urgencyLevel: 'high'
        },
        limit: {
          enabled: true,
          urgencyLevel: 'medium'
        },
        postOnly: {
          enabled: true,
          urgencyLevel: 'low'
        },
        ioc: {
          enabled: false, // bitbank取引所はIOC（Immediate or Cancel）注文をサポートしていないため無効
          // IOC: 即座に約定可能な数量のみ約定し、残りはキャンセルする注文タイプ
          urgencyLevel: 'medium'
        },
        iceberg: {
          enabled: true,
          largeOrderThreshold: {
            'BTC': 0.1,
            'ETH': 1.0,
            'default': 10.0
          }
        }
      }
    },
    
    // 動的urgency調整設定
    dynamicUrgencyAdjustment: {
      enabled: true,
      
      // 要素の重み設定（合計1.0になるよう調整）
      weights: {
        volatility: 0.3,        // 市場ボラティリティの重み
        portfolioRisk: 0.25,    // ポートフォリオリスクの重み
        timezone: 0.2,          // 時間帯の重み
        performance: 0.25       // 戦略パフォーマンスの重み
      },
      
      // 調整範囲制限
      adjustmentLimits: {
        min: -0.5,              // 最大50%ダウン調整
        max: 0.8                // 最大80%アップ調整
      },
      
      // キャッシュ設定
      cacheDuration: 60000,     // 1分間キャッシュ
      
      // 各分析モジュールの設定
      volatility: {
        atrPeriod: 14,
        volatilityPeriod: 20,
        cacheTimeout: 60000
      },
      
      portfolioRisk: {
        maxDrawdownThreshold: 0.15,     // 15%
        concentrationThreshold: 0.3,    // 30%
        cacheTimeout: 30000
      },
      
      timezone: {
        timezone: 'Asia/Tokyo',
        cacheTimeout: 300000            // 5分間キャッシュ
      },
      
      performance: {
        lookbackPeriod: 30,             // 30日間
        defaultTradeCount: 10,          // 直近10取引
        cacheTimeout: 60000
      }
    },
    
    // 統合動的urgencyシステム（Ultra-Advanced）
    unifiedUrgencySystem: {
      enabled: true,
      mode: 'production', // development, testing, production
      
      // フォールバック戦略
      fallbackStrategy: 'rule_based', // rule_based, static, conservative
      maxCalculationTime: 5000, // 5秒タイムアウト
      enableAutoOptimization: true,
      enableRealTimeAdaptation: true,
      optimizationInterval: 24 * 60 * 60 * 1000, // 24時間
      adaptationThreshold: 0.05, // 5%改善閾値
      
      // 基本動的urgency設定（フォールバック用）
      dynamic: {
        enabled: true,
        weights: {
          volatility: 0.3,
          portfolioRisk: 0.25,
          timezone: 0.2,
          performance: 0.25
        },
        adjustmentLimits: {
          min: -0.5,
          max: 0.8
        },
        cacheDuration: 60000
      },
      
      // パフォーマンス監視設定
      monitoring: {
        enabled: true,
        measurementWindow: 86400000, // 24時間
        minSampleSize: 10,
        cacheDuration: 60000
      },
      
      // 機械学習urgency予測設定
      ml: {
        enabled: false, // Phase 1では無効（将来的に有効化）
        modelType: 'adaptive_ensemble',
        trainingWindow: 7 * 24 * 60 * 60 * 1000, // 7日
        minTrainingData: 100,
        retrainInterval: 24 * 60 * 60 * 1000 // 24時間
      },
      
      // マルチタイムフレーム分析設定
      multiTimeframe: {
        enabled: true,
        timeframes: ['1m', '5m', '15m', '1h', '4h', '1d'],
        weights: {
          '1m': 0.1,
          '5m': 0.15,
          '15m': 0.2,
          '1h': 0.25,
          '4h': 0.2,
          '1d': 0.1
        },
        cacheTimeout: 30000 // 30秒
      },
      
      // A/Bテスト設定
      abTesting: {
        enabled: true,
        testDuration: 7 * 24 * 60 * 60 * 1000, // 7日間
        minSampleSize: 50,
        significanceLevel: 0.05, // 5%
        trafficAllocation: {
          control: 0.3,           // 静的urgency
          ruleBasedDynamic: 0.25, // ルールベース動的
          mlBased: 0.25,          // 機械学習ベース
          multiTimeframe: 0.2     // マルチタイムフレーム
        }
      }
    }
  },
  
  // 戦略固有の デフォルト設定
  strategies: {

    // 高頻度取引戦略 (bitbank WebSocket)
    HFT: {
      type: 'high_frequency',
      enabled: false, // *** EMERGENCY SHUTDOWN: CATASTROPHIC SYSTEM FAILURE ***
      function: require('./hft').startHFTStrategy,
      atomicExec: true,
      exchanges: [exchangeBB],
    },

    MUTUAL_INFO: {
      type: 'statistical',
      enabled: false, // 緊急停止: throttle queue危機対応
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
      type: 'mean_reversion',
      enabled: false, // 緊急停止: throttle queue危機対応
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
      type: 'trend_following',
      enabled: false, // 緊急停止: throttle queue危機対応
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
      type: 'mean_reversion',
      enabled: false, // 緊急停止: throttle queue危機対応
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
      type: 'trend_following',
      enabled: false, // 緊急停止: throttle queue危機対応
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
      type: 'mean_reversion',
      enabled: false, // 緊急停止: throttle queue危機対応
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
      type: 'mean_reversion',
      enabled: true, // RSI戦略を有効化
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

    // マルチ指標確認戦略（Issue #146）
    MULTI_INDICATOR: {
      type: 'composite',
      enabled: false, // 緊急停止: throttle queue危機対応
      ohlcvInterval: '15m',
      function: multiIndicatorStrategy,
      exchanges: [exchangeBB],
      enableRiskManagement: true,
      
      // マルチ指標設定（フラット化構造）
      requiredConfirmations: 3,
      
      // 重み設定（各指標の重要度）
      weightMACD: 1.0,
      weightEMA: 0.8,
      weightRSI: 0.7,
      weightVolume: 0.5,
      weightADX: 0.9,
      
      // 期間設定
      macdFastPeriod: 12,
      macdSlowPeriod: 26,
      macdSignalPeriod: 9,
      emaShortPeriod: 12,
      emaLongPeriod: 26,
      rsiPeriod: 14,
      adxPeriod: 14,
      volumeMAPeriod: 20,
      
      // リスク管理設定
      riskSettings: {
        fixedStopLossPercent: 0.015,       // 1.5%の固定ストップロス（高品質シグナルなので小さめ）
        trailingStopTriggerPercent: 0.01,  // 1%の利益でトレーリング発動
        trailingStopDistancePercent: 0.01, // 最高値から1%でトレーリング
        timeBasedStopHours: 48,            // 48時間でタイムストップ（長期ホールド）
        dailyMaxLossPercent: 0.03,         // 日次最大損失3%
        weeklyMaxLossPercent: 0.06,        // 週次最大損失6%
        monthlyMaxLossPercent: 0.12,       // 月次最大損失12%
        maxPositionsPerPair: 2,            // 同一ペアの最大ポジション（品質重視）
        maxTotalPositions: 6,              // 全体の最大ポジション
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

    // レガシー戦略（残高チェック用）
    OUTSIDE: {
      type: 'legacy',
      enabled: false,
      description: 'Legacy strategy for external or manual trades',
      function: null,  // 実行関数なし（レガシー対応）
      exchanges: [exchangeBB],
    },

    UNKNOWN: {
      type: 'legacy',
      enabled: false,
      description: 'Legacy strategy for unidentified trades',
      function: null,  // 実行関数なし（レガシー対応）
      exchanges: [exchangeBB],
    },

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