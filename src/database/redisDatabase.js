/**
 * Redisデータベースモジュール
 * SQLiteからRedisへの移行の一部として実装
 */
const { client, initRedisClient } = require('./redisClient');

// 初期化関数
async function initialize() {
  await initRedisClient();
  console.log('Redisデータベースモジュールが初期化されました');
}

async function setCurrentOrderPairRedis(exchangeId, symbol, strategyKey, pair) {
  const key = `current:orderPair:${exchangeId}:${symbol}:${strategyKey}`;

  return await client.set(key, JSON.stringify({ pair }));
}

async function getCurrentOrderPairRedis(exchangeId, symbol, strategyKey) {
  const key = `current:orderPair:${exchangeId}:${symbol}:${strategyKey}`;
  const data = await client.get(key);

  if (data) {
    return JSON.parse(data).pair;
  }

  return null;
}

async function updateTradeSummaryTimestamp(exchange, symbol) {
  const timestampKey = `summary:timestamp:${exchange}:${symbol}`;
  const now = Date.now();

  await client.set(timestampKey, now);
}

async function getTradeSummaryTimestamp(exchange, symbol) {
  const timestampKey = `summary:timestamp:${exchange}:${symbol}`;
  const timestamp = await client.get(timestampKey);

  if (timestamp) {
    return parseInt(timestamp);
  }

  return null;
}

// サマリーの更新
async function updateTradeSummary(trade) {
  const summaryKey = `summary:trade:${trade.exchange}:${trade.symbol}:${trade.strategy}`;
  const now = Date.now();

  const exists = await client.exists(summaryKey);

  if (!exists) {
    // 新しい約定サマリーを作成
    await client.hSet(summaryKey, {
      buyAmount: 0,
      sellAmount: 0,
      totalBuyCost: 0,
      totalSellValue: 0,
      netPosition: 0,
      totalFee: 0,
      realizedPnL: 0,
      createdAt: now,
      updatedAt: now
    });
  }

  // 約定サマリーを更新
  if (trade.side === 'buy') {
    // 買い注文の場合
    await client.hIncrByFloat(summaryKey, 'buyAmount', trade.amount);
    await client.hIncrByFloat(summaryKey, 'totalBuyCost', trade.value);
    await client.hIncrByFloat(summaryKey, 'netPosition', trade.amount);
    await client.hIncrByFloat(summaryKey, 'totalFee', trade.fee);
  } else if (trade.side === 'sell') {
    // 売り注文の場合
    await client.hIncrByFloat(summaryKey, 'sellAmount', trade.amount);
    await client.hIncrByFloat(summaryKey, 'totalSellValue', trade.value);
    await client.hIncrByFloat(summaryKey, 'netPosition', -trade.amount);
    await client.hIncrByFloat(summaryKey, 'totalFee', trade.fee);
    
    // 実現損益を計算（売りの場合のみ更新）
    // 単純化のため、売った分の平均購入コストを計算
    const currentBuyAmount = parseFloat(await client.hGet(summaryKey, 'buyAmount') || 0);
    const currentBuyCost = parseFloat(await client.hGet(summaryKey, 'totalBuyCost') || 0);
    
    if (currentBuyAmount > 0) {
      const avgBuyCost = currentBuyCost / currentBuyAmount;
      const soldCost = trade.amount * avgBuyCost;
      const profit = trade.value - soldCost;
      await client.hIncrByFloat(summaryKey, 'realizedPnL', profit);
    }
  }
  
}

async function getAllTradeSummaries() {
  const keys = await client.keys(`summary:trade:*`);
  const summaries = [];

  for (const key of keys) {
    const summary = await client.hGetAll(key);
    if (Object.keys(summary).length > 0) {
      summaries.push({
        exchangeId: key.split(':')[2],
        symbol: key.split(':')[3],
        strategyKey: key.split(':')[4],
        buyAmount: parseFloat(summary.buyAmount || 0),
        sellAmount: parseFloat(summary.sellAmount || 0),
        totalBuyCost: parseFloat(summary.totalBuyCost || 0),
        totalSellValue: parseFloat(summary.totalSellValue || 0),
        netPosition: parseFloat(summary.netPosition || 0),
        totalFee: parseFloat(summary.totalFee || 0),
        realizedPnL: parseFloat(summary.realizedPnL || 0),
        createdAt: parseInt(summary.createdAt || 0),
        updatedAt: parseInt(summary.updatedAt || 0)
      });
    }
  }

  return summaries;
}

