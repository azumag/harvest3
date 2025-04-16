const { postErrorToDiscord } = require('./notifications');
const { bitflyerMinTradeAmounts } = require('./config');
const { 
  getFilledSummary, addFilledTrade, getFilledSummaryTimestamp,
  getOrderStrategyKeyByOrderId, updateFilledSummaryTimestamp
} = require('./redisDatabase');
const { format } = require('morgan');
 
/**
 * 加重平均を計算する関数
 * @param {Array} prices - 価格の配列
 * @param {Array} amounts - 数量の配列
 * @returns {Number} - 加重平均値
 */
function weightedAverage(prices, amounts) {
  const totalAmount = amounts.reduce((acc, val) => acc + val, 0);
  return prices.reduce((acc, price, index) => acc + (price * amounts[index]), 0) / totalAmount;
}

/**
 * 取引所から総損益を取得する関数
 * @param {Object} exchange - 取引所オブジェクト
 * @param {String} symbol - 通貨ペア
 * @returns {Number} - 総損益
 */
async function fetchTotal(exchange, symbol) {
  try {
    const since = Date.now() - (24 * 60 * 60 * 1000); // 1日前のUNIXタイムスタンプを取得（ミリ秒単位）
    const trades = await exchange.fetchMyTrades(symbol, since); // 取引履歴を取得

    let totalSell = 0;
    let totalBuy = 0;

    for (const trade of trades) {
      let amount;
      let cost;

      if (trade.fee) {
        if (trade.fee.currency === 'JPY') {
          amount = trade.amount;
          cost = trade.fee.cost;
        } else {
          amount = trade.amount - trade.fee.cost;
          cost = 0;
        }
      } else {
        amount = trade.amount;
        cost = 0;
      }

      const delta = (trade.price * amount);

      if (trade.side === 'sell') {
        totalSell += delta - cost;
      } else if (trade.side === 'buy') {
        totalBuy += delta + cost;
      }
    }

    return totalSell - totalBuy; // 総損益を返す
  } catch (error) {
    console.error('損益の取得に失敗しました:', error);
    postErrorToDiscord(`損益の取得に失敗しました ${error.message}`);
    return 0; // エラー時は0を返す
  }
}

/**
 * マーケットパラメータを取得する共通関数
 * @param {Object} exchange - 取引所オブジェクト
 * @param {String} symbol - 通貨ペア
 * @returns {Object|null} - マーケットパラメータまたはnull（エラー時）
 */
async function getMarketParameters(exchange, symbol) {
  const market = exchange.markets[symbol];
  if (!market) {
    console.error(`マーケットデータが取得できませんでした: ${symbol} ${exchange.id}`);
    return null;
  }
  
  const minTradeAmount = (exchange.id === 'bitflyer' && bitflyerMinTradeAmounts && bitflyerMinTradeAmounts[symbol])
    ? bitflyerMinTradeAmounts[symbol]
    : (market.limits?.amount?.min || 0.0001);
    
  let pricePrecision = market.precision ? market.precision.price : undefined;
  
  if (!pricePrecision) {
    try {
      const ticker = await exchange.fetchTicker(symbol);
      const lastPrice = ticker.last;
      
      if (lastPrice) {
        const priceDecimals = (lastPrice.toString().split('.')[1] || '').length;
        pricePrecision = priceDecimals;
      } else {
        const errorMessage = `ティッカーのlast価格が取得できませんでした: ${symbol} ${exchange.name}`;
        console.error(errorMessage);
        if (postErrorToDiscord) {
          await postErrorToDiscord(errorMessage);
        }
        return null;
      }
    } catch (error) {
      const errorMessage = `価格精度が取得できず、ティッカーの取得にも失敗しました: ${symbol} ${exchange.name}`;
      console.error(errorMessage, error);
      if (postErrorToDiscord) {
        await postErrorToDiscord(errorMessage);
      }
      return null;
    }
  }
  
  if (pricePrecision > 0 && pricePrecision < 1) {
    const priceDecimals = (pricePrecision.toString().split('.')[1] || '').length;
    pricePrecision = priceDecimals;
  }
  
  let amountPrecision = market.precision ? market.precision.amount : undefined;
  
  if (!minTradeAmount) {
    const errorMessage = `最小取引単位が取得できませんでした: ${symbol} ${exchange.name}`;
    console.error(errorMessage);
    if (postErrorToDiscord) {
      await postErrorToDiscord(errorMessage);
    }
    return null;
  }
  
  if (!amountPrecision) {
    const minTradeAmountDecimals = (minTradeAmount.toString().split('.')[1] || '').length;
    amountPrecision = minTradeAmountDecimals;
  }
  
  if (amountPrecision > 0 && amountPrecision < 1) {
    const amountDecimals = (amountPrecision.toString().split('.')[1] || '').length;
    amountPrecision = amountDecimals;
  }
  
  return { minTradeAmount, pricePrecision, amountPrecision };
}

