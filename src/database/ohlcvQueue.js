const EventEmitter = require('events');
const { fetchOHLCVDataAPI } = require('./exchangeAPI');
const { timeframeToMs } = require('../common/utils');
const { sleep } = require('../common/utils');
const { postErrorToDiscord } = require('../common/notifications');
const { recordError } = require('../api/controllers/errorStats');

/**
 * OHLCV データ取得リクエストキューシステム
 * バックテストとbotの同時実行時のAPIレート制限問題を解決
 */
class OHLCVRequestQueue extends EventEmitter {
  constructor(options = {}) {
    super();
    
    // 設定
    this.config = {
      maxConcurrentRequests: options.maxConcurrentRequests || 1, // 同時実行数
      rateLimitMs: options.rateLimitMs || 1000, // APIレート制限間隔
      retryAttempts: options.retryAttempts || 3, // リトライ回数
      retryDelayMs: options.retryDelayMs || 2000, // リトライ間隔
      queueTimeout: options.queueTimeout || 30000, // キュータイムアウト
      ...options
    };
    
    // キューとリクエスト管理
    this.queues = {
      high: [], // bot（リアルタイム）
      medium: [], // 定期更新
      low: [] // バックテスト
    };
    
    this.activeRequests = new Map(); // 実行中リクエスト
    this.requestHistory = new Map(); // リクエスト履歴（重複排除用）
    this.timeoutHandlers = new Map(); // タイムアウトハンドラー管理
    this.lastRequestTime = 0; // 最後のAPI実行時刻
    this.isProcessing = false; // 処理中フラグ
    
    // 定期クリーンアップの開始
    this.startCleanupTasks();
    
    // 統計情報
    this.stats = {
      totalRequests: 0,
      successCount: 0,
      errorCount: 0,
      cacheHits: 0,
      duplicateRequests: 0,
      averageWaitTime: 0
    };
    
    // 定期処理開始
    this.startProcessing();
  }
  
  /**
   * OHLCVデータ取得リクエストをキューに追加
   * @param {Object} exchange - 取引所インスタンス
   * @param {string} symbol - 通貨ペア
   * @param {string} timeframe - タイムフレーム
   * @param {number} limit - データ数制限
   * @param {Object} options - オプション
   * @returns {Promise} データ取得結果
   */
  async requestOHLCV(exchange, symbol, timeframe, limit = 100, options = {}) {
    const requestId = this.generateRequestId(exchange.id, symbol, timeframe, limit, options);
    const priority = this.determinePriority(options);
    
    // 重複リクエストの確認
    if (this.isDuplicateRequest(requestId)) {
      this.stats.duplicateRequests++;
      if (process.env.BACKTEST_MODE !== 'true') {
        console.log(`[OHLCVQueue] 重複リクエストを検出: ${requestId}`);
      }
      return this.waitForExistingRequest(requestId);
    }
    
    // リクエストオブジェクト作成
    const request = {
      id: requestId,
      exchange,
      symbol,
      timeframe,
      limit,
      options,
      priority,
      timestamp: Date.now(),
      resolve: null,
      reject: null,
      retryCount: 0
    };
    
    // Promise作成
    const promise = new Promise((resolve, reject) => {
      request.resolve = resolve;
      request.reject = reject;
      
      // タイムアウト設定（適切な管理）
      const timeoutId = setTimeout(() => {
        this.removeRequest(requestId);
        reject(new Error(`Request timeout: ${requestId}`));
      }, this.config.queueTimeout);
      
      // タイムアウトハンドラーを記録
      this.timeoutHandlers.set(requestId, timeoutId);
    });
    
    // キューに追加
    this.addToQueue(request);
    this.stats.totalRequests++;
    
    if (process.env.BACKTEST_MODE !== 'true') {
      console.log(`[OHLCVQueue] リクエストをキューに追加: ${requestId} (優先度: ${priority})`);
    }
    
    return promise;
  }
  
  /**
   * リクエストIDを生成
   */
  generateRequestId(exchangeId, symbol, timeframe, limit, options = {}) {
    const backtest = options.backtest ? 'bt' : 'rt';
    const force = options.forceUpdate ? 'force' : 'cache';
    return `${exchangeId}:${symbol}:${timeframe}:${limit}:${backtest}:${force}`;
  }
  
