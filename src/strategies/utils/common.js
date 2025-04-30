const { formattedAvailableAmount, getRealizedPnL, addSignal, addOrder, fetchOHLCVData } = require('../../database/manager');
const { postOrderToDiscord, postErrorToDiscord } = require('../../common/notifications');
const { checkBuyOrderAllowance } = require('../../common/utils');

/**
 * OHLCV データを取得して検証する
 * @param {Object} exchange 取引所オブジェクト
 * @param {string} symbol シンボル
 * @param {string} ohlcvInterval インターバル
 * @param {number} period 期間
 * @param {Function} errorNotificationFn エラー通知関数
 * @param {string} strategyName 戦略名（エラーメッセージ用）
 * @returns {Array|null} 検証済みの終値配列、またはエラー時はnull
 */
async function fetchAndValidateOHLCVData(exchange, symbol, ohlcvInterval, period, errorNotificationFn, strategyName = 'オシレーター') {
  // 過去のローソク足データを取得
  const ohlcv = await fetchOHLCVData(exchange, symbol, ohlcvInterval, period + 10);
  if (ohlcv.length < period) {
    console.log(`${strategyName}戦略のデータが不足しています: ${symbol} ${ohlcv.length}/${period}`);
    return null;
  }

  // 終値の配列を作成
  const closes = ohlcv.map(candle => candle[4]);
  
  // データの検証を追加
  if (closes.some(price => price === undefined || price === null || isNaN(price))) {
    console.log(`${strategyName}戦略: ${symbol} - 無効な価格データが含まれています`);
    if (errorNotificationFn) {
      await errorNotificationFn(`[${strategyName}戦略] 警告: ${exchange.id} - ${symbol} - 無効な価格データが含まれています`);
    }
    return null;
  }
  
  return closes;
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
  formatLogInfo
) {
  const { currentPrice, signalType, buySignal, sellSignal } = signalResult;
  const logInfo = formatLogInfo(signalResult);
  
  // 注文を作成
  if (buySignal) {
    // 買いシグナル情報をログ出力
    console.log(`${strategyName}買いシグナル: ${symbol} - ${logInfo.buy}`);
    if (postOrderToDiscord) {
      await postOrderToDiscord(`[${strategyName}] 買いシグナル: ${exchange.id} - ${symbol} - ${logInfo.buy}`);
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
      logInfo.orderInfo
    );
    
  } else if (sellSignal) {
    // 売りシグナル情報をログ出力
    console.log(`${strategyName}売りシグナル: ${symbol} - ${logInfo.sell}`);
    if (postOrderToDiscord) {
      postOrderToDiscord(`[${strategyName}] 売りシグナル: ${exchange.id} - ${symbol} - ${logInfo.sell}`);
    }

    // 売り注文実行
    const sellResult = await executeSellOrder(
      exchange, 
      symbol, 
      strategyKey, 
      marketParameters, 
      currentPrice, 
      strategyName,
      logInfo.orderInfo
    );
    
    // 特定条件で早期リターン
    if (sellResult.earlyReturn) {
      return sellResult.returnValue;
    }
    
  } else {
    console.log(`${strategyName}シグナルなし: ${symbol} - ${logInfo.none}`);
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
async function executeBuyOrder(exchange, symbol, strategyKey, config, marketParameters, currentPrice, strategyName, signalInfo) {
  const { tradePercentage } = config;
  const { amountPrecision, minTradeAmount } = marketParameters;

  // 利用可能な資金を確認
  const balance = await exchange.fetchBalance();
  const baseCurrency = symbol.split('/')[1];
  const availableFunds = balance.free[baseCurrency];

  // 損益を取得
  const realizedPnL = await getRealizedPnL(exchange, symbol, strategyKey);

  // 利用可能な資金の割合に基づいて取引量を計算
  const maxBuyAmount = ((availableFunds * tradePercentage) + realizedPnL) / currentPrice;
  // 取引量を計算（最小取引量と計算した最大取引量の大きい方を使用）
  const tradeAmount = Math.max(minTradeAmount, maxBuyAmount);
  // 精度を考慮して、最小精度以上の値を確保
  let formattedAmount = parseFloat(tradeAmount.toFixed(amountPrecision));
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
    minTradeAmount
  );

  if (allowanceCheck.allowed) {
    // 買い注文を作成
    const params = { 'post_only': true };
    const order = await exchange.createLimitBuyOrder(symbol, formattedAmount, currentPrice, params);
    if (postOrderToDiscord) {
      postOrderToDiscord(`[${strategyName}] 買い注文実行: ${exchange.id} - ${symbol} - 価格: ${currentPrice}, 数量: ${formattedAmount}`);
    }

    // 取引記録を更新
    addOrder(exchange, symbol, strategyKey, 'buy', formattedAmount, currentPrice, order.id, 'limit');
    
    return { success: true, order };
  } else {
    console.log(allowanceCheck.reason);
    if (postOrderToDiscord) {
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
 * @param {Object} marketParameters マーケットパラメータ
 * @param {number} currentPrice 現在価格
 * @param {string} strategyName 戦略名（ログ出力用）
 * @param {Object} signalInfo シグナル情報（ログ出力用）
 * @returns {Object} 注文結果
 */
async function executeSellOrder(exchange, symbol, strategyKey, marketParameters, currentPrice, strategyName, signalInfo) {
  const { amountPrecision, minTradeAmount } = marketParameters;

  // 利用可能な資産を確認
  const balance = await exchange.fetchBalance();
  const quoteCurrency = symbol.split('/')[0];
  const availableAsset = balance.free[quoteCurrency];

  // 売れる量を取得
  const formattedAmount = await formattedAvailableAmount(exchange, symbol, strategyKey, amountPrecision);

  if (formattedAmount < minTradeAmount) {
    console.log(`調整後の売却量が最小取引量より小さいため、売り注文は発注しません: ${symbol} - 調整後: ${formattedAmount}, 最小: ${minTradeAmount}`);
    if (postOrderToDiscord) {
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
  
  if (availableAsset >= formattedAmount && formattedAmount > 0) {
    // 売り注文を作成
    const params = { 'post_only': true };
    const order = await exchange.createLimitSellOrder(symbol, formattedAmount, currentPrice, params);
    if (postOrderToDiscord) {
      postOrderToDiscord(`[${strategyName}] 売り注文実行: ${exchange.id} - ${symbol} - 価格: ${currentPrice}, 数量: ${formattedAmount}`);
    }

    // 取引記録を更新
    addOrder(exchange, symbol, strategyKey, 'sell', formattedAmount, currentPrice, order.id, 'limit');
    
    return { success: true, order };
  } else {
    console.log(`資産不足のため注文をスキップ: ${symbol} - 必要: ${formattedAmount}, 利用可能: ${availableAsset}`);
    if (postOrderToDiscord) {
      postOrderToDiscord(`[${strategyName}] 資産不足のため売り注文をスキップ: ${exchange.id} - ${symbol} - 必要: ${formattedAmount}, 利用可能: ${availableAsset}`);
    }
    
    return { success: false, reason: 'insufficient funds' };
  }
}

module.exports = {
  fetchAndValidateOHLCVData,
  handleStrategySignals,
  executeBuyOrder,
  executeSellOrder
};