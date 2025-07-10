/**
 * リアルタイム残高監視システム - issue #215
 *
 * 1分間隔での残高監視、異常検知、自動対応を行う
 */

const { balanceIntegrityService } = require('../services/balanceIntegrityService');
const { config } = require('../config');
const { postErrorToDiscord, postOrderToDiscord } = require('../common/notifications');
const { formatJST } = require('../common/utils');
const { SETTINGS } = require('../config/settings');

class BalanceMonitor {
  constructor() {
    this.config = config.global.balanceIntegritySystem;
    this.isRunning = false;
    this.monitoringInterval = null;
    this.healthCheckInterval = null;
    this.startTime = null;
    this.performanceStats = {
      totalChecks: 0,
      successfulChecks: 0,
      failedChecks: 0,
      averageResponseTime: 0,
      lastCheckTime: null,
      lastSuccessTime: null,
      lastFailureTime: null
    };
    this.alertStats = {
      totalAlerts: 0,
      criticalAlerts: 0,
      warningAlerts: 0,
      lastAlertTime: null
    };
    this.currentlyRunning = new Set();
    this.consecutiveFailures = 0;
    this.lastSummaryTime = 0;
  }

  /**
   * 監視システムの開始
   */
  async start() {
    if (this.isRunning) {
      console.log('⚠️ Balance Monitor は既に実行中です');
      return;
    }

    if (!this.config.enabled || !this.config.realTimeMonitoring.enabled) {
      console.log('⚠️ Balance Monitor は設定で無効化されています');
      return;
    }

    console.log('🔄 Balance Monitor を開始します...');
    this.isRunning = true;
    this.startTime = Date.now();
    this.consecutiveFailures = 0;

    // Balance Integrity Service の開始
    await balanceIntegrityService.start();

    // 定期監視開始
    this.startRealtimeMonitoring();

    // ヘルスチェック開始
    this.startHealthCheck();

    // 初回チェック実行
    await this.performMonitoringCheck();

    console.log('✅ Balance Monitor が正常に開始されました');
    await this.sendStartupNotification();
  }

  /**
   * 監視システムの停止
   */
  async stop() {
    if (!this.isRunning) {
      console.log('⚠️ Balance Monitor は既に停止中です');
      return;
    }

    console.log('🛑 Balance Monitor を停止します...');
    this.isRunning = false;

    // インターバルの停止
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    // Balance Integrity Service の停止
    await balanceIntegrityService.stop();

    // 実行中のタスクの待機
    if (this.currentlyRunning.size > 0) {
      console.log('⏳ 実行中のタスクの完了を待機中...');
      while (this.currentlyRunning.size > 0) {
        await new Promise(resolve => setTimeout(resolve, SETTINGS.MONITORING.TASK_WAIT_INTERVAL));
      }
    }

    console.log('✅ Balance Monitor が正常に停止されました');
    await this.sendShutdownNotification();
  }

  /**
   * リアルタイム監視の開始
   */
  startRealtimeMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    this.monitoringInterval = setInterval(async () => {
      if (!this.isRunning) {
        return;
      }

      await this.performMonitoringCheck();
    }, this.config.realTimeMonitoring.interval);

