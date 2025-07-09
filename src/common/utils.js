const { postErrorToDiscord } = require('./notifications');
const { errorHandler } = require('./errorHandler');
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

/**
 * スリープ関数
 * @param {number} ms - 待機時間（ミリ秒）
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * バックテストモードかどうかを判定する統一関数
 * @returns {boolean} - バックテストモードの場合true
 */
function isBacktestMode() {
  return process.env.BACKTEST_MODE === 'true';
}

/**
 * 戦略共通：シグナル決定ロジック
 * @param {boolean} buySignal - 買いシグナルフラグ
 * @param {boolean} sellSignal - 売りシグナルフラグ
 * @returns {string} 'buy' | 'sell' | 'none'
 */
function determineSignalType(buySignal, sellSignal) {
  return buySignal ? 'buy' : (sellSignal ? 'sell' : 'none');
}

/**
 * 戦略共通：ログ情報フォーマット
 * @param {string} strategyName - 戦略名
 * @param {string} exchange - 取引所名
 * @param {string} symbol - 通貨ペア
 * @param {Object} data - 戦略固有データ
 * @returns {Object} 統一フォーマットのログオブジェクト
 */
function formatStrategyLogInfo(strategyName, exchange, symbol, data) {
  return {
    timestamp: new Date().toISOString(),
    strategy: strategyName,
    exchange: exchange,
    symbol: symbol,
    ...data
  };
}

/**
 * 戦略共通：安全なエラーハンドリング
 * @param {Error|string} error - エラーオブジェクトまたはメッセージ
 * @param {string} strategyName - 戦略名
 * @param {string} exchange - 取引所名
 * @param {string} symbol - 通貨ペア
 * @param {boolean} shouldThrow - エラーを再throwするかどうか
 */
async function handleStrategyError(error, strategyName, exchange, symbol, shouldThrow = false) {
  const context = `${strategyName} - ${exchange} - ${symbol}`;
  const message = typeof error === 'string' ? error : error.message;

  console.error(`[${context}] エラー:`, message);

  try {
    await errorHandler.handleError(error, context, shouldThrow);
  } catch (handlerError) {
    console.error(`[${context}] エラーハンドラー自体でエラー:`, handlerError.message);
    await postErrorToDiscord(`${context}: ${message}`);
  }
}

/**
 * 戦略共通：パラメータ検証
 * @param {Object} params - パラメータオブジェクト
 * @param {Array} requiredKeys - 必須キーの配列
 * @param {string} strategyName - 戦略名（エラーメッセージ用）
 * @returns {boolean} 検証結果
 */
function validateStrategyParams(params, requiredKeys, strategyName) {
  if (!params || typeof params !== 'object') {
    throw new Error(`${strategyName}: パラメータが不正です`);
  }

  for (const key of requiredKeys) {
    if (!(key in params) || params[key] === undefined || params[key] === null) {
      throw new Error(`${strategyName}: 必須パラメータ '${key}' が不足しています`);
    }
  }

  return true;
}

/**
 * 戦略共通：数値の安全な変換
 * @param {any} value - 変換対象の値
 * @param {number} defaultValue - デフォルト値
 * @param {number} min - 最小値
 * @param {number} max - 最大値
 * @returns {number} 変換された数値
 */
function safeNumberConversion(value, defaultValue = 0, min = -Infinity, max = Infinity) {
  const num = parseFloat(value);
  if (isNaN(num)) {
    return defaultValue;
  }
  return Math.max(min, Math.min(max, num));
}

/**
 * 戦略共通：配列の安全な取得
 * @param {Array} array - 配列
 * @param {number} index - インデックス
 * @param {any} defaultValue - デフォルト値
 * @returns {any} 取得した値またはデフォルト値
 */
function safeArrayGet(array, index, defaultValue = null) {
  if (!Array.isArray(array) || index < 0 || index >= array.length) {
    return defaultValue;
  }
  return array[index];
}

/**
 * 戦略共通：OHLCVデータの検証
 * @param {Array} ohlcvData - OHLCVデータ配列
 * @param {number} requiredLength - 必要な最小データ数
 * @param {string} strategyName - 戦略名
 * @returns {boolean} 検証結果
 */
function validateOHLCVData(ohlcvData, requiredLength, strategyName) {
  if (!Array.isArray(ohlcvData)) {
    throw new Error(`${strategyName}: OHLCVデータが配列ではありません`);
  }

  if (ohlcvData.length < requiredLength) {
    throw new Error(`${strategyName}: データが不足しています: ${ohlcvData.length}/${requiredLength}`);
  }

  // 各データポイントの基本構造チェック
  for (let i = 0; i < Math.min(ohlcvData.length, 10); i++) {
    const candle = ohlcvData[i];
    if (!Array.isArray(candle) || candle.length < 5) {
      throw new Error(`${strategyName}: 不正なOHLCVデータ形式: index ${i}`);
    }

    const [timestamp, open, high, low, close] = candle;
    if (isNaN(timestamp) || isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) {
      throw new Error(`${strategyName}: 数値以外のデータが含まれています: index ${i}`);
    }
  }

  return true;
}

/**
 * 戦略共通：リトライ機能付きの非同期実行
 * @param {Function} asyncFunction - 実行する非同期関数
 * @param {number} maxRetries - 最大リトライ回数
 * @param {number} delayMs - リトライ間隔（ミリ秒）
 * @param {string} context - コンテキスト（エラーメッセージ用）
 * @returns {Promise<any>} 実行結果
 */
async function executeWithRetry(asyncFunction, maxRetries = 3, delayMs = 1000, context = 'unknown') {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await asyncFunction();
    } catch (error) {
      lastError = error;

      if (attempt === maxRetries) {
        throw error; // 最後のリトライでも失敗した場合は例外を投げる
      }

      console.warn(`[${context}] 実行失敗 (${attempt}/${maxRetries}): ${error.message}`);
      await sleep(delayMs * attempt); // 指数バックオフ
    }
  }

  throw lastError;
}

module.exports = {
  weightedAverage,
  fetchTotal,
  sleep,
  timeframeToMs,
  isBacktestMode,
  // 戦略共通関数
  determineSignalType,
  formatStrategyLogInfo,
  handleStrategyError,
  validateStrategyParams,
  safeNumberConversion,
  safeArrayGet,
  validateOHLCVData,
  executeWithRetry
};