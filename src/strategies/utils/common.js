const { formattedAvailableAmount, getRealizedPnL, addSignal,
  backtestCreateLimitBuyOrder, backtestCreateLimitSellOrder,
  addOrder, fetchOHLCVData, getAvailableFund,
  checkBuyOrderAllowance,
  getStrategyParameters,
  saveStrategyParameters,
  getTradeCurrentPosition,
  getOrderStrategyKeyByOrderId,
  updateFilledTrades,
  fetchTicker,
  getMarketParameters
} = require('../../database/manager');
const { postOrderToDiscord, postErrorToDiscord } = require('../../common/notifications');
const { BITBANK_ERRORS, isBitbankError } = require('../../common/exchangeErrors');
const {
  checkStopLoss,
  executeStopLoss,
  checkPositionLimits,
  checkDrawdown,
  recordBuyPosition,
  recordPnL,
  clearStrategyRiskData
} = require('./riskManagement');
const {
  getStrategyPositionsRedis,
  closeAndCleanupPosition
} = require('../../database/redisDatabase');
const { DynamicPositionSizing } = require('./positionSizing');
const { performanceTracker } = require('./performanceTracker');
const { AdvancedOrderManager, ORDER_TYPES, URGENCY_LEVELS } = require('./orderManager');
const { DynamicUrgencyCalculator } = require('./dynamicUrgencyCalculator');
const Logger = require('../../hft/utils/Logger');

// Logger instance for strategy utilities
const logger = new Logger('StrategyUtils');

// ==================== 共通ユーティリティ関数 ====================

/**
 * リスク管理処理の共通関数
 * @param {Object} exchange - 取引所オブジェクト
 * @param {string} symbol - 通貨ペア
 * @param {string} strategyKey - 戦略キー
 * @param {number} currentPrice - 現在価格
 * @param {Object} config - 設定オブジェクト
 * @param {Object} marketParameters - マーケットパラメータ
 * @param {string} strategyName - 戦略名
 * @param {string} strategyId - 戦略ID
 * @param {Object} logInfo - ログ情報
 * @param {Object} options - オプション
 * @returns {Promise<Object|null>} 早期リターンが必要な場合はオブジェクト、継続する場合はnull
 */
async function performRiskManagement(exchange, symbol, strategyKey, currentPrice, config, marketParameters, strategyName, strategyId, logInfo, options) {
  if (options.backtest || config.enableRiskManagement === false) {
    return null; // リスク管理をスキップ
  }

  // 約定情報を更新
  logger.info(`[リスク管理] ${symbol} の約定情報を更新中...`);
  const tradeUpdateStart = Date.now();
  const updatedCount = await updateFilledTrades(exchange, symbol);
  const tradeUpdateTime = Date.now() - tradeUpdateStart;
  logger.info(`[リスク管理] ${symbol} 約定情報更新完了: ${updatedCount}件 (${tradeUpdateTime}ms)`);

  // ストップロスチェック
  const stopLossPositions = await checkStopLoss(exchange, symbol, strategyKey, currentPrice, config.riskSettings);

  // ストップロスが必要なポジションを処理
  for (const position of stopLossPositions) {
    const safeMarketParameters = marketParameters || {
      amountPrecision: 4,
      pricePrecision: 2,
      minTradeAmount: 0.0001,
      maxTradeAmount: 1000000
    };
    await executeStopLoss(exchange, symbol, strategyKey, position, safeMarketParameters);
  }

  // ドローダウンチェック
  const drawdownStatus = await checkDrawdown(exchange, strategyKey, config.riskSettings);
  if (drawdownStatus.daily.exceeded) {
    const message = '🚨 [リスク管理] 日次最大損失制限到達 🚨\n' +
                   `取引所: ${exchange.id}\n` +
                   `戦略: ${strategyName}\n` +
                   `本日の損失: ${drawdownStatus.daily.pnl.toLocaleString()}円\n` +
                   `損失率: ${drawdownStatus.daily.loss !== null && drawdownStatus.daily.loss !== undefined ? (drawdownStatus.daily.loss * 100).toFixed(2) : 'N/A'}%\n` +
                   `制限値: ${drawdownStatus.daily.limit !== null && drawdownStatus.daily.limit !== undefined ? (drawdownStatus.daily.limit * 100).toFixed(2) : 'N/A'}%\n` +
                   '⚠️ 新規取引を停止しました';

    logger.info(`${strategyName}: 日次最大損失に達したため新規取引を停止します`);

    if (postOrderToDiscord) {
      await postOrderToDiscord(message);
    }

    return {
      strategy: strategyId,
      symbol,
      ...logInfo.result,
      signal: 'none',
      reason: 'daily drawdown limit exceeded'
    };
  }

  // 週次・月次ドローダウンの警告通知
  if (drawdownStatus.weekly.exceeded) {
    const message = '🔥 [リスク管理] 週次最大損失制限到達 🔥\n' +
                   `取引所: ${exchange.id}\n` +
                   `戦略: ${strategyName}\n` +
                   `今週の損失: ${drawdownStatus.weekly.pnl.toLocaleString()}円\n` +
                   `損失率: ${drawdownStatus.weekly.loss !== null && drawdownStatus.weekly.loss !== undefined ? (drawdownStatus.weekly.loss * 100).toFixed(2) : 'N/A'}%\n` +
                   `制限値: ${drawdownStatus.weekly.limit !== null && drawdownStatus.weekly.limit !== undefined ? (drawdownStatus.weekly.limit * 100).toFixed(2) : 'N/A'}%\n` +
                   '⚠️ 戦略を一時停止することを検討してください';

    if (postOrderToDiscord) {
      await postOrderToDiscord(message);
    }
  }

  if (drawdownStatus.monthly.exceeded) {
    const message = '💀 [リスク管理] 月次最大損失制限到達 💀\n' +
                   `取引所: ${exchange.id}\n` +
                   `戦略: ${strategyName}\n` +
                   `今月の損失: ${drawdownStatus.monthly.pnl.toLocaleString()}円\n` +
                   `損失率: ${drawdownStatus.monthly.loss !== null && drawdownStatus.monthly.loss !== undefined ? (drawdownStatus.monthly.loss * 100).toFixed(2) : 'N/A'}%\n` +
                   `制限値: ${drawdownStatus.monthly.limit !== null && drawdownStatus.monthly.limit !== undefined ? (drawdownStatus.monthly.limit * 100).toFixed(2) : 'N/A'}%\n` +
                   '🚨 戦略の見直しが必要です';

    if (postOrderToDiscord) {
      await postOrderToDiscord(message);
    }
  }

  return null; // 継続
}

/**
 * 注文オプション設定の共通関数
 * @param {Object} config - 設定オブジェクト
 * @param {Object} exchange - 取引所オブジェクト
 * @param {string} symbol - 通貨ペア
 * @param {string} strategyName - 戦略名
 * @param {number} currentPrice - 現在価格
 * @param {Object} marketParameters - マーケットパラメータ
 * @param {number} formattedAmount - 注文量
 * @returns {Promise<Object>} 注文オプション
 */
async function setupOrderOptions(config, exchange, symbol, strategyName, currentPrice, marketParameters, formattedAmount) {
  const appConfig = require('../../config');
  const orderConfig = appConfig?.config?.global?.advancedOrderManagement || {};
  const defaultUrgency = orderConfig.defaultUrgency || 'medium';
  const { orderType } = config;
  let baseUrgency = URGENCY_LEVELS.MEDIUM;

  // 注文タイプに基づいてベース緊急度を決定
  if (orderType === 'market') {
    baseUrgency = URGENCY_LEVELS.HIGH;
  } else if (orderConfig.orderTypes?.[orderType]?.urgencyLevel) {
    baseUrgency = URGENCY_LEVELS[orderConfig.orderTypes[orderType].urgencyLevel.toUpperCase()];
  } else {
    baseUrgency = URGENCY_LEVELS[defaultUrgency.toUpperCase()];
  }

  // 統合動的urgency調整を適用
  const urgencyResult = await calculateUnifiedUrgency(symbol, baseUrgency, exchange, strategyName, {
    currentPrice,
    marketParameters,
    amount: formattedAmount,
    side: orderType === 'market' ? 'market' : 'limit'
  });

  return {
    urgency: urgencyResult.urgency,
    urgencyResult,
    orderConfig,
    orderOptions: {
      urgency: urgencyResult.urgency,
      strategy: strategyName,
      backtest: false,
      maxSlippage: config.maxSlippage || orderConfig.maxSlippage || 0.005,
      enableRetry: orderConfig.maxRetries > 0,
      testId: urgencyResult.testId,
      urgencyMethod: urgencyResult.method,
      urgencyConfidence: urgencyResult.confidence
    }
  };
}

/**
 * 残高検証の共通関数
 * @param {Object} exchange - 取引所オブジェクト
 * @param {string} symbol - 通貨ペア
 * @param {string} strategyName - 戦略名
 * @param {number} formattedAmount - 必要な量
 * @param {number} currentPrice - 現在価格
 * @param {Object} options - オプション
 * @returns {Promise<Object>} 検証結果
 */
