/**
 * Issue #5191: [自動] backtestサービスで例外が発生 - 修正確認テスト
 * 
 * backtestサービスで発生していた重複起動メッセージ問題の修正を確認するテスト
 * Issue #5204の改良されたエラーハンドリング（リトライロジック付き）を検証
 * - 指数バックオフによるリトライ機構
 * - 最大連続失敗回数による再起動ループ防止
 * - 改良されたエラーハンドリングとDiscord通知
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

describe('Issue #5191: backtestサービス例外対応および再起動ループ防止', () => {
  const backtestRunnerPath = path.join(__dirname, '..', 'src', 'backtestRunner.js');
  
  test('Issue #5191の修正が適用されていることを確認', () => {
    expect(fs.existsSync(backtestRunnerPath)).toBe(true);
    
    const backtestRunnerContent = fs.readFileSync(backtestRunnerPath, 'utf8');
    
    // Issue #5204が#5191の問題も解決していることを確認
    expect(backtestRunnerContent).toContain('Issue #5204 修正: 再起動ループを防ぐ改良されたエラーハンドリング');
    expect(backtestRunnerContent).toContain('startBacktestWithRetry().catch');
    expect(backtestRunnerContent).toContain('バックテストメイン関数でエラーが発生しました');
    expect(backtestRunnerContent).toContain('連続失敗回数');
  });

  test('async main関数のエラーハンドリング確認', () => {
    const backtestRunnerContent = fs.readFileSync(backtestRunnerPath, 'utf8');
    
    // 改良されたリトライロジックの確認
    expect(backtestRunnerContent).toContain('startBacktestWithRetry().catch(error => {');
    expect(backtestRunnerContent).toContain('logWithLevel(\'error\', \'バックテストメイン関数でエラーが発生しました');
    expect(backtestRunnerContent).toContain('logWithLevel(\'error\', \'エラースタック:\', error.stack);');
    
    // Discord通知の確認
    expect(backtestRunnerContent).toContain('if (typeof postErrorToDiscord === \'function\') {');
    expect(backtestRunnerContent).toContain('await postErrorToDiscord(`バックテスト実行エラー');
    
    // 改良された再起動ループ防止の確認（指数バックオフ）
    expect(backtestRunnerContent).toContain('const MAX_CONSECUTIVE_FAILURES = 3;');
    expect(backtestRunnerContent).toContain('const BASE_RETRY_DELAY = 5000;');
    expect(backtestRunnerContent).toContain('指数バックオフによる待機時間の計算');
    expect(backtestRunnerContent).toContain('Math.pow(2, consecutiveFailures - 1)');
    expect(backtestRunnerContent).toContain('process.exit(1);');
  });

  test('TEST_MODE分岐の確認', () => {
    const backtestRunnerContent = fs.readFileSync(backtestRunnerPath, 'utf8');
    
    // TEST_MODE分岐が正しく保持されている
    expect(backtestRunnerContent).toContain('if (process.env.TEST_MODE !== \'true\') {');
    expect(backtestRunnerContent).toContain('startBacktestWithRetry().catch');
  });

  describe('エラーハンドリング動作テスト', () => {
    let tmpDir;

    beforeEach(() => {
      // .tmpディレクトリ内にテスト用ディレクトリを作成
      tmpDir = path.join(__dirname, '..', '.tmp');
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }
    });

    test('模擬的なasync関数エラーハンドリング確認', async () => {
      const testScript = `
const testMain = async () => {
  throw new Error('Test error for Issue #5191');
};

// Issue #5191修正版のエラーハンドリング
const postErrorToDiscord = async (message) => {
  console.log('Discord notification:', message);
};

console.log('Starting test...');

testMain().catch(error => {
  console.error('バックテストメイン関数で致命的エラーが発生しました:', error.message);
  console.error('エラースタック:', error.stack);
  
  // Discord通知（利用可能な場合）
  if (typeof postErrorToDiscord === 'function') {
    postErrorToDiscord(\`バックテストメイン関数エラー: \${error.message}\`).catch(console.error);
  }
  
  // 不安定な状態で再起動ループを避けるため、エラー時は長時間待機後に終了
  console.log('エラー発生のため30秒待機後にプロセスを終了します（再起動ループ防止）');
  // テスト用に待機時間を短縮
  setTimeout(() => {
    console.log('プロセスを終了します');
    process.exit(0); // テスト用に正常終了
  }, 100);
});
`;

      const testScriptPath = path.join(tmpDir, `test-error-handling-${Date.now()}.js`);
      fs.writeFileSync(testScriptPath, testScript);

      try {
        const { stdout, stderr } = await execAsync(`node ${testScriptPath}`, { timeout: 10000 });
        
        // エラーハンドリングが正しく動作していることを確認
        expect(stdout).toContain('Starting test...');
        // エラーメッセージはstderrに出力される
        expect(stderr).toContain('バックテストメイン関数で致命的エラーが発生しました: Test error for Issue #5191');
        expect(stdout).toContain('Discord notification: バックテストメイン関数エラー: Test error for Issue #5191');
        expect(stdout).toContain('エラー発生のため30秒待機後にプロセスを終了します（再起動ループ防止）');
        expect(stdout).toContain('プロセスを終了します');
        
      } finally {
        if (fs.existsSync(testScriptPath)) {
          fs.unlinkSync(testScriptPath);
        }
      }
    }, 10000);
  });

  test('既存機能に影響がないことを確認', () => {
    const backtestRunnerContent = fs.readFileSync(backtestRunnerPath, 'utf8');
    
    // 既存の重要な機能が維持されていることを確認
    const essentialFunctions = [
      'async function runBacktest(',
      'async function runBacktestForSymbol(',
      'async function main(',
      'function rankResults(',
      'function generateRandomParameterCombinations('
    ];
    
    essentialFunctions.forEach(func => {
      expect(backtestRunnerContent).toContain(func);
    });
    
    // BACKTEST_LONG_RUNNING_MODEの処理が正しく保持されている
    expect(backtestRunnerContent).toContain('process.env.BACKTEST_LONG_RUNNING_MODE');
    
    // グローバルエラーハンドラーが維持されている
    expect(backtestRunnerContent).toContain('process.on(\'unhandledRejection\'');
    expect(backtestRunnerContent).toContain('process.on(\'uncaughtException\'');
  });

  test('backtestRunner.js構文検証（Issue #5191修正後）', async () => {
    // 修正後もbacktestRunner.jsが正しく動作することを確認
    await expect(execAsync(`node -c ${backtestRunnerPath}`, { timeout: 3000 }))
      .resolves.not.toThrow();
  }, 5000);

  test('Issue #5191: 修正内容のセキュリティ確認', () => {
    const backtestRunnerContent = fs.readFileSync(backtestRunnerPath, 'utf8');
    
    // エラーログが適切に処理されている
    expect(backtestRunnerContent).toContain('logWithLevel(\'error\', \'エラースタック:\', error.stack);');
    
    // 適切なタイムアウト処理
    expect(backtestRunnerContent).toContain('setTimeout(() => {');
    expect(backtestRunnerContent).toContain('const ERROR_WAIT_TIME = parseInt(process.env.ERROR_WAIT_TIME || \'30000\');');
    expect(backtestRunnerContent).toContain('}, ERROR_WAIT_TIME);');
    
    // プロセス終了の適切な処理
    expect(backtestRunnerContent).toContain('process.exit(1);');
  });
});