  /**
   * 優先度を決定
   */
  determinePriority(options = {}) {
    if (options.backtest) {
      return 'low'; // バックテスト
    }
    if (options.urgent) {
      return 'high'; // 緊急（リアルタイム取引）
    }
    return 'medium'; // 通常（定期更新）
  }
  
  /**
   * 重複リクエストかチェック
   */
  isDuplicateRequest(requestId) {
    return this.activeRequests.has(requestId) || 
           this.requestHistory.has(requestId);
  }
  
  /**
   * 既存リクエストの完了を待機
   */
  async waitForExistingRequest(requestId) {
    try {
      // アクティブリクエストの場合
      if (this.activeRequests.has(requestId)) {
        return new Promise((resolve, reject) => {
          // タイムアウト付きリスナー
          const timeoutId = setTimeout(() => {
            try {
              if (this.removeListener && typeof this.removeListener === 'function') {
                this.removeListener('requestComplete', wrappedHandler);
              }
            } catch (cleanupError) {
              console.error('[OHLCVQueue] リスナー削除エラー:', cleanupError);
            }
            reject(new Error(`Waiting for existing request timeout: ${requestId}`));
          }, this.config.queueTimeout);
          
          const wrappedHandler = (id, result, error) => {
            if (id === requestId) {
              clearTimeout(timeoutId);
              try {
                if (this.removeListener && typeof this.removeListener === 'function') {
                  this.removeListener('requestComplete', wrappedHandler); // 適切にリスナー削除
                }
              } catch (cleanupError) {
                console.error('[OHLCVQueue] リスナー削除エラー:', cleanupError);
              }
              if (error) reject(error);
              else resolve(result);
            }
          };
          
          this.on('requestComplete', wrappedHandler);
        });
      }
      
      // 履歴にある場合（キャッシュされたデータを返す）
      const historyItem = this.requestHistory.get(requestId);
      if (historyItem && historyItem.result) {
        this.stats.cacheHits++;
        return historyItem.result;
      }
      
      throw new Error(`No existing request found: ${requestId}`);
    } catch (error) {
      // waitForExistingRequestでのエラーをDiscordに通知
      const errorMessage = `OHLCV Queue waitForExistingRequest Error: ${requestId} - ${error.message}`;
      console.error(`[OHLCVQueue] waitForExistingRequest エラー: ${requestId}`, error);
      
      // エラーをDiscordに通知
      try {
        await postErrorToDiscord(errorMessage);
        recordError('ohlcv_queue_wait', errorMessage, error.stack);
      } catch (notificationError) {
        console.error('[OHLCVQueue] Discord通知エラー:', notificationError);
      }
      
      // 元のエラーを再スロー
      throw error;
    }
  }
  
  /**
   * キューにリクエストを追加
   */
  addToQueue(request) {
    const queue = this.queues[request.priority];
    
    // 優先度に応じてソート（高優先度は先頭、低優先度は末尾）
    if (request.priority === 'high') {
      queue.unshift(request);
    } else {
      queue.push(request);
    }
    
    this.activeRequests.set(request.id, request);
  }
  
  /**
   * キュー処理を開始
   */
  startProcessing() {
    if (this.isProcessing) return;
    
    this.isProcessing = true;
    this.processQueue();
  }
  
  /**
   * キュー処理メインループ
   */
  async processQueue() {
    while (this.isProcessing) {
      try {
        await this.processNextRequest();
        await sleep(100); // 短い間隔でチェック
      } catch (error) {
        console.error('[OHLCVQueue] キュー処理エラー:', error);
        await sleep(1000); // エラー時は長めに待機
      }
    }
  }
  
  /**
   * 次のリクエストを処理
   */
  async processNextRequest() {
    // レート制限チェック
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.config.rateLimitMs) {
      await sleep(this.config.rateLimitMs - timeSinceLastRequest);
    }
    
    // 優先度順でリクエストを取得
    const request = this.getNextRequest();
    if (!request) {
      return;
    }
    
    const startTime = Date.now();
    
