/**
 * 改善されたスケジューリングマネージャー
 * geminiレビュー対応: node-cronによる宣言的スケジューリング実装
 */

const cron = require('node-cron');
const { getValidatedConfig } = require('./balanceCheckerConfig');
const { postErrorToDiscord } = require('./notifications');
const Logger = require('../hft/utils/Logger');

const logger = new Logger('Scheduler');

class SchedulingManager {
  constructor() {
    this.scheduledTasks = new Map();
    this.config = getValidatedConfig();
    this.isShutdown = false;
  }

  /**
   * タスクを安全に実行するヘルパーメソッド
   * @param {Function} taskFunction - 実行する関数
   * @param {string} taskName - タスク名
   */
  async _executeTask(taskFunction, taskName) {
    if (typeof taskFunction === 'function') {
      try {
        const result = taskFunction();
        if (result && typeof result.then === 'function') {
          await result;
        }
      } catch (error) {
        logger.error(`${taskName} 実行エラー:`, error.message);
      }
    }
  }

  /**
   * 毎時0分実行のタスクをスケジュール
   * @param {string} taskName - タスク名
   * @param {Function} taskFunction - 実行する関数
   * @param {Object} options - オプション設定
   */
  scheduleHourlyTask(taskName, taskFunction, options = {}) {
    const {
      timezone = 'Asia/Tokyo',
      scheduled = true,
      runOnInit = false
    } = options;

    logger.info(`毎時タスク登録: ${taskName}`);

    // 毎時0分に実行 (秒 分 時 日 月 曜日)
    const cronExpression = '0 0 * * * *';

    const task = cron.schedule(cronExpression, async () => {
      if (this.isShutdown) {
        return;
      }

      try {
        logger.info(`${taskName} 開始 - ${new Date().toLocaleString('ja-JP')}`);
        const startTime = Date.now();

        await this._executeTask(taskFunction, taskName);

        const duration = Date.now() - startTime;
        logger.info(`${taskName} 完了 - 処理時間: ${duration}ms`);
      } catch (error) {
        logger.error(`${taskName} エラー:`, error.message);

        // エラー通知機能があれば使用
        if (typeof postErrorToDiscord !== 'undefined') {
          await postErrorToDiscord(`スケジュールタスクエラー: ${taskName} - ${error.message}`);
        }
      }
    }, {
      scheduled,
      timezone
    });

    this.scheduledTasks.set(taskName, {
      task,
      type: 'hourly',
      cronExpression,
      options
    });

    // 初回実行オプション
    if (runOnInit && typeof taskFunction === 'function') {
      logger.info(`${taskName} 初回実行中...`);
      setTimeout(async () => {
        await this._executeTask(taskFunction, taskName);
      }, 1000);
    }

    return task;
  }

  /**
   * 指定間隔でのタスクスケジュール
   * @param {string} taskName - タスク名
   * @param {Function} taskFunction - 実行する関数
   * @param {number} intervalMinutes - 実行間隔（分）
   * @param {Object} options - オプション設定
   */
  scheduleIntervalTask(taskName, taskFunction, intervalMinutes, options = {}) {
    const {
      timezone = 'Asia/Tokyo',
      scheduled = true,
      runOnInit = false
    } = options;

    logger.info(`間隔タスク登録: ${taskName} (${intervalMinutes}分間隔)`);

    // 分間隔のcron表現を生成
    const cronExpression = `0 */${intervalMinutes} * * * *`;

    const task = cron.schedule(cronExpression, async () => {
      if (this.isShutdown) {
        return;
      }

      try {
        logger.info(`${taskName} 開始 - ${new Date().toLocaleString('ja-JP')}`);
        const startTime = Date.now();

        await this._executeTask(taskFunction, taskName);

        const duration = Date.now() - startTime;
        logger.info(`${taskName} 完了 - 処理時間: ${duration}ms`);
      } catch (error) {
        logger.error(`${taskName} エラー:`, error.message);

        if (typeof postErrorToDiscord !== 'undefined') {
          await postErrorToDiscord(`スケジュールタスクエラー: ${taskName} - ${error.message}`);
        }
      }
    }, {
      scheduled,
      timezone
    });

    this.scheduledTasks.set(taskName, {
      task,
      type: 'interval',
      cronExpression,
      intervalMinutes,
      options
    });

    // 初回実行オプション
    if (runOnInit && typeof taskFunction === 'function') {
      logger.info(`${taskName} 初回実行中...`);
      setTimeout(async () => {
        await this._executeTask(taskFunction, taskName);
      }, 1000);
    }

    return task;
  }

