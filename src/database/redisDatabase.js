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

async function setCurrentOrderPair(exchangeId, symbol, strategyKey, pair) {
  const key = `current:orderPair:${exchangeId}:${symbol}:${strategyKey}`;

  return await client.set(key, JSON.stringify({ pair }));
}

async function getCurrentOrderPair(exchangeId, symbol, strategyKey) {
  const key = `current:orderPair:${exchangeId}:${symbol}:${strategyKey}`;
  const data = await client.get(key);

  if (data) {
    return JSON.parse(data).pair;
  }

  return null;
}

// サマリーの更新
async function updateTradeSummary(trade) {
  const summaryKey = `summary:trade:${trade.exchangeId}:${trade.symbol}:${trade.strategy}`;
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
  } else if (side === 'sell') {
    // 売り注文の場合
    await client.hIncrByFloat(summaryKey, 'sellAmount', trade.amount);
    await client.hIncrByFloat(summaryKey, 'totalSellValue', trade.value);
    await client.hIncrByFloat(summaryKey, 'netPosition', -trade.amount);
    
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

// モジュールのエクスポートに新しい関数を追加
module.exports = {
  initialize,
  setCurrentOrderPair,
  getCurrentOrderPair,
  getTradeSummary,
  updateTradeSummary,
  saveStrategyParameters, // 追加
  getStrategyParameters,  // 追加
};


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