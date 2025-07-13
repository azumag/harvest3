const Logger = require('../hft/utils/Logger');
const logger = new Logger({ service: 'APIDataCache' });

class APIDataCache {
  constructor() {
    this.cache = new Map();
    this.requestQueue = [];
    this.processingQueue = false;
    this.maxCacheAge = 5 * 60 * 1000; // 5分間
    this.requestDelay = 1500; // リクエスト間隔 1.5秒
    this.stats = {
      hits: 0,
      misses: 0,
      requests: 0
    };
  }

  createCacheKey(exchangeId, method, symbol, params = {}) {
    const paramString = Object.keys(params).length > 0 ? JSON.stringify(params) : '';
    return `${exchangeId}:${method}:${symbol}:${paramString}`;
  }

  isExpired(cachedData) {
    return Date.now() - cachedData.timestamp > this.maxCacheAge;
  }

  getFromCache(exchangeId, method, symbol, params = {}) {
    const key = this.createCacheKey(exchangeId, method, symbol, params);
    const cachedData = this.cache.get(key);

    if (cachedData && !this.isExpired(cachedData)) {
      this.stats.hits++;
      logger.debug(`[APIキャッシュ] ヒット: ${key}`);
      return cachedData.data;
    }

    if (cachedData && this.isExpired(cachedData)) {
      this.cache.delete(key);
      logger.debug(`[APIキャッシュ] 期限切れ削除: ${key}`);
    }

    this.stats.misses++;
    return null;
  }

  setCache(exchangeId, method, symbol, data, params = {}) {
    const key = this.createCacheKey(exchangeId, method, symbol, params);
    this.cache.set(key, {
      data: data,
      timestamp: Date.now()
    });
    logger.debug(`[APIキャッシュ] 保存: ${key}`);
  }

  async queueRequest(exchangeInstance, method, symbol, params = {}) {
    const key = this.createCacheKey(exchangeInstance.id, method, symbol, params);
    
    const cachedData = this.getFromCache(exchangeInstance.id, method, symbol, params);
    if (cachedData) {
      return cachedData;
    }

    return new Promise((resolve, reject) => {
      this.requestQueue.push({
        exchangeInstance,
        method,
        symbol,
        params,
        key,
        resolve,
        reject
      });

      if (!this.processingQueue) {
        this.processQueue();
      }
    });
  }

  async processQueue() {
    if (this.processingQueue || this.requestQueue.length === 0) {
      return;
    }

    this.processingQueue = true;
    logger.info(`[APIキャッシュ] キュー処理開始: ${this.requestQueue.length}件`);

    while (this.requestQueue.length > 0) {
      const request = this.requestQueue.shift();
      const { exchangeInstance, method, symbol, params, key, resolve, reject } = request;

      const cachedData = this.getFromCache(exchangeInstance.id, method, symbol, params);
      if (cachedData) {
        logger.debug(`[APIキャッシュ] キュー処理中にヒット: ${key}`);
        resolve(cachedData);
        continue;
      }

      try {
        logger.debug(`[APIキャッシュ] API呼び出し実行: ${key}`);
        this.stats.requests++;

        let data;
        switch (method) {
          case 'fetchTicker':
            data = await exchangeInstance.fetchTicker(symbol);
            break;
          case 'fetchOHLCV':
            data = await exchangeInstance.fetchOHLCV(symbol, params.timeframe, params.since, params.limit);
            break;
          case 'fetchBalance':
            data = await exchangeInstance.fetchBalance();
            break;
          default:
            throw new Error(`未対応のメソッド: ${method}`);
        }

        this.setCache(exchangeInstance.id, method, symbol, data, params);
        resolve(data);

        if (this.requestQueue.length > 0) {
          logger.debug(`[APIキャッシュ] 次のリクエストまで${this.requestDelay}ms待機`);
          await new Promise(resolve => setTimeout(resolve, this.requestDelay));
        }

      } catch (error) {
        logger.error(`[APIキャッシュ] API呼び出し失敗: ${key} - ${error.message}`);
        reject(error);
      }
    }

    this.processingQueue = false;
    logger.info('[APIキャッシュ] キュー処理完了');
  }

  clearExpiredCache() {
    const beforeSize = this.cache.size;
    for (const [key, cachedData] of this.cache.entries()) {
      if (this.isExpired(cachedData)) {
        this.cache.delete(key);
      }
    }
    const afterSize = this.cache.size;
    if (beforeSize !== afterSize) {
      logger.debug(`[APIキャッシュ] 期限切れ削除: ${beforeSize - afterSize}件`);
    }
  }

  getStats() {
    const hitRate = this.stats.hits + this.stats.misses > 0 
      ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(1)
      : 0;
    
    return {
      ...this.stats,
      hitRate: `${hitRate}%`,
      cacheSize: this.cache.size,
      queueSize: this.requestQueue.length
    };
  }

  clearStats() {
    this.stats = { hits: 0, misses: 0, requests: 0 };
  }
}

const globalAPIDataCache = new APIDataCache();

setInterval(() => {
  globalAPIDataCache.clearExpiredCache();
}, 60000);

module.exports = {
  APIDataCache,
  globalAPIDataCache
};