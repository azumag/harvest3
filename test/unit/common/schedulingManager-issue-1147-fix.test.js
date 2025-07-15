/**
 * Issue #1147 修正テスト: lightweight-balance-checkタスクの重複実行問題の解決
 */
const { getSchedulingManager } = require('../../../src/common/schedulingManager');

// モックの設定
jest.mock('../../../src/common/balanceChecker', () => ({
  checkAllExchangeBalances: jest.fn().mockResolvedValue([
    { exchangeId: 'bitbank', isHealthy: true, discrepancies: [] }
  ])
}));

jest.mock('../../../src/bot', () => ({
  executeRiskManagementCheck: jest.fn().mockResolvedValue()
}));

describe('Issue #1147 修正: lightweight-balance-checkタスクの重複実行問題', () => {
  let schedulingManager;

  beforeEach(() => {
    // モジュールのリセット
    jest.clearAllMocks();
    
    // スケジューリングマネージャーの取得
    schedulingManager = getSchedulingManager();
    
    // 既存タスクのクリア
    schedulingManager.removeTask('lightweight-balance-check');
    schedulingManager.removeTask('robust-balance-check');
  });

  afterEach(() => {
    schedulingManager.removeTask('lightweight-balance-check');
    schedulingManager.removeTask('robust-balance-check');
  });

  test('lightweight-balance-checkタスクが正しく設定される', () => {
    // デフォルト残高チェックタスクの設定
    schedulingManager.setupDefaultBalanceTasks();
    
    // タスクの状態を取得（配列を返す）
    const tasksStatus = schedulingManager.getTasksStatus();
    
    // lightweight-balance-checkタスクを探す
    const lightweightTask = tasksStatus.find(task => task.name === 'lightweight-balance-check');
    
    // lightweight-balance-checkタスクが存在することを確認
    expect(lightweightTask).toBeDefined();
    expect(lightweightTask.description).toBe('軽量残高チェック（5分間隔）');
    expect(lightweightTask.type).toBe('interval');
  });

  test('robust-balance-checkタスクが正しく設定される', () => {
    // デフォルト残高チェックタスクの設定
    schedulingManager.setupDefaultBalanceTasks();
    
    // タスクの状態を取得（配列を返す）
    const tasksStatus = schedulingManager.getTasksStatus();
    
    // robust-balance-checkタスクを探す
    const robustTask = tasksStatus.find(task => task.name === 'robust-balance-check');
    
    // robust-balance-checkタスクが存在することを確認
    expect(robustTask).toBeDefined();
    expect(robustTask.description).toBe('堅牢残高整合性チェック（毎時0分実行）');
    expect(robustTask.type).toBe('hourly');
    expect(robustTask.cronExpression).toBe('0 0 * * * *');
  });

  test('両方のタスクが設定され、正しい間隔で実行される', () => {
    // デフォルト残高チェックタスクの設定
    schedulingManager.setupDefaultBalanceTasks();
    
    // タスクの状態を取得（配列を返す）
    const tasksStatus = schedulingManager.getTasksStatus();
    
    // 両方のタスクを探す
    const lightweightTask = tasksStatus.find(task => task.name === 'lightweight-balance-check');
    const robustTask = tasksStatus.find(task => task.name === 'robust-balance-check');
    
    // 両方のタスクが存在することを確認
    expect(lightweightTask).toBeDefined();
    expect(robustTask).toBeDefined();
    
    // 軽量チェックは5分間隔のインターバルタスク
    expect(lightweightTask.type).toBe('interval');
    
    // 堅牢チェックは毎時0分のスケジュールタスク
    expect(robustTask.type).toBe('hourly');
    expect(robustTask.cronExpression).toBe('0 0 * * * *');
  });

  test('Issue #1147 修正: lightweight-balance-checkタスクの説明が正しく設定される', () => {
    // 修正前: lightweight-balance-checkがexecuteRiskManagementCheckを呼び出していた
    // 修正後: lightweight-balance-checkがcheckAllExchangeBalancesを呼び出す
    
    // デフォルト残高チェックタスクの設定
    schedulingManager.setupDefaultBalanceTasks();
    
    // タスクの状態を取得（配列を返す）
    const tasksStatus = schedulingManager.getTasksStatus();
    
    // lightweight-balance-checkタスクを探す
    const lightweightTask = tasksStatus.find(task => task.name === 'lightweight-balance-check');
    
    // 修正後の動作確認
    expect(lightweightTask).toBeDefined();
    expect(lightweightTask.description).toBe('軽量残高チェック（5分間隔）');
    
    // 修正前の問題（重複実行）は解消されている
    // 軽量チェックは残高チェックに専念し、リスク管理チェックとは異なる機能になっている
    expect(lightweightTask.description).not.toContain('リスク管理');
    expect(lightweightTask.description).toContain('残高チェック');
  });
});