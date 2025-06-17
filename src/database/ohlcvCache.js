const NodeCache = require('node-cache');
const { timeframeToMs } = require('../common/utils');

/**
 * OHLCV データキャッシュマネージャー
 * メモリキャッシュ + Redis の階層化キャッシュシステム
 */
class OHLCVCacheManager {
  constructor(redisDatabase, options = {}) {
    this.redis = redisDatabase;
    
    // 設定
    this.config = {
      memoryTTL: options.memoryTTL || 300, // メモリキャッシュTTL（秒）
      maxMemoryKeys: options.maxMemoryKeys || 1000, // メモリキャッシュ最大キー数
      compressionThreshold: options.compressionThreshold || 1000, // 圧縮閾値
      ...options
    };
    
    // メモリキャッシュ（Node.js プロセス内）
    this.memoryCache = new NodeCache({
      stdTTL: this.config.memoryTTL,
      maxKeys: this.config.maxMemoryKeys,
      deleteOnExpire: true,
      checkperiod: 60 // 1分ごとに期限切れをチェック
    });
    
    // キャッシュ統計
    this.stats = {
      memoryHits: 0,
      redisHits: 0,
      misses: 0,
      sets: 0,
      evictions: 0
    };
    
    // メモリキャッシュのイベントリスナー
    this.memoryCache.on('expired', (key, value) => {
      this.stats.evictions++;
      console.log(`[OHLCVCache] メモリキャッシュ期限切れ: ${key}`);
    });
    
    this.memoryCache.on('del', (key, value) => {
      this.stats.evictions++;
    });
    
    // 定期最適化の開始
    this.startMaintenanceTasks();
  }
  
  /**
   * OHLCVデータを取得（階層化キャッシュ）
   * @param {string} exchangeId - 取引所ID
   * @param {string} symbol - 通貨ペア
   * @param {string} timeframe - タイムフレーム
   * @param {number} limit - データ数制限
   * @param {Object} options - オプション
   * @returns {Promise<Array|null>} キャッシュされたOHLCVデータまたはnull
   */
  async get(exchangeId, symbol, timeframe, limit = 100, options = {}) {
    const cacheKey = this.generateCacheKey(exchangeId, symbol, timeframe, limit, options);
    
    try {
      // 1. メモリキャッシュから取得を試行
      const memoryResult = this.memoryCache.get(cacheKey);
      if (memoryResult) {
        this.stats.memoryHits++;
        console.log(`[OHLCVCache] メモリヒット: ${cacheKey}`);
        return this.deserializeData(memoryResult);
      }
      
      // 2. Redisキャッシュから取得を試行
      const redisResult = await this.getFromRedis(exchangeId, symbol, timeframe, limit, options);
      if (redisResult && this.isValidCache(redisResult, timeframe, options)) {
        this.stats.redisHits++;
        console.log(`[OHLCVCache] Redisヒット: ${cacheKey}`);
        
        // メモリキャッシュに昇格
        this.setToMemory(cacheKey, redisResult.data);
        
        return redisResult.data;
      }
      
      // 3. キャッシュミス
      this.stats.misses++;
      return null;
      
    } catch (error) {
      console.error(`[OHLCVCache] キャッシュ取得エラー: ${cacheKey}`, error);
      this.stats.misses++;
      return null;
    }
  }
  
  /**
   * OHLCVデータを保存（階層化キャッシュ）
   * @param {string} exchangeId - 取引所ID
   * @param {string} symbol - 通貨ペア
   * @param {string} timeframe - タイムフレーム
   * @param {number} limit - データ数制限
   * @param {Array} data - OHLCVデータ
   * @param {Object} options - オプション
   */
  async set(exchangeId, symbol, timeframe, limit = 100, data, options = {}) {
    const cacheKey = this.generateCacheKey(exchangeId, symbol, timeframe, limit, options);
    
    try {
      // 1. メモリキャッシュに保存
      this.setToMemory(cacheKey, data);
      
      // 2. Redisキャッシュに保存
      await this.setToRedis(exchangeId, symbol, timeframe, limit, data, options);
      
      this.stats.sets++;
      console.log(`[OHLCVCache] キャッシュ保存: ${cacheKey} (${data.length}件)`);
      
    } catch (error) {
      console.error(`[OHLCVCache] キャッシュ保存エラー: ${cacheKey}`, error);
    }
  }
  
  /**
   * キャッシュキーを生成
   */
  generateCacheKey(exchangeId, symbol, timeframe, limit, options = {}) {
    const backtest = options.backtest ? 'bt' : 'rt';
    const since = options.since ? `:${options.since}` : '';
    return `ohlcv:${exchangeId}:${symbol}:${timeframe}:${limit}:${backtest}${since}`;
  }
  
  /**
   * メモリキャッシュに保存
   */
  setToMemory(key, data) {
    const serializedData = this.serializeData(data);
    this.memoryCache.set(key, serializedData);
  }
  
