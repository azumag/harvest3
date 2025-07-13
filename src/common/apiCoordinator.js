/**
 * API呼び出し協調制御システム - Issue #443対応
 * 複数の戦略からの同時API呼び出しを制御し、throttle queue overflowを防止
 */

const { EXCHANGE_SETTINGS } = require('./const');
const { throttleMonitor } = require('./throttleMonitor');
const Logger = require('../hft/utils/Logger');

const logger = new Logger('APICoordinator');

class APICoordinator {
  constructor() {
    this.queue = [];
    this.activeRequests = new Set();
    this.lastRequestTime = 0;
    this.isProcessing = false;
    
    // Issue #443: throttle queue監視設定
    this.monitoring = EXCHANGE_SETTINGS.THROTTLE_QUEUE_MONITORING;
    this.stats = {
      totalRequests: 0,
      queuedRequests: 0,
      rejectedRequests: 0,
      avgWaitTime: 0
    };

    // 定期的なqueue監視を開始
    if (this.monitoring.ENABLED) {
      this.startQueueMonitoring();
    }
  }

  /**
   * API呼び出しを協調制御で実行
   * @param {Function} apiCall - 実行するAPI呼び出し関数
   * @param {string} requestId - リクエストID
   * @param {number} priority - 優先度 (1: 高, 2: 中, 3: 低)
   * @returns {Promise} API呼び出しの結果
   */
  async executeAPICall(apiCall, requestId = null, priority = 2) {
    const request = {
      id: requestId || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      apiCall,
      priority,
      timestamp: Date.now(),
      resolve: null,
      reject: null
    };

    return new Promise((resolve, reject) => {
      request.resolve = resolve;
      request.reject = reject;

      // Issue #443: queue容量制限チェック (queue + activeRequests の合計)
      const totalRequests = this.queue.length + this.activeRequests.size;
      if (totalRequests >= EXCHANGE_SETTINGS.MAX_THROTTLE_QUEUE_SIZE) {
        this.stats.rejectedRequests++;
        logger.warn(`[Queue Full] リクエスト拒否: ${request.id}, 総リクエスト数: ${totalRequests} (queue: ${this.queue.length}, active: ${this.activeRequests.size})`);
        reject(new Error('API coordinator queue is full'));
        return;
      }

      // 優先度順でキューに追加
      this.addToQueue(request);
      this.stats.queuedRequests++;
      
      logger.debug(`[Queue Add] リクエスト追加: ${request.id}, queue長: ${this.queue.length}`);

      // キュー処理開始
      this.processQueue();
    });
  }

  /**
   * 優先度順でキューに追加
   */
  addToQueue(request) {
    // 優先度順（昇順）で挿入位置を決定
    let insertIndex = this.queue.length;
    for (let i = 0; i < this.queue.length; i++) {
      if (this.queue[i].priority > request.priority) {
        insertIndex = i;
        break;
      }
    }
    this.queue.splice(insertIndex, 0, request);
    logger.debug(`[Queue Insert] ${request.id} (優先度: ${request.priority}) をインデックス ${insertIndex} に挿入`);
  }

