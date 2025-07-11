/**
 * Tests for src/common/schedulingManager.js
 * スケジューリングマネージャーのテスト
 */

jest.mock('node-cron', () => ({
  schedule: jest.fn()
}));

jest.mock('../../../src/common/balanceCheckerConfig', () => ({
  getValidatedConfig: jest.fn(() => ({
    intervals: {
      lightweightCheck: 300000, // 5分
      robustCheck: 3600000      // 1時間
    }
  }))
}));

const cron = require('node-cron');
const { SchedulingManager, getSchedulingManager } = require('../../../src/common/schedulingManager');

describe('SchedulingManager', () => {
  let schedulingManager;
  let mockTask;

  beforeEach(() => {
    jest.clearAllMocks();

    // mock task object
    mockTask = {
      running: true,
      stop: jest.fn(),
      start: jest.fn(),
      destroy: jest.fn()
    };

    cron.schedule.mockReturnValue(mockTask);

    schedulingManager = new SchedulingManager();
  });

  describe('コンストラクタ', () => {
    it('初期化が正常に行われる', () => {
      expect(schedulingManager.scheduledTasks).toBeInstanceOf(Map);
      expect(schedulingManager.scheduledTasks.size).toBe(0);
      expect(schedulingManager.isShutdown).toBe(false);
    });
  });

  describe('scheduleHourlyTask', () => {
    it('毎時タスクの登録', () => {
      const taskFunction = jest.fn();

      const task = schedulingManager.scheduleHourlyTask('test-hourly', taskFunction);

      expect(cron.schedule).toHaveBeenCalledWith(
        '0 0 * * * *',
        expect.any(Function),
        expect.objectContaining({
          scheduled: true,
          timezone: 'Asia/Tokyo'
        })
      );
      expect(task).toBe(mockTask);
      expect(schedulingManager.scheduledTasks.size).toBe(1);
    });

    it('オプション設定でカスタマイズ', () => {
      const taskFunction = jest.fn();
      const options = {
        timezone: 'UTC',
        scheduled: false,
        runOnInit: true
      };

      schedulingManager.scheduleHourlyTask('test-custom', taskFunction, options);

      expect(cron.schedule).toHaveBeenCalledWith(
        '0 0 * * * *',
        expect.any(Function),
        expect.objectContaining({
          scheduled: false,
          timezone: 'UTC'
        })
      );
    });
  });

  describe('scheduleIntervalTask', () => {
    it('間隔タスクの登録', () => {
      const taskFunction = jest.fn();

      schedulingManager.scheduleIntervalTask('test-interval', taskFunction, 5);

      expect(cron.schedule).toHaveBeenCalledWith(
        '0 */5 * * * *',
        expect.any(Function),
        expect.objectContaining({
          scheduled: true,
          timezone: 'Asia/Tokyo'
        })
      );
      expect(schedulingManager.scheduledTasks.size).toBe(1);
    });

    it('異なる間隔での登録', () => {
      const taskFunction = jest.fn();

      schedulingManager.scheduleIntervalTask('test-15min', taskFunction, 15);

      expect(cron.schedule).toHaveBeenCalledWith(
        '0 */15 * * * *',
        expect.any(Function),
        expect.any(Object)
      );
    });
  });

  describe('scheduleCustomTask', () => {
    it('カスタムcron表現での登録', () => {
      const taskFunction = jest.fn();
      const cronExpression = '0 30 2 * * *'; // 毎日2:30

      schedulingManager.scheduleCustomTask('test-custom', cronExpression, taskFunction);

      expect(cron.schedule).toHaveBeenCalledWith(
        cronExpression,
        expect.any(Function),
        expect.objectContaining({
          scheduled: true,
          timezone: 'Asia/Tokyo'
        })
      );
    });
  });

  describe('タスク管理機能', () => {
    beforeEach(() => {
      const taskFunction = jest.fn();
      schedulingManager.scheduleHourlyTask('test-task', taskFunction);
    });

    it('タスク一時停止', () => {
      const result = schedulingManager.pauseTask('test-task');

      expect(result).toBe(true);
      expect(mockTask.stop).toHaveBeenCalled();
    });

    it('存在しないタスクの一時停止', () => {
      const result = schedulingManager.pauseTask('non-existent');

      expect(result).toBe(false);
    });

    it('タスク再開', () => {
      const result = schedulingManager.resumeTask('test-task');

      expect(result).toBe(true);
      expect(mockTask.start).toHaveBeenCalled();
    });

    it('タスク削除', () => {
      const result = schedulingManager.removeTask('test-task');

      expect(result).toBe(true);
      expect(mockTask.destroy).toHaveBeenCalled();
      expect(schedulingManager.scheduledTasks.size).toBe(0);
    });
  });

  describe('ステータス取得', () => {
    it('タスク状態取得', () => {
      const taskFunction = jest.fn();
      schedulingManager.scheduleHourlyTask('test-status', taskFunction, {
        description: 'テストタスク'
      });

      const status = schedulingManager.getTasksStatus();

      expect(status).toHaveLength(1);
      expect(status[0]).toEqual({
        name: 'test-status',
        type: 'hourly',
        cronExpression: '0 0 * * * *',
        running: true,
        description: 'テストタスク'
      });
    });
  });

  describe('シャットダウン', () => {
    it('優雅なシャットダウン', async () => {
      const taskFunction = jest.fn();
      schedulingManager.scheduleHourlyTask('test-shutdown', taskFunction);

      await schedulingManager.gracefulShutdown();

      expect(schedulingManager.isShutdown).toBe(true);
      expect(mockTask.destroy).toHaveBeenCalled();
      expect(schedulingManager.scheduledTasks.size).toBe(0);
    });

    it('シャットダウン中のタスク実行抑制', async () => {
      const taskFunction = jest.fn();
      schedulingManager.scheduleHourlyTask('test-shutdown-check', taskFunction);
      schedulingManager.isShutdown = true;

      // タスク関数を模擬実行
      const [[, taskWrapper]] = cron.schedule.mock.calls;
      await taskWrapper();

      // シャットダウン中はタスクが実行されない（taskFunctionが呼ばれない）
      expect(taskFunction).not.toHaveBeenCalled();
    });
  });

  describe('シングルトン', () => {
    it('同一インスタンス取得', () => {
      const instance1 = getSchedulingManager();
      const instance2 = getSchedulingManager();

      expect(instance1).toBe(instance2);
    });
  });

  describe('_executeTask', () => {
    it('非同期関数を正常に実行', async () => {
      const mockTask = jest.fn().mockResolvedValue('success');
      await schedulingManager._executeTask(mockTask, 'test-task');
      expect(mockTask).toHaveBeenCalled();
    });

    it('同期関数を正常に実行（Promiseではない戻り値）', async () => {
      const mockTask = jest.fn().mockReturnValue('sync result');
      await schedulingManager._executeTask(mockTask, 'test-task');
      expect(mockTask).toHaveBeenCalled();
    });

    it('同期関数のエラーを適切に処理', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const mockTask = jest.fn().mockImplementation(() => {
        throw new Error('Test error');
      });

      await schedulingManager._executeTask(mockTask, 'test-task');

      expect(consoleSpy).toHaveBeenCalledWith(
        '[スケジューラー] test-task 実行エラー:',
        'Test error'
      );
      consoleSpy.mockRestore();
    });

    it('非同期関数のエラーを適切に処理', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const mockTask = jest.fn().mockRejectedValue(new Error('Async error'));

      await schedulingManager._executeTask(mockTask, 'test-task');

      expect(consoleSpy).toHaveBeenCalledWith(
        '[スケジューラー] test-task 実行エラー:',
        'Async error'
      );
      consoleSpy.mockRestore();
    });

    it('関数以外が渡された場合は何もしない', async () => {
      await schedulingManager._executeTask('not-a-function', 'test-task');
      await schedulingManager._executeTask(null, 'test-task');
      await schedulingManager._executeTask(undefined, 'test-task');
      // エラーが発生しないことを確認
    });
  });

  describe('エラーハンドリング', () => {
    it('タスク実行エラーの適切な処理', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const errorTask = jest.fn().mockRejectedValue(new Error('Task error'));

      schedulingManager.scheduleHourlyTask('error-task', errorTask);

      // cronのコールバック関数を取得して実行
      const [[, taskWrapper]] = cron.schedule.mock.calls;
      await taskWrapper();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[スケジューラー] error-task 実行エラー:'),
        'Task error'
      );

      consoleSpy.mockRestore();
    });
  });
});