  /**
   * Redisキャッシュから取得
   */
  async getFromRedis(exchangeId, symbol, timeframe, limit, options = {}) {
    try {
      if (options.backtest) {
        // バックテスト用の専用ロジック
        return await this.getBacktestDataFromRedis(exchangeId, symbol, timeframe, limit, options);
      }
      
      // 通常のRedisキャッシュから取得
      const redisKey = `ohlcv_cache:${exchangeId}:${symbol}:${timeframe}`;
      const cached = await this.redis.getOHLCVRedis(exchangeId, symbol, timeframe);
      const timestamp = await this.redis.getOHLCVRedisTimestamp(exchangeId, symbol, timeframe);
      
      if (cached && cached.length > 0) {
        // limitに応じてデータを調整
        const adjustedData = this.adjustDataForLimit(cached, limit);
        
        return {
          data: adjustedData,
          timestamp: timestamp,
          source: 'redis'
        };
      }
      
      return null;
      
    } catch (error) {
      console.error(`[OHLCVCache] Redis取得エラー:`, error);
      return null;
    }
  }
  
  /**
   * バックテスト用データをRedisから取得
   */
  async getBacktestDataFromRedis(exchangeId, symbol, timeframe, limit, options) {
    try {
      const targetTimestamp = options.backtest?.timestamp || Date.now();
      
      // バックテスト用のソートされたセットから取得
      const data = await this.redis.getBacktestOHLCVRedisBeforeTimestamp(
        exchangeId, symbol, timeframe, targetTimestamp, limit
      );
      
      if (data && data.length > 0) {
        return {
          data: data,
          timestamp: targetTimestamp,
          source: 'redis_backtest'
        };
      }
      
      return null;
      
    } catch (error) {
      console.error(`[OHLCVCache] バックテストRedis取得エラー:`, error);
      return null;
    }
  }
  
  /**
   * Redisキャッシュに保存
   */
  async setToRedis(exchangeId, symbol, timeframe, limit, data, options = {}) {
    try {
      if (options.backtest) {
        // バックテスト用の保存は専用ロジックを使用
        return await this.setBacktestDataToRedis(exchangeId, symbol, timeframe, data, options);
      }
      
      // 通常のRedisキャッシュに保存
      await this.redis.updateOHLCVRedis(exchangeId, symbol, timeframe, data, Date.now());
      
    } catch (error) {
      console.error(`[OHLCVCache] Redis保存エラー:`, error);
    }
  }
  
  /**
   * バックテスト用データをRedisに保存
   */
  async setBacktestDataToRedis(exchangeId, symbol, timeframe, data, options) {
    try {
      // バックテスト用のソートされたセットに保存
      for (const ohlcv of data) {
        await this.redis.updateBacktestOHLCVRedisSortedSet(
          exchangeId, symbol, timeframe, ohlcv
        );
      }
      
    } catch (error) {
      console.error(`[OHLCVCache] バックテストRedis保存エラー:`, error);
    }
  }
  
  /**
   * limitに応じてデータを調整
   */
  adjustDataForLimit(data, limit) {
    if (!data || data.length === 0) return data;
    
    // limitより多いデータがある場合、最新のlimit分を返す
    if (data.length > limit) {
      return data.slice(-limit);
    }
    
    return data;
  }
  
  /**
   * キャッシュの有効性をチェック
   */
  isValidCache(cachedResult, timeframe, options = {}) {
    if (!cachedResult || !cachedResult.timestamp) {
      return false;
    }
    
    // バックテストモードでは常に有効とする
    if (options.backtest) {
      return true;
    }
    
    // 強制更新フラグがある場合は無効
    if (options.forceUpdate) {
      return false;
    }
    
    // タイムフレームに応じたTTLチェック
    const now = Date.now();
    const timeframeMs = timeframeToMs(timeframe);
    const age = now - cachedResult.timestamp;
    
    // タイムフレームの半分の時間が経過していたら期限切れとする
    const ttl = timeframeMs / 2;
    
    return age < ttl;
  }
  
  /**
   * データをシリアライズ（メモリ効率化）
   */
  serializeData(data) {
    if (!data || data.length === 0) return data;
    
    // 大きなデータは圧縮を検討（ここでは簡単な実装）
    if (data.length > this.config.compressionThreshold) {
      // JSON圧縮やgzipを使用する場合はここで実装
      return JSON.stringify(data);
    }
    
    return data;
  }
  
  /**
   * データをデシリアライズ
   */
  deserializeData(data) {
    if (typeof data === 'string') {
      try {
        return JSON.parse(data);
      } catch (error) {
        console.error('[OHLCVCache] デシリアライズエラー:', error);
        return null;
      }
    }
    
    return data;
  }
  
