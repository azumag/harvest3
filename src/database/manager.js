const { 
  getTradeSummary, updateTradeSummary 
} = require('./redisDatabase');

const { addTrade, addSignal, addOrder } = require('./mongoDatabase');
const { getStrategyParameters } = require('../redisDatabase');

async function getRealizedPnL(exchange, symbol, strategyKey) {
  // 約定を更新
  await updateFilledTrades(exchange, symbol);

  const summary = await getTradeSummary({
    exchangeId: exchange.id,
    symbol,
    strategyKey
  });
  
  // console.log(summary);
  return summary.realizedPnL || 0;
}

async function getTradeCurrentPosition(exchange, symbol, strategyKey) {
  // 約定を更新
  await updateFilledTrades(exchange, symbol);

  const summary = await getTradeSummary({
    exchangeId: exchange.id,
    symbol,
    strategyKey
  });
  
  return summary.netPosition || 0;
}

/**
 * 前回チェック時から現在までの約定履歴を取得し記録する
 * @param {Object} exchange - 取引所オブジェクト
 * @param {string} symbol - 通貨ペア
 * @returns {Promise<number>} - 処理した約定数
 */
async function updateFilledTrades(exchange, symbol) {
 
  try {
    // 前回のチェック時間を取得
    const tradeSummary = await getTradeSummary(exchange, symbol);
    const timestamp = tradeSummary.updatedAt;
    
    // 前回のチェック時間（ない場合は24時間前）
    const lastCheckTime = timestamp ? timestamp : Date.now() - 24 * 60 * 60 * 1000;
    
    // fetchMyTradesメソッドが利用可能かどうかを確認
    if (!exchange.has || !exchange.has['fetchMyTrades']) {
      console.error(`約定履歴の更新エラー (${exchange.id} ${symbol}): fetchMyTradesメソッドがサポートされていません`);
      return 0;
    }
    
    // 取引所から約定履歴を取得
    // 最終チェック時間からの約定履歴を取得
    const trades = await exchange.fetchMyTrades(symbol, lastCheckTime);
    console.log(`最終更新時間: ${new Date(lastCheckTime).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
    
    let processedCount = 0;
    let strategyKey = 'OUTSIDE';
    // 各約定を処理
    for (const trade of trades) {

      if (trade.order) {
        strategyKey = await getOrderStrategyKeyByOrderId(trade.order);
      }
      // console.log(`strategykey: ${strategyKey} trade: ${trade.order}`);

      const trade = {
        exchange: exchange.id,
        symbol,
        strategy: strategyKey,
        side: trade.side,
        amount: trade.amount,
        price: trade.price,
        value: trade.cost || trade.amount * trade.price,
        orderId: trade.order,
        orderType: trade.type || 'market',
        fee: trade.fee ? trade.fee.cost : undefined,
        tradeId: trade.id,
        timestamp: Date.now(),
      }

      await addTrade(trade);
      await updateTradeSummary(trade);
      
      processedCount++;
    }
    
    console.log(`${exchange.id} ${symbol} ${strategyKey}: ${processedCount}件の約定を記録しました`);
    return processedCount;
  } catch (error) {
    console.error(`約定履歴の更新エラー (${exchange.id} ${symbol} :`, error);
    return 0;
  }
}

async function addOrder(exchange, symbol, strategyKey, side, amount, price, orderId, orderType) {
    const timestamp = Date.now();

    const order = {
      exchange: exchange.id,
      symbol,
      strategy: strategyKey,
      side,
      amount,
      price,
      orderId,
      orderType,
      timestamp
    };

    return await addOrder(order);
}

async function addSignal(exchange, symbol, strategyKey, side, price, detail) {
    const timestamp = Date.now();

    const signal = {
        exchange: exchange.id,
        symbol,
        strategy: strategyKey,
        side,
        price,
        detail,
        timestamp
    };
    
    return await addSignal(signal);
}

/**
 * 戦略パラメータを読み出す関数
 * データベースに存在しない場合はnullを返す
 * @param {String} exchangeId - 取引所ID
 * @param {String} symbol - 通貨ペア
 * @param {String} strategyKey - 戦略キー
 * @returns {Promise<Object|null>} 戦略パラメータオブジェクト、またはnull
 */
async function getStrategyParameters(exchangeId, symbol, strategyKey) {
  const key = `params:${exchangeId}:${symbol}:${strategyKey}`;
  try {
    const params = await client.hGetAll(key);
    
    if (Object.keys(params).length > 0) {
      // Redisにパラメータが存在する場合、数値型に変換して返す
      const parsedParams = {};
      for (const [paramKey, value] of Object.entries(params)) {
        // 数値に変換できるものは変換
        const numValue = parseFloat(value);
        parsedParams[paramKey] = isNaN(numValue) ? value : numValue;
      }
      console.log(`戦略パラメータをRedisから読み出しました: ${key}`);
      return parsedParams;
    } else {
      // Redisにパラメータが存在しない場合
      console.log(`戦略パラメータがRedisに存在しません: ${key}`);
      return null;
    }
  } catch (error) {
    console.error(`戦略パラメータの読み出し中にエラーが発生しました: ${key}`, error);
    return null;
  }
}

/**
 * 戦略パラメータを保存する関数
 * @param {String} exchangeId - 取引所ID
 * @param {String} symbol - 通貨ペア
 * @param {String} strategyKey - 戦略キー
 * @param {Object} params - 保存するパラメータオブジェクト
 * @returns {Promise} 処理完了時に解決されるPromise
 */
async function saveStrategyParameters(exchangeId, symbol, strategyKey, params) {
  const key = `params:${exchangeId}:${symbol}:${strategyKey}`;
  try {
    // パラメータオブジェクトの各値を文字列に変換
    const stringifiedParams = {};
    for (const [paramKey, value] of Object.entries(params)) {
      stringifiedParams[paramKey] = String(value); // 値を文字列に変換
    }
    
    await client.hSet(key, stringifiedParams);
    console.log(`戦略パラメータを保存しました: ${key}`);
    return true;
  } catch (error) {
    console.error(`戦略パラメータの保存中にエラーが発生しました: ${key}`, error);
    return false;
  }
}

// 購入量ー売り注文量を計算
async function formattedAvailableAmount(exchange, symbol, strategyKey, amountPrecision) {
  try {
    // 取引記録から買った量を取得（ネットポジション）
    const netPosition = await getTradeCurrentPosition(exchange, symbol, strategyKey);
    
    // 未約定の注文を取得
    const openOrders = await exchange.fetchOpenOrders(symbol);

    // 未約定の売り注文のうち、売り注文を戦略キーでフィルタリングして合計量を計算
    // つまり、戦略で売りに出ている量を取得
    const sellOrderAmounts = await Promise.all(
      openOrders.map(async (order) => {
        const _strategyKey = await getOrderStrategyKeyByOrderId(order.id);
        return (strategyKey === _strategyKey && order.side === 'sell') ? order.amount : 0;
      })
    );
    const totalSellOrderAmount = sellOrderAmounts.reduce((sum, amount) => sum + amount, 0);
    
    // 売り注文のみをフィルタリングして合計量を計算
    // const totalSellOrderAmount = openOrders
    //   .filter(order => order.side === 'sell')
    //   .reduce((sum, order) => sum + order.amount, 0);
    
    // 利用可能量 = ネットポジション - 未約定売り注文量
    let availableAmount = netPosition - totalSellOrderAmount;
    
    // 負の値にならないようにする
    if (availableAmount < 0) availableAmount = 0;
    
    // 精度を考慮して、最小精度以上の値を確保
    return parseFloat(availableAmount.toFixed(amountPrecision));
  } catch (error) {
    console.error('利用可能量の計算に失敗しました:', error);
    // エラーとなった取引所とシンボルを記録
    const errorMessage = `formattedAvailableAmount実行中にエラーが発生しました: ${exchange.id} ${symbol} ${strategyKey}`;
    console.error(errorMessage, error);
    
    // エラー時は安全のために0を返す（より厳格な対応）
    return 0;
  }
}

module.exports = {
  updateFilledTrades,
  formattedAvailableAmount,
  getRealizedPnL,
  addSignal,
  addOrder,
  getStrategyParameters,
  saveStrategyParameters,
};