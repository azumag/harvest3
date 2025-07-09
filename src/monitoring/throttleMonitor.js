/**
 * スロットル監視システム - リアルタイムでAPI制限状況を監視
 * throttle queue エラーを予防的に検知し、自動対処を行う
 */

const EventEmitter = require('events');
const { EXCHANGE_SETTINGS, MONITORING_SETTINGS } = require('../common/const');

class ThrottleMonitor extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = {
      maxQueueSize: options.maxQueueSize || EXCHANGE_SETTINGS.MAX_THROTTLE_QUEUE_SIZE,
      warningThreshold: options.warningThreshold || 0.8, // 80%で警告
      criticalThreshold: options.criticalThreshold || 0.95, // 95%で緊急
      checkInterval: options.checkInterval || MONITORING_SETTINGS.THROTTLE_MONITOR_INTERVAL,
      autoAdjust: options.autoAdjust !== false, // デフォルトで自動調整有効
      ...options
    };

    this.exchanges = new Map(); // 取引所別の監視状態
    this.isMonitoring = false;
    this.checkTimer = null;

    // 内部状態
    this.lastAlertTime = new Map();
    this.alertCooldown = MONITORING_SETTINGS.ALERT_COOLDOWN_MS;

    this.setupEventHandlers();
  }

  /**
     * 取引所を監視対象に追加
     */
  addExchange(exchangeId, exchange) {
    if (!exchangeId || !exchange) {
      throw new Error('exchangeId and exchange are required');
    }

    this.exchanges.set(exchangeId, {
      exchange,
      queueSize: 0,
      lastCheck: Date.now(),
      status: 'normal', // normal, warning, critical
      consecutiveWarnings: 0,
      rateLimit: exchange.rateLimit || EXCHANGE_SETTINGS.RATE_LIMIT,
      originalRateLimit: exchange.rateLimit || EXCHANGE_SETTINGS.RATE_LIMIT
    });

    console.log(`[ThrottleMonitor] 監視開始: ${exchangeId}`);
    return this;
  }

  /**
     * 監視開始
     */
  startMonitoring() {
    if (this.isMonitoring) {
      return this;
    }

    this.isMonitoring = true;
    this.checkTimer = setInterval(() => {
      this.checkAllExchanges();
    }, this.options.checkInterval);

    console.log('[ThrottleMonitor] リアルタイム監視開始');
    this.emit('monitoring:started');
    return this;
  }

  /**
     * 監視停止
     */
  stopMonitoring() {
    if (!this.isMonitoring) {
      return this;
    }

    this.isMonitoring = false;
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }

    console.log('[ThrottleMonitor] 監視停止');
    this.emit('monitoring:stopped');
    return this;
  }

  /**
     * 全取引所の状態チェック
     */
  checkAllExchanges() {
    for (const [exchangeId, exchangeData] of this.exchanges) {
      this.checkExchangeStatus(exchangeId, exchangeData);
    }
  }

  /**
     * 個別取引所の状態チェック
     */
  checkExchangeStatus(exchangeId, exchangeData) {
    try {
      const { exchange } = exchangeData;

      // キューサイズを推定（ccxtの内部状態から）
      const estimatedQueueSize = this.estimateQueueSize(exchange);
      exchangeData.queueSize = estimatedQueueSize;
      exchangeData.lastCheck = Date.now();

      // 閾値チェック
      const queueRatio = estimatedQueueSize / this.options.maxQueueSize;
      const previousStatus = exchangeData.status;

      if (queueRatio >= this.options.criticalThreshold) {
        exchangeData.status = 'critical';
        exchangeData.consecutiveWarnings++;
        this.handleCriticalStatus(exchangeId, exchangeData, queueRatio);
      } else if (queueRatio >= this.options.warningThreshold) {
        exchangeData.status = 'warning';
        exchangeData.consecutiveWarnings++;
        this.handleWarningStatus(exchangeId, exchangeData, queueRatio);
      } else {
        exchangeData.status = 'normal';
        exchangeData.consecutiveWarnings = 0;

        // 回復時の処理
        if (previousStatus !== 'normal') {
          this.handleRecoveryStatus(exchangeId, exchangeData);
        }
      }

    } catch (error) {
      console.error(`[ThrottleMonitor] ${exchangeId} 監視エラー:`, error.message);
      this.emit('error', { exchangeId, error });
    }
  }

  /**
     * キューサイズの推定
     */
  estimateQueueSize(exchange) {
    try {
      // ccxtの内部状態から推定
      if (exchange.throttle && exchange.throttle.queue) {
        return exchange.throttle.queue.length || 0;
      }

      // rateLimit設定から推定
      const now = Date.now();
      const timeSinceLastRequest = now - (exchange.last || 0);
      const rateLimit = exchange.rateLimit || EXCHANGE_SETTINGS.RATE_LIMIT;

      // 簡単な推定：レート制限に近いほどキューが溜まっていると仮定
      if (timeSinceLastRequest < rateLimit * 0.5) {
        return Math.floor(this.options.maxQueueSize * 0.3); // 30%と推定
      } else if (timeSinceLastRequest < rateLimit) {
        return Math.floor(this.options.maxQueueSize * 0.1); // 10%と推定
      }

      return 0;
    } catch (error) {
      console.warn('[ThrottleMonitor] キューサイズ推定エラー:', error.message);
      return 0;
    }
  }

  /**
     * 警告状態の処理
     */
  handleWarningStatus(exchangeId, exchangeData, queueRatio) {
    const key = `${exchangeId}:warning`;
    const now = Date.now();

    // クールダウン中は処理しない
    if (this.lastAlertTime.has(key) &&
            (now - this.lastAlertTime.get(key)) < this.alertCooldown) {
      return;
    }

    console.warn(`[ThrottleMonitor] ${exchangeId} 警告: キュー使用率 ${(queueRatio * 100).toFixed(1)}%`);

    this.emit('throttle:warning', {
      exchangeId,
      queueSize: exchangeData.queueSize,
      queueRatio,
      maxQueueSize: this.options.maxQueueSize,
      consecutiveWarnings: exchangeData.consecutiveWarnings
    });

    this.lastAlertTime.set(key, now);

    // 自動調整
    if (this.options.autoAdjust && exchangeData.consecutiveWarnings >= 3) {
      this.adjustRateLimit(exchangeId, exchangeData, 'increase');
    }
  }

  /**
     * 緊急状態の処理
     */
  handleCriticalStatus(exchangeId, exchangeData, queueRatio) {
    const key = `${exchangeId}:critical`;
    const now = Date.now();

    console.error(`[ThrottleMonitor] ${exchangeId} 緊急: キュー使用率 ${(queueRatio * 100).toFixed(1)}%`);

    this.emit('throttle:critical', {
      exchangeId,
      queueSize: exchangeData.queueSize,
      queueRatio,
      maxQueueSize: this.options.maxQueueSize,
      consecutiveWarnings: exchangeData.consecutiveWarnings
    });

    this.lastAlertTime.set(key, now);

    // 即座に自動調整
    if (this.options.autoAdjust) {
      this.adjustRateLimit(exchangeId, exchangeData, 'emergency');
    }
  }

  /**
     * 回復状態の処理
     */
  handleRecoveryStatus(exchangeId, exchangeData) {
    console.log(`[ThrottleMonitor] ${exchangeId} 回復: 正常状態に戻りました`);

    this.emit('throttle:recovery', {
      exchangeId,
      queueSize: exchangeData.queueSize,
      previousStatus: exchangeData.status
    });

    // レート制限を徐々に元に戻す
    if (this.options.autoAdjust) {
      this.adjustRateLimit(exchangeId, exchangeData, 'decrease');
    }
  }

  /**
     * レート制限の自動調整
     */
  adjustRateLimit(exchangeId, exchangeData, action) {
    const { exchange } = exchangeData;
    const currentRateLimit = exchange.rateLimit || EXCHANGE_SETTINGS.RATE_LIMIT;

    let newRateLimit = currentRateLimit;

    switch (action) {
    case 'increase':
      newRateLimit = Math.min(currentRateLimit * 1.5, 30000); // 最大30秒
      break;
    case 'emergency':
      newRateLimit = Math.min(currentRateLimit * 2.0, 30000); // 緊急時は2倍
      break;
    case 'decrease':
      newRateLimit = Math.max(currentRateLimit * 0.9, exchangeData.originalRateLimit);
      break;
    }

    if (newRateLimit !== currentRateLimit) {
      exchange.rateLimit = newRateLimit;
      exchangeData.rateLimit = newRateLimit;

      console.log(`[ThrottleMonitor] ${exchangeId} レート制限調整: ${currentRateLimit}ms → ${newRateLimit}ms (${action})`);

      this.emit('rateLimit:adjusted', {
        exchangeId,
        oldRateLimit: currentRateLimit,
        newRateLimit,
        action
      });
    }
  }

  /**
     * 現在の状態を取得
     */
  getStatus() {
    const status = {
      isMonitoring: this.isMonitoring,
      exchanges: {},
      summary: {
        total: this.exchanges.size,
        normal: 0,
        warning: 0,
        critical: 0
      }
    };

    for (const [exchangeId, exchangeData] of this.exchanges) {
      status.exchanges[exchangeId] = {
        status: exchangeData.status,
        queueSize: exchangeData.queueSize,
        queueRatio: exchangeData.queueSize / this.options.maxQueueSize,
        rateLimit: exchangeData.rateLimit,
        lastCheck: exchangeData.lastCheck,
        consecutiveWarnings: exchangeData.consecutiveWarnings
      };

      status.summary[exchangeData.status]++;
    }

    return status;
  }

  /**
     * イベントハンドラーの設定
     */
  setupEventHandlers() {
    this.on('throttle:critical', (data) => {
      // 緊急アラートの追加処理が必要な場合はここに実装
      console.error(`🚨 CRITICAL: ${data.exchangeId} throttle queue at ${(data.queueRatio * 100).toFixed(1)}%`);
    });

    this.on('throttle:warning', (data) => {
      console.warn(`⚠️ WARNING: ${data.exchangeId} throttle queue at ${(data.queueRatio * 100).toFixed(1)}%`);
    });

    this.on('throttle:recovery', (data) => {
      console.log(`✅ RECOVERY: ${data.exchangeId} back to normal`);
    });
  }
}

module.exports = ThrottleMonitor;