/**
 * データキャッシング機構
 * パフォーマンス最適化のためのメモリキャッシュシステム
 */

class DataCache {
  constructor(defaultTTL = 60000) { // デフォルト1分
    this.cache = new Map();
    this.pendingFetches = new Map(); // 進行中のフェッチを追跡
    this.defaultTTL = defaultTTL;
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      invalidations: 0
    };
  }
  
  /**
   * キャッシュからデータを取得または新規取得
   * @param {string} key - キャッシュキー
   * @param {Function} fetchFunction - データ取得関数
   * @param {number} ttl - TTL（ミリ秒）
   * @returns {Promise<any>} - データ
   */
  async get(key, fetchFunction, ttl = this.defaultTTL) {
    const cached = this.cache.get(key);
    
    // キャッシュヒット && 有効期限内
    if (cached && Date.now() - cached.timestamp < cached.ttl) {
      this.stats.hits++;
      return cached.data;
    }
    
    // 進行中のフェッチがあるかチェック
    if (this.pendingFetches.has(key)) {
      this.stats.hits++; // 同じキーの並行リクエストもヒットとして扱う
      return this.pendingFetches.get(key);
    }
    
    // キャッシュミス - 新規取得
    this.stats.misses++;
    
    const fetchPromise = (async () => {
      try {
        const data = await fetchFunction();
        this.set(key, data, ttl);
        return data;
      } catch (error) {
        // エラー時は期限切れキャッシュがあれば返す
        if (cached) {
          return cached.data;
        }
        throw error;
      } finally {
        // フェッチ完了後は進行中リストから削除
        this.pendingFetches.delete(key);
      }
    })();
    
    // 進行中フェッチとして登録
    this.pendingFetches.set(key, fetchPromise);
    
    return fetchPromise;
  }
  
  /**
   * キャッシュにデータを設定
   * @param {string} key - キャッシュキー
   * @param {any} data - データ
   * @param {number} ttl - TTL（ミリ秒）
   */
  set(key, data, ttl = this.defaultTTL) {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    });
    this.stats.sets++;
  }
  
  /**
   * キャッシュを無効化
   * @param {string} key - キャッシュキー
   */
  invalidate(key) {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.stats.invalidations++;
    }
    return deleted;
  }
  
  /**
   * パターンに一致するキーを無効化
   * @param {RegExp|string} pattern - パターン
   */
  invalidatePattern(pattern) {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    let count = 0;
    
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }
    
    this.stats.invalidations += count;
    return count;
  }
  
  /**
   * 全キャッシュをクリア
   */
  clear() {
    const size = this.cache.size;
    this.cache.clear();
    this.pendingFetches.clear();
    this.stats.invalidations += size;
  }
  
  /**
   * 期限切れエントリを削除
   */
  cleanup() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp >= entry.ttl) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    
    return cleaned;
  }
  
  /**
   * キャッシュ統計を取得
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      size: this.cache.size,
      hitRate: total > 0 ? (this.stats.hits / total * 100).toFixed(2) + '%' : '0%'
    };
  }
  
  /**
   * 統計をリセット
   */
  resetStats() {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      invalidations: 0
    };
  }
}

/**
 * 戦略別キャッシュ管理
 */
class StrategyCache {
  constructor() {
    this.configCache = new DataCache(300000); // 5分
    this.orderBookCache = new DataCache(1000); // 1秒
    this.tickerCache = new DataCache(30000); // 30秒
    this.marketDataCache = new DataCache(60000); // 1分
  }
  
  /**
   * 戦略設定を取得（キャッシュ付き）
   */
  async getStrategyConfig(exchange, symbol, strategyKey, config, fetchFunction) {
    const key = `strategy_config:${exchange.id}:${symbol}:${strategyKey}`;
    return this.configCache.get(key, fetchFunction);
  }
  
  /**
   * 注文ブックを取得（キャッシュ付き）
   */
  async getOrderBook(exchange, symbol, depth, fetchFunction) {
    const key = `orderbook:${exchange.id}:${symbol}:${depth}`;
    return this.orderBookCache.get(key, fetchFunction);
  }
  
  /**
   * ティッカーを取得（キャッシュ付き）
   */
  async getTicker(exchange, symbol, fetchFunction) {
    const key = `ticker:${exchange.id}:${symbol}`;
    return this.tickerCache.get(key, fetchFunction);
  }
  
  /**
   * 市場データを取得（キャッシュ付き）
   */
  async getMarketData(exchange, symbol, dataType, fetchFunction) {
    const key = `market_data:${exchange.id}:${symbol}:${dataType}`;
    return this.marketDataCache.get(key, fetchFunction);
  }
  
  /**
   * 戦略関連のキャッシュを無効化
   */
  invalidateStrategy(exchange, symbol, strategyKey) {
    const patterns = [
      `strategy_config:${exchange.id}:${symbol}:${strategyKey}`,
      `orderbook:${exchange.id}:${symbol}:`,
      `ticker:${exchange.id}:${symbol}`,
      `market_data:${exchange.id}:${symbol}:`
    ];
    
    patterns.forEach(pattern => {
      this.configCache.invalidatePattern(pattern);
      this.orderBookCache.invalidatePattern(pattern);
      this.tickerCache.invalidatePattern(pattern);
      this.marketDataCache.invalidatePattern(pattern);
    });
  }
  
  /**
   * 全体統計を取得
   */
  getStats() {
    return {
      configCache: this.configCache.getStats(),
      orderBookCache: this.orderBookCache.getStats(),
      tickerCache: this.tickerCache.getStats(),
      marketDataCache: this.marketDataCache.getStats()
    };
  }
  
  /**
   * 定期クリーンアップ
   */
  cleanup() {
    return {
      config: this.configCache.cleanup(),
      orderBook: this.orderBookCache.cleanup(),
      ticker: this.tickerCache.cleanup(),
      marketData: this.marketDataCache.cleanup()
    };
  }
}

// グローバルインスタンス
const globalStrategyCache = new StrategyCache();

// 定期クリーンアップ（5分ごと）
setInterval(() => {
  const cleaned = globalStrategyCache.cleanup();
  const totalCleaned = Object.values(cleaned).reduce((sum, count) => sum + count, 0);
  if (totalCleaned > 0) {
    console.log(`Cache cleanup: removed ${totalCleaned} expired entries`);
  }
}, 300000);

// メモリ使用量監視（1分ごと）
setInterval(() => {
  const memUsage = process.memoryUsage();
  const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
  const heapTotalMB = memUsage.heapTotal / 1024 / 1024;
  
  console.log(`Memory usage: ${heapUsedMB.toFixed(1)}MB / ${heapTotalMB.toFixed(1)}MB`);
  
  // 500MB以上使用している場合は強制クリーンアップ
  if (memUsage.heapUsed > 500 * 1024 * 1024) {
    console.warn('High memory usage detected, forcing cache cleanup');
    const cleaned = globalStrategyCache.cleanup();
    const totalCleaned = Object.values(cleaned).reduce((sum, count) => sum + count, 0);
    console.log(`Emergency cleanup: removed ${totalCleaned} entries`);
    
    // それでもメモリが多い場合はキャッシュをクリア
    if (process.memoryUsage().heapUsed > 400 * 1024 * 1024) {
      console.warn('Critical memory usage, clearing all caches');
      globalStrategyCache.clear();
    }
  }
}, 60000);

module.exports = {
  DataCache,
  StrategyCache,
  globalStrategyCache
};