/**
 * Issue #1064 修正のテスト（Issue #1147 修正後の実装に更新）
 * schedulingManagerのlightweight-balance-checkスケジューラー修正内容を検証
 * 
 * 修正内容：
 * - lightweight-balance-checkスケジューラーがcompareBalancesの代わりに
 *   checkAllExchangeBalancesを呼び出すように変更（Issue #1147修正後）
 * - 循環依存を回避するため、balanceCheckerを実行時に動的にrequire
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

// balanceChecker のモック（Issue #1064 修正の対象、Issue #1147修正後のリファクタリング対応）
const mockBalanceChecker = {
  checkAllExchangeBalances: jest.fn(),
  checkSingleExchange: jest.fn()
};

jest.mock('../../../src/common/balanceChecker', () => mockBalanceChecker);

// botModule のモック（robust-balance-check用）
const mockBotModule = {
  executeRiskManagementCheck: jest.fn()
};

jest.mock('../../../src/bot', () => mockBotModule);

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

describe('Issue #1064: schedulingManager lightweight-balance-check修正テスト（Issue #1147修正後）', () => {
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
    
    // mockBalanceChecker の初期化（Issue #1147修正後のリファクタリング対応）
    mockBalanceChecker.checkAllExchangeBalances = jest.fn().mockResolvedValue([]);
    mockBalanceChecker.checkSingleExchange = jest.fn().mockResolvedValue({
      exchangeId: 'bitbank',
      isHealthy: true,
      discrepancyCount: 0,
      discrepancies: []
    });
    mockBotModule.executeRiskManagementCheck = jest.fn().mockResolvedValue();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('lightweight-balance-check スケジューラーの修正', () => {
    it('checkSingleExchange が正常に呼び出される（軽量チェック）', async () => {
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

      // checkSingleExchange が bitbank で呼び出されたことを確認（軽量チェック）
      expect(mockBalanceChecker.checkSingleExchange).toHaveBeenCalledTimes(1);
      expect(mockBalanceChecker.checkSingleExchange).toHaveBeenCalledWith('bitbank');
      // checkAllExchangeBalances は呼び出されないことを確認
      expect(mockBalanceChecker.checkAllExchangeBalances).not.toHaveBeenCalled();
    });

    it('checkSingleExchange でエラーが発生した場合の処理', async () => {
      // checkSingleExchange でエラーを発生させる
      const testError = new Error('Test checkSingleExchange error');
      mockBalanceChecker.checkSingleExchange = jest.fn().mockRejectedValue(testError);

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
        'Test checkSingleExchange error'
      );
    });

    it('軽量残高チェックで例外が発生した場合の処理', async () => {
      // checkSingleExchange で例外を発生させる
      const testError = new Error('軽量残高チェックの実行に失敗しました');
      mockBalanceChecker.checkSingleExchange = jest.fn().mockRejectedValue(testError);

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
        '軽量残高チェックの実行に失敗しました'
      );
    });

    it('robust-balance-check は影響を受けない（包括的チェック）', async () => {
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

      // checkAllExchangeBalances が呼び出されたことを確認（包括的チェック）
      expect(mockBalanceChecker.checkAllExchangeBalances).toHaveBeenCalledTimes(1);
      // checkSingleExchange は呼び出されないことを確認
      expect(mockBalanceChecker.checkSingleExchange).not.toHaveBeenCalled();
      
      // executeRiskManagementCheck は呼び出されないことを確認（robust-balance-check用）
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

      // それぞれの関数が適切に呼び出されたことを確認
      expect(mockBalanceChecker.checkSingleExchange).toHaveBeenCalledTimes(1); // lightweight のみ
      expect(mockBalanceChecker.checkAllExchangeBalances).toHaveBeenCalledTimes(1); // robust のみ
      expect(mockBotModule.executeRiskManagementCheck).toHaveBeenCalledTimes(0); // どちらも呼び出さない
    });
  });

  describe('タスクの説明文とメタデータ', () => {
    it('lightweight-balance-check タスクの説明文が正しい', () => {
      schedulingManager.setupDefaultBalanceTasks();

      const taskInfo = schedulingManager.scheduledTasks.get('lightweight-balance-check');
      expect(taskInfo).toBeDefined();
      expect(taskInfo.options.description).toBe('軽量残高チェック（主要取引所・5分間隔）');
    });

    it('robust-balance-check タスクの説明文が正しい', () => {
      schedulingManager.setupDefaultBalanceTasks();

      const taskInfo = schedulingManager.scheduledTasks.get('robust-balance-check');
      expect(taskInfo).toBeDefined();
      expect(taskInfo.options.description).toBe('堅牢残高整合性チェック（全取引所・毎時0分実行）');
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
      expect(taskInfo.options.description).toBe('軽量残高チェック（主要取引所・5分間隔）');
    });
  });

  describe('DRY原則対応', () => {
    it('balanceChecker がコンストラクタで一度だけrequireされる', async () => {
      // DRY原則に従い、コンストラクタで一度だけrequireすることを確認
      // 実際の実装では、this.balanceCheckerがコンストラクタで設定される
      
      schedulingManager.setupDefaultBalanceTasks();

      // lightweight-balance-check のタスク関数を取得
      const scheduleCalls = cron.schedule.mock.calls;
      const lightweightTaskCall = scheduleCalls.find(call => 
        call[0] === '0 */5 * * * *'
      );
      const taskFunction = lightweightTaskCall[1];

      // タスク関数を実行
      await taskFunction();

      // checkSingleExchange が呼び出されたことで、
      // this.balanceChecker が機能していることを間接的に確認
      expect(mockBalanceChecker.checkSingleExchange).toHaveBeenCalledTimes(1);
    });
  });
});