/**
 * 取引記録から買った量を取得
 * @param {Object} tradeRecords - 取引記録
 * @param {Object} exchange - 取引所
 * @param {string} symbol - シンボル
 * @param {string} strategyKey - 戦略キー
 * @returns {number} - 買い量
 */
function getNetPosition(tradeRecords, exchange, symbol, strategyKey) {
  let buyAmount = 0;
  // tradeRecordsから該当する取引所とシンボルの買い量を取得
  const exchangeRecords = tradeRecords[exchange.id];
  if (exchangeRecords && exchangeRecords[symbol]) {
    if (strategyKey && exchangeRecords[symbol][strategyKey]) {
      // 特定の戦略の買い量を取得
      buyAmount = exchangeRecords[symbol][strategyKey].netPosition || 0;
    }
    if (Number.isNaN(buyAmount)) buyAmount = 0; // NaNの場合は0にする (Number.isNaNを使用)
    if (buyAmount < 0) buyAmount = 0; // 負の値にならないように
  }
  return buyAmount;
}

async function getRealizedPnL(exchange, symbol, strategyKey) {
  // 約定を更新
  await updateFilledTrades(exchange, symbol);

  const summary = await getFilledSummary({
    exchangeId: exchange.id,
    symbol,
    strategyKey
  });
  
  // console.log(summary);
  return summary.realizedPnL || 0;
}

async function getFilledCurrentPosition(exchange, symbol, strategyKey) {
  // 約定を更新
  await updateFilledTrades(exchange, symbol);

  const summary = await getFilledSummary({
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
  // await updateFilledSummaryTimestamp(exchange.id, symbol);
 
  try {
    // 前回のチェック時間を取得
    const timestamp = await getFilledSummaryTimestamp(exchange, symbol);
    
    // 前回のチェック時間（ない場合は24時間前）
    const lastCheckTime = timestamp ? timestamp : Date.now() - 24 * 60 * 60 * 1000;
    
    // fetchMyTradesメソッドが利用可能かどうかを確認
    if (!exchange.has || !exchange.has['fetchMyTrades']) {
      console.error(`約定履歴の更新エラー (${exchange.id} ${symbol}): fetchMyTradesメソッドがサポートされていません`);
      return 0;
    }
    
    // 取引所から約定履歴を取得
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

      await addFilledTrade(
        exchange.id,
        symbol,
        strategyKey,
        trade.side,
        trade.amount,
        trade.price,
        trade.cost || trade.amount * trade.price,
        trade.order,
        trade.type || 'market',
        trade.fee ? trade.fee.cost : undefined,
        trade.id
      );
      
      processedCount++;
    }
    
    console.log(`${exchange.id} ${symbol} ${strategyKey}: ${processedCount}件の約定を記録しました`);
    return processedCount;
  } catch (error) {
    console.error(`約定履歴の更新エラー (${exchange.id} ${symbol} :`, error);
    return 0;
  }
}

async function formattedAvailableAmount(exchange, symbol, strategyKey, amountPrecision) {
  try {
    // 取引記録から買った量を取得（ネットポジション）
    const netPosition = await getFilledCurrentPosition(exchange, symbol, strategyKey);
    
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

// スリープ関数
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = {
  weightedAverage,
  fetchTotal,
  getMarketParameters,
  getNetPosition,
  getFilledCurrentPosition,
  updateFilledTrades,
  formattedAvailableAmount,
  getRealizedPnL,
  sleep
};