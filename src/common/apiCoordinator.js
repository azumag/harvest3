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
   * API呼び出しを協調制御で実行 - Issue #440対応
   * @param {Function} apiCall - 実行するAPI呼び出し関数
   * @param {string} requestId - リクエストID
   * @param {number} priority - 優先度 (1: 高, 2: 中, 3: 低)
   * @param {Object} options - オプション (dropIfBusy: 高負荷時にドロップ可能, timeout: タイムアウト時間)
   * @returns {Promise} API呼び出しの結果
   */
  async executeAPICall(apiCall, requestId = null, priority = 2, options = {}) {
    const request = {
      id: requestId || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      apiCall,
      priority,
      timestamp: Date.now(),
      resolve: null,
      reject: null,
      dropIfBusy: options.dropIfBusy || false,
      timeout: options.timeout || 30000
    };

    return new Promise((resolve, reject) => {
      request.resolve = resolve;
      request.reject = reject;

      // Issue #438 & #440: システム負荷チェックと適応的制御強化
      const totalRequests = this.queue.length + this.activeRequests.size;
      const queueUsageRate = totalRequests / EXCHANGE_SETTINGS.MAX_THROTTLE_QUEUE_SIZE;
      
      
      // キューが満杯の場合は緊急排出をスキップして直接拒否
      if (totalRequests >= EXCHANGE_SETTINGS.MAX_THROTTLE_QUEUE_SIZE) {
        this.stats.rejectedRequests++;
        logger.warn(`[Queue Full] リクエスト拒否: ${request.id}, 総リクエスト数: ${totalRequests} (queue: ${this.queue.length}, active: ${this.activeRequests.size})`);
        reject(new Error('API coordinator queue is full'));
        return;
      }
      
      // Issue #438: より積極的な予防策（キューが満杯でない場合のみ）
      if (queueUsageRate >= 0.75 && totalRequests < EXCHANGE_SETTINGS.MAX_THROTTLE_QUEUE_SIZE) {
        // 75%以上で緊急排出（従来の90%から引き下げ）
        this.emergencyQueueDrainage();
        
        // 緊急排出後もまだ高い場合は新規リクエストを一時的に拒否
        const newQueueUsageRate = (this.queue.length + this.activeRequests.size) / EXCHANGE_SETTINGS.MAX_THROTTLE_QUEUE_SIZE;
        if (newQueueUsageRate >= 0.6) {
          this.stats.rejectedRequests++;
          logger.warn(`[Queue Critical] 緊急排出後も高負荷のためリクエスト拒否: ${request.id}, 使用率: ${(newQueueUsageRate * 100).toFixed(1)}%`);
          reject(new Error('API coordinator queue remains critical after emergency drainage'));
          return;
        }
      } else if (queueUsageRate >= 0.6 && request.dropIfBusy) {
        // 60%以上で非重要リクエストをドロップ（従来の70%から引き下げ）
        this.stats.rejectedRequests++;
        logger.warn(`[Queue Busy] 高負荷のため非重要リクエストをドロップ: ${request.id}, 使用率: ${(queueUsageRate * 100).toFixed(1)}%`);
        reject(new Error('API coordinator is busy - request dropped'));
        return;
      } else if (queueUsageRate >= 0.5) {
        // Issue #438: 50%以上で予防警告
        logger.warn(`[Queue Prevention] キュー使用率警告: ${(queueUsageRate * 100).toFixed(1)}%, 予防的監視中...`);
      }

      // Issue #440: 動的優先度調整
      request.priority = this.adjustPriorityBasedOnLoad(request.priority, queueUsageRate);

      // 優先度順でキューに追加
      this.addToQueue(request);
      this.stats.queuedRequests++;
      
      logger.debug(`[Queue Add] リクエスト追加: ${request.id}, queue長: ${this.queue.length}, 優先度: ${request.priority}`);

      // キュー処理開始
      this.processQueue();
    });
  }
  
  /**
   * Issue #440: システム負荷に基づく動的優先度調整
   */
  adjustPriorityBasedOnLoad(originalPriority, queueUsageRate) {
    if (queueUsageRate < 0.3) {
      return originalPriority; // 負荷が低い場合は調整なし
    }
    
    // 負荷が高い場合は優先度を1段階上げる（数値を下げる）
    if (queueUsageRate >= 0.7) {
      return Math.max(originalPriority - 1, 1);
    }
    
    // 中程度の負荷の場合は低優先度のみ調整
    if (originalPriority >= 3 && queueUsageRate >= 0.5) {
      return originalPriority - 1;
    }
    
    return originalPriority;
  }
  
  /**
   * Issue #438 & #440: 緊急キュー排出強化
   */
  emergencyQueueDrainage() {
    const now = Date.now();
    let drainedCount = 0;
    const initialQueueLength = this.queue.length;
    
    // Issue #438: より積極的な排出ロジック
    this.queue = this.queue.filter(request => {
      const age = now - request.timestamp;
      let shouldDrain = false;
      
      // 優先度3以上（低優先度）は積極的に排出
      if (request.priority >= 3) {
        shouldDrain = true;
      }
      // 優先度2でも古い（5秒以上）またはdropIfBusyの場合は排出
      else if (request.priority === 2 && (age > 5000 || request.dropIfBusy)) {
        shouldDrain = true;
      }
      // 優先度1でも非常に古い（15秒以上）場合は排出
      else if (request.priority === 1 && age > 15000) {
        shouldDrain = true;
      }
      
      if (shouldDrain) {
        drainedCount++;
        if (typeof request.reject === 'function') {
          request.reject(new Error('Emergency queue drainage - request dropped for maxCapacity prevention'));
        }
        return false;
      }
      return true;
    });
    
    // Issue #438: 排出が不十分な場合は追加排出
    if (drainedCount > 0 && this.queue.length > EXCHANGE_SETTINGS.MAX_THROTTLE_QUEUE_SIZE * 0.5) {
      logger.warn(`[Emergency Drainage] 初回排出後もキューが高負荷: ${this.queue.length}個、追加排出実行中...`);
      
      // より積極的な追加排出（優先度2も含める）
      let additionalDrained = 0;
      this.queue = this.queue.filter(request => {
        const age = now - request.timestamp;
        if (request.priority >= 2 && age > 3000) {
          additionalDrained++;
          if (typeof request.reject === 'function') {
            request.reject(new Error('Additional emergency drainage - maxCapacity overflow prevention'));
          }
          return false;
        }
        return true;
      });
      drainedCount += additionalDrained;
    }
    
    if (drainedCount > 0) {
      logger.warn(`[Emergency Drainage] ${drainedCount}個のリクエストを緊急排出しました (${initialQueueLength} → ${this.queue.length})`);
      
      // throttleMonitorに通知
      if (this.throttleMonitor) {
        this.throttleMonitor.sendAlert(`🚨 **Issue #438: 強化された緊急キュー排出実行**
        
**排出数**: ${drainedCount}個のリクエスト
**理由**: キュー使用率75%超過（maxCapacity overflow予防）
**変化**: ${initialQueueLength} → ${this.queue.length}個
**現在使用率**: ${((this.queue.length / EXCHANGE_SETTINGS.MAX_THROTTLE_QUEUE_SIZE) * 100).toFixed(1)}%

**Issue #438対応**: より積極的な予防策でmaxCapacityエラーを防止しています。`);
      }
    }
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
    
    // 二重チェック（競合状態対策）
    if (this.queue.length === 0) {
      this.isProcessing = false;
      return;
    }

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
   * 緊急時のqueue初期化 - Issue #440対応
   */
  emergencyReset() {
    logger.warn('[Emergency Reset] API coordinator緊急リセット実行');
    
    const queueLength = this.queue.length;
    const activeCount = this.activeRequests.size;
    
    // 待機中のリクエストをエラーで終了
    this.queue.forEach(request => {
      // テスト時など、reject関数が存在しない場合の安全チェック
      try {
        if (request.reject && typeof request.reject === 'function') {
          request.reject(new Error('Emergency reset - request cancelled'));
        }
      } catch (rejectionError) {
        logger.warn(`[Emergency Reset] リクエスト拒否時エラー: ${rejectionError.message}`);
      }
    });
    
    // 処理を停止してqueueをクリア
    this.isProcessing = false;
    this.queue = [];
    this.activeRequests.clear();
    
    // Issue #440: 統計をリセット
    this.stats.rejectedRequests += queueLength;
    this.lastRequestTime = 0;
    
    logger.info(`[Emergency Reset] 完了 - クリア: queue=${queueLength}, active=${activeCount}`);
    
    // Issue #440: throttleMonitorと連携した通知
    if (this.throttleMonitor) {
      this.throttleMonitor.sendAlert(`🔴 **API Coordinator緊急リセット**
      
**クリア対象**:
- 待機中リクエスト: ${queueLength}個
- 実行中リクエスト: ${activeCount}個

**原因**: システム負荷またはqueue overflow対応
**状態**: 全てのリクエストキューをクリア

システムの復旧処理を実行中...`);
    }
  }
  
  /**
   * Issue #440: throttleMonitorとの連携設定
   */
  setThrottleMonitor(monitor) {
    this.throttleMonitor = monitor;
  }
}

// シングルトンインスタンス
const apiCoordinator = new APICoordinator();

module.exports = {
  apiCoordinator,
  APICoordinator
};