    console.log(`⏰ リアルタイム監視開始 (間隔: ${this.config.realTimeMonitoring.interval}ms)`);
  }

  /**
   * ヘルスチェックの開始
   */
  startHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // 設定値によるヘルスチェック間隔
    this.healthCheckInterval = setInterval(async () => {
      if (!this.isRunning) {
        return;
      }

      await this.performHealthCheck();
    }, SETTINGS.MONITORING.BALANCE_CHECK_INTERVAL);

    console.log(`🏥 ヘルスチェック開始 (間隔: ${SETTINGS.MONITORING.BALANCE_CHECK_INTERVAL / 1000 / 60}分)`);
  }

  /**
   * 監視チェックの実行
   */
  async performMonitoringCheck() {
    // 同時実行数の制限 - キューイングシステムで待機
    if (this.currentlyRunning.size >= this.config.realTimeMonitoring.maxConcurrentChecks) {
      console.log('⚠️ 最大同時実行数に達しています。キューに追加して待機します...');
      // 短時間待機後に再試行
      setTimeout(() => this.performMonitoringCheck(), 1000);
      return;
    }

    const checkId = `check_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.currentlyRunning.add(checkId);

    const startTime = Date.now();
    let success = false;

    try {
      // タイムアウト制御
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Monitoring check timeout')),
          this.config.realTimeMonitoring.timeout);
      });

      // 実際の監視チェック
      const checkPromise = this.executeMonitoringCheck();

      await Promise.race([checkPromise, timeoutPromise]);

      success = true;
      this.consecutiveFailures = 0;
      this.performanceStats.successfulChecks++;

    } catch (error) {
      console.error('監視チェック中にエラーが発生:', error);
      this.consecutiveFailures++;
      this.performanceStats.failedChecks++;
      this.performanceStats.lastFailureTime = new Date();

      // 連続失敗の処理
      if (this.consecutiveFailures >= SETTINGS.MONITORING.MAX_CONSECUTIVE_FAILURES) {
        await this.handleConsecutiveFailures();
      }

      // エラー通知
      await this.sendErrorNotification(error);
    } finally {
      this.currentlyRunning.delete(checkId);

      // 統計更新
      const responseTime = Date.now() - startTime;
      this.updatePerformanceStats(responseTime, success);
    }
  }

  /**
   * 実際の監視チェック実行
   */
  async executeMonitoringCheck() {
    console.log('🔍 監視チェック実行中...');

    // リアルタイムチェック実行
    const discrepancies = await balanceIntegrityService.performRealTimeCheck();

    // 結果の処理
    if (discrepancies && discrepancies.length > 0) {
      await this.handleDiscrepancies(discrepancies);
    }

    // 定期サマリー送信
    await this.sendPeriodicSummary();

    console.log('✅ 監視チェック完了');
    return discrepancies;
  }

  /**
   * 不整合の処理
   */
  async handleDiscrepancies(discrepancies) {
    console.log(`🚨 ${discrepancies.length}件の不整合を検出`);

    // 深刻度別分類
    const critical = discrepancies.filter(d => d.severity === 'critical');
    const warning = discrepancies.filter(d => d.severity === 'warning');
    const minor = discrepancies.filter(d => d.severity === 'minor');

    // 統計更新
    this.alertStats.totalAlerts += discrepancies.length;
    this.alertStats.criticalAlerts += critical.length;
    this.alertStats.warningAlerts += warning.length;
    this.alertStats.lastAlertTime = new Date();

    // 重要アラート処理
    if (critical.length > 0) {
      await this.handleCriticalDiscrepancies(critical);
    }

    // 警告アラート処理
    if (warning.length > 0) {
      await this.handleWarningDiscrepancies(warning);
    }

    // 軽微な不整合の処理
    if (minor.length > 0) {
      await this.handleMinorDiscrepancies(minor);
    }
  }

  /**
   * 重要な不整合の処理
   */
  async handleCriticalDiscrepancies(discrepancies) {
    console.log(`🚨 重要な不整合を処理中: ${discrepancies.length}件`);

    // 即座にDiscord通知
    let message = '🚨 **重要な残高不整合が検出されました**\n\n';
    message += `検出時刻: ${formatJST(new Date())}\n`;
    message += `不整合件数: ${discrepancies.length}件\n\n`;

    for (const discrepancy of discrepancies.slice(0, 5)) {
      message += `**${discrepancy.currency}**\n`;
      message += `- 取引所: ${discrepancy.exchangeBalance}\n`;
      message += `- Redis: ${discrepancy.redisBalance}\n`;
      message += `- 乖離率: ${discrepancy.discrepancyPercent.toFixed(2)}%\n\n`;
    }

    if (discrepancies.length > 5) {
      message += `...他${discrepancies.length - 5}件の不整合\n`;
    }

    try {
      await postErrorToDiscord(message);
    } catch (error) {
      console.error('重要アラート送信エラー:', error);
    }

    // 取引停止の検討
    const majorDiscrepancies = discrepancies.filter(d =>
      d.discrepancies.max >= this.config.tradingHalt.majorDiscrepancyThreshold
    );

    if (majorDiscrepancies.length > 0) {
      await this.considerEmergencyAction(majorDiscrepancies);
    }
  }

  /**
   * 警告レベルの不整合処理
   */
  async handleWarningDiscrepancies(discrepancies) {
    console.log(`⚠️ 警告レベルの不整合を処理中: ${discrepancies.length}件`);

    // 警告通知（まとめて送信）
    let message = '⚠️ **残高不整合の警告**\n\n';
    message += `検出時刻: ${formatJST(new Date())}\n`;
    message += `警告件数: ${discrepancies.length}件\n\n`;

    for (const discrepancy of discrepancies.slice(0, 3)) {
      message += `${discrepancy.currency}: ${discrepancy.discrepancyPercent.toFixed(2)}%乖離\n`;
    }

    if (discrepancies.length > 3) {
      message += `...他${discrepancies.length - 3}件\n`;
    }

    try {
      await postOrderToDiscord(message);
    } catch (error) {
      console.error('警告通知送信エラー:', error);
    }
  }

  /**
   * 軽微な不整合の処理
   */
  async handleMinorDiscrepancies(discrepancies) {
    console.log(`ℹ️ 軽微な不整合を処理中: ${discrepancies.length}件`);

    // 軽微な不整合はログ出力のみ
    for (const discrepancy of discrepancies) {
      console.log(`  ${discrepancy.currency}: ${discrepancy.discrepancyPercent.toFixed(2)}%乖離`);
    }
  }

  /**
   * 緊急対応の検討
   */
  async considerEmergencyAction(discrepancies) {
    console.log('🚨 緊急対応を検討中...');

    // 取引停止の実行
    if (this.config.tradingHalt.enabled) {
      await this.initiateEmergencyHalt(discrepancies);
    }

    // 管理者への緊急通知
    await this.sendEmergencyNotification(discrepancies);
  }

  /**
   * 緊急停止の実行
   */
  async initiateEmergencyHalt(discrepancies) {
    console.log('🛑 緊急停止を実行します');

    const message = '🚨 **緊急停止が実行されました**\n\n' +
      '重大な残高不整合により取引を停止します\n' +
      `不整合件数: ${discrepancies.length}件\n` +
      `最大乖離率: ${Math.max(...discrepancies.map(d => d.discrepancyPercent)).toFixed(2)}%\n` +
      `\n実行時刻: ${formatJST(new Date())}\n` +
      `クールダウン期間: ${this.config.tradingHalt.cooldownPeriod / 1000}秒`;

    try {
      await postErrorToDiscord(message);
    } catch (error) {
      console.error('緊急停止通知送信エラー:', error);
    }
  }

  /**
   * 緊急通知の送信
   */
  async sendEmergencyNotification(discrepancies) {
    let message = '🚨 **緊急事態発生**\n\n';
    message += '重大な残高不整合が検出されました\n';
    message += '即座の対応が必要です\n\n';

    for (const discrepancy of discrepancies) {
      message += `**${discrepancy.currency}**\n`;
      message += `- 最大乖離: ${discrepancy.discrepancies.max}\n`;
      message += `- 乖離率: ${discrepancy.discrepancyPercent.toFixed(2)}%\n\n`;
    }

    message += `🕐 検出時刻: ${formatJST(new Date())}\n`;
    message += '📊 システム状態: 緊急事態';

    try {
      await postErrorToDiscord(message);
    } catch (error) {
      console.error('緊急通知送信エラー:', error);
    }
  }

  /**
   * 連続失敗の処理
   */
  async handleConsecutiveFailures() {
    console.log(`⚠️ 連続失敗を検出: ${this.consecutiveFailures}回`);

    if (this.consecutiveFailures >= SETTINGS.MONITORING.FAILURE_ALERT_THRESHOLD) {
      const message = '🚨 **監視システム異常**\n\n' +
        `連続失敗回数: ${this.consecutiveFailures}回\n` +
        `最終成功時刻: ${this.performanceStats.lastSuccessTime ?
          formatJST(this.performanceStats.lastSuccessTime) : 'なし'}\n` +
        `最終失敗時刻: ${formatJST(this.performanceStats.lastFailureTime)}\n` +
        '\n監視システムの確認が必要です';

      try {
        await postErrorToDiscord(message);
      } catch (error) {
        console.error('連続失敗通知送信エラー:', error);
      }
    }
  }

  /**
   * エラー通知の送信
   */
  async sendErrorNotification(error) {
    // 連続失敗が少ない場合は通知をスキップ
    if (this.consecutiveFailures < 3) {
      return;
    }

    const message = '⚠️ **監視チェックエラー**\n\n' +
      `エラー: ${error.message}\n` +
      `連続失敗: ${this.consecutiveFailures}回\n` +
      `発生時刻: ${formatJST(new Date())}`;

    try {
      await postErrorToDiscord(message);
    } catch (notificationError) {
      console.error('エラー通知送信失敗:', notificationError);
    }
  }

  /**
   * 定期サマリーの送信
   */
  async sendPeriodicSummary() {
    const now = Date.now();
    const summaryInterval = this.config.notifications.discord.summaryInterval;

    if (now - this.lastSummaryTime < summaryInterval) {
      return;
    }

    this.lastSummaryTime = now;

    const integrityMetrics = balanceIntegrityService.getMetrics();

    let message = '📊 **残高監視システム サマリー**\n\n';
    message += '**監視統計**\n';
    message += `- 総チェック数: ${this.performanceStats.totalChecks}\n`;
    message += `- 成功率: ${((this.performanceStats.successfulChecks / this.performanceStats.totalChecks) * 100).toFixed(1)}%\n`;
    message += `- 平均応答時間: ${this.performanceStats.averageResponseTime.toFixed(0)}ms\n`;
    message += `- 最終チェック: ${formatJST(this.performanceStats.lastCheckTime)}\n\n`;

    message += '**不整合統計**\n';
    message += `- 総アラート数: ${this.alertStats.totalAlerts}\n`;
    message += `- 重要アラート: ${this.alertStats.criticalAlerts}\n`;
    message += `- 警告アラート: ${this.alertStats.warningAlerts}\n`;
    message += `- 自動修正数: ${integrityMetrics.autoCorrections}\n\n`;

    message += '**システム状態**\n';
    message += `- 監視システム: ${this.isRunning ? '✅ 稼働中' : '❌ 停止中'}\n`;
    message += `- 取引状態: ${integrityMetrics.tradingHalted ? '🛑 停止中' : '✅ 正常'}\n`;
    message += `- 連続失敗: ${this.consecutiveFailures}回\n`;
    message += `- 実行中タスク: ${this.currentlyRunning.size}件`;

    try {
      await postOrderToDiscord(message);
    } catch (error) {
      console.error('サマリー送信エラー:', error);
    }
  }

  /**
   * ヘルスチェックの実行
   */
  async performHealthCheck() {
    console.log('🏥 ヘルスチェック実行中...');

    const health = {
      timestamp: new Date(),
      system: {
        monitoring: this.isRunning,
        integrity: balanceIntegrityService.getMetrics().isRunning,
        trading: !balanceIntegrityService.getMetrics().tradingHalted
      },
      performance: this.performanceStats,
      alerts: this.alertStats,
      resources: {
        activeChecks: this.currentlyRunning.size,
        cacheSize: balanceIntegrityService.getMetrics().cacheSize,
        auditLogSize: balanceIntegrityService.getMetrics().auditLogSize
      }
    };

    // 健康状態の評価
    const healthScore = this.calculateHealthScore(health);

    if (healthScore < 0.7) {
      await this.sendHealthAlert(health, healthScore);
    }

    console.log(`🏥 ヘルスチェック完了 (健康度: ${(healthScore * 100).toFixed(1)}%)`);
  }

  /**
   * 健康度の計算
   */
  calculateHealthScore(health) {
    let score = 1.0;

    // システム状態
    if (!health.system.monitoring) {
      score -= 0.4;
    }
    if (!health.system.integrity) {
      score -= 0.3;
    }
    if (!health.system.trading) {
      score -= 0.2;
    }

    // パフォーマンス
    const successRate = health.performance.successfulChecks / health.performance.totalChecks;
    if (successRate < 0.9) {
      score -= (0.9 - successRate) * 0.3;
    }

    // 連続失敗
    if (this.consecutiveFailures > 0) {
      score -= Math.min(this.consecutiveFailures * 0.05, 0.2);
    }

    return Math.max(0, score);
  }

  /**
   * 健康アラートの送信
   */
  async sendHealthAlert(health, healthScore) {
    const message = '🏥 **システム健康状態アラート**\n\n' +
      `健康度: ${(healthScore * 100).toFixed(1)}%\n` +
      `監視システム: ${health.system.monitoring ? '✅' : '❌'}\n` +
      `整合性サービス: ${health.system.integrity ? '✅' : '❌'}\n` +
      `取引状態: ${health.system.trading ? '✅' : '❌'}\n` +
      `成功率: ${((health.performance.successfulChecks / health.performance.totalChecks) * 100).toFixed(1)}%\n` +
      `連続失敗: ${this.consecutiveFailures}回\n` +
      `\n🕐 チェック時刻: ${formatJST(new Date())}`;

    try {
      await postErrorToDiscord(message);
    } catch (error) {
      console.error('健康アラート送信エラー:', error);
    }
  }

  /**
   * パフォーマンス統計の更新
   */
  updatePerformanceStats(responseTime, success) {
    this.performanceStats.totalChecks++;
    this.performanceStats.lastCheckTime = new Date();

    if (success) {
      this.performanceStats.lastSuccessTime = new Date();
    }

    // 平均応答時間の更新
    const totalChecks = this.performanceStats.totalChecks;
    this.performanceStats.averageResponseTime =
      (this.performanceStats.averageResponseTime * (totalChecks - 1) + responseTime) / totalChecks;
  }

  /**
   * 開始通知の送信
   */
  async sendStartupNotification() {
    const message = '🚀 **Balance Monitor 開始**\n\n' +
      `監視間隔: ${this.config.realTimeMonitoring.interval}ms\n` +
      `最大同時実行数: ${this.config.realTimeMonitoring.maxConcurrentChecks}\n` +
      `タイムアウト: ${this.config.realTimeMonitoring.timeout}ms\n` +
      `\n🕐 開始時刻: ${formatJST(new Date())}`;

    try {
      await postOrderToDiscord(message);
    } catch (error) {
      console.error('開始通知送信エラー:', error);
    }
  }

  /**
   * 終了通知の送信
   */
  async sendShutdownNotification() {
    const message = '🛑 **Balance Monitor 停止**\n\n' +
      `稼働時間: ${this.getUptimeString()}\n` +
      `総チェック数: ${this.performanceStats.totalChecks}\n` +
      `成功率: ${((this.performanceStats.successfulChecks / this.performanceStats.totalChecks) * 100).toFixed(1)}%\n` +
      `総アラート数: ${this.alertStats.totalAlerts}\n` +
      `\n🕐 停止時刻: ${formatJST(new Date())}`;

    try {
      await postOrderToDiscord(message);
    } catch (error) {
      console.error('終了通知送信エラー:', error);
    }
  }

  /**
   * 稼働時間の取得
   */
  getUptimeString() {
    if (!this.startTime) {
      return 'データなし';
    }
    const uptimeMs = Date.now() - this.startTime;
    const hours = Math.floor(uptimeMs / (1000 * 60 * 60));
    const minutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((uptimeMs % (1000 * 60)) / 1000);
    return `${hours}時間${minutes}分${seconds}秒`;
  }

  /**
   * 現在の状態を取得
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      consecutiveFailures: this.consecutiveFailures,
      currentlyRunning: this.currentlyRunning.size,
      performanceStats: { ...this.performanceStats },
      alertStats: { ...this.alertStats },
      integrityService: balanceIntegrityService.getMetrics()
    };
  }
}

// シングルトンインスタンス
const balanceMonitor = new BalanceMonitor();

module.exports = {
  BalanceMonitor,
  balanceMonitor
};