async function validateBalance(exchange, symbol, strategyName, formattedAmount, currentPrice, options) {
  logger.info(`[${strategyName}] 📊 VALIDATION START: ${symbol}`);
  logger.info(`[${strategyName}] ├─ 現在価格: ¥${currentPrice?.toLocaleString()}`);
  logger.info(`[${strategyName}] ├─ 予定売却量: ${formattedAmount}`);
  logger.info(`[${strategyName}] └─ 戦略キー: ${strategyName}`);

  const exchangeBalance = await exchange.fetchBalance();
  const baseCurrency = symbol.split('/')[0];
  const exchangeAmount = exchangeBalance.free[baseCurrency] || 0;
  const exchangeLockedAmount = exchangeBalance.used[baseCurrency] || 0;
  const exchangeTotalAmount = exchangeBalance.total[baseCurrency] || 0;

  // 詳細な残高ログ
  logger.info(`[${strategyName}] 💰 BALANCE DETAILS: ${symbol}`);
  logger.info(`[${strategyName}] ├─ Free: ${exchangeAmount}`);
  logger.info(`[${strategyName}] ├─ Used: ${exchangeLockedAmount}`);
  logger.info(`[${strategyName}] ├─ Total: ${exchangeTotalAmount}`);
  logger.info(`[${strategyName}] └─ Required: ${formattedAmount}`);

  if (exchangeAmount < formattedAmount) {
    const shortage = formattedAmount - exchangeAmount;
    const shortagePercent = ((shortage / formattedAmount) * 100).toFixed(2);

    logger.error(`[${strategyName}] ❌ VALIDATION FAILED: ${symbol}`);
    logger.error(`[${strategyName}] ├─ 不足量: ${shortage} (${shortagePercent}%)`);
    logger.error(`[${strategyName}] ├─ Exchange Free: ${exchangeAmount}`);
    logger.error(`[${strategyName}] ├─ Exchange Used: ${exchangeLockedAmount}`);
    logger.error(`[${strategyName}] └─ 必要量: ${formattedAmount}`);

    if (postErrorToDiscord && !options.backtest) {
      await postErrorToDiscord(`🚨 **残高検証失敗** ${symbol}\n` +
                              `戦略: ${strategyName}\n` +
                              `Exchange Free残高: ${exchangeAmount}\n` +
                              `Exchange Used残高: ${exchangeLockedAmount}\n` +
                              `Exchange Total残高: ${exchangeTotalAmount}\n` +
                              `必要量: ${formattedAmount}\n` +
                              `不足量: ${shortage} (${shortagePercent}%)\n` +
                              `現在価格: ¥${currentPrice?.toLocaleString()}\n` +
                              '⚠️ 残高不足により注文を停止\n' +
                              `⏰ ${new Date().toLocaleString('ja-JP')}`);
    }

    return {
      success: false,
      reason: 'Insufficient balance',
      validationDetails: {
        exchangeAmount,
        exchangeLockedAmount,
        exchangeTotalAmount,
        attemptedAmount: formattedAmount,
        shortage,
        shortagePercent: parseFloat(shortagePercent)
      }
    };
  }

  logger.info(`[${strategyName}] ✅ VALIDATION PASSED: ${symbol}`);
  logger.info(`[${strategyName}] ├─ Exchange Free: ${exchangeAmount} >= Required: ${formattedAmount}`);
  logger.info(`[${strategyName}] └─ 余剰量: ${(exchangeAmount - formattedAmount).toFixed(6)}`);

  return {
    success: true,
    balanceDetails: {
      exchangeAmount,
      exchangeLockedAmount,
      exchangeTotalAmount,
      availableAmount: exchangeAmount - formattedAmount
    }
  };
}
const { UnifiedUrgencySystem } = require('./unifiedUrgencySystem');

// 動的ポジションサイジングのインスタンス（設定注入用）
let dynamicSizing = null;

// 統合動的urgency調整システムのインスタンス（設定注入用）
let unifiedUrgencySystem = null;

// 高度注文管理のインスタンス（取引所別）
const orderManagers = new Map();

/**
 * 動的ポジションサイジングを初期化
 * @param {Object} config - グローバル設定
 */
function initializeDynamicSizing(config) {
  if (config?.global?.dynamicPositionSizing) {
    dynamicSizing = new DynamicPositionSizing(config.global.dynamicPositionSizing);
  }
}

/**
 * 統合動的urgency調整システムを初期化
 * @param {Object} config - グローバル設定
 */
function initializeUnifiedUrgencySystem(config) {
  if (config?.global?.unifiedUrgencySystem) {
    unifiedUrgencySystem = new UnifiedUrgencySystem(config.global.unifiedUrgencySystem);
    logger.info('[common.js] 統合動的urgency調整システムを初期化しました');
  } else if (config?.global?.dynamicUrgencyAdjustment) {
    // フォールバック: 基本動的システム
    unifiedUrgencySystem = new UnifiedUrgencySystem({
      enabled: true,
      mode: 'basic',
      dynamic: config.global.dynamicUrgencyAdjustment
    });
    logger.info('[common.js] 基本動的urgency調整システムを初期化しました');
  }
}

/**
 * 高度注文管理インスタンスを取得
 * @param {Object} exchange - 取引所オブジェクト
 * @returns {AdvancedOrderManager} 注文管理インスタンス
 */
function getOrderManager(exchange) {
  if (!orderManagers.has(exchange.id)) {
    orderManagers.set(exchange.id, new AdvancedOrderManager(exchange));
  }
  return orderManagers.get(exchange.id);
}

/**
 * 統合動的urgency調整を計算
 * @param {string} symbol - 通貨ペア
 * @param {string} baseUrgency - ベースのurgency
 * @param {Object} exchange - 取引所オブジェクト
 * @param {string} strategyName - 戦略名
 * @param {Object} additionalContext - 追加コンテキスト
 * @returns {Promise<Object>} 調整されたurgency結果
 */
async function calculateUnifiedUrgency(symbol, baseUrgency, exchange, strategyName, additionalContext = {}) {
  // 統合urgency調整が無効または未初期化の場合はベース値を返す
  if (!unifiedUrgencySystem) {
    return { urgency: baseUrgency, method: 'disabled', confidence: 0, testId: null };
  }

  try {
    const context = {
      symbol,
      baseUrgency,
      exchange,
      strategyName,
      ...additionalContext
    };

    return await unifiedUrgencySystem.calculateOptimalUrgency(context);
  } catch (error) {
    logger.error(`[統合urgency] 計算エラー: ${symbol} - ${error.message}`);
    return { urgency: baseUrgency, method: 'error', confidence: 0, testId: null, error: error.message };
  }
}

/**
 * OHLCV データを取得して検証する
 * @param {Object} exchange 取引所オブジェクト
 * @param {string} symbol シンボル
 * @param {string} ohlcvInterval インターバル
 * @param {number} period 期間
 * @param {Function} errorNotificationFn エラー通知関数
 * @param {string} strategyName 戦略名（エラーメッセージ用）
 * @returns {Object|null} 検証済みのデータオブジェクト、またはエラー時はnull
 */
async function fetchAndValidateOHLCVData(exchange, symbol, ohlcvInterval, period, errorNotificationFn, strategyName, options) {
  // 過去のローソク足データを取得
  const ohlcv = await fetchOHLCVData(exchange, symbol, ohlcvInterval, period + 10, options);

  // データ不足の許容範囲を設定（90%以上あれば許可）
  const minRequiredData = Math.max(period * 0.9, period - 5); // 最低でも90%または期間-5のいずれか大きい方

  if (ohlcv.length < minRequiredData) {
    if (!options.backtest) {
      logger.info(`${strategyName}戦略のデータが不足しています: ${symbol} ${ohlcv.length}/${period} (最低必要: ${minRequiredData})`);
      throw new Error(`${strategyName}戦略のデータが不足しています: ${symbol} ${ohlcv.length}/${period}`);
    }
    if (options.backtest) {
      return null; // バックテストモードではnullを返す
    }
  }

  // データが最低要件は満たしているが、期待値より少ない場合は警告
  if (ohlcv.length < period && !options.backtest) {
    logger.warn(`[${strategyName}] ${symbol}: データ数が期待値より少ないですが実行継続 (${ohlcv.length}/${period})`);
  }

  // 終値の配列を作成
  const closes = ohlcv.map(candle => candle[4]);

  // データの検証を追加
  if (closes.some(price => price === undefined || price === null || isNaN(price))) {
    logger.info(`${strategyName}戦略: ${symbol} - 無効な価格データが含まれています`);
    if (errorNotificationFn) {
      await errorNotificationFn(`[${strategyName}戦略] 警告: ${exchange.id} - ${symbol} - 無効な価格データが含まれています`);
    }
    throw new Error(`${strategyName}戦略: ${symbol} - 無効な価格データが含まれています`);
  }

  return { ohlcv, closes };
}

/**
 * 戦略のシグナルに基づいて処理を行う共通関数
 * @param {Object} exchange 取引所オブジェクト
 * @param {string} symbol 通貨ペア
 * @param {string} strategyKey 戦略キー
 * @param {Object} config 設定オブジェクト
 * @param {Object} marketParameters マーケットパラメータ
 * @param {Object} signalResult シグナル計算結果
 * @param {string} strategyName 戦略名（日本語）
 * @param {string} strategyId 戦略ID（英語）
 * @param {Function} formatLogInfo ログ情報をフォーマットする関数
 * @returns {Object} 処理結果
 */
async function handleStrategySignals(
  exchange,
  symbol,
  strategyKey,
  config,
  marketParameters,
  signalResult,
  strategyName,
  strategyId,
  formatLogInfo,
  options = {},
  globalConfig = null
) {
  // 動的ポジションサイジングの初期化（初回のみ）
  if (globalConfig && !dynamicSizing) {
    initializeDynamicSizing(globalConfig);
  }

  // 統合動的urgency調整システムの初期化（初回のみ）
  if (globalConfig && !unifiedUrgencySystem) {
    initializeUnifiedUrgencySystem(globalConfig);
  }

  const { currentPrice, signalType, buySignal, sellSignal } = signalResult;
  const logInfo = formatLogInfo(signalResult);

  // リスク管理処理（共通関数を使用）
  const riskManagementResult = await performRiskManagement(
    exchange, symbol, strategyKey, currentPrice, config, marketParameters,
    strategyName, strategyId, logInfo, options
  );

  // リスク管理で早期リターンが必要な場合
  if (riskManagementResult) {
    return riskManagementResult;
  }

  // 注文を作成
  if (buySignal) {
    // 買いシグナル情報をログ出力
    if (!options.backtest) {
      logger.info(`${strategyName}買いシグナル: ${symbol} - ${logInfo.buy}`);
    }
    if (postOrderToDiscord && !options.backtest) {
      postOrderToDiscord(`[${strategyName}] 買いシグナル: ${exchange.id} - ${symbol} - ${logInfo.buy}`);
    }

    // 買い注文実行
    await executeBuyOrder(
      exchange,
      symbol,
      strategyKey,
      config,
      marketParameters,
      currentPrice,
      strategyName,
      logInfo.orderInfo,
      options,
      globalConfig
    );

  } else if (sellSignal) {
    // 売りシグナル情報をログ出力
    if (!options.backtest) {
      logger.info(`${strategyName}売りシグナル: ${symbol} - ${logInfo.sell}`);
    }
    if (postOrderToDiscord && !options.backtest) {
      postOrderToDiscord(`[${strategyName}] 売りシグナル: ${exchange.id} - ${symbol} - ${logInfo.sell}`);
    }

    // 売り注文実行
    const sellResult = await executeSellOrder(
      exchange,
      symbol,
      strategyKey,
      config,
      marketParameters,
      currentPrice,
      strategyName,
      logInfo.orderInfo,
      options,
      globalConfig
    );

    // 特定条件で早期リターン
    if (sellResult.earlyReturn) {
      return sellResult.returnValue;
    }

  } else {
    if (!options.backtest) {
      logger.info(`${strategyName}シグナルなし: ${symbol} - ${logInfo.none}`);
    }
  }

  return {
    strategy: strategyId,
    symbol,
    ...logInfo.result,
    signal: buySignal ? 'buy' : (sellSignal ? 'sell' : 'none')
  };
}