  /**
   * カスタムcron表現でのタスクスケジュール
   * @param {string} taskName - タスク名
   * @param {string} cronExpression - cron表現
   * @param {Function} taskFunction - 実行する関数
   * @param {Object} options - オプション設定
   */
  scheduleCustomTask(taskName, cronExpression, taskFunction, options = {}) {
    const {
      timezone = 'Asia/Tokyo',
      scheduled = true,
      description = ''
    } = options;

    logger.info(`カスタムタスク登録: ${taskName} (${cronExpression}) ${description}`);

    const task = cron.schedule(cronExpression, async () => {
      if (this.isShutdown) {
        return;
      }

      try {
        logger.info(`${taskName} 開始 - ${new Date().toLocaleString('ja-JP')}`);
        const startTime = Date.now();

        await this._executeTask(taskFunction, taskName);

        const duration = Date.now() - startTime;
        logger.info(`${taskName} 完了 - 処理時間: ${duration}ms`);
      } catch (error) {
        logger.error(`${taskName} エラー:`, error.message);

        if (typeof postErrorToDiscord !== 'undefined') {
          await postErrorToDiscord(`スケジュールタスクエラー: ${taskName} - ${error.message}`);
        }
      }
    }, {
      scheduled,
      timezone
    });

    this.scheduledTasks.set(taskName, {
      task,
      type: 'custom',
      cronExpression,
      options
    });

    return task;
  }

  /**
   * デフォルト残高チェックタスクの設定
   */
  setupDefaultBalanceTasks() {
    logger.info('デフォルト残高チェックタスク設定中...');

    // 設定から間隔を取得（ミリ秒を分に変換）
    const lightweightIntervalMinutes = Math.round(this.config.intervals.lightweightCheck / (1000 * 60));
    const robustIntervalMinutes = Math.round(this.config.intervals.robustCheck / (1000 * 60));

    logger.info(`軽量チェック: ${lightweightIntervalMinutes}分間隔`);
    logger.info(`堅牢チェック: ${robustIntervalMinutes}分間隔 (毎時0分)`);

    // 毎時0分の堅牢残高チェック
    this.scheduleHourlyTask('robust-balance-check', async () => {
      const { checkAllExchangeBalances } = require('../common/balanceChecker');
      await checkAllExchangeBalances();
    }, {
      description: '堅牢残高整合性チェック（毎時0分実行）'
    });

    // 軽量チェック（設定間隔）
    this.scheduleIntervalTask('lightweight-balance-check', async () => {
      const { executeRiskManagementCheck } = require('../bot');
      await executeRiskManagementCheck();
    }, lightweightIntervalMinutes, {
      description: `軽量リスク管理チェック（${lightweightIntervalMinutes}分間隔）`
    });
  }

  /**
   * タスクの一時停止
   * @param {string} taskName - タスク名
   */
  pauseTask(taskName) {
    const taskInfo = this.scheduledTasks.get(taskName);
    if (taskInfo) {
      taskInfo.task.stop();
      logger.info(`タスク一時停止: ${taskName}`);
      return true;
    }
    return false;
  }

  /**
   * タスクの再開
   * @param {string} taskName - タスク名
   */
  resumeTask(taskName) {
    const taskInfo = this.scheduledTasks.get(taskName);
    if (taskInfo) {
      taskInfo.task.start();
      logger.info(`タスク再開: ${taskName}`);
      return true;
    }
    return false;
  }

  /**
   * タスクの削除
   * @param {string} taskName - タスク名
   */
  removeTask(taskName) {
    const taskInfo = this.scheduledTasks.get(taskName);
    if (taskInfo) {
      taskInfo.task.destroy();
      this.scheduledTasks.delete(taskName);
      logger.info(`タスク削除: ${taskName}`);
      return true;
    }
    return false;
  }

  /**
   * 全タスクの状態表示
   */
  getTasksStatus() {
    const status = [];
    for (const [name, info] of this.scheduledTasks.entries()) {
      status.push({
        name,
        type: info.type,
        cronExpression: info.cronExpression,
        running: info.task.running,
        description: info.options.description || ''
      });
    }
    return status;
  }

  /**
   * デバッグ用: 次回実行時刻の表示
   */
  showNextExecutions() {
    logger.info('\n次回実行予定:');
    for (const [name, info] of this.scheduledTasks.entries()) {
      if (info.task.running) {
        logger.info(`  ${name}: ${info.cronExpression} (${info.options.description || ''})`);
      }
    }
  }

  /**
   * 優雅なシャットダウン
   */
  async gracefulShutdown() {
    logger.info('優雅なシャットダウン開始...');
    this.isShutdown = true;

    // 全タスクを停止
    for (const [name, info] of this.scheduledTasks.entries()) {
      try {
        info.task.destroy();
        logger.info(`タスク停止: ${name}`);
      } catch (error) {
        logger.error(`タスク停止エラー ${name}:`, error.message);
      }
    }

    this.scheduledTasks.clear();
    logger.info('全タスク停止完了');
  }
}

// シングルトンインスタンス
let schedulingManagerInstance = null;

/**
 * シングルトンインスタンスの取得
 */
function getSchedulingManager() {
  if (!schedulingManagerInstance) {
    schedulingManagerInstance = new SchedulingManager();
  }
  return schedulingManagerInstance;
}

module.exports = {
  SchedulingManager,
  getSchedulingManager
};