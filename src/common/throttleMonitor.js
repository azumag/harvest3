/**
 * API スロットリング監視・自動回復システム - Issue #443対応
 * bitbank API のスロットル状況を監視し、APIコーディネーターと連携して自動回復策を実行する
 */

const { postErrorToDiscord } = require('./notifications');
const { MONITORING_SETTINGS, NOTIFICATION_SETTINGS } = require('./const');

class ThrottleMonitor {
  constructor() {
    this.stats = {
      totalRequests: 0,
      throttleErrors: 0,
      consecutiveErrors: 0,
      lastErrorTime: 0,
      recoveryAttempts: 0,
      // Issue #443: 新しい統計項目
      queueOverflowErrors: 0,
      coordinatorErrors: 0,
      lastQueueOverflow: 0
    };

    this.thresholds = {
      criticalErrorRate: 0.2, // Issue #443: 20%エラー率で危険レベル（より厳格に）
      maxConsecutiveErrors: 5, // Issue #443: 連続エラー閾値を5に削減（早期対応）
      recoveryDelay: 30000, // Issue #443: 回復待機時間を30秒に短縮
      alertCooldown: NOTIFICATION_SETTINGS.RATE_LIMIT_WINDOW_MS,
      // Issue #443: 新しい閾値
      queueOverflowThreshold: 3, // queue overflow 3回で緊急対応
      coordinatorResetThreshold: 5 // コーディネーターリセット閾値
    };

    this.lastAlertTime = 0;
    this.isRecoveryMode = false;
    this.apiCoordinator = null; // 後で設定される
  }

  /**
   * API リクエストを記録する - Issue #443対応
   * @param {boolean} isError - エラーかどうか
   * @param {string} errorType - エラーの種類
   */
  recordRequest(isError = false, errorType = '') {
    this.stats.totalRequests++;

    if (isError) {
      this.stats.throttleErrors++;
      this.stats.consecutiveErrors++;
      this.stats.lastErrorTime = Date.now();

      // Issue #443: 詳細なエラー分類
      if (errorType.includes('throttle') || errorType.includes('maxCapacity')) {
        this.stats.queueOverflowErrors++;
        this.stats.lastQueueOverflow = Date.now();
        this.handleThrottleError(errorType);
      } else if (errorType.includes('coordinator') || errorType.includes('queue is full')) {
        this.stats.coordinatorErrors++;
        this.handleCoordinatorError(errorType);
      } else {
        this.handleThrottleError(errorType);
      }
    } else {
      this.stats.consecutiveErrors = 0;
      if (this.isRecoveryMode) {
        this.handleRecovery();
      }
    }
  }

  /**
   * APIコーディネーターとの連携を設定
   * @param {Object} coordinator - APIコーディネーターインスタンス
   */
  setAPICoordinator(coordinator) {
    this.apiCoordinator = coordinator;
  }

  /**
   * スロットルエラーを処理する - Issue #443対応
   */
  async handleThrottleError(errorType = '') {
    const errorRate = this.stats.throttleErrors / this.stats.totalRequests;

    // Issue #443: queue overflow の早期検出
    if (this.stats.queueOverflowErrors >= this.thresholds.queueOverflowThreshold) {
      await this.handleQueueOverflowCrisis();
      return;
    }

    // 危険レベルの判定
    if (errorRate > this.thresholds.criticalErrorRate ||
        this.stats.consecutiveErrors > this.thresholds.maxConsecutiveErrors) {

      await this.enterRecoveryMode();
    }
  }

  /**
   * APIコーディネーターエラーを処理する - Issue #443対応
   */
  async handleCoordinatorError(errorType = '') {
    console.log(`[ThrottleMonitor] コーディネーターエラー検出: ${errorType}`);

    if (this.stats.coordinatorErrors >= this.thresholds.coordinatorResetThreshold && this.apiCoordinator) {
      const message = `🚨 **APIコーディネーター緊急リセット**
      
**原因**: コーディネーターエラーが閾値(${this.thresholds.coordinatorResetThreshold})に到達
- コーディネーターエラー数: ${this.stats.coordinatorErrors}
- 総リクエスト数: ${this.stats.totalRequests}

**対応**: APIコーディネーターの緊急リセットを実行`;

      await this.sendAlert(message);
      this.apiCoordinator.emergencyReset();
      
      // エラーカウントをリセット
      this.stats.coordinatorErrors = 0;
    }
  }

