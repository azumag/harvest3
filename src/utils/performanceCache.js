/**
 * パフォーマンス向上のためのキャッシュマネージャー
 * ループ処理での重複データ取得を最適化
 */
const NodeCache = require('node-cache');

// キャッシュインスタンス
// strategyConfig: 戦略設定用キャッシュ（TTL: 30秒）
// orderBook: 注文ブック用キャッシュ（TTL: 1秒）
const strategyConfigCache = new NodeCache({ stdTTL: 30, checkperiod: 10 });
const orderBookCache = new NodeCache({ stdTTL: 1, checkperiod: 1 });

/**
 * 戦略設定のキャッシュキーを生成
 * @param {string} exchangeId - 取引所ID
 * @param {string} symbol - 通貨ペア
 * @param {string} strategyKey - 戦略キー
 * @returns {string} キャッシュキー
 */
function getStrategyConfigCacheKey(exchangeId, symbol, strategyKey) {
  return `strategy_${exchangeId}_${symbol}_${strategyKey}`;
}

/**
 * 注文ブックのキャッシュキーを生成
 * @param {string} exchangeId - 取引所ID
 * @param {string} symbol - 通貨ペア
 * @param {number} depth - 注文ブックの深度
 * @returns {string} キャッシュキー
 */
function getOrderBookCacheKey(exchangeId, symbol, depth) {
  return `orderbook_${exchangeId}_${symbol}_${depth}`;
}

/**
 * 戦略設定をキャッシュから取得、なければ提供された関数で取得してキャッシュ
 * @param {string} exchangeId - 取引所ID
 * @param {string} symbol - 通貨ペア
 * @param {string} strategyKey - 戦略キー
 * @param {Function} fetchFunction - データ取得関数
 * @returns {Promise<Object|null>} 戦略設定
 */
async function getCachedStrategyConfig(exchangeId, symbol, strategyKey, fetchFunction) {
  const cacheKey = getStrategyConfigCacheKey(exchangeId, symbol, strategyKey);

  // キャッシュから取得を試行
  let config = strategyConfigCache.get(cacheKey);

  if (config === undefined) {
    // キャッシュにない場合は取得してキャッシュ
    config = await fetchFunction();
    if (config !== null) {
      strategyConfigCache.set(cacheKey, config);
    }
  }

  return config;
}

/**
 * 注文ブックをキャッシュから取得、なければ提供された関数で取得してキャッシュ
 * @param {string} exchangeId - 取引所ID
 * @param {string} symbol - 通貨ペア
 * @param {number} depth - 注文ブックの深度
 * @param {Function} fetchFunction - データ取得関数
 * @returns {Promise<Object|null>} 注文ブック
 */
async function getCachedOrderBook(exchangeId, symbol, depth, fetchFunction) {
  const cacheKey = getOrderBookCacheKey(exchangeId, symbol, depth);

  // キャッシュから取得を試行
  let orderBook = orderBookCache.get(cacheKey);

  if (orderBook === undefined) {
    // キャッシュにない場合は取得してキャッシュ
    orderBook = await fetchFunction();
    if (orderBook !== null) {
      orderBookCache.set(cacheKey, orderBook);
    }
  }

  return orderBook;
}

/**
 * 戦略設定キャッシュをクリア
 * @param {string} exchangeId - 取引所ID（オプション）
 * @param {string} symbol - 通貨ペア（オプション）
 * @param {string} strategyKey - 戦略キー（オプション）
 */
function clearStrategyConfigCache(exchangeId = null, symbol = null, strategyKey = null) {
  if (exchangeId && symbol && strategyKey) {
    // 特定のキーをクリア
    const cacheKey = getStrategyConfigCacheKey(exchangeId, symbol, strategyKey);
    strategyConfigCache.del(cacheKey);
  } else {
    // 全キャッシュをクリア
    strategyConfigCache.flushAll();
  }
}

/**
 * 注文ブックキャッシュをクリア
 * @param {string} exchangeId - 取引所ID（オプション）
 * @param {string} symbol - 通貨ペア（オプション）
 */
function clearOrderBookCache(exchangeId = null, symbol = null) {
  if (exchangeId && symbol) {
    // 特定の取引所とシンボルのキーをクリア
    const keys = orderBookCache.keys();
    const targetKeys = keys.filter(key =>
      key.startsWith(`orderbook_${exchangeId}_${symbol}_`)
    );
    orderBookCache.del(targetKeys);
  } else {
    // 全キャッシュをクリア
    orderBookCache.flushAll();
  }
}

/**
 * キャッシュ統計情報を取得
 * @returns {Object} キャッシュ統計
 */
function getCacheStats() {
  return {
    strategyConfig: {
      keys: strategyConfigCache.keys().length,
      hits: strategyConfigCache.getStats().hits,
      misses: strategyConfigCache.getStats().misses
    },
    orderBook: {
      keys: orderBookCache.keys().length,
      hits: orderBookCache.getStats().hits,
      misses: orderBookCache.getStats().misses
    }
  };
}

module.exports = {
  getCachedStrategyConfig,
  getCachedOrderBook,
  clearStrategyConfigCache,
  clearOrderBookCache,
  getCacheStats
};