/**
 * 買い注文を実行する共通処理
 * @param {Object} exchange 取引所オブジェクト
 * @param {string} symbol 通貨ペア
 * @param {string} strategyKey 戦略キー
 * @param {Object} config 設定オブジェクト
 * @param {Object} marketParameters マーケットパラメータ
 * @param {number} currentPrice 現在価格
 * @param {string} strategyName 戦略名（ログ出力用）
 * @param {Object} signalInfo シグナル情報（ログ出力用）
 * @returns {Object|void} 注文結果
 */
async function executeBuyOrder(exchange, symbol, strategyKey, config, marketParameters, currentPrice, strategyName, signalInfo, options = {}, globalConfig = null) { // globalConfigを追加
  // marketParametersが未定義の場合の安全処理
  if (!marketParameters) {
    logger.error(`[${strategyName}] marketParametersが未定義です: ${symbol}`);
    return { success: false, reason: 'marketParameters is undefined' };
  }

  const { tradePercentage } = config;
  const { amountPrecision, minTradeAmount } = marketParameters;
  const { orderType } = config;

  // リスク管理: ポジション制限チェック（バックテストモードではスキップ）
  if (!options.backtest && config.enableRiskManagement !== false) {
    const positionLimitCheck = await checkPositionLimits(exchange, symbol, strategyKey, config.riskSettings);
    if (!positionLimitCheck.allowed) {
      const message = '⛔ [リスク管理] ポジション制限到達 ⛔\n' +
                     `取引所: ${exchange.id}\n` +
                     `通貨ペア: ${symbol}\n` +
                     `戦略: ${strategyName}\n` +
                     `制限理由: ${positionLimitCheck.reason}\n` +
                     `現在価格: ${currentPrice.toLocaleString()}円\n` +
                     '🛑 新規買い注文をスキップしました';

      logger.info(`${strategyName}: ${positionLimitCheck.reason}`);

      if (postOrderToDiscord) {
        await postOrderToDiscord(message);
      }

      return { success: false, reason: positionLimitCheck.reason };
    }
  }

  // 利用可能な資金を確認
  // const balance = await exchange.fetchBalance(); // 既存の呼び出し
  const balance = await getAvailableFund(exchange, symbol, options); // getAvailableFund を呼び出すように変更
  const baseCurrency = symbol.split('/')[1];
  const availableFunds = balance.free[baseCurrency];

  // デバッグ: 資金計算情報をログ出力
  if (!options.backtest) {
    const safeAvailableFunds = availableFunds !== null && availableFunds !== undefined ? availableFunds : 0;
    const safeTradePercentage = config.tradePercentage !== null && config.tradePercentage !== undefined ? config.tradePercentage : 0;
    const safeCalculated = (safeAvailableFunds * safeTradePercentage).toFixed(2);
    logger.debug(`[資金DEBUG] ${symbol}: 利用可能資金=${safeAvailableFunds}円, tradePercentage=${safeTradePercentage}, 制限後=${safeCalculated}円`);
  }

  // 損益を取得
  const realizedPnL = await getRealizedPnL(exchange, symbol, strategyKey, options); // options を渡すように変更

  let formattedAmount;

  let isPositionSized = false;
  // 動的ポジションサイジングが有効かチェック
  if (globalConfig?.global?.dynamicPositionSizing?.enabled && !options.backtest && dynamicSizing) {
    try {
      // 動的サイジングの設定を取得
      const sizingConfig = globalConfig.global.dynamicPositionSizing;
      const { timeframe, limit } = sizingConfig.ohlcv;
      const ohlcv = await fetchOHLCVData(exchange, symbol, timeframe, limit, options);

      if (ohlcv && ohlcv.length >= sizingConfig.atrPeriod) {
        // 市場条件に基づく動的パラメータ調整
        const volatility = calculateCurrentVolatility(ohlcv.slice(-sizingConfig.volatility.window));
        const marketConditions = analyzeMarketConditions(ohlcv, currentPrice);

        // 動的パラメータ設定
        const dynamicConfig = { ...sizingConfig };

        // 高ボラティリティ時はリスクを削減
        if (volatility > sizingConfig.volatility.threshold) {
          dynamicConfig.baseRiskPerTrade *= sizingConfig.volatility.riskReductionFactor;
        }

        // トレンド市場ではポジションサイズを増加
        if (marketConditions.trend === 'strong' && sizingConfig.marketConditions?.trend?.strong?.atrMultiplierAdjustment) {
          dynamicConfig.atrMultiplier *= sizingConfig.marketConditions.trend.strong.atrMultiplierAdjustment;
        }

        // 実現損益に基づく調整
        let performanceAdjustment = 1.0;
        const perfConfig = sizingConfig.performanceAdjustment;
        if (realizedPnL < 0 && perfConfig?.loss) {
          const lossRatio = Math.abs(realizedPnL) / availableFunds;
          const minAdjustment = 1.0 - perfConfig.loss.maxReductionRatio;
          performanceAdjustment = Math.max(minAdjustment, 1.0 - (lossRatio * perfConfig.loss.factor));
        } else if (realizedPnL > 0 && perfConfig?.profit) {
          const profitRatio = realizedPnL / availableFunds;
          const maxAdjustment = 1.0 + perfConfig.profit.maxIncreaseRatio;
          performanceAdjustment = Math.min(maxAdjustment, 1.0 + (profitRatio * perfConfig.profit.factor));
        }

        // 動的サイジング設定を更新
        dynamicSizing.updateConfig(dynamicConfig);

        // 動的ポジションサイジングを計算
        const accountBalance = availableFunds + realizedPnL;
        const ohlcData = ohlcv.map(candle => ({
          high: candle[2],
          low: candle[3],
          close: candle[4]
        }));

        const positionResult = dynamicSizing.calculateATRBasedPosition({
          accountBalance,
          ohlcData,
          currentPrice,
          strategyKey,
          marketData: {
            volatility,
            marketConditions,
            performanceAdjustment,
            marketParameters
          }
        });

        if (positionResult.reason === 'success' && positionResult.positionSize > 0) {
          // パフォーマンス調整を適用
          const adjustedPositionSize = positionResult.positionSize * performanceAdjustment;
          formattedAmount = adjustedPositionSize !== null && adjustedPositionSize !== undefined
            ? parseFloat(adjustedPositionSize.toFixed(amountPrecision))
            : parseFloat(minTradeAmount.toFixed(amountPrecision));
          isPositionSized = true;

          // Discord通知
          if (postOrderToDiscord) {
            const safeATR = positionResult.atr !== null && positionResult.atr !== undefined ? positionResult.atr.toFixed(6) : 'N/A';
            const safeStopLoss = positionResult.stopLossDistance !== null && positionResult.stopLossDistance !== undefined ? positionResult.stopLossDistance.toFixed(6) : 'N/A';
            const sizeInfo = '📊 [動的サイジング] ATRベース計算適用\n' +
                           `ATR: ${safeATR}\n` +
                           `リスク: ${(positionResult.adjustedRisk * 100).toFixed(2)}%\n` +
                           `元サイズ: ${positionResult.positionSize.toFixed(amountPrecision)}\n` +
                           `調整後サイズ: ${formattedAmount}\n` +
                           `調整率: ${(performanceAdjustment * 100).toFixed(1)}%\n` +
                           `ボラティリティ: ${(volatility * 100).toFixed(2)}%\n` +
                           `市場状況: ${marketConditions.trend}\n` +
                           `ストップロス距離: ${safeStopLoss}`;

            logger.info(`[動的サイジング] ${strategyName}: ${sizeInfo}`);
          }
        } else {
          // 動的サイジング失敗時は従来の方式にフォールバック
          logger.info(`[動的サイジング] 計算失敗、従来方式を使用: ${positionResult.reason}`);
          const maxBuyAmount = ((availableFunds * tradePercentage) + realizedPnL) / currentPrice;
          const tradeAmount = Math.max(minTradeAmount, maxBuyAmount);
          formattedAmount = parseFloat(tradeAmount.toFixed(amountPrecision));
        }
      } else {
        // データ不足時は従来の方式にフォールバック
        const maxBuyAmount = ((availableFunds * tradePercentage) + realizedPnL) / currentPrice;
        const tradeAmount = Math.max(minTradeAmount, maxBuyAmount);
        formattedAmount = parseFloat(tradeAmount.toFixed(amountPrecision));
      }
    } catch (error) {
      logger.error(`[動的サイジング] エラー、従来方式を使用: ${error.message}`);
      // エラー時は従来の方式にフォールバック
      const maxBuyAmount = ((availableFunds * tradePercentage) + realizedPnL) / currentPrice;
      const tradeAmount = Math.max(minTradeAmount, maxBuyAmount);
      formattedAmount = parseFloat(tradeAmount.toFixed(amountPrecision));
    }
  } else {
    // 動的ポジションサイジング無効時は従来の方式を使用
    const maxBuyAmount = ((availableFunds * tradePercentage) + realizedPnL) / currentPrice;
    const tradeAmount = Math.max(minTradeAmount, maxBuyAmount);
    formattedAmount = parseFloat(tradeAmount.toFixed(amountPrecision));
  }

  // 最小精度（0.0001）を下回らないようにする
  formattedAmount = Math.max(formattedAmount, 0.0001);

  // 買い注文が許可されるかチェック
  const allowanceCheck = await checkBuyOrderAllowance(
    exchange,
    symbol,
    strategyKey,
    currentPrice,
    formattedAmount,
    availableFunds,
    tradePercentage,
    realizedPnL,
    minTradeAmount,
    isPositionSized, // 動的ポジションサイジングの結果を渡す
    options // options を渡すように変更
  );

  if (allowanceCheck.allowed) {
    let order;
    let orderResult = { success: false };

    if (options.backtest) {
      // バックテストモードの場合、バックテスト用の注文関数を呼び出す
      order = await backtestCreateLimitBuyOrder(symbol, formattedAmount, currentPrice, options);
      orderResult = { success: true, order };
    } else {
      // リアルタイムモードの場合、高度注文管理システムを使用
      const orderManager = getOrderManager(exchange);

      // 注文オプションを設定（グローバル設定から取得）
      const appConfig = require('../../config');
      const orderConfig = appConfig?.config?.global?.advancedOrderManagement || {};
      const defaultUrgency = orderConfig.defaultUrgency || 'medium';
      let baseUrgency = URGENCY_LEVELS.MEDIUM;

      // 注文タイプに基づいてベース緊急度を決定
      if (orderType === 'market') {
        baseUrgency = URGENCY_LEVELS.HIGH;
      } else if (orderConfig.orderTypes?.[orderType]?.urgencyLevel) {
        baseUrgency = URGENCY_LEVELS[orderConfig.orderTypes[orderType].urgencyLevel.toUpperCase()];
      } else {
        baseUrgency = URGENCY_LEVELS[defaultUrgency.toUpperCase()];
      }

      // 統合動的urgency調整を適用
      const urgencyResult = await calculateUnifiedUrgency(symbol, baseUrgency, exchange, strategyName, {
        currentPrice,
        marketParameters,
        amount: formattedAmount,
        side: orderType === 'market' ? 'market' : 'limit'
      });
      const urgency = urgencyResult.urgency;

      const orderOptions = {
        urgency,
        strategy: strategyName,
        backtest: false,
        maxSlippage: config.maxSlippage || orderConfig.maxSlippage || 0.005,
        enableRetry: orderConfig.maxRetries > 0,
        testId: urgencyResult.testId, // A/Bテスト用
        urgencyMethod: urgencyResult.method,
        urgencyConfidence: urgencyResult.confidence
      };

      // 高度注文管理が有効かチェック
      if (orderConfig.enabled) {
        logger.info(`[${strategyName}] 高度注文管理システム使用: ${symbol} urgency=${urgency} (${urgencyResult.method}, 信頼度:${urgencyResult.confidence.toFixed(3)})`);
        // 高度注文実行
        orderResult = await orderManager.executeAdvancedOrder(
          symbol, 'buy', formattedAmount, currentPrice, orderOptions
        );
      } else {
        logger.warn(`[${strategyName}] 高度注文管理無効 - 従来方式使用: ${symbol}`);
        orderResult.success = false; // フォールバック処理を実行
      }

      if (orderResult.success) {
        order = orderResult.order;
      } else {
        // 🚨 EMERGENCY FIX: 高度注文が失敗した場合、従来方式にフォールバック
        logger.warn(`[${strategyName}] 高度注文失敗、従来方式でフォールバック: ${symbol}`);
        logger.warn(`[${strategyName}] 失敗理由: ${orderResult.error?.message || 'バリデーション失敗'}`);

        try {
          // 従来のマーケット注文方式でフォールバック実行
          logger.info(`[${strategyName}] フォールバック: createMarketBuyOrder実行 ${symbol} 数量:${formattedAmount}`);
          order = await exchange.createMarketBuyOrder(symbol, formattedAmount);

          // フォールバック成功の通知
          if (postOrderToDiscord && !options.backtest) {
            await postOrderToDiscord(`✅ **フォールバック成功** ${symbol}\n` +
                                    `戦略: ${strategyName}\n` +
                                    '高度注文失敗 → 従来方式で購入完了\n' +
                                    `数量: ${formattedAmount}\n` +
                                    `価格: ¥${(order.price || currentPrice).toLocaleString()}\n` +
                                    `⏰ ${new Date().toLocaleString('ja-JP')}`);
          }

          logger.info(`[${strategyName}] フォールバック成功: ${symbol} - Order ID: ${order.id}`);

        } catch (fallbackError) {
          // フォールバック失敗時のエラーハンドリング
          logger.error(`[${strategyName}] フォールバック失敗: ${symbol} - ${fallbackError.message}`);

          if (postErrorToDiscord && !options.backtest) {
            await postErrorToDiscord(`🚨 **フォールバック失敗** ${symbol}\n` +
                                    `戦略: ${strategyName}\n` +
                                    '高度注文失敗 + 従来方式も失敗\n' +
                                    `エラー: ${fallbackError.message}\n` +
                                    '⚠️ 手動介入が必要です\n' +
                                    `⏰ ${new Date().toLocaleString('ja-JP')}`);
          }

          return { success: false, reason: 'フォールバック失敗のため注文実行不可', error: fallbackError };
        }
      }
    }

    if (postOrderToDiscord && !options.backtest) {
      const orderTypeInfo = orderResult.orderType ? ` (${orderResult.orderType})` : '';
      const attemptInfo = orderResult.attempts ? ` - 試行: ${orderResult.attempts}回` : '';
      postOrderToDiscord(`[${strategyName}] 買い注文実行${orderTypeInfo}: ${exchange.id} - ${symbol} - 価格: ${currentPrice}, 数量: ${formattedAmount}${attemptInfo}`);
    }

    // 取引記録を更新
    // 高度注文の場合、調整された価格を使用
    // フォールバック注文の場合、marketタイプとして扱う
    const executedPrice = orderResult?.adjustedPrice || order.price || currentPrice;
    const finalOrderType = orderResult?.success ? orderType : 'market'; // フォールバック時はmarket扱い

    if (finalOrderType === 'market') {
      // マーケットオーダーの場合、実際の約定価格を取得
      addOrder(exchange, symbol, strategyKey, 'buy', formattedAmount, executedPrice, order.id, 'market', options);
    } else {
      addOrder(exchange, symbol, strategyKey, 'buy', formattedAmount, executedPrice, order.id, 'limit', options);
    }

    // リスク管理: ポジション情報を記録（バックテストモードではスキップ）
    if (!options.backtest && config.enableRiskManagement !== false) {
      await recordBuyPosition(exchange, symbol, strategyKey, order, executedPrice);
    }

    return { success: true, order };
  } else {
    // logger.info(allowanceCheck.reason);
    if (postOrderToDiscord && !options.backtest) {
      await postOrderToDiscord(`[${strategyName}] ${allowanceCheck.reason}`);
    }

    return { success: false, reason: allowanceCheck.reason };
  }
}

