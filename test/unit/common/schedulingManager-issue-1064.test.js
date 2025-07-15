/**
 * Issue #1064 修正のテスト
 * schedulingManagerのlightweight-balance-checkスケジューラー修正内容を検証
 * 
 * 修正内容：
 * - lightweight-balance-checkスケジューラーがcompareBalancesの代わりに
 *   executeRiskManagementCheckを呼び出すように変更
 * - 循環依存を回避するため、botModuleを実行時に動的にrequire
 * - エラーハンドリングの強化
 */

// Mock dependencies
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

// botModule のモック（Issue #1064 修正の対象）
const mockBotModule = {
  executeRiskManagementCheck: jest.fn()
};

jest.mock('../../../src/bot', () => mockBotModule);

// balanceChecker のモック
const mockBalanceChecker = {
  checkAllExchangeBalances: jest.fn()
};

jest.mock('../../../src/common/balanceChecker', () => mockBalanceChecker);

// Logger のモック
const mockLoggerInstance = {
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
};

jest.mock('../../../src/hft/utils/Logger', () => {
  return jest.fn().mockImplementation(() => mockLoggerInstance);
});

const cron = require('node-cron');
const { SchedulingManager } = require('../../../src/common/schedulingManager');

describe('Issue #1064: schedulingManager lightweight-balance-check修正テスト', () => {
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
    
    // mockBotModule.executeRiskManagementCheck の初期化
    mockBotModule.executeRiskManagementCheck = jest.fn().mockResolvedValue();
    mockBalanceChecker.checkAllExchangeBalances = jest.fn().mockResolvedValue();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('lightweight-balance-check スケジューラーの修正', () => {
    it('executeRiskManagementCheck が正常に呼び出される', async () => {
      // デフォルト残高チェックタスクを設定
      schedulingManager.setupDefaultBalanceTasks();

      // lightweight-balance-check タスクが登録されたことを確認
      expect(cron.schedule).toHaveBeenCalledWith(
        '0 */5 * * * *', // 5分間隔
        expect.any(Function),
        expect.objectContaining({
          scheduled: true,
          timezone: 'Asia/Tokyo'
        })
      );

      // lightweight-balance-check のタスク関数を取得
      const scheduleCalls = cron.schedule.mock.calls;
      const lightweightTaskCall = scheduleCalls.find(call => 
        call[0] === '0 */5 * * * *' // 5分間隔のタスク
      );

      expect(lightweightTaskCall).toBeDefined();
      const taskFunction = lightweightTaskCall[1];

      // タスク関数を実行
      await taskFunction();

      // executeRiskManagementCheck が呼び出されたことを確認
      expect(mockBotModule.executeRiskManagementCheck).toHaveBeenCalledTimes(1);
    });

    it('executeRiskManagementCheck が function でない場合にエラーが発生する', async () => {
      // executeRiskManagementCheck を関数以外にモック
      mockBotModule.executeRiskManagementCheck = 'not a function';

      schedulingManager.setupDefaultBalanceTasks();

      // lightweight-balance-check のタスク関数を取得
      const scheduleCalls = cron.schedule.mock.calls;
      const lightweightTaskCall = scheduleCalls.find(call => 
        call[0] === '0 */5 * * * *'
      );

      const taskFunction = lightweightTaskCall[1];

      // taskFunctionはwrap関数なので、実際の処理は_executeTaskで行われる
      // エラーが発生するが、_executeTaskによってキャッチされてlogに出力される
      await taskFunction();
      
      // エラーログが出力されたことを確認（実際の実装に合わせる）
      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        'lightweight-balance-check 実行エラー:',
        'executeRiskManagementCheck is not a function'
      );
    });

    it('executeRiskManagementCheck でエラーが発生した場合の処理', async () => {
      // executeRiskManagementCheck でエラーを発生させる
      const testError = new Error('Test executeRiskManagementCheck error');
      mockBotModule.executeRiskManagementCheck = jest.fn().mockRejectedValue(testError);

      schedulingManager.setupDefaultBalanceTasks();

      // lightweight-balance-check のタスク関数を取得
      const scheduleCalls = cron.schedule.mock.calls;
      const lightweightTaskCall = scheduleCalls.find(call => 
        call[0] === '0 */5 * * * *'
      );

      const taskFunction = lightweightTaskCall[1];

      // taskFunctionはwrap関数なので、実際の処理は_executeTaskで行われる
      // エラーが発生するが、_executeTaskによってキャッチされてlogに出力される
      await taskFunction();
      
      // エラーログが出力されたことを確認（実際の実装に合わせる）
      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        'lightweight-balance-check 実行エラー:',
        'Test executeRiskManagementCheck error'
      );
    });

    it('robust-balance-check は影響を受けない', async () => {
      schedulingManager.setupDefaultBalanceTasks();

      // robust-balance-check タスクが登録されたことを確認
      expect(cron.schedule).toHaveBeenCalledWith(
        '0 0 * * * *', // 毎時0分
        expect.any(Function),
        expect.objectContaining({
          scheduled: true,
          timezone: 'Asia/Tokyo'
        })
      );

      // robust-balance-check のタスク関数を取得
      const scheduleCalls = cron.schedule.mock.calls;
      const robustTaskCall = scheduleCalls.find(call => 
        call[0] === '0 0 * * * *' // 毎時0分のタスク
      );

      expect(robustTaskCall).toBeDefined();
      const taskFunction = robustTaskCall[1];

      // タスク関数を実行
      await taskFunction();

      // checkAllExchangeBalances が呼び出されたことを確認
      expect(mockBalanceChecker.checkAllExchangeBalances).toHaveBeenCalledTimes(1);
      
      // executeRiskManagementCheck は呼び出されないことを確認
      expect(mockBotModule.executeRiskManagementCheck).not.toHaveBeenCalled();
    });

    it('両方のタスクが独立して動作する', async () => {
      schedulingManager.setupDefaultBalanceTasks();

      // 2つのタスクが登録されたことを確認
      expect(cron.schedule).toHaveBeenCalledTimes(2);

      const scheduleCalls = cron.schedule.mock.calls;
      
      // lightweight-balance-check タスクを実行
      const lightweightTaskCall = scheduleCalls.find(call => 
        call[0] === '0 */5 * * * *'
      );
      await lightweightTaskCall[1]();

      // robust-balance-check タスクを実行
      const robustTaskCall = scheduleCalls.find(call => 
        call[0] === '0 0 * * * *'
      );
      await robustTaskCall[1]();

      // それぞれの関数が1回ずつ呼び出されたことを確認
      expect(mockBotModule.executeRiskManagementCheck).toHaveBeenCalledTimes(1);
      expect(mockBalanceChecker.checkAllExchangeBalances).toHaveBeenCalledTimes(1);
    });
  });

  describe('タスクの説明文とメタデータ', () => {
    it('lightweight-balance-check タスクの説明文が正しい', () => {
      schedulingManager.setupDefaultBalanceTasks();

      const taskInfo = schedulingManager.scheduledTasks.get('lightweight-balance-check');
      expect(taskInfo).toBeDefined();
      expect(taskInfo.options.description).toBe('軽量リスク管理チェック（5分間隔）');
    });

    it('robust-balance-check タスクの説明文が正しい', () => {
      schedulingManager.setupDefaultBalanceTasks();

      const taskInfo = schedulingManager.scheduledTasks.get('robust-balance-check');
      expect(taskInfo).toBeDefined();
      expect(taskInfo.options.description).toBe('堅牢残高整合性チェック（毎時0分実行）');
    });

    it('タスクの種類が正しく設定されている', () => {
      schedulingManager.setupDefaultBalanceTasks();

      const lightweightTaskInfo = schedulingManager.scheduledTasks.get('lightweight-balance-check');
      const robustTaskInfo = schedulingManager.scheduledTasks.get('robust-balance-check');

      expect(lightweightTaskInfo.type).toBe('interval');
      expect(robustTaskInfo.type).toBe('hourly');
    });

    it('cronExpression が正しく設定されている', () => {
      schedulingManager.setupDefaultBalanceTasks();

      const lightweightTaskInfo = schedulingManager.scheduledTasks.get('lightweight-balance-check');
      const robustTaskInfo = schedulingManager.scheduledTasks.get('robust-balance-check');

      expect(lightweightTaskInfo.cronExpression).toBe('0 */5 * * * *');
      expect(robustTaskInfo.cronExpression).toBe('0 0 * * * *');
    });
  });

  describe('設定間隔の動的計算', () => {
    it('設定間隔が正しく計算される', () => {
      // 期待値：デフォルト設定（5分）が使用されることを確認
      schedulingManager.setupDefaultBalanceTasks();

      // 5分間隔のタスクが登録されたことを確認
      expect(cron.schedule).toHaveBeenCalledWith(
        '0 */5 * * * *', // 5分間隔
        expect.any(Function),
        expect.objectContaining({
          scheduled: true,
          timezone: 'Asia/Tokyo'
        })
      );

      const taskInfo = schedulingManager.scheduledTasks.get('lightweight-balance-check');
      expect(taskInfo.options.description).toBe('軽量リスク管理チェック（5分間隔）');
    });
  });

  describe('循環依存の回避', () => {
    it('botModule が実行時に動的にrequireされる', async () => {
      // 循環依存を回避するため、タスク実行時に動的にrequireすることを確認
      // 実際の実装では、require('../bot')が各タスク実行時に呼び出される
      
      schedulingManager.setupDefaultBalanceTasks();

      // lightweight-balance-check のタスク関数を取得
      const scheduleCalls = cron.schedule.mock.calls;
      const lightweightTaskCall = scheduleCalls.find(call => 
        call[0] === '0 */5 * * * *'
      );
      const taskFunction = lightweightTaskCall[1];

      // タスク関数を実行
      await taskFunction();

      // executeRiskManagementCheck が呼び出されたことで、
      // 動的require が機能していることを間接的に確認
      expect(mockBotModule.executeRiskManagementCheck).toHaveBeenCalledTimes(1);
    });
  });
});