const { formattedAvailableAmount, getRealizedPnL, addSignal,
  backtestCreateLimitBuyOrder, backtestCreateLimitSellOrder,
  addOrder, fetchOHLCVData, getAvailableFund,
  checkBuyOrderAllowance,
  getStrategyParameters,
  saveStrategyParameters,
  getTradeCurrentPosition,
  getOrderStrategyKeyByOrderId,
  updateFilledTrades,
} = require('../../database/manager');
const { postOrderToDiscord, postErrorToDiscord } = require('../../common/notifications');
const { 
  checkStopLoss, 
  executeStopLoss, 
  checkPositionLimits, 
  checkDrawdown,
  recordBuyPosition,
  recordPnL
} = require('./riskManagement');
const { 
  getStrategyPositionsRedis,
  closeAndCleanupPosition 
} = require('../../database/redisDatabase');
const { DynamicPositionSizing } = require('./positionSizing');
const { performanceTracker } = require('./performanceTracker');

// 動的ポジションサイジングのインスタンス（設定注入用）
let dynamicSizing = null;

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
  if (ohlcv.length < period) {
    if (!options.backtest) {
      console.log(`${strategyName}戦略のデータが不足しています: ${symbol} ${ohlcv.length}/${period}`);
      throw new Error(`${strategyName}戦略のデータが不足しています: ${symbol} ${ohlcv.length}/${period}`);
    }
    if (options.backtest) {
      return null; // バックテストモードではnullを返す
    }
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
  const logInfo = formatLogInfo(signalResult);
  
  // リスク管理: ストップロスチェック（バックテストモードではスキップ）
  if (!options.backtest && config.enableRiskManagement !== false) {
    // リスク管理前に約定情報を更新
    console.log(`[リスク管理] ${symbol} の約定情報を更新中...`);
    await updateFilledTrades(exchange, symbol);
    
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
                     `損失率: ${(drawdownStatus.daily.loss * 100).toFixed(2)}%\n` +
                     `制限値: ${(drawdownStatus.daily.limit * 100).toFixed(2)}%\n` +
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
                     `損失率: ${(drawdownStatus.weekly.loss * 100).toFixed(2)}%\n` +
                     `制限値: ${(drawdownStatus.weekly.limit * 100).toFixed(2)}%\n` +
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
                     `損失率: ${(drawdownStatus.monthly.loss * 100).toFixed(2)}%\n` +
                     `制限値: ${(drawdownStatus.monthly.limit * 100).toFixed(2)}%\n` +
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

  // 損益を取得
  const realizedPnL = await getRealizedPnL(exchange, symbol, strategyKey, options); // options を渡すように変更

  let formattedAmount;
  
  // 動的ポジションサイジングが有効かチェック
  if (globalConfig?.global?.dynamicPositionSizing?.enabled && !options.backtest && dynamicSizing) {
    try {
      // OHLCV データを取得（ATR計算用）
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
          formattedAmount = parseFloat(positionResult.positionSize.toFixed(amountPrecision));
          
          // Discord通知
          if (postOrderToDiscord) {
            const sizeInfo = `📊 [動的サイジング] ATRベース計算適用\n` +
                           `ATR: ${positionResult.atr?.toFixed(6) || 'N/A'}\n` +
                           `リスク: ${(positionResult.adjustedRisk * 100).toFixed(2)}%\n` +
                           `計算サイズ: ${formattedAmount}\n` +
                           `ストップロス距離: ${positionResult.stopLossDistance?.toFixed(6) || 'N/A'}`;
            
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
    options // options を渡すように変更
  );

  if (allowanceCheck.allowed) {
    // 買い注文を作成
    const params = { 'post_only': true };
    let order;
    if (options.backtest) {
      // バックテストモードの場合、バックテスト用の注文関数を呼び出す
      order = await backtestCreateLimitBuyOrder(symbol, formattedAmount, currentPrice, options);
    } else {
      // リアルタイムモードの場合、既存の exchange メソッドを呼び出す
      // orderType が 'limit' の場合、createLimitBuyOrder を使用
      // orderType が 'market' の場合、createMarketBuyOrder を使用
      if (orderType && orderType === 'market') {
        order = await exchange.createMarketBuyOrder(symbol, formattedAmount);
      } else {
        order = await exchange.createLimitBuyOrder(symbol, formattedAmount, currentPrice, params);
      }
    }

    if (postOrderToDiscord && !options.backtest) {
      postOrderToDiscord(`[${strategyName}] 買い注文実行: ${exchange.id} - ${symbol} - 価格: ${currentPrice}, 数量: ${formattedAmount}`);
    }

    // 取引記録を更新
    const executedPrice = (orderType && orderType === 'market') ? (order.price || currentPrice) : currentPrice;
    if (orderType && orderType === 'market') {
      // マーケットオーダーの場合、実際の約定価格を取得
      addOrder(exchange, symbol, strategyKey, 'buy', formattedAmount, executedPrice, order.id, 'market', options); // options を渡すように変更
    } else {
      addOrder(exchange, symbol, strategyKey, 'buy', formattedAmount, currentPrice, order.id, 'limit', options); // options を渡すように変更
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
    // 売り注文を作成
    const params = { 'post_only': true };
    let order;
    if (options.backtest) {
      // バックテストモードの場合、バックテスト用の注文関数を呼び出す
      order = await backtestCreateLimitSellOrder(symbol, formattedAmount, currentPrice, options);
    } else {
      // リアルタイムモードの場合、既存の exchange メソッドを呼び出す
      // orderType が 'limit' の場合、createLimitSellOrder を使用
      // orderType が 'market' の場合、createMarketSellOrder を使用
      if (orderType && orderType === 'market') {
        order = await exchange.createMarketSellOrder(symbol, formattedAmount);
      } else {
        order = await exchange.createLimitSellOrder(symbol, formattedAmount, currentPrice, params);
      }
    }

    // 取引記録を更新
    const executedPrice = (orderType && orderType === 'market') ? (order.price || currentPrice) : currentPrice;
    
    if (orderType && orderType === 'market') {
      // マーケットオーダーの場合、実際の約定価格を取得
      addOrder(exchange, symbol, strategyKey, 'sell', formattedAmount, executedPrice, order.id, 'market', options); // options を渡すように変更
    }
    else {
      addOrder(exchange, symbol, strategyKey, 'sell', formattedAmount, currentPrice, order.id, 'limit', options); // options を渡すように変更
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
          
          console.log(`[パフォーマンス追跡] ${strategyName}: PnL記録 ${estimatedPnL.toFixed(2)}`);
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

  const netPosition = Math.max(_netPosition.toFixed(4), 0.0001);
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
    
  } catch (error) {
    console.error(`売り注文の発注に失敗: ${symbol} - エラー: ${error.message}`);
    if (postErrorToDiscord) {
      await postErrorToDiscord(`[${exchange.id}] 売り注文の発注に失敗: ${symbol} - エラー: ${error.message}\nスタックトレース: ${error.stack}`);
    }
    return { success: false, error };
  }

  return { success: true };
}

module.exports = {
  fetchAndValidateOHLCVData,
  handleStrategySignals,
  executeBuyOrder,
  executeSellOrder,
  disableStrategy,
  clearPositionMarket,
  initializeDynamicSizing,
  performanceTracker
};