/**
 * 売り注文を実行する共通処理
 * @param {Object} exchange 取引所オブジェクト
 * @param {string} symbol 通貨ペア
 * @param {string} strategyKey 戦略キー
 * @param {Object} config 設定オブジェクト
 * @param {Object} marketParameters マーケットパラメータ
 * @param {number} currentPrice 現在価格
 * @param {string} strategyName 戦略名（ログ出力用）
 * @param {Object} signalInfo シグナル情報（ログ出力用）
 * @returns {Object} 注文結果
 */
async function executeSellOrder(exchange, symbol, strategyKey, config, marketParameters, currentPrice, strategyName, signalInfo, options = {}, globalConfig = null) { // globalConfigを追加
  // marketParametersが未定義の場合の安全処理
  if (!marketParameters) {
    logger.error(`[${strategyName}] marketParametersが未定義です: ${symbol}`);
    return { success: false, reason: 'marketParameters is undefined' };
  }

  const { amountPrecision, minTradeAmount } = marketParameters;
  const { orderType } = config;

  // 利用可能な資産を確認
  // const balance = await exchange.fetchBalance(); // 既存の呼び出し
  const balance = await getAvailableFund(exchange, symbol, options); // getAvailableFund を呼び出すように変更
  const quoteCurrency = symbol.split('/')[0];
  const availableAsset = balance.free[quoteCurrency];

  // 売れる量を取得
  const formattedAmount = await formattedAvailableAmount(exchange, symbol, strategyKey, amountPrecision, options); // options を渡すように変更

  if (formattedAmount < minTradeAmount) {
    if (!options.backtest) {
      logger.info(`調整後の売却量が最小取引量より小さいため、売り注文は発注しません: ${symbol} - 調整後: ${formattedAmount}, 最小: ${minTradeAmount}`);
    }
    if (postOrderToDiscord && !options.backtest) {
      postOrderToDiscord(`[${strategyName}] 調整後の売却量が最小取引量より小さいため、売り注文をスキップ: ${exchange.id} - ${symbol} - 調整後: ${formattedAmount}, 最小: ${minTradeAmount}`);
    }

    // 早期リターンが必要な場合のためのフラグとデータを含める
    return {
      success: false,
      reason: 'adjusted amount below minimum trade amount',
      earlyReturn: true,
      returnValue: {
        strategy: strategyName,
        symbol,
        price: currentPrice,
        ...signalInfo,
        signal: 'none',
        reason: 'adjusted amount below minimum trade amount'
      }
    };
  }

  // availableAsset >= formattedAmount のチェックはバックテストでは不要（資金はシミュレーションで管理されるため）
  // ただし、リアルタイムモードとの互換性を保つため、チェックを残すか、バックテストモードではスキップするように修正が必要。
  // 計画ではバックテストモードでの資金チェックは getAvailableFund で行われる計算に委ねられていると解釈し、ここでは formattedAmount > 0 のチェックのみに絞る。
  // リアルタイムモードの availableAsset >= formattedAmount && formattedAmount > 0 はそのまま残す。

  if (options.backtest || (availableAsset >= formattedAmount && formattedAmount > 0)) { // バックテストモードの場合は formattedAmount > 0 のみチェック
    let order;
    let orderResult = { success: false };

    if (options.backtest) {
      // バックテストモードの場合、バックテスト用の注文関数を呼び出す
      order = await backtestCreateLimitSellOrder(symbol, formattedAmount, currentPrice, options);
      orderResult = { success: true, order };
    } else {
      // リアルタイムモードの場合、高度注文管理システムを使用
      const orderManager = getOrderManager(exchange);

      // 注文オプション設定（共通関数を使用）
      const { urgency, urgencyResult, orderConfig, orderOptions } = await setupOrderOptions(
        config, exchange, symbol, strategyName, currentPrice, marketParameters, formattedAmount
      );

      // 高度注文管理が有効かチェック
      if (orderConfig.enabled) {
        // 残高検証（共通関数を使用）
        const validationResult = await validateBalance(exchange, symbol, strategyName, formattedAmount, currentPrice, options);

        if (!validationResult.success) {
          return {
            success: false,
            reason: 'Position validation failed before advanced order - insufficient balance on exchange',
            validationDetails: validationResult.validationDetails
          };
        }

        logger.info(`[${strategyName}] 高度注文管理システム使用: ${symbol} urgency=${urgency} (${urgencyResult.method}, 信頼度:${urgencyResult.confidence.toFixed(3)})`);
        // 高度注文実行
        orderResult = await orderManager.executeAdvancedOrder(
          symbol, 'sell', formattedAmount, currentPrice, orderOptions
        );
      } else {
        logger.warn(`[${strategyName}] 高度注文管理無効 - 従来方式使用: ${symbol}`);
        orderResult.success = false; // フォールバック処理を実行
      }

      if (orderResult.success) {
        order = orderResult.order;
      } else {
        // 🚨 EMERGENCY FIX: 高度注文が失敗した場合、従来方式にフォールバック
        logger.warn(`[${strategyName}] 高度注文失敗、従来方式でフォールバック: ${symbol}`);
        logger.warn(`[${strategyName}] 失敗理由: ${orderResult.error?.message || 'バリデーション失敗'}`);

        try {
          // 🔍 COMPREHENSIVE VALIDATION: Check position existence with detailed logging (fallback)
          logger.info(`[${strategyName}] 📊 FALLBACK VALIDATION START: ${symbol}`);
          logger.info(`[${strategyName}] ├─ 高度注文失敗のためフォールバック実行`);
          logger.info(`[${strategyName}] ├─ 現在価格: ¥${currentPrice?.toLocaleString()}`);
          logger.info(`[${strategyName}] ├─ 予定売却量: ${formattedAmount}`);
          logger.info(`[${strategyName}] └─ 戦略キー: ${strategyKey}`);

          const exchangeBalance = await exchange.fetchBalance();
          const baseCurrency = symbol.split('/')[0];
          const exchangeAmount = exchangeBalance.free[baseCurrency] || 0;
          const exchangeLockedAmount = exchangeBalance.used[baseCurrency] || 0;
          const exchangeTotalAmount = exchangeBalance.total[baseCurrency] || 0;

          // Detailed balance logging for fallback
          logger.info(`[${strategyName}] 💰 FALLBACK BALANCE DETAILS: ${symbol}`);
          logger.info(`[${strategyName}] ├─ Free: ${exchangeAmount}`);
          logger.info(`[${strategyName}] ├─ Used: ${exchangeLockedAmount}`);
          logger.info(`[${strategyName}] ├─ Total: ${exchangeTotalAmount}`);
          logger.info(`[${strategyName}] └─ Required: ${formattedAmount}`);

          if (exchangeAmount < formattedAmount) {
            const shortage = formattedAmount - exchangeAmount;
            const shortagePercent = ((shortage / formattedAmount) * 100).toFixed(2);

            logger.error(`[${strategyName}] ❌ FALLBACK VALIDATION FAILED: ${symbol}`);
            logger.error(`[${strategyName}] ├─ 不足量: ${shortage} (${shortagePercent}%)`);
            logger.error(`[${strategyName}] ├─ Exchange Free: ${exchangeAmount}`);
            logger.error(`[${strategyName}] ├─ Exchange Used: ${exchangeLockedAmount}`);
            logger.error(`[${strategyName}] ├─ 必要量: ${formattedAmount}`);
            logger.error(`[${strategyName}] └─ フォールバック実行不可`);

            if (postErrorToDiscord && !options.backtest) {
              await postErrorToDiscord(`🚨 **フォールバックポジション検証失敗** ${symbol}\n` +
                                      `戦略: ${strategyName}\n` +
                                      `Exchange Free残高: ${exchangeAmount}\n` +
                                      `Exchange Used残高: ${exchangeLockedAmount}\n` +
                                      `Exchange Total残高: ${exchangeTotalAmount}\n` +
                                      `売却予定: ${formattedAmount}\n` +
                                      `不足量: ${shortage} (${shortagePercent}%)\n` +
                                      `現在価格: ¥${currentPrice?.toLocaleString()}\n` +
                                      '⚠️ 高度注文失敗後のフォールバックも実行不可\n' +
                                      '🔥 緊急対応が必要です\n' +
                                      `⏰ ${new Date().toLocaleString('ja-JP')}`);
            }

            return {
              success: false,
              reason: 'Fallback position validation failed - insufficient balance on exchange',
              fallbackValidationDetails: {
                exchangeAmount,
                exchangeLockedAmount,
                exchangeTotalAmount,
                attemptedAmount: formattedAmount,
                shortage,
                shortagePercent: parseFloat(shortagePercent),
                isFallback: true
              }
            };
          }

          logger.info(`[${strategyName}] ✅ FALLBACK VALIDATION PASSED: ${symbol}`);
          logger.info(`[${strategyName}] ├─ Exchange Free: ${exchangeAmount} >= Required: ${formattedAmount}`);
          logger.info(`[${strategyName}] ├─ 余剰量: ${(exchangeAmount - formattedAmount).toFixed(6)}`);
          logger.info(`[${strategyName}] └─ フォールバック実行可能`);

          // 従来のマーケット注文方式でフォールバック実行
          logger.info(`[${strategyName}] フォールバック: createMarketSellOrder実行 ${symbol} 数量:${formattedAmount}`);
          
          // Issue #5486: バックテスト環境でcreateMarketSellOrderメソッドが存在しない場合の防御的処理
          try {
            if (typeof exchange.createMarketSellOrder !== 'function') {
              // バックテスト環境またはモックオブジェクトでcreateMarketSellOrderが定義されていない場合
              logger.info(`[${strategyName}] 情報: ${exchange.id}でcreateMarketSellOrderメソッドが利用できません（バックテスト環境）。模擬注文を返します。`);
              order = {
                id: `backtest_fallback_sell_${Date.now()}`,
                symbol: symbol,
                amount: formattedAmount,
                price: currentPrice || 0,
                type: 'market',
                side: 'sell',
                status: 'closed',
                filled: formattedAmount,
                remaining: 0,
                cost: (currentPrice || 0) * formattedAmount,
                timestamp: Date.now(),
                datetime: new Date().toISOString()
              };
            } else {
              order = await exchange.createMarketSellOrder(symbol, formattedAmount);
            }
          } catch (fallbackOrderError) {
            // Issue #5486: createMarketSellOrderメソッドが関数ではない場合の追加処理
            if (fallbackOrderError.message && fallbackOrderError.message.includes('is not a function')) {
              logger.info(`[${strategyName}] 情報: ${exchange.id}でcreateMarketSellOrderメソッドが正しく定義されていません（バックテスト環境）。模擬注文を返します。`);
              order = {
                id: `backtest_fallback_sell_${Date.now()}`,
                symbol: symbol,
                amount: formattedAmount,
                price: currentPrice || 0,
                type: 'market',
                side: 'sell',
                status: 'closed',
                filled: formattedAmount,
                remaining: 0,
                cost: (currentPrice || 0) * formattedAmount,
                timestamp: Date.now(),
                datetime: new Date().toISOString()
              };
            } else {
              // その他のエラーは再スロー
              throw fallbackOrderError;
            }
          }

          // フォールバック成功の通知
          if (postOrderToDiscord && !options.backtest) {
            await postOrderToDiscord(`✅ **フォールバック成功** ${symbol}\n` +
                                    `戦略: ${strategyName}\n` +
                                    '高度注文失敗 → 従来方式で売却完了\n' +
                                    `数量: ${formattedAmount}\n` +
                                    `価格: ¥${(order.price || currentPrice).toLocaleString()}\n` +
                                    `⏰ ${new Date().toLocaleString('ja-JP')}`);
          }

          logger.info(`[${strategyName}] フォールバック成功: ${symbol} - Order ID: ${order.id}`);

        } catch (fallbackError) {
          // フォールバック失敗時のエラーハンドリング
          logger.error(`[${strategyName}] フォールバック失敗: ${symbol} - ${fallbackError.message}`);

          if (postErrorToDiscord && !options.backtest) {
            await postErrorToDiscord(`🚨 **フォールバック失敗** ${symbol}\n` +
                                    `戦略: ${strategyName}\n` +
                                    '高度注文失敗 + 従来方式も失敗\n' +
                                    `エラー: ${fallbackError.message}\n` +
                                    '⚠️ 手動介入が必要です\n' +
                                    `⏰ ${new Date().toLocaleString('ja-JP')}`);
          }

          return { success: false, reason: 'フォールバック失敗のため注文実行不可', error: fallbackError };
        }
      }
    }

    // 取引記録を更新
    // 高度注文の場合、調整された価格を使用
    // フォールバック注文の場合、marketタイプとして扱う
    const executedPrice = orderResult?.adjustedPrice || order.price || currentPrice;
    const finalOrderType = orderResult?.success ? orderType : 'market'; // フォールバック時はmarket扱い

    if (finalOrderType === 'market') {
      // マーケットオーダーの場合、実際の約定価格を取得
      addOrder(exchange, symbol, strategyKey, 'sell', formattedAmount, executedPrice, order.id, 'market', options);
    } else {
      addOrder(exchange, symbol, strategyKey, 'sell', formattedAmount, executedPrice, order.id, 'limit', options);
    }

    // パフォーマンス追跡（バックテスト以外）
    if (!options.backtest && globalConfig?.global?.dynamicPositionSizing?.enabled) {
      try {
        // 簡易的なPnL計算（正確な計算はaddOrderで行われる）
        const estimatedPnL = await getRealizedPnL(exchange, symbol, strategyKey, options);

        if (estimatedPnL !== null && estimatedPnL !== 0) {
          await performanceTracker.recordTrade(exchange.id, symbol, strategyKey, {
            side: 'sell',
            amount: formattedAmount,
            price: executedPrice,
            pnl: estimatedPnL,
            timestamp: Date.now()
          });

          const safePnL = estimatedPnL !== null && estimatedPnL !== undefined ? estimatedPnL.toFixed(2) : 'N/A';
          logger.info(`[パフォーマンス追跡] ${strategyName}: PnL記録 ${safePnL}`);
        }
      } catch (trackingError) {
        logger.error(`[パフォーマンス追跡] エラー: ${trackingError.message}`);
      }
    }

    return { success: true, order };
  } else {
    logger.info(`資産不足のため注文をスキップ: ${symbol} - 必要: ${formattedAmount}, 利用可能: ${availableAsset}`);
    if (postOrderToDiscord) {
      postOrderToDiscord(`[${strategyName}] 資産不足のため売り注文をスキップ: ${exchange.id} - ${symbol} - 必要: ${formattedAmount}, 利用可能: ${availableAsset}`);
    }

    return { success: false, reason: 'insufficient funds' };
  }
}

