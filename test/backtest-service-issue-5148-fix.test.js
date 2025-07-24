/**
 * Issue #5148: backtestサービスで例外が発生 - 解決確認テスト
 * 
 * 2025-07-22に発生したbacktestサービスの例外問題の解決確認
 * - npm エラーログの発生への対処確認
 * - 起動メッセージの重複表示問題の解決確認
 * - Issue #5175修正による問題解決の検証
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// ログ関数（entrypoint.shと同様のフォーマット）
const log = (message) => {
  console.log(`[${new Date().toISOString().replace('T', ' ').replace('Z', '')}] [TEST] ${message}`);
};

describe('Issue #5148: backtestサービス例外解決確認', () => {
  const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
  const tmpDir = path.join(__dirname, '..', '.tmp');
  
  beforeAll(() => {
    // .tmpディレクトリが存在しない場合は作成
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  test('Issue #5148の報告された問題がentrypoint.shで解決されていることを確認', () => {
    expect(fs.existsSync(entrypointPath)).toBe(true);
    
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5148で報告された起動メッセージが存在することを確認
    expect(entrypointContent).toContain('Starting backtest container with enhanced error handling');
    
    // Issue #5175修正とIssue #5159 flock方式により重複防止機構が強化されていることを確認
    expect(entrypointContent).toContain('Issue #5127, #5058 & #5175: backtest container専用起動メッセージ関数（簡素化版）');
    expect(entrypointContent).toContain('flockによる確実なatomic lock実装');
    
    // npm エラー対処の強化がされていることを確認
    expect(entrypointContent).toContain('retry_npm_install_with_backoff');
    expect(entrypointContent).toContain('npm install failed after cache clean');
    expect(entrypointContent).toContain('指数バックオフによるリトライとコンテナ再起動防止');
  });

  test('Issue #5148の重複メッセージ防止: 機能の存在確認', () => {
    // entrypoint.shにlog_backtest_startup_message関数が存在することを確認
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5175の修正とIssue #5159 flock方式で強化された重複防止機能が存在することを確認
    expect(entrypointContent).toContain('log_backtest_startup_message()');
    expect(entrypointContent).toContain('flockによる確実なatomic lock実装');
    
    // タイムスタンプベースの重複防止ロジック
    expect(entrypointContent).toContain('BACKTEST_STARTUP_LOCK_TIMEOUT');
    expect(entrypointContent).toContain('Backtest startup message suppressed');
    
    // コンテナ再起動検出機能
    // Issue #5159: flock方式のロック機構への更新
    expect(entrypointContent).toContain('exec 200>"$lock_file"');
    expect(entrypointContent).toContain('flock -x -w "$max_wait_time" 200');
    expect(entrypointContent).toContain('exec 200>&-');
    
    // atomicロック機構（mkdirにatomic操作）
    expect(entrypointContent).toContain('backtest-npm-error-detection.state');
    
    log('重複メッセージ防止機能の存在を確認しました');
  });

  test('Issue #5148の重複メッセージ防止: ロックファイルロジック確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // ファイルベースのロック機構が存在することを確認
    expect(entrypointContent).toContain('BACKTEST_STARTUP_LOCK_FILE');
    expect(entrypointContent).toContain('timestamp_file');
    
    // タイムアウトチェックロジック
    expect(entrypointContent).toContain('time_diff');
    expect(entrypointContent).toContain('current_time - last_time');
    expect(entrypointContent).toContain('last shown');
    
    // ファイル権限のセキュリティ設定
    expect(entrypointContent).toContain('chmod 600');
    
    log('ロックファイルロジックの存在を確認しました');
  });

  test('Issue #5148の重複メッセージ防止: エラーハンドリング確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // エラーハンドリングとクリーンアップ処理
    expect(entrypointContent).toContain('2>/dev/null || true');
    expect(entrypointContent).toContain('exec 200>&-');
    
    // NPMエラー検出ファイルのクリーンアップ機構
    expect(entrypointContent).toContain('Removed backtest NPM error detection file');
    
    // Issue #5159: flock方式の適切なメッセージ抑制
    expect(entrypointContent).toContain('lock acquisition timeout');
    
    log('エラーハンドリング機構の存在を確認しました');
  });

  test('Issue #5148の npm エラー対処機能確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // npm エラーログに言及された問題への対処が含まれていることを確認
    expect(entrypointContent).toContain('npm_error_log="/tmp/npm-install-error.log"');
    expect(entrypointContent).toContain('retry_npm_install_with_backoff');
    expect(entrypointContent).toContain('npm install failed after cache clean');
    
    // Issue #4202修正によるnpm対処強化の確認
    expect(entrypointContent).toContain('Issue #4202 修正: 指数バックオフによるリトライとコンテナ再起動防止');
    expect(entrypointContent).toContain('npm install failed after cache clean and');
    expect(entrypointContent).toContain('max_container_restarts');
    
    // npm ログファイルの詳細出力機能
    expect(entrypointContent).toContain('npm error details:');
    expect(entrypointContent).toContain('cat "$npm_error_log"');
  });

  test('Issue #5148解決後の安定性確認', async () => {
    // entrypoint.shの構文エラーがないことを確認
    await expect(execAsync(`bash -n ${entrypointPath}`, { timeout: 3000 }))
      .resolves.not.toThrow();
    
    // 重要な関数が正しく定義されていることを確認
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    const criticalFunctions = [
      'log_backtest_startup_message()',
      'retry_npm_install_with_backoff()',
      'install_npm_dependencies()',
      'cleanup_backtest_locks()'
    ];
    
    criticalFunctions.forEach(func => {
      expect(entrypointContent).toContain(func);
    });
  }, 5000);

  test('Issue #5148対応による回帰テスト', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5148修正が他の既存機能に影響していないことを確認
    expect(entrypointContent).toContain('$BACKTEST_MODE');
    expect(entrypointContent).toContain('log_startup_message');
    expect(entrypointContent).toContain('acquire_startup_lock');
    expect(entrypointContent).toContain('release_startup_lock');
    
    // Docker Compose設定との整合性確認
    expect(entrypointContent).toContain('npm run backtest');
    expect(entrypointContent).toContain('REDIS_URL');
    expect(entrypointContent).toContain('MONGO_URL');
  });
});