    try {
      if (process.env.BACKTEST_MODE !== 'true') {
        console.log(`[OHLCVQueue] リクエスト処理開始: ${request.id}`);
      }
      
      // API呼び出し
      const result = await fetchOHLCVDataAPI(
        request.exchange,
        request.symbol,
        request.timeframe,
        request.limit
      );
      
      this.lastRequestTime = Date.now();
      
      // 成功処理
      const waitTime = this.lastRequestTime - startTime;
      this.updateStats(true, waitTime);
      
      this.completeRequest(request, result);
      this.addToHistory(request, result);
      
      if (process.env.BACKTEST_MODE !== 'true') {
        console.log(`[OHLCVQueue] リクエスト完了: ${request.id} (${result.length}件, ${waitTime}ms)`);
      }
      
    } catch (error) {
      console.error(`[OHLCVQueue] リクエストエラー: ${request.id}`, error);
      
      // 重要なAPIエラーはDiscordに通知
      if (request.retryCount === 0) { // 初回のエラーのみ通知（スパム防止）
        const errorMessage = `OHLCV Queue Error: ${request.exchange.id} ${request.symbol} ${request.timeframe} - ${error.message}`;
        recordError('ohlcv_queue', errorMessage, error.stack);
        try {
          await postErrorToDiscord(errorMessage);
        } catch (err) {
          console.error('Discord通知エラー:', err);
        }
      }
      
      // リトライ処理
      if (request.retryCount < this.config.retryAttempts) {
        request.retryCount++;
        console.log(`[OHLCVQueue] リトライ ${request.retryCount}/${this.config.retryAttempts}: ${request.id}`);
        
        // 少し待ってからキューに戻す
        setTimeout(() => {
          this.addToQueue(request);
        }, this.config.retryDelayMs);
        
        return;
      }
      
      // 最終的に失敗
      const finalErrorMessage = `OHLCV Queue Final Failure: ${request.exchange.id} ${request.symbol} ${request.timeframe} - ${this.config.retryAttempts}回リトライしましたが失敗しました`;
      recordError('ohlcv_queue', finalErrorMessage, error.stack);
      try {
        await postErrorToDiscord(finalErrorMessage);
      } catch (err) {
        console.error('Discord通知エラー:', err);
      }
      
      this.updateStats(false);
      this.completeRequest(request, null, error);
    }
  }
  
  /**
   * 次のリクエストを取得（優先度順）
   */
  getNextRequest() {
    // high -> medium -> low の順でチェック
    for (const priority of ['high', 'medium', 'low']) {
      const queue = this.queues[priority];
      if (queue.length > 0) {
        const request = queue.shift();
        return request;
      }
    }
    return null;
  }
  
  /**
   * リクエスト完了処理
   */
  completeRequest(request, result, error = null) {
    this.activeRequests.delete(request.id);
    
    // タイムアウトハンドラーをクリア
    const timeoutId = this.timeoutHandlers.get(request.id);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.timeoutHandlers.delete(request.id);
    }
    
    if (error) {
      request.reject(error);
    } else {
      request.resolve(result);
    }
    
    // イベント発行
    this.emit('requestComplete', request.id, result, error);
  }
  
  /**
   * リクエスト履歴に追加（重複排除用）
   */
  addToHistory(request, result) {
    const historyItem = {
      timestamp: Date.now(),
      result: result,
      timeframe: request.timeframe
    };
    
    this.requestHistory.set(request.id, historyItem);
    
    // 履歴のクリーンアップ（古いエントリを削除）
    this.cleanupHistory();
  }
  
  /**
   * 古いリクエスト履歴をクリーンアップ
   */
  cleanupHistory() {
    const now = Date.now();
    const maxAge = 2 * 60 * 1000; // 2分（より短く）
    let cleanedCount = 0;
    
    for (const [key, item] of this.requestHistory.entries()) {
      if (now - item.timestamp > maxAge) {
        this.requestHistory.delete(key);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`[OHLCVQueue] 履歴クリーンアップ: ${cleanedCount}件削除`);
    }
  }
  
  /**
   * リクエストを削除
   */
  removeRequest(requestId) {
    this.activeRequests.delete(requestId);
    
    // タイムアウトハンドラーをクリア
    const timeoutId = this.timeoutHandlers.get(requestId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.timeoutHandlers.delete(requestId);
    }
    
    // 各キューから削除
    for (const queue of Object.values(this.queues)) {
      const index = queue.findIndex(req => req.id === requestId);
      if (index !== -1) {
        queue.splice(index, 1);
      }
    }
  }
  
  /**
   * 統計情報を更新
   */
  updateStats(success, waitTime = 0) {
    if (success) {
      this.stats.successCount++;
    } else {
      this.stats.errorCount++;
    }
    
    if (waitTime > 0) {
      const totalSuccessRequests = this.stats.successCount;
      this.stats.averageWaitTime = 
        (this.stats.averageWaitTime * (totalSuccessRequests - 1) + waitTime) / totalSuccessRequests;
    }
  }
  
  /**
   * キューの状態を取得
   */
  getQueueStatus() {
    return {
      queues: {
        high: this.queues.high.length,
        medium: this.queues.medium.length,
        low: this.queues.low.length
      },
      activeRequests: this.activeRequests.size,
      stats: { ...this.stats },
      lastRequestTime: this.lastRequestTime,
      isProcessing: this.isProcessing
    };
  }
  
  /**
   * 定期クリーンアップタスクを開始
   */
  startCleanupTasks() {
    // 履歴クリーンアップ（1分ごと）
    this.historyCleanupInterval = setInterval(() => {
      this.cleanupHistory();
    }, 60 * 1000);
    
    // メモリ使用量チェック（5分ごと）
    this.memoryCheckInterval = setInterval(() => {
      this.checkMemoryUsage();
    }, 5 * 60 * 1000);
  }
  
  /**
   * メモリ使用量をチェックして適切に削減
   */
  checkMemoryUsage() {
    const historySize = this.requestHistory.size;
    const activeSize = this.activeRequests.size;
    const timeoutSize = this.timeoutHandlers.size;
    
    console.log(`[OHLCVQueue] メモリ使用状況: History:${historySize}, Active:${activeSize}, Timeouts:${timeoutSize}`);
    
    // 履歴が多すぎる場合は強制クリーンアップ
    if (historySize > 1000) {
      const oldestEntries = Array.from(this.requestHistory.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)
        .slice(0, Math.floor(historySize / 2));
      
      for (const [key] of oldestEntries) {
        this.requestHistory.delete(key);
      }
      
      console.log(`[OHLCVQueue] 強制履歴クリーンアップ: ${oldestEntries.length}件削除`);
    }
    
    // 孤立したタイムアウトハンドラーをクリーンアップ
    for (const [requestId, timeoutId] of this.timeoutHandlers.entries()) {
      if (!this.activeRequests.has(requestId)) {
        clearTimeout(timeoutId);
        this.timeoutHandlers.delete(requestId);
      }
    }
  }
  
  /**
   * キュー処理を停止
   */
  stop() {
    this.isProcessing = false;
    
    // 定期タスクを停止
    if (this.historyCleanupInterval) {
      clearInterval(this.historyCleanupInterval);
    }
    if (this.memoryCheckInterval) {
      clearInterval(this.memoryCheckInterval);
    }
    
    // 全タイムアウトハンドラーをクリア
    for (const timeoutId of this.timeoutHandlers.values()) {
      clearTimeout(timeoutId);
    }
    this.timeoutHandlers.clear();
    
    // アクティブなリクエストをキャンセル
    for (const request of this.activeRequests.values()) {
      request.reject(new Error('Queue stopped'));
    }
    
    this.activeRequests.clear();
    this.requestHistory.clear();
    
    // キューをクリア
    for (const queue of Object.values(this.queues)) {
      queue.length = 0;
    }
    
    // イベントリスナーをクリア
    this.removeAllListeners();
  }
}

// シングルトンインスタンス
let globalQueue = null;

/**
 * グローバルOHLCVキューを取得
 */
function getOHLCVQueue(options = {}) {
  if (!globalQueue) {
    globalQueue = new OHLCVRequestQueue(options);
  }
  return globalQueue;
}

/**
 * グローバルキューをリセット（テスト用）
 */
function resetOHLCVQueue() {
  if (globalQueue) {
    globalQueue.stop();
    globalQueue = null;
  }
}

module.exports = {
  OHLCVRequestQueue,
  getOHLCVQueue,
  resetOHLCVQueue
};