async function disableStrategy(exchange, symbol, strategyKey, config, options = {}) {
  // configを取得
  const _dbParams = await getStrategyParameters(exchange.id, symbol, strategyKey);
  // enabledをfalseに設定
  _dbParams.enabled = false;
  // configを保存
  await saveStrategyParameters(exchange.id, symbol, strategyKey, _dbParams);
}

async function clearPositionMarket(exchange, symbol, strategyKey, options = {}) {

  try {
    // Issue #5063: exchangeオブジェクトの存在確認
    if (!exchange) {
      logger.warn(`警告: exchangeオブジェクトが定義されていません。処理をスキップします。`);
      return { success: false, reason: 'exchange object is null or undefined' };
    }

    // 取引所がシンボルをサポートしているか確認
    if (!exchange.markets) {
      await exchange.loadMarkets();
    }

    // シンボルが取引所でサポートされているか確認
    if (!(symbol in exchange.markets)) {
      logger.info(`警告: ${exchange.id}は${symbol}をサポートしていません。オープンオーダーの確認をスキップします。`);
      return { success: false, reason: 'unsupported symbol' };
    }

    // 戦略キーが一致するオーダーのみキャンセル
    let openOrders;
    try {
      // Issue #5063: バックテスト環境でfetchOpenOrdersメソッドが存在しない場合の防御的処理
      if (typeof exchange.fetchOpenOrders !== 'function') {
        // バックテスト環境またはモックオブジェクトでfetchOpenOrdersが定義されていない場合
        logger.info(`警告: ${exchange.id}でfetchOpenOrdersメソッドが利用できません（バックテスト環境）。空の配列を返します。`);
        openOrders = [];
      } else {
        openOrders = await exchange.fetchOpenOrders(symbol);
      }
    } catch (fetchError) {
      // Issue #5081: fetchOpenOrdersメソッドが関数ではない場合の追加処理
      if (fetchError.message && fetchError.message.includes('is not a function')) {
        logger.info(`警告: ${exchange.id}でfetchOpenOrdersメソッドが正しく定義されていません（バックテスト環境）。空の配列を返します。`);
        openOrders = [];
      }
      // 認証エラーや無効なシンボルエラーの場合、サポートされていないシンボルとして扱う
      else if (fetchError.name === 'AuthenticationError' ||
          fetchError.message.includes('authentication') ||
          fetchError.message.includes('Invalid symbol') ||
          isBitbankError(fetchError, BITBANK_ERRORS.SYSTEM_ERROR)) {  // bitbankのシステムエラー（堅牢な判定）
        logger.info(`警告: ${exchange.id}の${symbol}でオープンオーダー取得に失敗しました（サポートされていない可能性）: ${fetchError.message}`);
        return { success: false, reason: 'unsupported symbol for private API' };
      }
      // その他のエラーは再スロー
      else {
        throw fetchError;
      }
    }

    await Promise.all(openOrders.map(async (order) => {
      try {
        const _strategyKey = await getOrderStrategyKeyByOrderId(order.id);
        return (strategyKey === _strategyKey) ? await exchange.cancelOrder(order.id, symbol) : null;
      } catch (error) {
        logger.error(`オーダーキャンセルに失敗: ${symbol} - エラー: ${error.message}`);
        if (postErrorToDiscord) {
          await postErrorToDiscord(`[${exchange?.id || 'unknown'}] オーダーキャンセルに失敗: ${symbol} - エラー: ${error.message}\nスタックトレース: ${error.stack}`);
        }
      }
    }));
  } catch (error) {
    logger.error(`オープンオーダーの取得に失敗: ${symbol} - エラー: ${error.message}`);
    if (postErrorToDiscord) {
      await postErrorToDiscord(`[${exchange?.id || 'unknown'}] オープンオーダーの取得に失敗: ${symbol} - エラー: ${error.message}\nスタックトレース: ${error.stack}`);
    }
    return { success: false, error };
  }

  // 戦略に買いポジションがある場合、売り注文を作成
  const _netPosition = await getTradeCurrentPosition(exchange, symbol, strategyKey);

  // 市場パラメータから最小取引量を取得
  const marketParams = await getMarketParameters(exchange, symbol);
  const minTradeAmount = marketParams?.minTradeAmount || 0.0001; // フォールバック値

  if (_netPosition < minTradeAmount) {
    logger.info(`ポジションが最小取引量未満のため、売り注文は発注しません: ${symbol} (position: ${_netPosition}, min: ${minTradeAmount})`);
    return { success: false, reason: 'position below minimum' };
  }

  const netPosition = Math.max(_netPosition !== null && _netPosition !== undefined ? _netPosition.toFixed(4) : 0, minTradeAmount);
  // 売り注文を作成
  try {
    let order;
    try {
      // Issue #5486: バックテスト環境でcreateMarketSellOrderメソッドが存在しない場合の防御的処理
      if (typeof exchange.createMarketSellOrder !== 'function') {
        // バックテスト環境またはモックオブジェクトでcreateMarketSellOrderが定義されていない場合
        logger.info(`情報: ${exchange.id}でcreateMarketSellOrderメソッドが利用できません（バックテスト環境）。模擬注文を返します。`);
        order = {
          id: `backtest_sell_${Date.now()}`,
          symbol: symbol,
          amount: netPosition,
          price: 0, // バックテストでは価格は0として扱う
          type: 'market',
          side: 'sell',
          status: 'closed',
          filled: netPosition,
          remaining: 0,
          cost: 0,
          timestamp: Date.now(),
          datetime: new Date().toISOString()
        };
      } else {
        order = await exchange.createMarketSellOrder(symbol, netPosition);
      }
    } catch (createOrderError) {
      // Issue #5486: createMarketSellOrderメソッドが関数ではない場合の追加処理
      if (createOrderError.message && createOrderError.message.includes('is not a function')) {
        logger.info(`情報: ${exchange.id}でcreateMarketSellOrderメソッドが正しく定義されていません（バックテスト環境）。模擬注文を返します。`);
        order = {
          id: `backtest_sell_${Date.now()}`,
          symbol: symbol,
          amount: netPosition,
          price: 0, // バックテストでは価格は0として扱う
          type: 'market',
          side: 'sell',
          status: 'closed',
          filled: netPosition,
          remaining: 0,
          cost: 0,
          timestamp: Date.now(),
          datetime: new Date().toISOString()
        };
      } else {
        // その他のエラーは再スロー
        throw createOrderError;
      }
    }
    addOrder(exchange, symbol, strategyKey, 'sell', netPosition, order.price, order.id, 'market');

    // 売り注文成功後、関連するポジションをクリーンアップ
    try {
      logger.info(`[INFO] Cleaning up positions for strategy ${strategyKey} after market sell`);

      // 戦略の全ポジションを取得
      const positions = await getStrategyPositionsRedis(exchange.id, symbol, strategyKey);
      let cleanedCount = 0;
      let cleanupErrors = 0;

      for (const position of positions) {
        // オープンポジションのみクリーンアップ対象とする
        if (position.status === 'open' && position.side === 'buy') {
          try {
            const cleanupResult = await closeAndCleanupPosition(position.key, {
              saveHistory: true,  // 履歴をMongoDBに保存
              delayHours: 0      // 即座に削除
            });

            if (cleanupResult.success) {
              cleanedCount++;
              logger.info(`[INFO] Position cleaned up: ${position.key}, action: ${cleanupResult.action}`);
              if (cleanupResult.historyKey) {
                logger.info(`[INFO] Position history saved to MongoDB: ${cleanupResult.historyKey}`);
              }
            } else {
              cleanupErrors++;
              logger.warn(`[WARNING] Position cleanup failed: ${position.key}, reason: ${cleanupResult.reason}`);
            }
          } catch (cleanupError) {
            cleanupErrors++;
            logger.error(`[ERROR] Position cleanup error: ${position.key}`, cleanupError.message);
          }
        }
      }

      if (cleanedCount > 0 || cleanupErrors > 0) {
        const cleanupMessage = '🧹 [ポジション整理] 戦略クリア後のクリーンアップ完了\n' +
                              `取引所: ${exchange.id}\n` +
                              `通貨ペア: ${symbol}\n` +
                              `戦略: ${strategyKey}\n` +
                              `✅ クリーンアップ成功: ${cleanedCount}件\n` +
                              `❌ クリーンアップ失敗: ${cleanupErrors}件\n` +
                              `💰 売却量: ${netPosition}\n` +
                              `📅 実行時刻: ${new Date().toLocaleString('ja-JP')}`;

        if (postOrderToDiscord) {
          await postOrderToDiscord(cleanupMessage);
        }

        logger.info(`[INFO] Position cleanup completed: ${cleanedCount} cleaned, ${cleanupErrors} errors`);
      }
    } catch (cleanupError) {
      logger.error(`[ERROR] Position cleanup process failed: ${symbol}`, cleanupError.message);
      // クリーンアップ失敗は売り注文成功を妨げない
    }

    // リスク管理データのクリア（バックテスト強制決済時に重要）
    try {
      logger.info(`[INFO] Clearing risk management data for strategy ${strategyKey}`);
      const riskClearResult = await clearStrategyRiskData(exchange.id, symbol, strategyKey);

      if (riskClearResult.success) {
        logger.info(`[INFO] Risk management data cleared successfully: ${riskClearResult.message}`);

        if (postOrderToDiscord) {
          const riskMessage = '🛡️ [リスク管理] データクリア完了\\n' +
                             `取引所: ${exchange.id}\\n` +
                             `通貨ペア: ${symbol}\\n` +
                             `戦略: ${strategyKey}\\n` +
                             `結果: ${riskClearResult.message}\\n` +
                             `📅 実行時刻: ${new Date().toLocaleString('ja-JP')}`;

          await postOrderToDiscord(riskMessage);
        }
      } else {
        logger.warn(`[WARNING] Risk management data clear had issues: ${riskClearResult.message}`);

        if (postErrorToDiscord) {
          await postErrorToDiscord(`[${exchange.id}] リスク管理データクリアで問題発生: ${symbol} - ${riskClearResult.message}`);
        }
      }
    } catch (riskClearError) {
      logger.error(`[ERROR] Risk management data clear failed: ${symbol}`, riskClearError.message);

      if (postErrorToDiscord) {
        await postErrorToDiscord(`[${exchange.id}] リスク管理データクリア失敗: ${symbol} - エラー: ${riskClearError.message}`);
      }
      // リスク管理データクリア失敗は売り注文成功を妨げない
    }

  } catch (error) {
    logger.error(`売り注文の発注に失敗: ${symbol} - エラー: ${error.message}`);
    if (postErrorToDiscord) {
      await postErrorToDiscord(`[${exchange.id}] 売り注文の発注に失敗: ${symbol} - エラー: ${error.message}\nスタックトレース: ${error.stack}`);
    }
    return { success: false, error };
  }

  return { success: true };
}

