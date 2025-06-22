/**
 * Redisデータベースモジュール
 * SQLiteからRedisへの移行の一部として実装
 */
const { client, initRedisClient } = require('./redisClient');
const { errorHandler } = require('../common/errorHandler');

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
  const summaryKey = `trade_summary:${trade.exchange}:${trade.symbol}:${trade.strategy}`;
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
  const keys = await client.keys(`trade_summary:*`);
  const summaries = [];

  for (const key of keys) {
    const summary = await client.hGetAll(key);
    if (Object.keys(summary).length > 0) {
      const keyParts = key.split(':');
      const exchangeId = keyParts[2];
      const symbol = keyParts[3];
      const strategyKey = keyParts[4];
      
      // undefinedやnullの値を持つキーをスキップ
      if (exchangeId === 'undefined' || !exchangeId || 
          symbol === 'undefined' || !symbol || 
          strategyKey === 'undefined' || !strategyKey) {
        console.warn(`無効なRedisキーを検出してスキップ: ${key}`);
        continue;
      }
      
      summaries.push({
        exchangeId,
        symbol,
        strategyKey,
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
  const keys = await client.keys(`trade_summary:${exchangeId}:*`);
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
    const summaryKey = `trade_summary:${exchangeId}:${symbol}:${strategyKey}`;
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
    await errorHandler.handleError(error, '全ての戦略パラメータの読み出し', true);
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
    await errorHandler.handleError(error, '取引所情報の取得', true);
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

/**
 * 指定されたキーをRedisから削除する
 * @param {String} key - 削除するキー
 * @returns {Promise<Boolean>} 削除に成功したかどうか
 */
async function deleteKey(key) {
  try {
    const result = await client.del(key);
    return result > 0;
  } catch (error) {
    console.error(`Redisからキーの削除に失敗しました: ${key}`, error);
    return false;
  }
}

// ===== ポジション管理機能 =====

/**
 * ポジション情報を保存
 * @param {String} positionKey - ポジションキー (exchange:symbol:strategy:orderId)
 * @param {Object} positionData - ポジション情報
 * @returns {Promise<Boolean>} 保存に成功したかどうか
 */
async function savePositionRedis(positionKey, positionData) {
  const key = `position:${positionKey}`;
  try {
    const dataWithTimestamp = {
      ...positionData,
      updatedAt: Date.now()
    };
    await client.hSet(key, dataWithTimestamp);
    return true;
  } catch (error) {
    console.error(`ポジション情報の保存に失敗しました: ${key}`, error);
    return false;
  }
}

/**
 * ポジション情報を取得
 * @param {String} positionKey - ポジションキー
 * @returns {Promise<Object|null>} ポジション情報
 */
async function getPositionRedis(positionKey) {
  const key = `position:${positionKey}`;
  try {
    const position = await client.hGetAll(key);
    
    if (Object.keys(position).length === 0) {
      return null;
    }
    
    // 数値フィールドを変換
    return {
      exchangeId: position.exchangeId,
      symbol: position.symbol,
      strategyKey: position.strategyKey,
      orderId: position.orderId,
      side: position.side,
      amount: parseFloat(position.amount || 0),
      entryPrice: parseFloat(position.entryPrice || 0),
      highestPrice: parseFloat(position.highestPrice || 0),
      status: position.status,
      createdAt: parseInt(position.createdAt || 0),
      updatedAt: parseInt(position.updatedAt || 0)
    };
  } catch (error) {
    console.error(`ポジション情報の取得に失敗しました: ${key}`, error);
    return null;
  }
}

/**
 * 戦略に関連する全ポジションを取得
 * @param {String} exchangeId - 取引所ID
 * @param {String} symbol - シンボル
 * @param {String} strategyKey - 戦略キー
 * @returns {Promise<Array>} ポジション配列
 */
async function getStrategyPositionsRedis(exchangeId, symbol, strategyKey) {
  try {
    const pattern = `position:${exchangeId}:${symbol}:${strategyKey}:*`;
    const keys = await client.keys(pattern);
    const positions = [];
    
    for (const key of keys) {
      const position = await client.hGetAll(key);
      if (Object.keys(position).length > 0) {
        const positionKey = key.replace('position:', '');
        positions.push({
          key: positionKey,
          exchangeId: position.exchangeId,
          symbol: position.symbol,
          strategyKey: position.strategyKey,
          orderId: position.orderId,
          side: position.side,
          amount: parseFloat(position.amount || 0),
          entryPrice: parseFloat(position.entryPrice || 0),
          highestPrice: parseFloat(position.highestPrice || 0),
          status: position.status,
          createdAt: parseInt(position.createdAt || 0),
          updatedAt: parseInt(position.updatedAt || 0)
        });
      }
    }
    
    return positions;
  } catch (error) {
    console.error(`戦略ポジションの取得に失敗しました: ${exchangeId}:${symbol}:${strategyKey}`, error);
    return [];
  }
}

/**
 * すべてのポジション情報を取得
 * @returns {Promise<Array>} 全ポジション配列
 */
async function getAllPositionsRedis() {
  try {
    const pattern = `position:*`;
    const keys = await client.keys(pattern);
    const positions = [];
    
    for (const key of keys) {
      const position = await client.hGetAll(key);
      if (Object.keys(position).length > 0) {
        const positionKey = key.replace('position:', '');
        positions.push({
          key: positionKey,
          positionKey: positionKey, // API互換性のため
          exchangeId: position.exchangeId,
          exchange: position.exchangeId, // API互換性のため
          symbol: position.symbol,
          strategyKey: position.strategyKey,
          strategy: position.strategyKey, // API互換性のため
          orderId: position.orderId,
          side: position.side,
          amount: parseFloat(position.amount || 0),
          entryPrice: parseFloat(position.entryPrice || 0),
          highestPrice: parseFloat(position.highestPrice || 0),
          currentPrice: parseFloat(position.currentPrice || position.entryPrice || 0),
          status: position.status,
          createdAt: parseInt(position.createdAt || 0),
          updatedAt: parseInt(position.updatedAt || 0),
          timestamp: parseInt(position.createdAt || 0) // API互換性のため
        });
      }
    }
    
    return positions;
  } catch (error) {
    console.error(`全ポジションの取得に失敗しました:`, error);
    return [];
  }
}

/**
 * ポジション情報を削除
 * @param {String} positionKey - ポジションキー
 * @returns {Promise<Boolean>} 削除に成功したかどうか
 */
async function deletePositionRedis(positionKey) {
  const key = `position:${positionKey}`;
  try {
    const result = await client.del(key);
    return result > 0;
  } catch (error) {
    console.error(`ポジション情報の削除に失敗しました: ${key}`, error);
    return false;
  }
}

/**
 * ポジション履歴をMongoDBに保存
 * @param {Object} positionData - ポジション情報
 * @returns {Promise<Boolean>} 保存に成功したかどうか
 */
async function savePositionHistoryToMongoDB(positionData) {
  try {
    // MongoDB接続の取得
    const { connectDB } = require('./mongoDatabase');
    await connectDB();
    
    // positions履歴コレクションへの保存
    const { MongoClient } = require('mongodb');
    const mongoUrl = process.env.MONGO_URL;
    const mongoDbName = process.env.MONGO_DB_NAME;
    
    const client = new MongoClient(mongoUrl);
    await client.connect();
    const db = client.db(mongoDbName);
    
    // positionsコレクションが存在しない場合は作成
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);
    
    if (!collectionNames.includes('positions')) {
      await db.createCollection('positions');
      console.log('positions コレクションを作成しました');
    }
    
    const positionsCollection = db.collection('positions');
    
    // インデックスを作成（一度だけ）
    try {
      await positionsCollection.createIndex({ positionKey: 1 }, { unique: true });
      await positionsCollection.createIndex({ exchangeId: 1, symbol: 1, strategyKey: 1 });
      await positionsCollection.createIndex({ createdAt: 1 });
      await positionsCollection.createIndex({ closedAt: 1 });
    } catch (indexError) {
      // インデックスが既に存在する場合は無視
    }
    
    // ポジション履歴データを準備
    const historyData = {
      ...positionData,
      savedToHistoryAt: new Date(),
      // 数値フィールドを確実に数値として保存
      amount: parseFloat(positionData.amount || 0),
      entryPrice: parseFloat(positionData.entryPrice || 0),
      highestPrice: parseFloat(positionData.highestPrice || 0),
      closePrice: parseFloat(positionData.closePrice || 0),
      createdAt: new Date(positionData.createdAt || Date.now()),
      updatedAt: new Date(positionData.updatedAt || Date.now()),
      closedAt: positionData.closedAt ? new Date(positionData.closedAt) : null
    };
    
    // 重複チェック用のキーを作成
    const positionKey = `${positionData.exchangeId}:${positionData.symbol}:${positionData.strategyKey}:${positionData.orderId}`;
    historyData.positionKey = positionKey;
    
    // upsert操作で保存（既存データがあれば更新、なければ挿入）
    await positionsCollection.replaceOne(
      { positionKey: positionKey },
      historyData,
      { upsert: true }
    );
    
    await client.close();
    
    console.log(`ポジション履歴をMongoDBに保存しました: ${positionKey}`);
    return true;
  } catch (error) {
    console.error('ポジション履歴のMongoDB保存に失敗しました:', error);
    return false;
  }
}

/**
 * ポジションを完全決済し、履歴保存後にRedisから削除
 * @param {String} positionKey - ポジションキー  
 * @param {Object} options - オプション設定
 * @param {Boolean} options.saveHistory - 履歴をMongoDBに保存するか (default: true)
 * @param {Number} options.delayHours - 削除までの遅延時間（時間単位）(default: 0 - 即座に削除)
 * @returns {Promise<Object>} 処理結果
 */
async function closeAndCleanupPosition(positionKey, options = {}) {
  const { saveHistory = true, delayHours = 0 } = options;
  const key = `position:${positionKey}`;
  
  try {
    // 現在のポジション情報を取得
    const positionData = await getPositionRedis(positionKey);
    if (!positionData) {
      return { success: false, reason: 'position_not_found' };
    }
    
    // ポジションを閉じた状態に更新
    const closedPositionData = {
      ...positionData,
      status: 'closed',
      closedAt: positionData.closedAt || Date.now(),
      updatedAt: Date.now()
    };
    
    // 履歴を保存（オプションで有効な場合）
    if (saveHistory) {
      const historySaved = await savePositionHistoryToMongoDB(closedPositionData);
      if (!historySaved) {
        console.warn(`履歴保存に失敗しましたが処理を継続します: ${positionKey}`);
      }
    }
    
    // 削除処理
    if (delayHours > 0) {
      // 遅延削除: TTLを設定
      const ttlSeconds = delayHours * 60 * 60;
      await client.expire(key, ttlSeconds);
      console.log(`ポジションを${delayHours}時間後に自動削除するよう設定しました: ${positionKey}`);
      
      return {
        success: true,
        action: 'delayed_cleanup',
        delayHours,
        historyKey: saveHistory ? closedPositionData.positionKey : null
      };
    } else {
      // 即座に削除
      const deleted = await deletePositionRedis(positionKey);
      if (deleted) {
        console.log(`ポジションをRedisから削除しました: ${positionKey}`);
        return {
          success: true,
          action: 'immediate_cleanup',
          historyKey: saveHistory ? closedPositionData.positionKey : null
        };
      } else {
        return { success: false, reason: 'delete_failed' };
      }
    }
  } catch (error) {
    console.error(`ポジションクリーンアップに失敗しました: ${positionKey}`, error);
    return { success: false, error: error.message };
  }
}

/**
 * 指定された期間より古い完了ポジションを一括削除
 * @param {Number} olderThanHours - この時間より古いポジションを削除（時間単位）
 * @param {Boolean} saveHistory - 削除前に履歴を保存するか (default: true)
 * @returns {Promise<Object>} 削除結果
 */
async function cleanupOldClosedPositions(olderThanHours = 24, saveHistory = true) {
  try {
    const pattern = 'position:*';
    const keys = await client.keys(pattern);
    
    let processed = 0;
    let deleted = 0;
    let historySaved = 0;
    let errors = 0;
    
    const cutoffTime = Date.now() - (olderThanHours * 60 * 60 * 1000);
    
    for (const key of keys) {
      try {
        const position = await client.hGetAll(key);
        
        if (Object.keys(position).length > 0) {
          processed++;
          
          // ポジションがクローズ済みで、指定時間より古い場合
          const closedAt = parseInt(position.closedAt || 0);
          const updatedAt = parseInt(position.updatedAt || 0);
          const isOld = Math.max(closedAt, updatedAt) < cutoffTime;
          
          if (position.status === 'closed' && isOld) {
            // 履歴保存
            if (saveHistory) {
              const historyResult = await savePositionHistoryToMongoDB({
                exchangeId: position.exchangeId,
                symbol: position.symbol,
                strategyKey: position.strategyKey,
                orderId: position.orderId,
                side: position.side,
                amount: parseFloat(position.amount || 0),
                entryPrice: parseFloat(position.entryPrice || 0),
                highestPrice: parseFloat(position.highestPrice || 0),
                closePrice: parseFloat(position.closePrice || 0),
                status: position.status,
                createdAt: parseInt(position.createdAt || 0),
                updatedAt: parseInt(position.updatedAt || 0),
                closedAt: parseInt(position.closedAt || 0)
              });
              
              if (historyResult) {
                historySaved++;
              }
            }
            
            // Redis から削除
            const result = await client.del(key);
            if (result > 0) {
              deleted++;
              const positionKey = key.replace('position:', '');
              console.log(`古いポジションを削除しました: ${positionKey}`);
            }
          }
        }
      } catch (error) {
        errors++;
        console.error(`ポジション処理エラー: ${key}`, error.message);
      }
    }
    
    const result = {
      success: true,
      processed,
      deleted,
      historySaved,
      errors,
      cutoffTime: new Date(cutoffTime).toISOString()
    };
    
    console.log(`古いポジションクリーンアップ完了:`, result);
    return result;
  } catch (error) {
    console.error('古いポジションクリーンアップに失敗しました:', error);
    return { success: false, error: error.message };
  }
}

// ===== 損益追跡機能 =====

/**
 * 損益を記録
 * @param {String} exchangeId - 取引所ID
 * @param {String} strategyKey - 戦略キー
 * @param {Number} pnl - 損益
 * @returns {Promise<Boolean>} 記録に成功したかどうか
 */
async function recordPnLRedis(exchangeId, strategyKey, pnl) {
  const now = new Date();
  const dateKey = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const key = `pnl:${exchangeId}:${strategyKey}:${dateKey}`;
  
  try {
    // 既存データを取得
    const existingData = await client.hGetAll(key);
    const currentPnL = parseFloat(existingData.pnl || 0);
    const currentTrades = parseInt(existingData.trades || 0);
    
    // データを更新
    await client.hSet(key, {
      pnl: currentPnL + pnl,
      trades: currentTrades + 1,
      lastUpdated: now.toISOString()
    });
    
    // TTLを設定（90日後に自動削除）
    await client.expire(key, 90 * 24 * 60 * 60);
    
    return true;
  } catch (error) {
    console.error(`損益の記録に失敗しました: ${key}`, error);
    return false;
  }
}

/**
 * 期間の損益を計算
 * @param {String} exchangeId - 取引所ID
 * @param {String} strategyKey - 戦略キー
 * @param {Number} days - 過去何日分を計算するか
 * @returns {Promise<Number>} 期間の合計損益
 */
async function calculatePeriodPnLRedis(exchangeId, strategyKey, days) {
  try {
    const now = new Date();
    let totalPnL = 0;
    
    for (let i = 0; i < days; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateKey = date.toISOString().split('T')[0];
      const key = `pnl:${exchangeId}:${strategyKey}:${dateKey}`;
      
      const dayData = await client.hGetAll(key);
      if (Object.keys(dayData).length > 0) {
        totalPnL += parseFloat(dayData.pnl || 0);
      }
    }
    
    return totalPnL;
  } catch (error) {
    console.error(`期間損益の計算に失敗しました: ${exchangeId}:${strategyKey}:${days}日`, error);
    return 0;
  }
}

/**
 * 指定日の損益データをクリア
 * @param {String} exchangeId - 取引所ID
 * @param {String} strategyKey - 戦略キー
 * @param {String} date - 日付 (YYYY-MM-DD)
 * @returns {Promise<Boolean>} クリアに成功したかどうか
 */
async function clearPnLRedis(exchangeId, strategyKey, date) {
  const key = `pnl:${exchangeId}:${strategyKey}:${date}`;
  try {
    const result = await client.del(key);
    return result > 0;
  } catch (error) {
    console.error(`損益データのクリアに失敗しました: ${key}`, error);
    return false;
  }
}

/**
 * テスト用: 全ポジションデータをクリア
 * @returns {Promise<Boolean>} クリアに成功したかどうか
 */
async function clearAllPositionsRedis() {
  try {
    const keys = await client.keys('position:*');
    if (keys.length > 0) {
      await client.del(keys);
    }
    return true;
  } catch (error) {
    console.error('全ポジションデータのクリアに失敗しました:', error);
    return false;
  }
}

/**
 * テスト用: 全損益データをクリア
 * @returns {Promise<Boolean>} クリアに成功したかどうか
 */
async function clearAllPnLRedis() {
  try {
    const keys = await client.keys('pnl:*');
    if (keys.length > 0) {
      await client.del(keys);
    }
    return true;
  } catch (error) {
    console.error('全損益データのクリアに失敗しました:', error);
    return false;
  }
}

/**
 * 戦略パラメータを削除する関数
 * @param {String} exchangeId - 取引所ID
 * @param {String} symbol - 通貨ペア
 * @param {String} strategyKey - 戦略キー
 * @returns {Promise<Boolean>} - 削除が成功したかどうか
 */
async function deleteStrategyParametersRedis(exchangeId, symbol, strategyKey) {
  const key = `params:${exchangeId}:${symbol}:${strategyKey}`;
  try {
    const result = await client.del(key);
    console.log(`戦略パラメータを削除しました: ${key}`);
    return result > 0;
  } catch (error) {
    console.error(`戦略パラメータの削除中にエラーが発生しました: ${key}`, error);
    return false;
  }
}

/**
 * 特定戦略の未約定注文をクリーンアップする関数
 * @param {String} exchangeId - 取引所ID
 * @param {String} symbol - 通貨ペア
 * @param {String} strategyKey - 戦略キー
 * @returns {Object} クリーンアップ結果
 */
async function cleanupStrategyPendingOrders(exchangeId, symbol, strategyKey) {
  const result = { checked: 0, deleted: 0, errors: 0 };
  
  try {
    // 該当戦略の未約定注文を取得
    const pattern = `pending_order:${exchangeId}:${symbol}:${strategyKey}:*`;
    const keys = await client.keys(pattern);
    
    result.checked = keys.length;
    
    for (const key of keys) {
      try {
        const pendingOrder = await client.hGetAll(key);
        
        if (pendingOrder && pendingOrder.orderId) {
          // 実際の取引所で注文状態を確認（オプション）
          // 注文が存在しない場合はRedisから削除
          await client.del(key);
          result.deleted++;
          console.log(`[戦略クリーンアップ] 削除: ${pendingOrder.orderId} (${strategyKey})`);
        }
      } catch (error) {
        console.warn(`[戦略クリーンアップ] キー処理エラー: ${key} - ${error.message}`);
        result.errors++;
      }
    }
    
    console.log(`[戦略クリーンアップ] 完了: ${result.checked}件チェック, ${result.deleted}件削除, ${result.errors}件エラー`);
    
    return result;
  } catch (error) {
    console.error(`[戦略クリーンアップ] 全体エラー: ${error.message}`);
    result.errors++;
    return result;
  }
}

/**
 * Redisクライアントを取得する関数
 * @returns {Object} Redis クライアント
 */
function getClient() {
  return client;
}

// モジュールのエクスポートに新しい関数を追加
module.exports = {
  getClient,
  initialize,
  setCurrentOrderPairRedis,
  getCurrentOrderPairRedis,
  getTradeSummary,
  updateTradeSummary,
  saveStrategyParametersRedis,
  getStrategyParametersRedis,
  deleteStrategyParametersRedis,
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
  deleteKey,
  // ポジション管理機能
  savePositionRedis,
  getPositionRedis,
  getStrategyPositionsRedis,
  getAllPositionsRedis,
  deletePositionRedis,
  // ポジションクリーンアップ機能
  savePositionHistoryToMongoDB,
  closeAndCleanupPosition,
  cleanupOldClosedPositions,
  // 損益追跡機能
  recordPnLRedis,
  calculatePeriodPnLRedis,
  clearPnLRedis,
  // テスト用
  clearAllPositionsRedis,
  clearAllPnLRedis,
  // 未約定注文管理機能
  savePendingOrderRedis,
  getPendingOrderRedis,
  getAllPendingOrdersRedis,
  deletePendingOrderRedis,
  cleanupInvalidPendingOrders,
  cleanupStrategyPendingOrders,
};

/**
 * 未約定注文をRedisに保存
 * @param {string} exchangeId - 取引所ID
 * @param {string} symbol - シンボル
 * @param {string} strategyKey - 戦略キー
 * @param {string} orderId - 注文ID
 * @param {Object} orderData - 注文データ
 */
async function savePendingOrderRedis(exchangeId, symbol, strategyKey, orderId, orderData) {
  try {
    const key = `pending_order:${exchangeId}:${symbol}:${strategyKey}:${orderId}`;
    const data = {
      exchangeId,
      symbol,
      strategyKey,
      orderId,
      side: orderData.side,
      amount: orderData.amount.toString(),
      price: orderData.price.toString(),
      orderType: orderData.orderType || 'limit',
      timestamp: orderData.timestamp.toString(),
      status: 'open'
    };
    
    await client.hSet(key, data);
    console.log(`未約定注文を保存しました: ${key}`);
    return true;
  } catch (error) {
    console.error(`未約定注文の保存に失敗しました: ${error.message}`);
    return false;
  }
}

/**
 * 特定の未約定注文を取得
 * @param {string} exchangeId - 取引所ID
 * @param {string} symbol - シンボル
 * @param {string} strategyKey - 戦略キー
 * @param {string} orderId - 注文ID
 */
async function getPendingOrderRedis(exchangeId, symbol, strategyKey, orderId) {
  try {
    const key = `pending_order:${exchangeId}:${symbol}:${strategyKey}:${orderId}`;
    const order = await client.hGetAll(key);
    
    if (Object.keys(order).length === 0) {
      return null;
    }
    
    return {
      exchangeId: order.exchangeId,
      symbol: order.symbol,
      strategyKey: order.strategyKey,
      orderId: order.orderId,
      side: order.side,
      amount: parseFloat(order.amount),
      price: parseFloat(order.price),
      orderType: order.orderType,
      timestamp: parseInt(order.timestamp),
      status: order.status
    };
  } catch (error) {
    console.error(`未約定注文の取得に失敗しました: ${error.message}`);
    return null;
  }
}

/**
 * 全ての未約定注文を取得
 * @returns {Promise<Array>} 未約定注文の配列
 */
async function getAllPendingOrdersRedis() {
  try {
    const pattern = `pending_order:*`;
    const keys = await client.keys(pattern);
    const orders = [];
    
    for (const key of keys) {
      const order = await client.hGetAll(key);
      if (Object.keys(order).length > 0) {
        orders.push({
          key: key,
          exchangeId: order.exchangeId,
          exchange: order.exchangeId, // API互換性のため
          symbol: order.symbol,
          strategyKey: order.strategyKey,
          strategy: order.strategyKey, // API互換性のため
          orderId: order.orderId,
          side: order.side,
          amount: parseFloat(order.amount),
          price: parseFloat(order.price),
          orderType: order.orderType,
          timestamp: parseInt(order.timestamp),
          status: order.status,
          filled: false, // 未約定フラグ
        });
      }
    }
    
    return orders;
  } catch (error) {
    console.error(`全未約定注文の取得に失敗しました: ${error.message}`);
    return [];
  }
}

/**
 * 未約定注文を削除（約定時などに使用）
 * @param {string} exchangeId - 取引所ID
 * @param {string} symbol - シンボル
 * @param {string} strategyKey - 戦略キー
 * @param {string} orderId - 注文ID
 */
async function deletePendingOrderRedis(exchangeId, symbol, strategyKey, orderId) {
  try {
    const key = `pending_order:${exchangeId}:${symbol}:${strategyKey}:${orderId}`;
    const result = await client.del(key);
    
    if (result === 1) {
      console.log(`未約定注文を削除しました: ${key}`);
      return true;
    } else {
      console.log(`削除対象の未約定注文が見つかりませんでした: ${key}`);
      return false;
    }
  } catch (error) {
    console.error(`未約定注文の削除に失敗しました: ${error.message}`);
    return false;
  }
}

/**
 * 無効な未約定注文をクリーンアップ
 * 取引所APIで注文状態を確認し、約定済み・キャンセル済み・期限切れの注文をRedisから削除
 * @param {Object} exchangeInstance - 取引所インスタンス
 * @returns {Promise<Object>} - クリーンアップ結果
 */
async function cleanupInvalidPendingOrders(exchangeInstance) {
  const isBacktest = process.env.BACKTEST_MODE === 'true';
  const result = {
    checked: 0,
    deleted: 0,
    errors: 0,
    details: []
  };
  
  try {
    // Redisから全ての未約定注文を取得
    const pendingOrders = await getAllPendingOrdersRedis();
    
    if (pendingOrders.length === 0) {
      if (!isBacktest) {
        console.log('[注文クリーンアップ] クリーンアップ対象の未約定注文がありません');
      }
      return result;
    }
    
    if (!isBacktest) {
      console.log(`[注文クリーンアップ] ${pendingOrders.length}件の未約定注文をチェック開始`);
    }
    
    // 取引所インスタンスの準備
    if (!exchangeInstance.markets) {
      await exchangeInstance.loadMarkets();
    }
    
    // 各未約定注文の状態をチェック
    for (const pendingOrder of pendingOrders) {
      result.checked++;
      
      try {
        // 注文状態を確認
        const orderInfo = await exchangeInstance.fetchOrder(pendingOrder.orderId, pendingOrder.symbol);
        
        // 注文が約定済み・キャンセル済み・期限切れの場合は削除
        const invalidStatuses = ['closed', 'canceled', 'cancelled', 'rejected', 'expired'];
        if (invalidStatuses.includes(orderInfo.status) || orderInfo.filled >= orderInfo.amount) {
          const deleted = await deletePendingOrderRedis(
            pendingOrder.exchangeId,
            pendingOrder.symbol,
            pendingOrder.strategyKey,
            pendingOrder.orderId
          );
          
          if (deleted) {
            result.deleted++;
            result.details.push({
              orderId: pendingOrder.orderId,
              symbol: pendingOrder.symbol,
              strategy: pendingOrder.strategyKey,
              status: orderInfo.status,
              filled: orderInfo.filled,
              amount: orderInfo.amount
            });
            
            if (!isBacktest) {
              console.log(`[注文クリーンアップ] 削除: ${pendingOrder.orderId} (${orderInfo.status}, filled: ${orderInfo.filled}/${orderInfo.amount})`);
            }
          }
        }
      } catch (orderError) {
        result.errors++;
        
        // 注文が見つからない場合（Not Found）はRedisから削除
        if (orderError.message.includes('not found') || 
            orderError.message.includes('NotFound') || 
            orderError.message.includes('Invalid order') ||
            orderError.message.includes('does not exist')) {
          
          const deleted = await deletePendingOrderRedis(
            pendingOrder.exchangeId,
            pendingOrder.symbol,
            pendingOrder.strategyKey,
            pendingOrder.orderId
          );
          
          if (deleted) {
            result.deleted++;
            result.details.push({
              orderId: pendingOrder.orderId,
              symbol: pendingOrder.symbol,
              strategy: pendingOrder.strategyKey,
              status: 'not_found',
              error: orderError.message
            });
            
            if (!isBacktest) {
              console.log(`[注文クリーンアップ] 削除（注文なし）: ${pendingOrder.orderId} - ${orderError.message}`);
            }
          }
        } else {
          // その他のエラーは警告ログのみ
          if (!isBacktest) {
            console.warn(`[注文クリーンアップ] チェックエラー: ${pendingOrder.orderId} - ${orderError.message}`);
          }
        }
      }
      
      // API制限を考慮して少し待機
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    if (!isBacktest) {
      console.log(`[注文クリーンアップ] 完了: ${result.checked}件チェック, ${result.deleted}件削除, ${result.errors}件エラー`);
    }
    
    return result;
  } catch (error) {
    console.error(`[注文クリーンアップ] 全体エラー: ${error.message}`);
    result.errors++;
    return result;
  }
}