async function getTradeSummaries(exchangeId) {
  const keys = await client.keys(`summary:trade:${exchangeId}:*`);
  const summaries = [];

  for (const key of keys) {
    const summary = await client.hGetAll(key);
    if (Object.keys(summary).length > 0) {
      summaries.push({
        exchangeId,
        symbol: key.split(':')[3],
        strategyKey: key.split(':')[4],
        buyAmount: parseFloat(summary.buyAmount || 0),
        sellAmount: parseFloat(summary.sellAmount || 0),
        totalBuyCost: parseFloat(summary.totalBuyCost || 0),
        totalSellValue: parseFloat(summary.totalSellValue || 0),
        netPosition: parseFloat(summary.netPosition || 0),
        totalFee: parseFloat(summary.totalFee || 0),
        realizedPnL: parseFloat(summary.realizedPnL || 0),
        createdAt: parseInt(summary.createdAt || 0),
        updatedAt: parseInt(summary.updatedAt || 0)
      });
    }
  }

  return summaries;

}

/**
 * 約定サマリーを取得する関数
 * @param {Object} filters - フィルター条件（exchangeId, symbol, strategyKey）
 * @returns {Promise<Object>} 約定サマリー情報
 */
async function getTradeSummary(filters = {}) {
  const { exchangeId, symbol, strategyKey } = filters;
  
  // 全て指定されている場合は特定のサマリーを取得
  if (exchangeId && symbol && strategyKey) {
    const summaryKey = `summary:trade:${exchangeId}:${symbol}:${strategyKey}`;
    const summary = await client.hGetAll(summaryKey);
    
    if (Object.keys(summary).length > 0) {
      return {
        buyAmount: parseFloat(summary.buyAmount || 0),
        sellAmount: parseFloat(summary.sellAmount || 0),
        totalBuyCost: parseFloat(summary.totalBuyCost || 0),
        totalSellValue: parseFloat(summary.totalSellValue || 0),
        netPosition: parseFloat(summary.netPosition || 0),
        totalFee: parseFloat(summary.totalFee || 0),
        realizedPnL: parseFloat(summary.realizedPnL || 0),
        createdAt: parseInt(summary.createdAt || 0),
        updatedAt: parseInt(summary.updatedAt || 0)
      };
    }
    return {};
  }
  
  return {};
}

/**
 * 戦略パラメータを保存する関数
 * @param {String} exchangeId - 取引所ID
 * @param {String} symbol - 通貨ペア
 * @param {String} strategyKey - 戦略キー
 * @param {Object} params - 保存するパラメータオブジェクト
 * @returns {Promise} 処理完了時に解決されるPromise
 */
async function saveStrategyParametersRedis(exchangeId, symbol, strategyKey, params) {
  const key = `params:${exchangeId}:${symbol}:${strategyKey}`;
  try {
    
    // パラメータオブジェクトの各値を文字列に変換
    const stringifiedParams = {};
    for (const [paramKey, value] of Object.entries(params)) {
      stringifiedParams[paramKey] = String(value); // 値を文字列に変換
    }
    
    await client.hSet(key, stringifiedParams);
    // console.log(`戦略パラメータを保存しました: ${key}`);
    return true;
  } catch (error) {
    console.error(`戦略パラメータの保存中にエラーが発生しました: ${key}`, error);
    return false;
  }
}

// 型変換用のヘルパー関数
// TODO: use zod
function parseParamValue(value) {
  // null/undefined チェック
  if (value === null || value === undefined || value === 'null') {
    return null;
  }
  
  // 真偽値チェック
  if (value === 'true') return true;
  if (value === 'false') return false;
  
  // 数値チェック
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  
  // JSON オブジェクト/配列チェック
  if ((value.startsWith('{') && value.endsWith('}')) || 
      (value.startsWith('[') && value.endsWith(']'))) {
    try {
      return JSON.parse(value);
    } catch (e) {
      // パースに失敗した場合は元の文字列を返す
    }
  }
  
  // その他は文字列として扱う
  return value;
}

