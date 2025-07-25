/**
 * Issue #5204修正のテスト: backtestサービスで例外が発生する問題
 * 再起動ループを防ぐ改良されたエラーハンドリングのテスト
 */

const fs = require('fs');
const path = require('path');

describe('Backtest Service Issue #5204 Fix', () => {
  let originalConsoleLog;
  let originalConsoleError;
  let originalProcessExit;
  let consoleOutput;
  let errorOutput;
  let processExitCalled;
  
  beforeEach(() => {
    // コンソール出力をキャプチャ
    consoleOutput = [];
    errorOutput = [];
    processExitCalled = false;
    
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    originalProcessExit = process.exit;
    
    console.log = (...args) => {
      consoleOutput.push(args.join(' '));
    };
    
    console.error = (...args) => {
      errorOutput.push(args.join(' '));
    };
    
    process.exit = (code) => {
      processExitCalled = { code };
    };
    
    // TEST_MODEを設定してテスト実行を防ぐ
    process.env.TEST_MODE = 'true';
  });
  
  afterEach(() => {
    // 元の関数を復元
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.exit = originalProcessExit;
    
    delete process.env.TEST_MODE;
  });

  test('backtestRunner.jsファイルが存在し、修正されたエラーハンドリングコードが含まれている', () => {
    const backtestRunnerPath = path.join(__dirname, '../src/backtestRunner.js');
    expect(fs.existsSync(backtestRunnerPath)).toBe(true);
    
    const content = fs.readFileSync(backtestRunnerPath, 'utf8');
    
    // Issue #5204修正コメントが存在することを確認
    expect(content).toMatch(/Issue #5204 修正.*再起動ループを防ぐ改良されたエラーハンドリング/);
    
    // 再試行ロジックの重要な要素が存在することを確認
    expect(content).toMatch(/consecutiveFailures/);
    expect(content).toMatch(/MAX_CONSECUTIVE_FAILURES/);
    expect(content).toMatch(/BASE_RETRY_DELAY/);
    expect(content).toMatch(/startBacktestWithRetry/);
    
    // 指数バックオフの実装が存在することを確認
    expect(content).toMatch(/Math\.pow\(2, consecutiveFailures - 1\)/);
  });

  test('改良されたエラーハンドリングロジックが正しく実装されている', () => {
    const backtestRunnerPath = path.join(__dirname, '../src/backtestRunner.js');
    const content = fs.readFileSync(backtestRunnerPath, 'utf8');
    
    // 即座にprocess.exit(1)を呼び出すのではなく、再試行ロジックがあることを確認
    const lines = content.split('\n');
    let foundRetryLogic = false;
    let foundConditionalExit = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // 再試行ロジックの存在確認
      if (line.includes('consecutiveFailures < MAX_CONSECUTIVE_FAILURES')) {
        foundRetryLogic = true;
      }
      
      // 条件付きprocess.exit(1)の存在確認（エラー種別に応じた終了処理）
      if (line.includes('process.exit(1)')) {
        // process.exit(1)の前後10行以内にエラー処理に関するメッセージがあるかチェック
        for (let j = Math.max(0, i-10); j <= Math.min(lines.length-1, i+10); j++) {
          if (lines[j].includes('設定エラーが検出されました') || 
              lines[j].includes('リトライが無効なエラー種別') ||
              lines[j].includes('最大リトライ回数') ||
              lines[j].includes('手動での確認が必要') ||
              lines[j].includes('strategy.immediateStop') ||
              lines[j].includes('strategy.shouldRetry')) {
            foundConditionalExit = true;
            break;
          }
        }
      }
    }
    
    expect(foundRetryLogic).toBe(true);
    expect(foundConditionalExit).toBe(true);
  });

  test('エラーハンドリングの定数値が適切に設定されている', () => {
    const backtestRunnerPath = path.join(__dirname, '../src/backtestRunner.js');
    const content = fs.readFileSync(backtestRunnerPath, 'utf8');
    
    // MAX_CONSECUTIVE_FAILURESが3に設定されていることを確認
    expect(content).toMatch(/const MAX_CONSECUTIVE_FAILURES = 3/);
    
    // BASE_RETRY_DELAYが10秒に設定されていることを確認
    expect(content).toMatch(/const BASE_RETRY_DELAY = 10000/);
  });

  test('Discord通知のエラーハンドリングが改善されている', () => {
    const backtestRunnerPath = path.join(__dirname, '../src/backtestRunner.js');
    const content = fs.readFileSync(backtestRunnerPath, 'utf8');
    
    // エラー分類に関する実装が含まれていることを確認
    expect(content).toMatch(/BacktestErrorClassifier\.analyzeError/);
    
    // 統一エラーハンドラーが含まれていることを確認
    expect(content).toMatch(/unifiedErrorHandler\.handleError/);
    
    // 致命的エラー時の特別なDiscord通知が含まれていることを確認
    expect(content).toMatch(/バックテスト致命的エラー.*連続で失敗しました/);
  });

  test('TEST_MODEでの実行時は起動処理がスキップされる', () => {
    // TEST_MODEが設定されている場合、実際の起動処理は実行されない
    const backtestRunnerPath = path.join(__dirname, '../src/backtestRunner.js');
    
    // ファイルをrequireしても実際の処理は実行されないことを確認
    expect(() => {
      require(backtestRunnerPath);
    }).not.toThrow();
    
    // process.exitが呼ばれていないことを確認
    expect(processExitCalled).toBe(false);
  });

  test('エラーハンドリングの改善により無限再起動ループが防止される', () => {
    const backtestRunnerPath = path.join(__dirname, '../src/backtestRunner.js');
    const content = fs.readFileSync(backtestRunnerPath, 'utf8');
    
    // 古い実装（即座にprocess.exit(1)）が削除されていることを確認
    const oldImplementationPattern = /process\.exit\(1\);\s*}\s*,\s*ERROR_WAIT_TIME\)/;
    expect(content).not.toMatch(oldImplementationPattern);
    
    // 新しい実装で再試行ロジックが実装されていることを確認
    expect(content).toMatch(/while \(consecutiveFailures < MAX_CONSECUTIVE_FAILURES\)/);
    
    // 指数バックオフによる待機時間の計算が実装されていることを確認
    expect(content).toMatch(/retryDelay = BASE_RETRY_DELAY \* Math\.pow\(2, consecutiveFailures - 1\)/);
  });

  test('コードの品質: 適切なログレベルとメッセージが使用されている', () => {
    const backtestRunnerPath = path.join(__dirname, '../src/backtestRunner.js');
    const content = fs.readFileSync(backtestRunnerPath, 'utf8');
    
    // 適切なログレベルが使用されていることを確認
    expect(content).toMatch(/logWithLevel\('error'/);
    expect(content).toMatch(/logWithLevel\('info'/);
    
    // ユーザーに分かりやすいメッセージが含まれていることを確認  
    expect(content).toMatch(/consecutiveFailures/);
    expect(content).toMatch(/秒後に再試行します/);
    expect(content).toMatch(/手動での確認が必要です/);
  });
});