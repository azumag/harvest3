const ccxt = require('ccxt');
const dotenv = require('dotenv');
const { EXCHANGE_SETTINGS, TRADING_SETTINGS, BITFLYER_MIN_TRADE_AMOUNTS, ORDER_MANAGEMENT_SETTINGS } = require('./common/const');
const { SETTINGS } = require('./config/settings');
dotenv.config(); // .envファイルから環境変数を読み込む

// strategies
const { maStrategy, macdStrategy, rsiStrategy, bollingerBandsStrategy, multiIndicatorStrategy } = require('./strategies/trendFollowing');
const { meanReversionStrategy, oscillatorStrategy } = require('./strategies/meanReversion');
const { mutualInformationStrategy } = require('./strategies/mutualInformation');
// const { highFrequencyTrading } = require('./strategies/highFrequencyTrading');

// Additional configurations
const { getValidatedConfig: getBalanceCheckerConfig } = require('./common/balanceCheckerConfig');
const { getInstance: getCollectorConfig } = require('./config/collectorConfig');
const { WS_CONFIG, STRATEGY_PARAMS } = require('./hft/config');

// APIキーとシークレットを設定 (環境変数から取得)
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
    // CCXT内部のthrottle queueは1000固定のため、それを超えないよう設定
    'maxThrottleQueueSize': 800, // 1000未満に制限して安全マージンを確保
    'defaultType': 'spot',
    'recvWindow': EXCHANGE_SETTINGS.RECV_WINDOW,
    'adjustForTimeDifference': true,
    // 追加のthrottle制御オプション
    'throttle': {
      'maxCapacity': 800, // 内部キュー最大容量を制限
      'refillRate': 10, // 1秒あたりのトークン補充率を制限
      'refillPeriod': 1000 // 補充間隔（ミリ秒）
    }
  }
});

// Issue #431対応: throttle queue overflow対策として更に保守的な設定
// bitbank API制限: 取得系 10回/秒、更新系 6回/秒
// 緊急対応: 2秒間隔（0.5回/秒）で超安全運用
console.log('[Issue #431] throttle queue overflow対策として超保守的rate limitingを適用');
exchangeBB.enableRateLimit = true;
exchangeBB.rateLimit = Math.max(SETTINGS.EXCHANGE.BITBANK_RATE_LIMIT, 2000); // 最低2秒間隔
exchangeBB.timeout = EXCHANGE_SETTINGS.TIMEOUT;

// CCXT標準機能の設定確認
console.log(`[Rate Limiting] enableRateLimit: ${exchangeBB.enableRateLimit}, rateLimit: ${exchangeBB.rateLimit}ms, timeout: ${exchangeBB.timeout}ms`);