  /**
   * Queue overflow危機対応 - Issue #443対応
   */
  async handleQueueOverflowCrisis() {
    const message = `🔥 **Throttle Queue Overflow危機**
    
**統計:**
- Queue overflow回数: ${this.stats.queueOverflowErrors}
- 閾値: ${this.thresholds.queueOverflowThreshold}
- 最後のOverflow: ${new Date(this.stats.lastQueueOverflow).toLocaleString()}

**緊急対応を実行中...**`;

    await this.sendAlert(message);

    if (this.apiCoordinator) {
      console.log('[ThrottleMonitor] APIコーディネーター緊急リセット実行');
      this.apiCoordinator.emergencyReset();
    }

    // より長い回復時間を設定
    await new Promise(resolve => setTimeout(resolve, this.thresholds.recoveryDelay * 2));
    
    // 統計リセット
    this.stats.queueOverflowErrors = 0;
  }

  /**
   * 回復モードに入る
   */
  async enterRecoveryMode() {
    if (this.isRecoveryMode) {
      return;
    }

    this.isRecoveryMode = true;
    this.stats.recoveryAttempts++;

    const message = `🚨 **API スロットリング危機検出**
    
**統計:**
- 総リクエスト数: ${this.stats.totalRequests}
- スロットルエラー数: ${this.stats.throttleErrors}
- エラー率: ${(this.stats.throttleErrors / this.stats.totalRequests * 100).toFixed(1)}%
- 連続エラー数: ${this.stats.consecutiveErrors}

**自動回復処理を開始します...**`;

    await this.sendAlert(message);

    console.log('[ThrottleMonitor] 回復モードに入りました');
    console.log(`[ThrottleMonitor] ${this.thresholds.recoveryDelay}ms 待機中...`);

    // 回復待機時間
    await new Promise(resolve => setTimeout(resolve, this.thresholds.recoveryDelay));
  }

  /**
   * 回復処理を実行する
   */
  async handleRecovery() {
    this.isRecoveryMode = false;

    const message = `✅ **API スロットリング回復**
    
回復モードから正常状態に戻りました。
- 回復試行回数: ${this.stats.recoveryAttempts}
- 現在の連続エラー数: ${this.stats.consecutiveErrors}`;

    await this.sendAlert(message);
    console.log('[ThrottleMonitor] 正常状態に回復しました');
  }

  /**
   * アラートを送信する（重複防止機能付き）
   */
  async sendAlert(message) {
    const now = Date.now();

    if (now - this.lastAlertTime < this.thresholds.alertCooldown) {
      return; // アラート抑制中
    }

    this.lastAlertTime = now;

    try {
      await postErrorToDiscord(message);
    } catch (error) {
      console.error('[ThrottleMonitor] Discord通知エラー:', error.message);
    }
  }

  /**
   * 現在の統計情報を取得する
   */
  getStats() {
    return {
      ...this.stats,
      errorRate: this.stats.totalRequests > 0 ?
        (this.stats.throttleErrors / this.stats.totalRequests) : 0,
      isRecoveryMode: this.isRecoveryMode
    };
  }

  /**
   * 統計をリセットする
   */
  resetStats() {
    this.stats = {
      totalRequests: 0,
      throttleErrors: 0,
      consecutiveErrors: 0,
      lastErrorTime: 0,
      recoveryAttempts: 0
    };
    this.isRecoveryMode = false;
    console.log('[ThrottleMonitor] 統計をリセットしました');
  }

  /**
   * 現在の推奨待機時間を取得する
   */
  getRecommendedDelay() {
    if (this.isRecoveryMode) {
      return Math.min(5000 * this.stats.consecutiveErrors, 30000);
    }

    const errorRate = this.stats.throttleErrors / this.stats.totalRequests;
    if (errorRate > 0.1) { // 10% エラー率以上
      return 2000; // 2秒待機
    }

    return 0;
  }
}

// シングルトンインスタンス
const throttleMonitor = new ThrottleMonitor();

module.exports = {
  throttleMonitor,
  ThrottleMonitor
};