  /**
   * 特定のキャッシュを無効化
   */
  async invalidate(exchangeId, symbol, timeframe, options = {}) {
    const patterns = [
      this.generateCacheKey(exchangeId, symbol, timeframe, '*', options),
      `ohlcv:${exchangeId}:${symbol}:${timeframe}:*`,
    ];
    
    // メモリキャッシュから削除
    for (const pattern of patterns) {
      const keys = this.memoryCache.keys().filter(key => 
        key.startsWith(pattern.replace('*', ''))
      );
      for (const key of keys) {
        this.memoryCache.del(key);
      }
    }
    
    console.log(`[OHLCVCache] キャッシュ無効化: ${exchangeId}:${symbol}:${timeframe}`);
  }
  
  /**
   * 全キャッシュをクリア
   */
  async clearAll() {
    this.memoryCache.flushAll();
    console.log('[OHLCVCache] 全キャッシュをクリア');
  }
  
  /**
   * キャッシュ統計を取得
   */
  getStats() {
    const memoryStats = this.memoryCache.getStats();
    
    return {
      ...this.stats,
      memory: {
        keys: memoryStats.keys,
        hits: memoryStats.hits,
        misses: memoryStats.misses,
        ksize: memoryStats.ksize,
        vsize: memoryStats.vsize
      },
      hitRate: {
        memory: this.stats.memoryHits / (this.stats.memoryHits + this.stats.redisHits + this.stats.misses) * 100,
        redis: this.stats.redisHits / (this.stats.memoryHits + this.stats.redisHits + this.stats.misses) * 100,
        overall: (this.stats.memoryHits + this.stats.redisHits) / (this.stats.memoryHits + this.stats.redisHits + this.stats.misses) * 100
      }
    };
  }
  
  /**
   * 定期メンテナンスタスクを開始
   */
  startMaintenanceTasks() {
    // キャッシュ最適化（5分ごと）
    this.optimizeInterval = setInterval(() => {
      this.optimize();
    }, 5 * 60 * 1000);
    
    // 統計リセット（1時間ごと）
    this.statsResetInterval = setInterval(() => {
      this.resetStats();
    }, 60 * 60 * 1000);
  }
  
  /**
   * 統計情報をリセット（メモリリーク防止）
   */
  resetStats() {
    const oldStats = { ...this.stats };
    
    // 累積統計をログ出力
    console.log(`[OHLCVCache] 1時間の統計: `, oldStats);
    
    // 統計をリセット
    this.stats = {
      memoryHits: 0,
      redisHits: 0,
      misses: 0,
      sets: 0,
      evictions: 0
    };
  }
  
  /**
   * キャッシュサイズを最適化
   */
  async optimize() {
    // メモリキャッシュの統計を確認
    const stats = this.memoryCache.getStats();
    
    console.log(`[OHLCVCache] 最適化チェック: Keys:${stats.keys}/${this.config.maxMemoryKeys}, Memory:${(stats.vsize/1024/1024).toFixed(2)}MB`);
    
    if (stats.keys > this.config.maxMemoryKeys * 0.9) {
      // キャッシュが90%以上埋まっている場合、古いエントリを削除
      const keys = this.memoryCache.keys();
      const keysToDelete = keys.slice(0, Math.floor(keys.length * 0.2)); // 20%削除
      
      for (const key of keysToDelete) {
        this.memoryCache.del(key);
      }
      
      console.log(`[OHLCVCache] キャッシュ最適化: ${keysToDelete.length}件削除`);
    }
    
    // ガベージコレクションの実行を促す
    if (global.gc && stats.vsize > 50 * 1024 * 1024) { // 50MB以上の場合
      console.log(`[OHLCVCache] ガベージコレクション実行`);
      global.gc();
    }
  }
  
  /**
   * キャッシュマネージャーを停止してリソースを解放
   */
  destroy() {
    // 定期タスクを停止
    if (this.optimizeInterval) {
      clearInterval(this.optimizeInterval);
    }
    if (this.statsResetInterval) {
      clearInterval(this.statsResetInterval);
    }
    
    // メモリキャッシュをクリア
    this.memoryCache.flushAll();
    
    console.log('[OHLCVCache] キャッシュマネージャーを停止しました');
  }
}

// シングルトンインスタンス
let globalCacheManager = null;

/**
 * グローバルOHLCVキャッシュマネージャーを取得
 */
function getOHLCVCacheManager(redisDatabase, options = {}) {
  if (!globalCacheManager) {
    globalCacheManager = new OHLCVCacheManager(redisDatabase, options);
  }
  return globalCacheManager;
}

/**
 * グローバルキャッシュマネージャーをリセット（テスト用）
 */
function resetOHLCVCacheManager() {
  if (globalCacheManager) {
    globalCacheManager.destroy(); // 適切なリソース解放
    globalCacheManager = null;
  }
}

module.exports = {
  OHLCVCacheManager,
  getOHLCVCacheManager,
  resetOHLCVCacheManager
};