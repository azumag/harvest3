const { postErrorToDiscord } = require('./notifications');
const { max } = require('moment');

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
 * タイムフレーム文字列をミリ秒に変換する関数
 * @param {string} timeframe - タイムフレーム文字列 (例: "1m", "1h", "1d")
 * @returns {number} ミリ秒
 */
function timeframeToMs(timeframe) {
  const value = parseInt(timeframe);
  const unit = timeframe.slice(value.toString().length);
  
  switch (unit) {
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    case 'w': return value * 7 * 24 * 60 * 60 * 1000;
    default: throw new Error(`Unknown timeframe unit: ${unit}`);
  }
}

// スリープ関数
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * バックテストモードかどうかを判定する統一関数
 * @returns {boolean} - バックテストモードの場合true
 */
function isBacktestMode() {
  return process.env.BACKTEST_MODE === 'true';
}

module.exports = {
  weightedAverage,
  fetchTotal,
  sleep,
  timeframeToMs,
  isBacktestMode
};