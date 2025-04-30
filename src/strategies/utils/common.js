/**
 * OHLCV データを取得して検証する
 * @param {Object} exchange 取引所オブジェクト
 * @param {string} symbol シンボル
 * @param {string} ohlcvInterval インターバル
 * @param {number} period 期間
 * @param {Function} errorNotificationFn エラー通知関数
 * @returns {Array|null} 検証済みの終値配列、またはエラー時はnull
 */
async function fetchAndValidateOHLCVData(exchange, symbol, ohlcvInterval, period, errorNotificationFn) {
  // 過去のローソク足データを取得
  const ohlcv = await fetchOHLCVData(exchange, symbol, ohlcvInterval, period + 10);
  if (ohlcv.length < period) {
    console.log(`オシレーター戦略のデータが不足しています: ${symbol} ${ohlcv.length}/${period}`);
    return null;
  }

  // 終値の配列を作成
  const closes = ohlcv.map(candle => candle[4]);
  
  // データの検証を追加
  if (closes.some(price => price === undefined || price === null || isNaN(price))) {
    console.log(`オシレーター戦略: ${symbol} - 無効な価格データが含まれています`);
    if (errorNotificationFn) {
      await errorNotificationFn(`[オシレーター戦略] 警告: ${exchange.id} - ${symbol} - 無効な価格データが含まれています`);
    }
    return null;
  }
  
  return closes;
}

module.exports = {
  fetchAndValidateOHLCVData
}