const Logger = require('../hft/utils/Logger');
const { API_CACHE_SETTINGS } = require('../config/settings');
const logger = new Logger({ service: 'APIDataCache' });

class APIDataCache {
  constructor(options = {}) {
    this.cache = new Map();
    this.requestQueue = [];
    this.processingQueue = false;
    this.maxCacheAge = options.maxCacheAge || API_CACHE_SETTINGS.MAX_CACHE_AGE; // 設定ファイルから取得
    this.requestDelay = options.requestDelay || API_CACHE_SETTINGS.REQUEST_DELAY; // 設定ファイルから取得
    this.cleanupInterval = options.cleanupInterval || API_CACHE_SETTINGS.CLEANUP_INTERVAL; // 設定ファイルから取得
    this.cleanupIntervalId = null;
    this.maxRetries = options.maxRetries || 3; // デフォルトで3回再試行
    this.baseRetryDelay = options.baseRetryDelay || 1000; // 基本再試行間隔（1秒）
    this.stats = {
      hits: 0,
      misses: 0,
      requests: 0,
      retries: 0,
      fallbacks: 0
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

  // 期限切れチェックのみ、削除は行わない（フォールバック用）
  getFromCacheWithoutExpiry(exchangeId, method, symbol, params = {}) {
    const key = this.createCacheKey(exchangeId, method, symbol, params);
    const cachedData = this.cache.get(key);

    if (cachedData && !this.isExpired(cachedData)) {
      this.stats.hits++;
      logger.debug(`[APIキャッシュ] ヒット: ${key}`);
      return cachedData.data;
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
    
    const cachedData = this.getFromCacheWithoutExpiry(exchangeInstance.id, method, symbol, params);
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

      const cachedData = this.getFromCacheWithoutExpiry(exchangeInstance.id, method, symbol, params);
      if (cachedData) {
        logger.debug(`[APIキャッシュ] キュー処理中にヒット: ${key}`);
        resolve(cachedData);
        continue;
      }

      try {
        logger.debug(`[APIキャッシュ] API呼び出し実行: ${key}`);
        this.stats.requests++;

        const data = await this.executeAPICallWithRetry(exchangeInstance, method, symbol, params, key);
        this.setCache(exchangeInstance.id, method, symbol, data, params);
        resolve(data);

        if (this.requestQueue.length > 0) {
          logger.debug(`[APIキャッシュ] 次のリクエストまで${this.requestDelay}ms待機`);
          await new Promise(resolve => setTimeout(resolve, this.requestDelay));
        }

      } catch (error) {
        logger.error(`[APIキャッシュ] API呼び出し失敗: ${key} - ${error.message}`);
        
        // 古いキャッシュデータがある場合はフォールバック
        const fallbackData = this.getFallbackData(exchangeInstance.id, method, symbol, params);
        if (fallbackData) {
          logger.warn(`[APIキャッシュ] フォールバック: ${key} - 古いキャッシュデータを使用`);
          resolve(fallbackData);
        } else {
          reject(error);
        }
      }
    }

    this.processingQueue = false;
    logger.info('[APIキャッシュ] キュー処理完了');
  }

  async executeAPICallWithRetry(exchangeInstance, method, symbol, params, key) {
    let lastError;
    
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = this.baseRetryDelay * Math.pow(2, attempt - 1); // 指数バックオフ
          logger.info(`[APIキャッシュ] 再試行 ${attempt}/${this.maxRetries}: ${key} - ${delay}ms後`);
          await new Promise(resolve => setTimeout(resolve, delay));
          this.stats.retries++;
        }

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

        if (attempt > 0) {
          logger.info(`[APIキャッシュ] 再試行成功: ${key} - ${attempt}回目で成功`);
        }
        
        return data;

      } catch (error) {
        lastError = error;
        
        // 一時的なエラーかどうかを判定
        if (!this.isRetryableError(error)) {
          logger.error(`[APIキャッシュ] 再試行不可能なエラー: ${key} - ${error.message}`);
          throw error;
        }

        if (attempt === this.maxRetries) {
          logger.error(`[APIキャッシュ] 最大再試行回数に達しました: ${key} - ${error.message}`);
          throw error;
        }

        logger.warn(`[APIキャッシュ] 再試行可能なエラー: ${key} - ${error.message}`);
      }
    }

    throw lastError;
  }

  isRetryableError(error) {
    // 再試行可能なエラーの判定
    const retryableMessages = [
      'fetch failed',
      'ECONNRESET',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'Network Error',
      'Request timeout',
      'Rate limit',
      'Service Unavailable',
      'Bad Gateway',
      'Gateway Timeout'
    ];

    const errorMessage = error.message || '';
    return retryableMessages.some(msg => errorMessage.includes(msg));
  }

  getFallbackData(exchangeId, method, symbol, params = {}) {
    const key = this.createCacheKey(exchangeId, method, symbol, params);
    const cachedData = this.cache.get(key);
    
    // フォールバック用なので、期限切れでも使用可能
    if (cachedData) {
      const ageSeconds = Math.round((Date.now() - cachedData.timestamp) / 1000);
      logger.info(`[APIキャッシュ] フォールバック可能: ${key} - ${ageSeconds}秒前のデータ`);
      this.stats.fallbacks++;
      return cachedData.data;
    }
    
    return null;
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
    this.stats = { hits: 0, misses: 0, requests: 0, retries: 0, fallbacks: 0 };
  }

  startCleanupTimer() {
    if (this.cleanupIntervalId) {
      return; // すでに開始済み
    }
    this.cleanupIntervalId = setInterval(() => {
      this.clearExpiredCache();
    }, this.cleanupInterval);
    logger.debug(`[APIキャッシュ] クリーンアップタイマー開始: ${this.cleanupInterval}ms間隔`);
  }

  stopCleanupTimer() {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
      logger.debug('[APIキャッシュ] クリーンアップタイマー停止');
    }
  }

  destroy() {
    this.stopCleanupTimer();
    this.cache.clear();
    this.requestQueue = [];
    logger.debug('[APIキャッシュ] インスタンス破棄');
  }
}

const globalAPIDataCache = new APIDataCache();

// クリーンアップタイマーを開始
globalAPIDataCache.startCleanupTimer();

// プロセス終了時のクリーンアップ
process.on('exit', () => {
  globalAPIDataCache.destroy();
});

process.on('SIGINT', () => {
  globalAPIDataCache.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  globalAPIDataCache.destroy();
  process.exit(0);
});

module.exports = {
  APIDataCache,
  globalAPIDataCache
};