  /**
   * キュー処理
   */
  async processQueue() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    try {
      while (this.queue.length > 0) {
        // Issue #443: 並列実行数制限
        if (this.activeRequests.size >= EXCHANGE_SETTINGS.MAX_CONCURRENT_PAIRS) {
          logger.debug(`[Concurrent Limit] 並列制限待機: ${this.activeRequests.size}/${EXCHANGE_SETTINGS.MAX_CONCURRENT_PAIRS}`);
          await this.waitForAvailableSlot();
        }

        // Rate limiting: 前回のリクエストからの間隔をチェック
        const timeSinceLastRequest = Date.now() - this.lastRequestTime;
        const requiredDelay = EXCHANGE_SETTINGS.RATE_LIMIT;
        
        if (timeSinceLastRequest < requiredDelay) {
          const waitTime = requiredDelay - timeSinceLastRequest;
          logger.debug(`[Rate Limit] ${waitTime}ms待機中...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        const request = this.queue.shift();
        if (!request) {
          break;
        }

        logger.debug(`[Queue Process] 処理開始: ${request.id}, 優先度: ${request.priority}`);
        this.lastRequestTime = Date.now();
        this.executeRequest(request);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * 個別リクエストの実行
   */
  async executeRequest(request) {
    const startTime = Date.now();
    this.activeRequests.add(request.id);
    this.stats.totalRequests++;

    try {
      logger.debug(`[Execute] リクエスト実行開始: ${request.id}`);
      
      const result = await request.apiCall();
      
      // 成功時の統計更新
      const waitTime = startTime - request.timestamp;
      this.updateAverageWaitTime(waitTime);
      
      logger.debug(`[Execute Success] リクエスト完了: ${request.id}, 待機時間: ${waitTime}ms`);
      request.resolve(result);

    } catch (error) {
      logger.warn(`[Execute Error] リクエスト失敗: ${request.id}, エラー: ${error.message}`);
      
      // throttle monitor にエラーを記録
      throttleMonitor.recordRequest(true, error.message);
      
      request.reject(error);
    } finally {
      this.activeRequests.delete(request.id);
    }
  }

  /**
   * 利用可能なスロットを待機
   */
  async waitForAvailableSlot() {
    return new Promise(resolve => {
      const checkAvailability = () => {
        if (this.activeRequests.size < EXCHANGE_SETTINGS.MAX_CONCURRENT_PAIRS) {
          resolve();
        } else {
          setTimeout(checkAvailability, 100);
        }
      };
      checkAvailability();
    });
  }

  /**
   * 平均待機時間の更新
   */
  updateAverageWaitTime(waitTime) {
    const alpha = 0.1; // 移動平均の重み
    this.stats.avgWaitTime = this.stats.avgWaitTime * (1 - alpha) + waitTime * alpha;
  }

  /**
   * Queue監視の開始
   */
  startQueueMonitoring() {
    setInterval(() => {
      this.monitorQueueStatus();
    }, this.monitoring.CHECK_INTERVAL);
  }

  /**
   * Queue状況の監視
   */
  monitorQueueStatus() {
    const queueUsageRate = this.queue.length / EXCHANGE_SETTINGS.MAX_THROTTLE_QUEUE_SIZE;

    if (queueUsageRate >= this.monitoring.CRITICAL_THRESHOLD / EXCHANGE_SETTINGS.MAX_THROTTLE_QUEUE_SIZE) {
      logger.error(`[Queue Critical] queue使用率: ${(queueUsageRate * 100).toFixed(1)}%, 長さ: ${this.queue.length}`);
    } else if (queueUsageRate >= this.monitoring.WARNING_THRESHOLD / EXCHANGE_SETTINGS.MAX_THROTTLE_QUEUE_SIZE) {
      logger.warn(`[Queue Warning] queue使用率: ${(queueUsageRate * 100).toFixed(1)}%, 長さ: ${this.queue.length}`);
    }
  }

  /**
   * 統計情報を取得
   */
  getStats() {
    return {
      ...this.stats,
      queueLength: this.queue.length,
      activeRequests: this.activeRequests.size,
      queueUsageRate: this.queue.length / EXCHANGE_SETTINGS.MAX_THROTTLE_QUEUE_SIZE
    };
  }

  /**
   * 緊急時のqueue初期化
   */
  emergencyReset() {
    logger.warn('[Emergency Reset] API coordinator緊急リセット実行');
    
    // 待機中のリクエストをエラーで終了
    this.queue.forEach(request => {
      // テスト時など、reject関数が存在しない場合の安全チェック
      if (typeof request.reject === 'function') {
        request.reject(new Error('Emergency reset - request cancelled'));
      }
    });
    
    // 処理を停止してqueueをクリア
    this.isProcessing = false;
    this.queue = [];
    this.activeRequests.clear();
    
    logger.info('[Emergency Reset] 完了');
  }
}

// シングルトンインスタンス
const apiCoordinator = new APICoordinator();

module.exports = {
  apiCoordinator,
  APICoordinator
};