/**
 * マルチ指標確認システム
 * 複数の指標が同じ方向を示しているかを確認
 * @param {Object} indicators - 各種指標の計算結果
 * @param {Object} config - 確認システムの設定
 * @returns {Object} 確認結果とシグナル強度
 */
function confirmMultipleIndicators(indicators, config = {}) {
  const {
    requiredConfirmations = 3, // 必要な確認数
    weights = {
      macd: 1.0,
      ema: 0.8,
      rsi: 0.7,
      volume: 0.5,
      adx: 0.9
    }
  } = config;

  const bullishSignals = [];
  const bearishSignals = [];
  let totalBullishWeight = 0;
  let totalBearishWeight = 0;

  // MACD確認
  if (indicators.macd) {
    const { histogram, signal, macd } = indicators.macd;
    const lastHistogram = histogram[histogram.length - 1];
    const prevHistogram = histogram[histogram.length - 2];

    if (lastHistogram > 0 && lastHistogram > prevHistogram) {
      bullishSignals.push('MACD');
      totalBullishWeight += weights.macd;
    } else if (lastHistogram < 0 && lastHistogram < prevHistogram) {
      bearishSignals.push('MACD');
      totalBearishWeight += weights.macd;
    }
  }

  // EMA確認（短期が長期を上回る）
  if (indicators.emaShort && indicators.emaLong) {
    const lastShort = indicators.emaShort[indicators.emaShort.length - 1];
    const lastLong = indicators.emaLong[indicators.emaLong.length - 1];

    if (lastShort > lastLong) {
      bullishSignals.push('EMA');
      totalBullishWeight += weights.ema;
    } else if (lastShort < lastLong) {
      bearishSignals.push('EMA');
      totalBearishWeight += weights.ema;
    }
  }

  // RSI確認
  if (indicators.rsi) {
    const lastRSI = indicators.rsi[indicators.rsi.length - 1];
    const prevRSI = indicators.rsi[indicators.rsi.length - 2];

    // RSIが30を上抜け（買われすぎ領域から脱出）
    if (lastRSI > 30 && prevRSI <= 30) {
      bullishSignals.push('RSI');
      totalBullishWeight += weights.rsi;
    }
    // RSIが70を下抜け（売られすぎ領域から脱出）
    else if (lastRSI < 70 && prevRSI >= 70) {
      bearishSignals.push('RSI');
      totalBearishWeight += weights.rsi;
    }
    // トレンド確認
    else if (lastRSI > 50 && lastRSI > prevRSI) {
      bullishSignals.push('RSI');
      totalBullishWeight += weights.rsi * 0.5; // トレンド確認は弱いシグナル
    } else if (lastRSI < 50 && lastRSI < prevRSI) {
      bearishSignals.push('RSI');
      totalBearishWeight += weights.rsi * 0.5;
    }
  }

  // 出来高確認
  if (indicators.volume && indicators.volumeMA) {
    const lastVolume = indicators.volume[indicators.volume.length - 1];
    const lastVolumeMA = indicators.volumeMA[indicators.volumeMA.length - 1];

    // 出来高が平均を上回る場合、現在のトレンドを確認
    if (lastVolume > lastVolumeMA * 1.2) {
      if (indicators.priceChange > 0) {
        bullishSignals.push('Volume');
        totalBullishWeight += weights.volume;
      } else if (indicators.priceChange < 0) {
        bearishSignals.push('Volume');
        totalBearishWeight += weights.volume;
      }
    }
  }

  // ADX確認（トレンド強度）
  if (indicators.adx) {
    const { adx, plusDI, minusDI } = indicators.adx;
    const lastADX = adx[adx.length - 1];
    const lastPlusDI = plusDI[plusDI.length - 1];
    const lastMinusDI = minusDI[minusDI.length - 1];

    // ADXが25以上でトレンドが存在
    if (lastADX >= 25) {
      if (lastPlusDI > lastMinusDI) {
        bullishSignals.push('ADX');
        totalBullishWeight += weights.adx;
      } else if (lastMinusDI > lastPlusDI) {
        bearishSignals.push('ADX');
        totalBearishWeight += weights.adx;
      }
    }
  }

  // シグナル強度を計算（0-100のスコア）
  // 実際に評価された指標の重みのみで計算（動的重み計算）
  const evaluatedWeights = [];

  if (indicators.macd) {
    evaluatedWeights.push(weights.macd || 0);
  }
  if (indicators.emaShort && indicators.emaLong) {
    evaluatedWeights.push(weights.ema || 0);
  }
  if (indicators.rsi) {
    evaluatedWeights.push(weights.rsi || 0);
  }
  if (indicators.volume && indicators.volumeMA) {
    evaluatedWeights.push(weights.volume || 0);
  }
  if (indicators.adx) {
    evaluatedWeights.push(weights.adx || 0);
  }

  const maxPossibleWeight = evaluatedWeights.reduce((a, b) => a + b, 0);
  const bullishScore = maxPossibleWeight > 0 ? (totalBullishWeight / maxPossibleWeight) * 100 : 0;
  const bearishScore = maxPossibleWeight > 0 ? (totalBearishWeight / maxPossibleWeight) * 100 : 0;

  // 確認結果を判定
  const isBullish = bullishSignals.length >= requiredConfirmations && bullishScore > bearishScore;
  const isBearish = bearishSignals.length >= requiredConfirmations && bearishScore > bullishScore;

  return {
    confirmed: isBullish || isBearish,
    direction: isBullish ? 'bullish' : (isBearish ? 'bearish' : 'neutral'),
    bullishSignals,
    bearishSignals,
    bullishScore: bullishScore !== null && bullishScore !== undefined ? bullishScore.toFixed(2) : '0.00',
    bearishScore: bearishScore !== null && bearishScore !== undefined ? bearishScore.toFixed(2) : '0.00',
    requiredConfirmations,
    actualConfirmations: {
      bullish: bullishSignals.length,
      bearish: bearishSignals.length
    }
  };
}

