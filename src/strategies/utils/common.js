const { formattedAvailableAmount, getRealizedPnL, addSignal,
  backtestCreateLimitBuyOrder, backtestCreateLimitSellOrder,
  addOrder, fetchOHLCVData, getAvailableFund,
  checkBuyOrderAllowance,
  getStrategyParameters,
  saveStrategyParameters,
  getTradeCurrentPosition,
  getOrderStrategyKeyByOrderId,
  updateFilledTrades,
  fetchTicker
} = require('../../database/manager');
const { postOrderToDiscord, postErrorToDiscord } = require('../../common/notifications');
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

// 動的ポジションサイジングのインスタンス（設定注入用）
let dynamicSizing = null;

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
      console.log(`${strategyName}戦略のデータが不足しています: ${symbol} ${ohlcv.length}/${period} (最低必要: ${minRequiredData})`);
      throw new Error(`${strategyName}戦略のデータが不足しています: ${symbol} ${ohlcv.length}/${period}`);
    }
    if (options.backtest) {
      return null; // バックテストモードではnullを返す
    }
  }
  
  // データが最低要件は満たしているが、期待値より少ない場合は警告
  if (ohlcv.length < period && !options.backtest) {
    console.warn(`[${strategyName}] ${symbol}: データ数が期待値より少ないですが実行継続 (${ohlcv.length}/${period})`);
  }

  // 終値の配列を作成
  const closes = ohlcv.map(candle => candle[4]);
  
  // データの検証を追加
  if (closes.some(price => price === undefined || price === null || isNaN(price))) {
    console.log(`${strategyName}戦略: ${symbol} - 無効な価格データが含まれています`);
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
  
  const { currentPrice, signalType, buySignal, sellSignal } = signalResult;
  // console.log(っっHANDLE SIGNALS] ${symbol}: About to call formatLogInfo with signalResult:`, JSON.stringify(signalResult));
  const logInfo = formatLogInfo(signalResult);
  // console.log(`[HANDLE SIGNALS] ${symbol}: formatLogInfo completed successfully`);
  
  // リスク管理: ストップロスチェック（バックテストモードではスキップ）
  if (!options.backtest && config.enableRiskManagement !== false) {
    // リスク管理前に約定情報を更新
    console.log(`[リスク管理] ${symbol} の約定情報を更新中...`);
    const tradeUpdateStart = Date.now();
    const updatedCount = await updateFilledTrades(exchange, symbol);
    const tradeUpdateTime = Date.now() - tradeUpdateStart;
    console.log(`[リスク管理] ${symbol} 約定情報更新完了: ${updatedCount}件 (${tradeUpdateTime}ms)`);
    
    const stopLossPositions = await checkStopLoss(exchange, symbol, strategyKey, currentPrice, config.riskSettings);
    
    // ストップロスが必要なポジションを処理
    for (const position of stopLossPositions) {
      await executeStopLoss(exchange, symbol, strategyKey, position, marketParameters);
    }
    
    // ドローダウンチェック
    const drawdownStatus = await checkDrawdown(exchange, strategyKey, config.riskSettings);
    if (drawdownStatus.daily.exceeded) {
      const message = `🚨 [リスク管理] 日次最大損失制限到達 🚨\n` +
                     `取引所: ${exchange.id}\n` +
                     `戦略: ${strategyName}\n` +
                     `本日の損失: ${drawdownStatus.daily.pnl.toLocaleString()}円\n` +
                     `損失率: ${drawdownStatus.daily.loss !== null && drawdownStatus.daily.loss !== undefined ? (drawdownStatus.daily.loss * 100).toFixed(2) : 'N/A'}%\n` +
                     `制限値: ${drawdownStatus.daily.limit !== null && drawdownStatus.daily.limit !== undefined ? (drawdownStatus.daily.limit * 100).toFixed(2) : 'N/A'}%\n` +
                     `⚠️ 新規取引を停止しました`;
      
      console.log(`${strategyName}: 日次最大損失に達したため新規取引を停止します`);
      
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
      const message = `🔥 [リスク管理] 週次最大損失制限到達 🔥\n` +
                     `取引所: ${exchange.id}\n` +
                     `戦略: ${strategyName}\n` +
                     `今週の損失: ${drawdownStatus.weekly.pnl.toLocaleString()}円\n` +
                     `損失率: ${drawdownStatus.weekly.loss !== null && drawdownStatus.weekly.loss !== undefined ? (drawdownStatus.weekly.loss * 100).toFixed(2) : 'N/A'}%\n` +
                     `制限値: ${drawdownStatus.weekly.limit !== null && drawdownStatus.weekly.limit !== undefined ? (drawdownStatus.weekly.limit * 100).toFixed(2) : 'N/A'}%\n` +
                     `⚠️ 戦略を一時停止することを検討してください`;
      
      if (postOrderToDiscord) {
        await postOrderToDiscord(message);
      }
    }
    
    if (drawdownStatus.monthly.exceeded) {
      const message = `💀 [リスク管理] 月次最大損失制限到達 💀\n` +
                     `取引所: ${exchange.id}\n` +
                     `戦略: ${strategyName}\n` +
                     `今月の損失: ${drawdownStatus.monthly.pnl.toLocaleString()}円\n` +
                     `損失率: ${drawdownStatus.monthly.loss !== null && drawdownStatus.monthly.loss !== undefined ? (drawdownStatus.monthly.loss * 100).toFixed(2) : 'N/A'}%\n` +
                     `制限値: ${drawdownStatus.monthly.limit !== null && drawdownStatus.monthly.limit !== undefined ? (drawdownStatus.monthly.limit * 100).toFixed(2) : 'N/A'}%\n` +
                     `🚨 戦略の見直しが必要です`;
      
      if (postOrderToDiscord) {
        await postOrderToDiscord(message);
      }
    }
  }
  
  // 注文を作成
  if (buySignal) {
    // 買いシグナル情報をログ出力
    if (!options.backtest) {
      console.log(`${strategyName}買いシグナル: ${symbol} - ${logInfo.buy}`);
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
      console.log(`${strategyName}売りシグナル: ${symbol} - ${logInfo.sell}`);
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
      console.log(`${strategyName}シグナルなし: ${symbol} - ${logInfo.none}`);
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
  const { tradePercentage } = config;
  const { amountPrecision, minTradeAmount } = marketParameters;
  const { orderType } = config;

  // リスク管理: ポジション制限チェック（バックテストモードではスキップ）
  if (!options.backtest && config.enableRiskManagement !== false) {
    const positionLimitCheck = await checkPositionLimits(exchange, symbol, strategyKey, config.riskSettings);
    if (!positionLimitCheck.allowed) {
      const message = `⛔ [リスク管理] ポジション制限到達 ⛔\n` +
                     `取引所: ${exchange.id}\n` +
                     `通貨ペア: ${symbol}\n` +
                     `戦略: ${strategyName}\n` +
                     `制限理由: ${positionLimitCheck.reason}\n` +
                     `現在価格: ${currentPrice.toLocaleString()}円\n` +
                     `🛑 新規買い注文をスキップしました`;
      
      console.log(`${strategyName}: ${positionLimitCheck.reason}`);
      
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
    console.log(`[資金DEBUG] ${symbol}: 利用可能資金=${safeAvailableFunds}円, tradePercentage=${safeTradePercentage}, 制限後=${safeCalculated}円`);
  }

  // 損益を取得
  const realizedPnL = await getRealizedPnL(exchange, symbol, strategyKey, options); // options を渡すように変更

  let formattedAmount;

  let isPositionSized = false;
  // 動的ポジションサイジングが有効かチェック
  if (globalConfig?.global?.dynamicPositionSizing?.enabled && !options.backtest && dynamicSizing) {
    try {
      // OHLCV データを取得（ATR計算用）
      // TODO: 動的ポジションサイジングのパラメータ設定
      // TOOD: ポジションサイジングにおいて、実現損益が低いほど少なくなるようになっているか？
      const ohlcv = await fetchOHLCVData(exchange, symbol, '1h', 50, options);
      
      if (ohlcv && ohlcv.length >= dynamicSizing.config.atrPeriod) {
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
          strategyKey
        });
        
        if (positionResult.reason === 'success' && positionResult.positionSize > 0) {
          formattedAmount = positionResult.positionSize !== null && positionResult.positionSize !== undefined 
                           ? parseFloat(positionResult.positionSize.toFixed(amountPrecision))
                           : parseFloat((tradeAmount).toFixed(amountPrecision));
          isPositionSized = true;
          
          // Discord通知
          if (postOrderToDiscord) {
            const safeATR = positionResult.atr !== null && positionResult.atr !== undefined ? positionResult.atr.toFixed(6) : 'N/A';
            const safeStopLoss = positionResult.stopLossDistance !== null && positionResult.stopLossDistance !== undefined ? positionResult.stopLossDistance.toFixed(6) : 'N/A';
            const sizeInfo = `📊 [動的サイジング] ATRベース計算適用\n` +
                           `ATR: ${safeATR}\n` +
                           `リスク: ${(positionResult.adjustedRisk * 100).toFixed(2)}%\n` +
                           `計算サイズ: ${formattedAmount}\n` +
                           `ストップロス距離: ${safeStopLoss}`;
            
            console.log(`[動的サイジング] ${strategyName}: ${sizeInfo}`);
          }
        } else {
          // 動的サイジング失敗時は従来の方式にフォールバック
          console.log(`[動的サイジング] 計算失敗、従来方式を使用: ${positionResult.reason}`);
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
      console.error(`[動的サイジング] エラー、従来方式を使用: ${error.message}`);
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
      let urgency = URGENCY_LEVELS.MEDIUM;
      
      // 注文タイプに基づいて緊急度を決定
      if (orderType === 'market') {
        urgency = URGENCY_LEVELS.HIGH;
      } else if (orderConfig.orderTypes?.[orderType]?.urgencyLevel) {
        urgency = URGENCY_LEVELS[orderConfig.orderTypes[orderType].urgencyLevel.toUpperCase()];
      } else {
        urgency = URGENCY_LEVELS[defaultUrgency.toUpperCase()];
      }
      
      const orderOptions = {
        urgency,
        strategy: strategyName,
        backtest: false,
        maxSlippage: config.maxSlippage || orderConfig.maxSlippage || 0.005,
        enableRetry: orderConfig.maxRetries > 0
      };
      
      // 高度注文管理が有効かチェック
      if (orderConfig.enabled) {
        console.log(`[${strategyName}] 高度注文管理システム使用: ${symbol} urgency=${urgency}`);
        // 高度注文実行
        orderResult = await orderManager.executeAdvancedOrder(
          symbol, 'buy', formattedAmount, currentPrice, orderOptions
        );
      } else {
        console.warn(`[${strategyName}] 高度注文管理無効 - 従来方式使用: ${symbol}`);
        orderResult.success = false; // フォールバック処理を実行
      }
      
      if (orderResult.success) {
        order = orderResult.order;
      } else {
        // 高度注文が失敗した場合、従来方式にフォールバック
        console.warn(`[${strategyName}] 高度注文失敗、従来方式を使用`);
        const params = { 'post_only': true };
        
        if (orderType && orderType === 'market') {
          order = await exchange.createMarketBuyOrder(symbol, formattedAmount);
        } else {
          order = await exchange.createLimitBuyOrder(symbol, formattedAmount, currentPrice, params);
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
    const executedPrice = orderResult.adjustedPrice || 
                        ((orderType && orderType === 'market') ? (order.price || currentPrice) : currentPrice);
    if (orderType && orderType === 'market') {
      // マーケットオーダーの場合、実際の約定価格を取得
      addOrder(exchange, symbol, strategyKey, 'buy', formattedAmount, executedPrice, order.id, 'market', options); // options を渡すように変更
    } else {
      addOrder(exchange, symbol, strategyKey, 'buy', formattedAmount, executedPrice, order.id, 'limit', options); // options を渡すように変更
    }

    // リスク管理: ポジション情報を記録（バックテストモードではスキップ）
    if (!options.backtest && config.enableRiskManagement !== false) {
      await recordBuyPosition(exchange, symbol, strategyKey, order, executedPrice);
    }

    return { success: true, order };
  } else {
    // console.log(allowanceCheck.reason);
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
      console.log(`調整後の売却量が最小取引量より小さいため、売り注文は発注しません: ${symbol} - 調整後: ${formattedAmount}, 最小: ${minTradeAmount}`);
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
      
      // 注文オプションを設定（グローバル設定から取得）
      const appConfig = require('../../config');
      const orderConfig = appConfig?.config?.global?.advancedOrderManagement || {};
      const defaultUrgency = orderConfig.defaultUrgency || 'medium';
      let urgency = URGENCY_LEVELS.MEDIUM;
      
      // 注文タイプに基づいて緊急度を決定
      if (orderType === 'market') {
        urgency = URGENCY_LEVELS.HIGH;
      } else if (orderConfig.orderTypes?.[orderType]?.urgencyLevel) {
        urgency = URGENCY_LEVELS[orderConfig.orderTypes[orderType].urgencyLevel.toUpperCase()];
      } else {
        urgency = URGENCY_LEVELS[defaultUrgency.toUpperCase()];
      }
      
      const orderOptions = {
        urgency,
        strategy: strategyName,
        backtest: false,
        maxSlippage: config.maxSlippage || orderConfig.maxSlippage || 0.005,
        enableRetry: orderConfig.maxRetries > 0
      };
      
      // 高度注文管理が有効かチェック
      if (orderConfig.enabled) {
        console.log(`[${strategyName}] 高度注文管理システム使用: ${symbol} urgency=${urgency}`);
        // 高度注文実行
        orderResult = await orderManager.executeAdvancedOrder(
          symbol, 'sell', formattedAmount, currentPrice, orderOptions
        );
      } else {
        console.warn(`[${strategyName}] 高度注文管理無効 - 従来方式使用: ${symbol}`);
        orderResult.success = false; // フォールバック処理を実行
      }
      
      if (orderResult.success) {
        order = orderResult.order;
      } else {
        // 高度注文が失敗した場合、従来方式にフォールバック
        console.warn(`[${strategyName}] 高度注文失敗、従来方式を使用`);
        const params = { 'post_only': true };
        
        if (orderType && orderType === 'market') {
          order = await exchange.createMarketSellOrder(symbol, formattedAmount);
        } else {
          order = await exchange.createLimitSellOrder(symbol, formattedAmount, currentPrice, params);
        }
      }
    }

    // 取引記録を更新
    // 高度注文の場合、調整された価格を使用
    const executedPrice = orderResult.adjustedPrice || 
                        ((orderType && orderType === 'market') ? (order.price || currentPrice) : currentPrice);
    
    if (orderType && orderType === 'market') {
      // マーケットオーダーの場合、実際の約定価格を取得
      addOrder(exchange, symbol, strategyKey, 'sell', formattedAmount, executedPrice, order.id, 'market', options); // options を渡すように変更
    }
    else {
      addOrder(exchange, symbol, strategyKey, 'sell', formattedAmount, executedPrice, order.id, 'limit', options); // options を渡すように変更
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
          console.log(`[パフォーマンス追跡] ${strategyName}: PnL記録 ${safePnL}`);
        }
      } catch (trackingError) {
        console.error(`[パフォーマンス追跡] エラー: ${trackingError.message}`);
      }
    }

    return { success: true, order };
  } else {
    console.log(`資産不足のため注文をスキップ: ${symbol} - 必要: ${formattedAmount}, 利用可能: ${availableAsset}`);
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
    // 取引所がシンボルをサポートしているか確認
    if (!exchange.markets) {
      await exchange.loadMarkets();
    }
    
    // シンボルが取引所でサポートされているか確認
    if (!(symbol in exchange.markets)) {
      console.log(`警告: ${exchange.id}は${symbol}をサポートしていません。オープンオーダーの確認をスキップします。`);
      return { success: false, reason: 'unsupported symbol' };
    }
    
    // 戦略キーが一致するオーダーのみキャンセル
    let openOrders;
    try {
      openOrders = await exchange.fetchOpenOrders(symbol);
    } catch (fetchError) {
      // 認証エラーや無効なシンボルエラーの場合、サポートされていないシンボルとして扱う
      if (fetchError.name === 'AuthenticationError' || fetchError.message.includes('authentication') || fetchError.message.includes('Invalid symbol')) {
        console.log(`警告: ${exchange.id}の${symbol}でオープンオーダー取得に失敗しました（サポートされていない可能性）: ${fetchError.message}`);
        return { success: false, reason: 'unsupported symbol for private API' };
      }
      // その他のエラーは再スロー
      throw fetchError;
    }
    
    await Promise.all(openOrders.map(async (order) => {
      try {
        const _strategyKey = await getOrderStrategyKeyByOrderId(order.id);
        return (strategyKey === _strategyKey) ? await exchange.cancelOrder(order.id, symbol) : null;
      } catch (error) {
        console.error(`オーダーキャンセルに失敗: ${symbol} - エラー: ${error.message}`);
        if (postErrorToDiscord) {
          await postErrorToDiscord(`[${exchange.id}] オーダーキャンセルに失敗: ${symbol} - エラー: ${error.message}\nスタックトレース: ${error.stack}`);
        }
      }
    }));
  } catch (error) {
    console.error(`オープンオーダーの取得に失敗: ${symbol} - エラー: ${error.message}`);
    if (postErrorToDiscord) {
      await postErrorToDiscord(`[${exchange.id}] オープンオーダーの取得に失敗: ${symbol} - エラー: ${error.message}\nスタックトレース: ${error.stack}`);
    }
    return { success: false, error };
  }

  // 戦略に買いポジションがある場合、売り注文を作成
  const _netPosition = await getTradeCurrentPosition(exchange, symbol, strategyKey);

  // TODO: use market parameters
  if (_netPosition < 0.0001) {
    console.log(`ポジションがないため、売り注文は発注しません: ${symbol}`);
    return { success: false, reason: 'no position' };
  }

  const netPosition = Math.max(_netPosition !== null && _netPosition !== undefined ? _netPosition.toFixed(4) : 0, 0.0001);
  // 売り注文を作成
  try {
    const order = await exchange.createMarketSellOrder(symbol, netPosition);
    addOrder(exchange, symbol, strategyKey, 'sell', netPosition, order.price, order.id, 'market');
    
    // 売り注文成功後、関連するポジションをクリーンアップ
    try {
      console.log(`[INFO] Cleaning up positions for strategy ${strategyKey} after market sell`);
      
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
              console.log(`[INFO] Position cleaned up: ${position.key}, action: ${cleanupResult.action}`);
              if (cleanupResult.historyKey) {
                console.log(`[INFO] Position history saved to MongoDB: ${cleanupResult.historyKey}`);
              }
            } else {
              cleanupErrors++;
              console.warn(`[WARNING] Position cleanup failed: ${position.key}, reason: ${cleanupResult.reason}`);
            }
          } catch (cleanupError) {
            cleanupErrors++;
            console.error(`[ERROR] Position cleanup error: ${position.key}`, cleanupError.message);
          }
        }
      }
      
      if (cleanedCount > 0 || cleanupErrors > 0) {
        const cleanupMessage = `🧹 [ポジション整理] 戦略クリア後のクリーンアップ完了\n` +
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
        
        console.log(`[INFO] Position cleanup completed: ${cleanedCount} cleaned, ${cleanupErrors} errors`);
      }
    } catch (cleanupError) {
      console.error(`[ERROR] Position cleanup process failed: ${symbol}`, cleanupError.message);
      // クリーンアップ失敗は売り注文成功を妨げない
    }
    
    // リスク管理データのクリア（バックテスト強制決済時に重要）
    try {
      console.log(`[INFO] Clearing risk management data for strategy ${strategyKey}`);
      const riskClearResult = await clearStrategyRiskData(exchange.id, symbol, strategyKey);
      
      if (riskClearResult.success) {
        console.log(`[INFO] Risk management data cleared successfully: ${riskClearResult.message}`);
        
        if (postOrderToDiscord) {
          const riskMessage = `🛡️ [リスク管理] データクリア完了\\n` +
                             `取引所: ${exchange.id}\\n` +
                             `通貨ペア: ${symbol}\\n` +
                             `戦略: ${strategyKey}\\n` +
                             `結果: ${riskClearResult.message}\\n` +
                             `📅 実行時刻: ${new Date().toLocaleString('ja-JP')}`;
          
          await postOrderToDiscord(riskMessage);
        }
      } else {
        console.warn(`[WARNING] Risk management data clear had issues: ${riskClearResult.message}`);
        
        if (postErrorToDiscord) {
          await postErrorToDiscord(`[${exchange.id}] リスク管理データクリアで問題発生: ${symbol} - ${riskClearResult.message}`);
        }
      }
    } catch (riskClearError) {
      console.error(`[ERROR] Risk management data clear failed: ${symbol}`, riskClearError.message);
      
      if (postErrorToDiscord) {
        await postErrorToDiscord(`[${exchange.id}] リスク管理データクリア失敗: ${symbol} - エラー: ${riskClearError.message}`);
      }
      // リスク管理データクリア失敗は売り注文成功を妨げない
    }
    
  } catch (error) {
    console.error(`売り注文の発注に失敗: ${symbol} - エラー: ${error.message}`);
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
  
  if (indicators.macd) evaluatedWeights.push(weights.macd || 0);
  if (indicators.emaShort && indicators.emaLong) evaluatedWeights.push(weights.ema || 0);
  if (indicators.rsi) evaluatedWeights.push(weights.rsi || 0);
  if (indicators.volume && indicators.volumeMA) evaluatedWeights.push(weights.volume || 0);
  if (indicators.adx) evaluatedWeights.push(weights.adx || 0);
  
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
  console.error(`${strategyName}戦略でエラーが発生しました: ${symbol}`, error);
  console.error(`[DETAILED ERROR] Stack trace:`, error.stack);
  
  if (postErrorToDiscord) {
    const detailedMessage = `[${strategyName}] エラー: ${exchange.id} - ${symbol} - ${error.message}\nスタック: ${error.stack?.split('\n')[1] || 'N/A'}`;
    await postErrorToDiscord(detailedMessage);
  }
  
  return {
    strategy: strategyId,
    symbol,
    error: error.message,
    stack: error.stack
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
  
  if (!validatedData) return null;
  
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

module.exports = {
  fetchAndValidateOHLCVData,
  handleStrategySignals,
  executeBuyOrder,
  executeSellOrder,
  disableStrategy,
  clearPositionMarket,
  initializeDynamicSizing,
  performanceTracker,
  confirmMultipleIndicators,
  identifyMarketEnvironment,
  // 新しい共通関数
  handleStrategyError,
  getCurrentPrice,
  saveStrategySignal,
  createLogInfoBase,
  fetchAndValidateOHLCVWithBacktestSetup,
  executeStrategyTemplate
};