async function getStrategyParametersRedis(exchangeId, symbol, strategyKey) {
  const key = `params:${exchangeId}:${symbol}:${strategyKey}`;
  try {
    const params = await client.hGetAll(key);
    
    if (Object.keys(params).length > 0) {
      const parsedParams = {};
      for (const [paramKey, value] of Object.entries(params)) {
        parsedParams[paramKey] = parseParamValue(value);
      }
      return parsedParams;
    } else {
      console.log(`戦略パラメータがRedisに存在しません: ${key}`);
      return null;
    }
  } catch (error) {
    console.error(`戦略パラメータの読み出し中にエラーが発生しました: ${key}`, error);
    return null;
  }
}

/**
 * 全ての戦略パラメータを取得する関数
 * Redisから 'params:*' のパターンで全てのキーを取得し、対応するパラメータを返します。
 * @returns {Promise<Object>} キー（params:exchangeId:symbol:strategyKey）とパラメータオブジェクトのマップ
 */
async function getAllStrategyParametersRedis() {
  try {
    const keys = await client.keys('params:*');
    const allParams = {};

    for (const key of keys) {
      const params = await client.hGetAll(key);
      if (Object.keys(params).length > 0) {
        const parsedParams = {};
        for (const [paramKey, value] of Object.entries(params)) {
          parsedParams[paramKey] = parseParamValue(value);
        }
        allParams[key] = parsedParams;
      }
    }

    console.log(`全ての戦略パラメータを取得しました (${Object.keys(allParams).length}件)`);
    return allParams;
  } catch (error) {
    console.error('全ての戦略パラメータの読み出し中にエラーが発生しました:', error);
    return {}; // エラー時は空のオブジェクトを返す
  }
}

/**
 * トレード情報のキーを取得する
 * @returns {Promise<Array>} 取引所の情報の配列
 */
async function getTradeKeys() {
  try {
    const key = 'summary:trade:*';
    const exchangesKeys = await client.keys(key);

    // 取得キーを分解してJSONに構造化
    const exchanges = {};
    
    for (const key of exchangesKeys) {
      const parts = key.split(':');
      if (parts.length >= 5) {
      const exchangeId = parts[2];
      const symbol = parts[3];
      const strategyKey = parts[4];
      
      if (!exchanges[exchangeId]) {
        exchanges[exchangeId] = {};
      }
      
      if (!exchanges[exchangeId][symbol]) {
        exchanges[exchangeId][symbol] = [];
      }
      
      if (!exchanges[exchangeId][symbol].includes(strategyKey)) {
        exchanges[exchangeId][symbol].push(strategyKey);
      }
      }
    }

    console.log(exchanges);

    return JSON.stringify(exchanges);
  } catch (error) {
    console.error('取引所情報の取得に失敗しました:', error);
    return [];
  }
}

async function getOHLCVRedisTimestamp(exchangeId, symbol, timeframe) {
  const key = `ohlcv:timestamp:${exchangeId}:${symbol}:${timeframe}`;
  const timestamp = await client.get(key);
  if (timestamp) {
    return parseInt(timestamp);
  }
  return null;
}

async function updateOHLCVRedisTimestamp(exchangeId, symbol, timeframe) {
  const key = `ohlcv:timestamp:${exchangeId}:${symbol}:${timeframe}`;
  const now = Date.now();

  await client.set(key, now);
  // console.log(`OHLCVのタイムスタンプを更新しました: ${key} - ${now}`);

  return now;
}

async function getOHLCVRedis(exchangeId, symbol, timeframe) {
  const key = `ohlcv:data:${exchangeId}:${symbol}:${timeframe}`;
  const data = await client.get(key);

  if (data) {
    return JSON.parse(data);
  }

  return null;
}

async function updateOHLCVRedis(exchangeId, symbol, timeframe, ohlcvData) {
  const key = `ohlcv:data:${exchangeId}:${symbol}:${timeframe}`;

  // RedisにOHLCVデータを保存
  await client.set(key, JSON.stringify(ohlcvData));

  // タイムスタンプを更新
  updateOHLCVRedisTimestamp(exchangeId, symbol, timeframe);

  // console.log(`OHLCVデータを更新しました: ${key} - ${now}`);
}

