const { postErrorToDiscord } = require('./notifications');
const { bitflyerMinTradeAmounts } = require('./config');
const { getFilledSummary, addFilledTrade } = require('./redisDatabase');
 
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

async function getFilledCurrentPosition(exchange, symbol, strategyKey) {
  // 約定を更新
  await updateFilledTrades(exchange, symbol, strategyKey);

  const summary = await getFilledSummary({
    exchangeId: exchange.id,
    symbol,
    strategyKey
  });
  
  return summary.netPosition;
}

/**
 * 前回チェック時から現在までの約定履歴を取得し記録する
 * @param {Object} exchange - 取引所オブジェクト
 * @param {string} symbol - 通貨ペア
 * @param {string} strategyKey - 戦略キー
 * @returns {Promise<number>} - 処理した約定数
 */
async function updateFilledTrades(exchange, symbol, strategyKey) {
 
  try {
    // 前回のチェック時間を取得
    const summary = await getFilledSummary({
      exchangeId: exchange.id,
      symbol,
      strategyKey
    });
    
    // 前回のチェック時間（ない場合は24時間前）
    const lastCheckTime = summary.updatedAt
      ? summary.updatedAt
      : Date.now() - 24 * 60 * 60 * 1000;
    
    // fetchMyTradesメソッドが利用可能かどうかを確認
    if (!exchange.has || !exchange.has['fetchMyTrades']) {
      console.error(`約定履歴の更新エラー (${exchange.id} ${symbol} ${strategyKey}): fetchMyTradesメソッドがサポートされていません`);
      return 0;
    }
    
    // 取引所から約定履歴を取得
    const trades = await exchange.fetchMyTrades(symbol, lastCheckTime);
    
    let processedCount = 0;
    // 各約定を処理
    for (const trade of trades) {
      await addFilledTrade(
        exchange.id,
        symbol,
        strategyKey,
        trade.side,
        trade.amount,
        trade.price,
        trade.cost || trade.amount * trade.price,
        trade.id || trade.order_id || trade.order,
        trade.type || 'market',
        trade.fee ? trade.fee.cost : undefined
      );
      
      processedCount++;
    }
    
    console.log(`${exchange.id} ${symbol} ${strategyKey}: ${processedCount}件の約定を記録しました`);
    return processedCount;
  } catch (error) {
    console.error(`約定履歴の更新エラー (${exchange.id} ${symbol} ${strategyKey}):`, error);
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
  updateFilledTrades,  // 新しい関数を追加
  sleep
};