/**
 * 市場環境を識別（トレンド vs レンジ）
 * @param {Object} adxData - ADX計算結果
 * @param {Object} config - 識別設定
 * @returns {Object} 市場環境の識別結果
 */
function identifyMarketEnvironment(adxData, config = {}) {
  const {
    strongTrendThreshold = 40,
    trendThreshold = 25,
    weakTrendThreshold = 20
  } = config;

  if (!adxData || !adxData.adx || adxData.adx.length === 0) {
    return {
      environment: 'unknown',
      strength: 0,
      description: 'データ不足'
    };
  }

  const lastADX = adxData.adx[adxData.adx.length - 1];
  const prevADX = adxData.adx[adxData.adx.length - 2] || lastADX;
  const adxTrend = lastADX - prevADX;

  let environment, strength, description;

  if (lastADX >= strongTrendThreshold) {
    environment = 'strong_trend';
    strength = lastADX;
    description = '強いトレンド相場';
  } else if (lastADX >= trendThreshold) {
    environment = 'trend';
    strength = lastADX;
    description = 'トレンド相場';
  } else if (lastADX >= weakTrendThreshold) {
    environment = 'weak_trend';
    strength = lastADX;
    description = '弱いトレンド相場';
  } else {
    environment = 'range';
    strength = lastADX;
    description = 'レンジ相場';
  }

  // トレンドの方向性
  let direction = 'neutral';
  if (adxData.plusDI && adxData.minusDI) {
    const lastPlusDI = adxData.plusDI[adxData.plusDI.length - 1];
    const lastMinusDI = adxData.minusDI[adxData.minusDI.length - 1];

    if (lastPlusDI > lastMinusDI) {
      direction = 'bullish';
    } else if (lastMinusDI > lastPlusDI) {
      direction = 'bearish';
    }
  }

  return {
    environment,
    strength,
    description,
    direction,
    adxTrend: adxTrend > 0 ? 'strengthening' : 'weakening',
    recommendation: getMarketRecommendation(environment, direction)
  };
}

/**
 * 市場環境に基づく推奨戦略を取得
 * @param {string} environment - 市場環境
 * @param {string} direction - トレンド方向
 * @returns {Object} 推奨戦略
 */
function getMarketRecommendation(environment, direction) {
  const recommendations = {
    strong_trend: {
      strategy: 'trend_following',
      description: 'トレンドフォロー戦略が有効',
      caution: 'トレンド転換に注意'
    },
    trend: {
      strategy: 'trend_following',
      description: 'トレンドフォロー戦略を推奨',
      caution: 'ポジションサイズ管理に注意'
    },
    weak_trend: {
      strategy: 'mixed',
      description: 'トレンドとレンジ戦略の併用を検討',
      caution: 'だましシグナルに注意'
    },
    range: {
      strategy: 'range_trading',
      description: 'レンジ取引戦略が有効',
      caution: 'ブレイクアウトに備える'
    }
  };

  return recommendations[environment] || {
    strategy: 'caution',
    description: '市場環境が不明瞭',
    caution: '小さなポジションで様子見'
  };
}

/**
 * 戦略共通エラーハンドリング関数
 * 全戦略で同じ形式のエラーハンドリングを提供
 * @param {Error} error - 発生したエラー
 * @param {string} symbol - 通貨ペア
 * @param {string} strategyName - 戦略名（日本語）
 * @param {string} strategyId - 戦略ID（英語）
 * @param {Object} exchange - 取引所オブジェクト
 * @returns {Object} 標準化されたエラーレスポンス
 */
async function handleStrategyError(error, symbol, strategyName, strategyId, exchange) {
  logger.error(`${strategyName}戦略でエラーが発生しました: ${symbol}`, error);
  logger.error('[DETAILED ERROR] Stack trace:', error.stack);

  if (postErrorToDiscord) {
    const simpleMessage = `[${strategyName}] エラー: ${exchange.id} - ${symbol} - ${error.message}`;
    await postErrorToDiscord(simpleMessage);
  }

  return {
    strategy: strategyId,
    symbol,
    error: error.message
  };
}

/**
 * 現在価格取得の共通関数
 * 全戦略で統一された価格取得処理を提供
 * @param {Object} exchange - 取引所オブジェクト
 * @param {string} symbol - 通貨ペア
 * @param {Object} options - オプション（バックテスト設定等）
 * @returns {Promise<number>} 現在価格
 */
async function getCurrentPrice(exchange, symbol, options = {}) {
  const ticker = await fetchTicker(exchange, symbol, options);
  if (!ticker || !ticker.last) {
    logger.warn(`[getCurrentPrice] ${symbol} - ティッカーまたはlast価格が取得できませんでした`);
    return null;
  }
  return ticker.last;
}

/**
 * 戦略シグナル保存の共通関数
 * 条件に応じてシグナルを保存する統一処理
 * @param {Object} exchange - 取引所オブジェクト
 * @param {string} symbol - 通貨ペア
 * @param {string} strategyKey - 戦略キー
 * @param {string} signalType - シグナルタイプ ('buy', 'sell', 'none')
 * @param {number} currentPrice - 現在価格
 * @param {Object} strategyResults - 戦略計算結果
 * @param {Object} options - オプション（バックテスト設定等）
 */
async function saveStrategySignal(exchange, symbol, strategyKey, signalType, currentPrice, strategyResults, options = {}) {
  if (signalType !== 'none') {
    await addSignal(exchange, symbol, strategyKey, signalType, currentPrice, strategyResults, options);
  }
}

