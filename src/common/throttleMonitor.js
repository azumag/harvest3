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
      lastQueueOverflow: 0,
      // Issue #440: 追加統計
      emergencyStops: 0,
      lastEmergencyStop: 0,
      systemHealthScore: 1.0 // 0.0-1.0 のスコア
    };

    this.thresholds = {
      criticalErrorRate: 0.15, // Issue #440: 15%エラー率で危険レベル（より厳格に）
      maxConsecutiveErrors: 3, // Issue #440: 連続エラー閾値を3に削減（早期対応）
      recoveryDelay: 25000, // Issue #440: 回復待機時間を25秒に短縮
      alertCooldown: NOTIFICATION_SETTINGS.RATE_LIMIT_WINDOW_MS,
      // Issue #440: 強化された閾値
      queueOverflowThreshold: 2, // queue overflow 2回で緊急対応（より厳格）
      coordinatorResetThreshold: 3, // コーディネーターリセット閾値を削減
      emergencyThreshold: 0.8, // システム負荷80%で緊急停止
      healthRecoveryThreshold: 0.7 // ヘルススコア70%以下で制限開始
    };

    this.lastAlertTime = 0;
    this.isRecoveryMode = false;
    this.apiCoordinator = null; // 後で設定される
    
    // Issue #440: サーキットブレーカー状態管理
    this.circuitBreaker = {
      state: 'CLOSED', // CLOSED, OPEN, HALF_OPEN
      failureCount: 0,
      lastFailureTime: 0,
      nextAttemptTime: 0,
      successCount: 0
    };
    
    // Issue #440: システムヘルスモニタリング
    this.healthMonitoring = {
      enabled: true,
      lastHealthCheck: 0,
      healthHistory: [], // 直近の健康状態履歴
      maxHistorySize: 10
    };
  }

  /**
   * API リクエストを記録する - Issue #440対応
   * @param {boolean} isError - エラーかどうか
   * @param {string} errorType - エラーの種類
   */
  recordRequest(isError = false, errorType = '') {
    this.stats.totalRequests++;

    // Issue #440: サーキットブレーカー状態を更新
    this.updateCircuitBreakerState(!isError);

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
    
    // Issue #440: システムヘルススコアを定期的に更新
    this.stats.systemHealthScore = this.getSystemHealthScore();
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
   * 現在の統計情報を取得する - Issue #440対応
   */
  getStats() {
    return {
      ...this.stats,
      errorRate: this.stats.totalRequests > 0 ?
        (this.stats.throttleErrors / this.stats.totalRequests) : 0,
      isRecoveryMode: this.isRecoveryMode,
      // Issue #440: 追加統計情報
      circuitBreakerState: this.circuitBreaker.state,
      systemHealthScore: this.getSystemHealthScore(),
      shouldAllowRequest: this.shouldAllowRequest(),
      recommendedDelay: this.getRecommendedDelay(),
      healthHistory: this.healthMonitoring.healthHistory.slice(-5) // 直近5件
    };
  }

  /**
   * 統計をリセットする - Issue #440対応
   */
  resetStats() {
    this.stats = {
      totalRequests: 0,
      throttleErrors: 0,
      consecutiveErrors: 0,
      lastErrorTime: 0,
      recoveryAttempts: 0,
      queueOverflowErrors: 0,
      coordinatorErrors: 0,
      lastQueueOverflow: 0,
      emergencyStops: 0,
      lastEmergencyStop: 0,
      systemHealthScore: 1.0
    };
    this.isRecoveryMode = false;
    
    // Issue #440: サーキットブレーカーもリセット
    this.circuitBreaker = {
      state: 'CLOSED',
      failureCount: 0,
      lastFailureTime: 0,
      nextAttemptTime: 0,
      successCount: 0
    };
    
    // Issue #440: ヘルス履歴もリセット
    this.healthMonitoring.healthHistory = [];
    
    console.log('[ThrottleMonitor] 統計とサーキットブレーカーをリセットしました');
  }

  /**
   * 現在の推奨待機時間を取得する - Issue #440対応
   */
  getRecommendedDelay() {
    // Issue #440: サーキットブレーカーの状態を考慮
    if (this.circuitBreaker.state === 'OPEN') {
      const timeUntilNextAttempt = this.circuitBreaker.nextAttemptTime - Date.now();
      return Math.max(timeUntilNextAttempt, 0);
    }
    
    if (this.isRecoveryMode) {
      return Math.min(6000 * this.stats.consecutiveErrors, 35000); // Issue #440: 若干延長
    }

    // Issue #440: システムヘルスを考慮した動的遅延
    const healthScore = this.getSystemHealthScore();
    const baseErrorRate = this.stats.throttleErrors / this.stats.totalRequests;
    
    if (healthScore < this.thresholds.healthRecoveryThreshold) {
      const healthPenalty = (1 - healthScore) * 5000; // 最大5秒のペナルティ
      return Math.min(healthPenalty, 8000);
    }
    
    if (baseErrorRate > 0.08) { // 8% エラー率以上（閾値を下げた）
      return Math.min(3000 * (baseErrorRate / 0.08), 6000); // 動的待機時間
    }

    return 0;
  }
  
  /**
   * Issue #440: サーキットブレーカーの状態をチェック
   */
  shouldAllowRequest() {
    const now = Date.now();
    
    switch (this.circuitBreaker.state) {
      case 'CLOSED':
        return true;
        
      case 'OPEN':
        if (now >= this.circuitBreaker.nextAttemptTime) {
          this.circuitBreaker.state = 'HALF_OPEN';
          this.circuitBreaker.successCount = 0;
          console.log('[ThrottleMonitor] サーキットブレーカー: OPEN → HALF_OPEN');
          return true;
        }
        return false;
        
      case 'HALF_OPEN':
        return true;
        
      default:
        return true;
    }
  }
  
  /**
   * Issue #440: サーキットブレーカーの状態を更新
   */
  updateCircuitBreakerState(isSuccess) {
    const now = Date.now();
    
    if (isSuccess) {
      this.circuitBreaker.failureCount = 0;
      
      if (this.circuitBreaker.state === 'HALF_OPEN') {
        this.circuitBreaker.successCount++;
        if (this.circuitBreaker.successCount >= 3) { // 3回連続成功で回復
          this.circuitBreaker.state = 'CLOSED';
          console.log('[ThrottleMonitor] サーキットブレーカー: HALF_OPEN → CLOSED');
        }
      }
    } else {
      this.circuitBreaker.failureCount++;
      this.circuitBreaker.lastFailureTime = now;
      
      if (this.circuitBreaker.state === 'CLOSED' && 
          this.circuitBreaker.failureCount >= this.thresholds.maxConsecutiveErrors) {
        this.openCircuitBreaker();
      } else if (this.circuitBreaker.state === 'HALF_OPEN') {
        this.openCircuitBreaker();
      }
    }
  }
  
  /**
   * Issue #440: サーキットブレーカーをOPEN状態にする
   */
  openCircuitBreaker() {
    this.circuitBreaker.state = 'OPEN';
    this.circuitBreaker.nextAttemptTime = Date.now() + this.thresholds.recoveryDelay;
    this.stats.emergencyStops++;
    this.stats.lastEmergencyStop = Date.now();
    
    console.log(`[ThrottleMonitor] サーキットブレーカー: OPEN (${this.thresholds.recoveryDelay}ms後に再試行)`);
    
    // 緊急停止通知
    this.sendAlert(`🔴 **サーキットブレーカー緊急停止**
    
**原因**: 連続エラー閾値到達 (${this.circuitBreaker.failureCount}回)
**状態**: API呼び出しを一時停止
**復旧予定**: ${new Date(this.circuitBreaker.nextAttemptTime).toLocaleString()}

システムの安定化を図っています...`);
  }
  
  /**
   * Issue #440: システムヘルススコアを計算
   */
  getSystemHealthScore() {
    const now = Date.now();
    
    if (this.stats.totalRequests === 0) {
      return 1.0; // リクエストがない場合は健全とする
    }
    
    // エラー率による減点 (最大40%減点)
    const errorRate = this.stats.throttleErrors / this.stats.totalRequests;
    const errorPenalty = Math.min(errorRate * 2, 0.4);
    
    // 連続エラーによる減点 (最大30%減点)
    const consecutivePenalty = Math.min(this.stats.consecutiveErrors * 0.1, 0.3);
    
    // 最近のqueue overflowによる減点 (最大20%減点)
    const timeSinceOverflow = now - this.stats.lastQueueOverflow;
    const overflowPenalty = timeSinceOverflow < 60000 ? 0.2 : 0; // 1分以内なら減点
    
    // APIコーディネーターの状態による減点
    const coordinatorPenalty = this.apiCoordinator ? 
      Math.min(this.apiCoordinator.getStats().queueUsageRate * 0.1, 0.1) : 0;
    
    const healthScore = Math.max(1.0 - errorPenalty - consecutivePenalty - overflowPenalty - coordinatorPenalty, 0.0);
    
    // ヘルス履歴を更新
    this.updateHealthHistory(healthScore);
    
    return healthScore;
  }
  
  /**
   * Issue #440: ヘルス履歴を更新
   */
  updateHealthHistory(score) {
    const now = Date.now();
    
    this.healthMonitoring.healthHistory.push({
      score: score,
      timestamp: now
    });
    
    // 履歴サイズ制限
    if (this.healthMonitoring.healthHistory.length > this.healthMonitoring.maxHistorySize) {
      this.healthMonitoring.healthHistory.shift();
    }
    
    this.healthMonitoring.lastHealthCheck = now;
  }
}

// シングルトンインスタンス
const throttleMonitor = new ThrottleMonitor();

module.exports = {
  throttleMonitor,
  ThrottleMonitor
};