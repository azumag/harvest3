/**
 * API スロットリング監視・自動回復システム
 * bitbank API のスロットル状況を監視し、自動的に回復策を実行する
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
      recoveryAttempts: 0
    };
    
    this.thresholds = {
      criticalErrorRate: 0.3, // 30% エラー率で危険レベル
      maxConsecutiveErrors: 10,
      recoveryDelay: 60000, // 1分間の回復待機時間
      alertCooldown: NOTIFICATION_SETTINGS.RATE_LIMIT_WINDOW_MS // 設定ファイルから取得
    };
    
    this.lastAlertTime = 0;
    this.isRecoveryMode = false;
  }

  /**
   * API リクエストを記録する
   * @param {boolean} isError - エラーかどうか
   * @param {string} errorType - エラーの種類
   */
  recordRequest(isError = false, errorType = '') {
    this.stats.totalRequests++;
    
    if (isError) {
      this.stats.throttleErrors++;
      this.stats.consecutiveErrors++;
      this.stats.lastErrorTime = Date.now();
      
      if (errorType.includes('throttle') || errorType.includes('maxCapacity')) {
        this.handleThrottleError();
      }
    } else {
      this.stats.consecutiveErrors = 0;
      if (this.isRecoveryMode) {
        this.handleRecovery();
      }
    }
  }

  /**
   * スロットルエラーを処理する
   */
  async handleThrottleError() {
    const errorRate = this.stats.throttleErrors / this.stats.totalRequests;
    
    // 危険レベルの判定
    if (errorRate > this.thresholds.criticalErrorRate || 
        this.stats.consecutiveErrors > this.thresholds.maxConsecutiveErrors) {
      
      await this.enterRecoveryMode();
    }
  }

  /**
   * 回復モードに入る
   */
  async enterRecoveryMode() {
    if (this.isRecoveryMode) return;
    
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