const exchangeBF = new ccxt.bitflyer({
  apiKey: BFApiKey,
  secret: BFApiSecret,
  enableRateLimit: true,
  rateLimit: SETTINGS.EXCHANGE.BITFLYER_RATE_LIMIT // 設定ファイルから取得
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
      // Kelly基準: 期待値とリスクに基づく最適ポジションサイズ計算手法
      // f* = (bp - q) / b ここで、b=オッズ-1, p=勝率, q=負率
      kellyEnabled: false, // Phase 1では無効（高リスクのため）
      kellyFraction: 0.25, // Kelly基準の25%を使用（リスク軽減）

      // パフォーマンス調整設定
      performanceAdjustment: {
        enabled: true,
        lookbackDays: SETTINGS.PERFORMANCE.LOOKBACK_DAYS,
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
        bufferPercent: SETTINGS.PERFORMANCE.BUFFER_PERCENT,        // 設定ファイルから取得
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
            'BTC': SETTINGS.TRADING.ICEBERG_THRESHOLDS.BTC,
            'ETH': SETTINGS.TRADING.ICEBERG_THRESHOLDS.ETH,
            'default': SETTINGS.TRADING.ICEBERG_THRESHOLDS.DEFAULT
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
      maxCalculationTime: SETTINGS.PERFORMANCE.MAX_CALCULATION_TIME, // 設定ファイルから取得
      enableAutoOptimization: true,
      enableRealTimeAdaptation: true,
      optimizationInterval: SETTINGS.PERFORMANCE.OPTIMIZATION_INTERVAL, // 設定ファイルから取得
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
        testDuration: SETTINGS.PERFORMANCE.TEST_DURATION, // 設定ファイルから取得
        minSampleSize: 50,
        significanceLevel: 0.05, // 5%
        trafficAllocation: {
          control: 0.3,           // 静的urgency
          ruleBasedDynamic: 0.25, // ルールベース動的
          mlBased: 0.25,          // 機械学習ベース
          multiTimeframe: 0.2     // マルチタイムフレーム
        }
      }
    },

    // 残高整合性チェック設定（issue #215）
    balanceIntegritySystem: {
      enabled: true,
      realTimeMonitoring: {
        enabled: true,
        interval: 60000, // 1分間隔
        maxConcurrentChecks: 3,
        timeout: 30000 // 30秒タイムアウト
      },

      // 不整合閾値設定
      thresholds: {
        absoluteThreshold: 0.001, // 0.001以上の絶対差
        percentageThreshold: 1.0, // 1%以上の相対差
        warningThreshold: 0.5,    // 0.5%以上で警告
        criticalThreshold: 5.0    // 5%以上で重要アラート
      },

      // 自動修正設定
      autoCorrection: {
        enabled: true,
        minorDiscrepancyThreshold: 0.01,  // 0.01以下は軽微として自動修正
        majorDiscrepancyThreshold: 0.1,   // 0.1以上は重大として手動確認
        maxAutoCorrections: 3,             // 1日の最大自動修正回数
        requireManualApproval: true        // 手動承認必須
      },

      // 取引停止設定
      tradingHalt: {
        enabled: true,
        majorDiscrepancyThreshold: 0.1,    // 10%以上で取引停止
        maxConsecutiveFailures: 3,         // 連続失敗回数
        cooldownPeriod: 300000            // 5分間のクールダウン
      },

      // 監査ログ設定
      auditLog: {
        enabled: true,
        retentionDays: 90,                // 90日間保持
        detailedLogging: true,            // 詳細ログ有効
        includeSnapshots: true,           // 残高スナップショット含める
        compressionEnabled: true          // ログ圧縮有効
      },

      // 通知設定
      notifications: {
        discord: {
          enabled: true,
          warningChannel: process.env.DISCORD_WARNING_WEBHOOK_URL,
          criticalChannel: process.env.DISCORD_ERROR_WEBHOOK_URL,
          summaryChannel: process.env.DISCORD_ORDER_WEBHOOK_URL,
          summaryInterval: 3600000         // 1時間毎のサマリー
        },
        email: {
          enabled: false,
          recipients: [],
          criticalOnly: true
        }
      },

      // データソース設定
      dataSources: {
        exchange: {
          enabled: true,
          priority: 1,
          cacheTTL: 30000               // 30秒キャッシュ
        },
        redis: {
          enabled: true,
          priority: 2,
          cacheTTL: 60000               // 1分キャッシュ
        },
        mongodb: {
          enabled: true,
          priority: 3,
          cacheTTL: 300000              // 5分キャッシュ
        }
      },

      // パフォーマンス設定
      performance: {
        batchSize: 50,                   // バッチ処理サイズ
        maxConcurrentQueries: 5,         // 最大並行クエリ数
        queryTimeout: 15000,             // クエリタイムアウト
        enableMetrics: true,             // メトリクス収集
        metricsRetention: 86400000      // 24時間保持
      }
    }
  },

  // 戦略固有の デフォルト設定
  strategies: {

    // 高頻度取引戦略 (bitbank WebSocket)
    HFT: {
      type: 'high_frequency',
      enabled: process.env.STRATEGY_HFT_ENABLED === 'true' || false, // 環境変数で制御（デフォルト無効）
      function: require('./hft').startHFTStrategy,
      atomicExec: true,
      exchanges: [exchangeBB]
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
        maxTotalPositions: 10             // 全体の最大ポジション
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
        maxTotalPositions: 8              // 全体の最大ポジション
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
        maxTotalPositions: 12             // 全体の最大ポジション
      }
    },

    BOLLINGER_BANDS: {
      type: 'mean_reversion',
      enabled: true, // Issue #431対応後テスト用に一時再有効化
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
        maxTotalPositions: 9              // 全体の最大ポジション
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
        maxTotalPositions: 10             // 全体の最大ポジション
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
        maxTotalPositions: 8              // 全体の最大ポジション
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
        maxTotalPositions: 9              // 全体の最大ポジション
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
        maxTotalPositions: 6              // 全体の最大ポジション
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
      exchanges: [exchangeBB]
    },

    UNKNOWN: {
      type: 'legacy',
      enabled: false,
      description: 'Legacy strategy for unidentified trades',
      function: null,  // 実行関数なし（レガシー対応）
      exchanges: [exchangeBB]
    }

  },

  exchanges: {
    'bitbank': {
      apiKey: BBApiKey,
      secret: BBApiSecret,
      module: 'bitbank',
      instance: exchangeBB
    }
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
  config,
  // Additional configurations
  getBalanceCheckerConfig,
  getCollectorConfig,
  WS_CONFIG,
  STRATEGY_PARAMS
};