/**
 * ログ情報フォーマットの基底関数
 * 戦略固有の情報と共通フォーマットを組み合わせる
 * @param {number} currentPrice - 現在価格
 * @param {Object} strategySpecificInfo - 戦略固有の情報
 * @returns {Object} 標準化されたログ情報オブジェクト
 */
function createLogInfoBase(currentPrice, strategySpecificInfo) {
  return {
    buy: strategySpecificInfo.buy || 'シグナル情報なし',
    sell: strategySpecificInfo.sell || 'シグナル情報なし',
    none: strategySpecificInfo.none || 'シグナルなし',
    orderInfo: strategySpecificInfo.orderInfo || {},
    result: {
      ...strategySpecificInfo.result || {},
      currentPrice
    }
  };
}

/**
 * OHLCV データ取得とバックテスト設定の共通処理
 * 戦略で頻繁に使用されるパターンを統一
 * @param {Object} exchange - 取引所オブジェクト
 * @param {string} symbol - 通貨ペア
 * @param {string} ohlcvInterval - OHLCV間隔
 * @param {number} period - 期間
 * @param {string} strategyName - 戦略名
 * @param {Object} options - オプション
 * @returns {Object|null} 検証済みデータまたはnull
 */
async function fetchAndValidateOHLCVWithBacktestSetup(exchange, symbol, ohlcvInterval, period, strategyName, options = {}) {
  const validatedData = await fetchAndValidateOHLCVData(
    exchange,
    symbol,
    ohlcvInterval,
    period,
    postErrorToDiscord,
    strategyName,
    options
  );

  if (!validatedData) {
    return null;
  }

  const { closes, ohlcv } = validatedData;

  // バックテストモードの場合、OHLCVデータを設定
  if (options.backtest) {
    options.backtest.ohlcvData = ohlcv;
  }

  return { closes, ohlcv };
}

/**
 * 戦略実行の標準テンプレート関数
 * 共通のtry-catch-returnパターンを統一
 * @param {Function} strategyLogic - 戦略の実行ロジック関数
 * @param {Object} context - 戦略実行コンテキスト
 * @returns {Promise<Object>} 戦略実行結果
 */
async function executeStrategyTemplate(strategyLogic, context) {
  const { exchange, symbol, strategyName, strategyId } = context;

  try {
    return await strategyLogic();
  } catch (error) {
    return await handleStrategyError(error, symbol, strategyName, strategyId, exchange);
  }
}

/**
 * 注文実行結果をフィードバック記録
 * @param {string} testId - テストID
 * @param {Object} orderData - 注文データ
 * @param {Object} urgencyData - urgency調整データ
 * @param {Object} executionResult - 実行結果
 */
function recordOrderExecutionFeedback(testId, orderData, urgencyData, executionResult) {
  try {
    if (unifiedUrgencySystem && testId) {
      unifiedUrgencySystem.recordExecutionFeedback(testId, {
        orderData,
        urgencyData,
        ...executionResult
      });
    }
  } catch (error) {
    logger.warn('[common.js] フィードバック記録エラー:', error.message);
  }
}

/**
 * オブジェクトから数値型のプロパティキーを抽出する
 * @param {Object|null|undefined} config - 設定オブジェクト
 * @returns {Array} 数値型のプロパティキーの配列
 */
function extractNumericParameterKeys(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return [];
  }
  return Object.keys(config).filter(key => typeof config[key] === 'number');
}

/**
 * パラメータの全ての組み合わせを生成する
 * @param {Object} defaultConfig - デフォルト設定
 * @param {Array} numericKeys - 数値型のキーの配列
 * @param {number} n - パラメータの変動幅（デフォルト0.5）
 * @param {number} step - パラメータのステップ数（デフォルト10）
 * @returns {Array} 全ての組み合わせの配列
 */
function generateParameterCombinations(defaultConfig, numericKeys, n = 0.5, step = 10) {
  if (numericKeys.length === 0) {
    return [{}];
  }

  const combinations = [];

  // デフォルト設定を最初に追加
  const defaultCombo = {};
  for (const key of numericKeys) {
    defaultCombo[key] = defaultConfig[key];
  }
  combinations.push(defaultCombo);

  // 組み合わせ生成のループ
  for (const key of numericKeys) {
    const currentCombinations = [...combinations];
    combinations.length = 0; // 既存のcombinationsをクリア

    for (const combo of currentCombinations) {
      const originalValue = defaultConfig[key];
      const stepSize = Math.max(1, originalValue * n / step);

      for (let i = -step; i <= step; i++) {
        if (i === 0) {
          combinations.push({ ...combo, [key]: originalValue }); // デフォルト値
        } else {
          const adjustedValue = Math.round(originalValue + (i * stepSize));
          if (adjustedValue > 0) { // 正の値のみ
            combinations.push({ ...combo, [key]: adjustedValue });
          }
        }
      }
    }
  }

  return combinations;
}

/**
 * 正規分布ランダム値を生成（Box-Muller変換）
 * @param {number} mean - 平均値
 * @param {number} stdDev - 標準偏差
 * @returns {number} 正規分布に従ったランダム値
 */
function generateNormalRandom(mean, stdDev) {
  let u = 0, v = 0;
  while (u === 0) {
    u = Math.random();
  } // 0を回避
  while (v === 0) {
    v = Math.random();
  } // 0を回避
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + z * stdDev;
}

/**
 * 正規乱数を使ったパラメータ組み合わせを生成する
 * @param {Object} defaultConfig - デフォルト設定
 * @param {Array} numericKeys - 数値型のキーの配列
 * @param {number} count - 生成する組み合わせの数（デフォルト60）
 * @param {number} n - パラメータの変動幅（デフォルト0.1）
 * @returns {Array} ランダムに生成されたパラメータ組合せの配列
 */
function generateRandomParameterCombinations(defaultConfig, numericKeys, count = 60, n = 0.1) {
  if (numericKeys.length === 0) {
    return [{}];
  }

  const combinations = [];

  // デフォルト設定を最初に追加
  const defaultCombo = {};
  for (const key of numericKeys) {
    defaultCombo[key] = defaultConfig[key];
  }
  combinations.push(defaultCombo);

  // 残りのランダム組み合わせを生成
  for (let i = 0; i < count - 1; i++) {
    const combo = {};
    for (const key of numericKeys) {
      const defaultValue = defaultConfig[key];
      // 標準偏差はデフォルト値のn%程度に設定
      const stdDev = Math.max(1, defaultValue * n);
      // 正規分布に従ったランダム値を生成し、整数に丸める
      let value = Math.round(generateNormalRandom(defaultValue, stdDev));
      // 最小値を1に制限
      value = Math.max(1, value);

      combo[key] = value;
    }
    combinations.push(combo);
  }

  return combinations;
}

module.exports = {
  fetchAndValidateOHLCVData,
  handleStrategySignals,
  executeBuyOrder,
  executeSellOrder,
  disableStrategy,
  clearPositionMarket,
  initializeDynamicSizing,
  initializeUnifiedUrgencySystem,
  performanceTracker,
  confirmMultipleIndicators,
  identifyMarketEnvironment,
  calculateUnifiedUrgency,
  recordOrderExecutionFeedback,
  // 新しい共通関数
  handleStrategyError,
  getCurrentPrice,
  saveStrategySignal,
  createLogInfoBase,
  fetchAndValidateOHLCVWithBacktestSetup,
  executeStrategyTemplate,
  // 動的ポジションサイジング関連
  calculateCurrentVolatility,
  analyzeMarketConditions,
  // バックテスト関連のパラメータ操作関数
  extractNumericParameterKeys,
  generateParameterCombinations,
  generateRandomParameterCombinations
};

/**
 * 現在のボラティリティを計算
 * @param {Array} ohlcvData - OHLCV データ
 * @returns {number} - ボラティリティ（標準偏差ベース）
 */
function calculateCurrentVolatility(ohlcvData) {
  if (!ohlcvData || ohlcvData.length < 2) {
    return 0.02; // デフォルトボラティリティ
  }

  try {
    // 価格変動率を計算
    const returns = [];
    for (let i = 1; i < ohlcvData.length; i++) {
      const currentPrice = ohlcvData[i][4]; // 終値
      const previousPrice = ohlcvData[i-1][4];
      if (previousPrice > 0) {
        returns.push((currentPrice - previousPrice) / previousPrice);
      }
    }

    if (returns.length === 0) {
      return 0.02;
    }

    // 平均リターンを計算
    const meanReturn = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;

    // 分散を計算
    const variance = returns.reduce((sum, ret) => {
      return sum + Math.pow(ret - meanReturn, 2);
    }, 0) / returns.length;

    // 標準偏差（ボラティリティ）を計算
    const volatility = Math.sqrt(variance);

    // 異常値を防ぐため上限と下限を設定
    return Math.max(0.001, Math.min(0.5, volatility));

  } catch (error) {
    logger.error('ボラティリティ計算エラー:', error);
    return 0.02; // デフォルト値
  }
}

/**
 * 市場状況を分析
 * @param {Array} ohlcvData - OHLCV データ
 * @param {number} currentPrice - 現在価格
 * @returns {Object} - 市場分析結果
 */
function analyzeMarketConditions(ohlcvData, currentPrice) {
  if (!ohlcvData || ohlcvData.length < 10) {
    return { trend: 'unknown', strength: 0, direction: 'sideways' };
  }

  try {
    const prices = ohlcvData.map(candle => candle[4]); // 終値
    const period = Math.min(10, prices.length);
    const recentPrices = prices.slice(-period);

    // 簡単なトレンド分析
    const firstPrice = recentPrices[0];
    const lastPrice = recentPrices[recentPrices.length - 1];
    const priceChange = (lastPrice - firstPrice) / firstPrice;

    // 移動平均との比較
    const sma = recentPrices.reduce((sum, price) => sum + price, 0) / recentPrices.length;
    const priceVsSma = (currentPrice - sma) / sma;

    // トレンドの強さを計算
    const trendStrength = Math.abs(priceChange);

    let trend = 'weak';
    let direction = 'sideways';

    if (trendStrength > 0.03) { // 3%以上の変動
      trend = 'strong';
      direction = priceChange > 0 ? 'up' : 'down';
    } else if (trendStrength > 0.01) { // 1%以上の変動
      trend = 'moderate';
      direction = priceChange > 0 ? 'up' : 'down';
    }

    return {
      trend,
      strength: trendStrength,
      direction,
      priceChange,
      priceVsSma,
      currentPrice,
      sma
    };

  } catch (error) {
    logger.error('市場分析エラー:', error);
    return { trend: 'unknown', strength: 0, direction: 'sideways' };
  }
}