async function getTickerRedis(exchangeId, symbol) {
  const key = `ticker:${exchangeId}:${symbol}`;
  const data = await client.get(key);

  if (data) {
    return JSON.parse(data);
  }

  return null;
}

async function updateTickerRedis(exchangeId, symbol, tickerData) {
  const key = `ticker:${exchangeId}:${symbol}`;

  // Redisにティッカーデータを保存
  await client.set(key, JSON.stringify(tickerData));

  // console.log(`ティッカーデータを更新しました: ${key}`);
}

/**
 * Backtest用OHLCVデータをsorted setとして保存する関数
 * タイムスタンプをスコアとして使用
 */
async function updateBacktestOHLCVRedisSortedSet(exchangeId, symbol, timeframe, ohlcvData) {
  const key = `backtest:ohlcv:zset:${exchangeId}:${symbol}:${timeframe}`;
  
  // 既存のデータをクリア
  await client.del(key);
  
  // バルク操作用の配列を準備
  const bulkData = [];
  
  for (const item of ohlcvData) {
    // 配列の最初の要素（通常はタイムスタンプ）をスコアとして使用
    const score = item.timestamp;
    // 残りのデータをJSON文字列として保存
    const value = JSON.stringify(item);
    
    bulkData.push({ score, value });
  }
  
  // バルク操作でデータを追加
  if (bulkData.length > 0) {
    await client.zAdd(key, bulkData);
  }
  
  return Date.now();
}

/**
 * タイムスタンプの範囲でフィルタリングしてデータを取得
 */
async function getBacktestOHLCVRedisByTimeRange(exchangeId, symbol, timeframe, startTime, endTime) {
  const key = `backtest:ohlcv:zset:${exchangeId}:${symbol}:${timeframe}`;
  
  // 指定された範囲のスコア（タイムスタンプ）の要素を取得
  const result = await client.zRangeByScore(key, startTime, endTime);
  
  // 結果をJSONとしてパース
  return result.map(item => JSON.parse(item));
}

/**
 * すべてのBacktest用OHLCVデータを取得
 */
async function getAllBacktestOHLCVRedisSortedSet(exchangeId, symbol, timeframe) {
  const key = `backtest:ohlcv:zset:${exchangeId}:${symbol}:${timeframe}`;
  
  // すべての要素を取得
  const result = await client.zRange(key, 0, -1);
  
  // 結果をJSONとしてパース
  return result.map(item => JSON.parse(item));
}

/**
 * 指定されたtimestampより古いOHLCVデータをlimit件数だけ取得する
 * @param {String} exchangeId - 取引所ID
 * @param {String} symbol - 通貨ペア
 * @param {String} timeframe - タイムフレーム
 * @param {Number} timestamp - このtimestamp以前のデータを取得
 * @param {Number} limit - 取得する最大件数
 * @returns {Promise<Array>} OHLCVデータの配列
 */
async function getBacktestOHLCVRedisBeforeTimestamp(exchangeId, symbol, timeframe, timestamp, limit = 100) {
  const key = `backtest:ohlcv:zset:${exchangeId}:${symbol}:${timeframe}`;
  
  // timestampより古いデータを降順（新しい順）で取得
  const result = await client.zRange(
    key,
    timestamp,
    '-inf',
    {
      BY: 'SCORE',
      REV: true,
      LIMIT: {
        offset: 0,
        count: limit
      }
    }
  );
  
  // 結果をJSONとしてパース
  return result.map(item => JSON.parse(item));
}

// モジュールのエクスポートに新しい関数を追加
module.exports = {
  initialize,
  setCurrentOrderPairRedis,
  getCurrentOrderPairRedis,
  getTradeSummary,
  updateTradeSummary,
  saveStrategyParametersRedis,
  getStrategyParametersRedis,
  getTradeSummaryTimestamp,
  updateTradeSummaryTimestamp,
  getTradeSummaries,
  getAllTradeSummaries,
  getTradeKeys,
  getAllStrategyParametersRedis,
  getOHLCVRedisTimestamp,
  getOHLCVRedis,
  updateOHLCVRedis,
  getTickerRedis,
  updateTickerRedis,
  updateBacktestOHLCVRedisSortedSet,
  getBacktestOHLCVRedisByTimeRange,
  getAllBacktestOHLCVRedisSortedSet,
  getBacktestOHLCVRedisBeforeTimestamp,
};