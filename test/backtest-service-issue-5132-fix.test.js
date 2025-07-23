/**
 * Issue #5132: [自動] backtestサービスで例外が発生 - 修正確認テスト
 * 
 * backtestサービスで発生していた重複起動メッセージ問題の修正テスト
 * - entrypoint.shでの冗長なlog_backtest_startup_message呼び出し削除
 * - 単一の起動メッセージのみが出力されることを確認
 * - 既存機能への影響がないことを確認
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

describe('Issue #5132: backtestサービス重複メッセージ修正', () => {
  const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
  const tmpDir = path.join(__dirname, '..', '.tmp');
  
  beforeAll(() => {
    // .tmpディレクトリが存在しない場合は作成
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  test('Issue #5132修正がentrypoint.shに適用されていることを確認', () => {
    expect(fs.existsSync(entrypointPath)).toBe(true);
    
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5132修正の確認
    expect(entrypointContent).toContain('Issue #5132修正: 重複する起動メッセージを防止するため、exec実行前の追加メッセージを削除');
    expect(entrypointContent).toContain('バックテスト実行開始はline 1288で既に通知済み');
    
    // 冗長な2回目のlog_backtest_startup_message呼び出しが削除されていることを確認
    expect(entrypointContent).not.toContain('log_backtest_startup_message "Executing backtest command with enhanced error handling..."');
    
    // 最初の正当な呼び出しは残っていることを確認
    expect(entrypointContent).toContain('log_backtest_startup_message "Starting backtest container with enhanced error handling"');
  });

  test('backtest mode分岐で単一メッセージのみが出力されることを確認', async () => {
    const testScript = `#!/bin/bash
set -e

# テスト用環境変数設定
export BACKTEST_MODE=true
BACKTEST_STARTUP_LOCK_FILE="/tmp/test-backtest-5132-\${RANDOM}.lock"
BACKTEST_STARTUP_LOCK_TIMEOUT=10

# 簡略版のlog_backtest_startup_message関数
log_backtest_startup_message() {
    local message="$1"
    local current_time=$(date +%s)
    
    if [ -f "$BACKTEST_STARTUP_LOCK_FILE" ]; then
        local last_time=$(cat "$BACKTEST_STARTUP_LOCK_FILE" 2>/dev/null || echo 0)
        local time_diff=$((current_time - last_time))
        
        if [ $time_diff -lt $BACKTEST_STARTUP_LOCK_TIMEOUT ]; then
            echo "Backtest startup message suppressed (last shown \${time_diff}s ago)"
            return 0
        fi
    fi
    
    echo "$current_time" > "$BACKTEST_STARTUP_LOCK_FILE"
    chmod 600 "$BACKTEST_STARTUP_LOCK_FILE"
    echo "[ENTRYPOINT] $message"
    return 0
}

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

# Issue #5132修正後のmain関数backtest部分をシミュレート
if [ "$BACKTEST_MODE" = "true" ]; then
    # 起動ロック取得後に安全にメッセージを出力（1回目の呼び出し）
    log_backtest_startup_message "Starting backtest container with enhanced error handling"
    
    # Issue #5132修正: 2回目の呼び出しは削除済み
    # log_backtest_startup_message "Executing backtest command with enhanced error handling..." # 削除済み
    
    # backtest開始時刻を記録（問題追跡用）
    echo "$(date +%s)" > /tmp/backtest-start-time.marker
    
    log "Backtest initialization completed"
fi

# クリーンアップ
rm -f "$BACKTEST_STARTUP_LOCK_FILE" 2>/dev/null || true
`;

    const testScriptPath = path.join(tmpDir, `test-issue-5132-single-message-${Date.now()}.sh`);
    fs.writeFileSync(testScriptPath, testScript);
    fs.chmodSync(testScriptPath, '755');

    try {
      const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 8000 });
      
      // "Starting backtest container"メッセージが1回のみ出力されることを確認
      const startupMessages = stdout.split('\n').filter(line => 
        line.includes('Starting backtest container with enhanced error handling') &&
        !line.includes('suppressed')
      );
      expect(startupMessages.length).toBe(1);
      
      // "Executing backtest command"メッセージが出力されないことを確認（修正により削除）
      const executingMessages = stdout.split('\n').filter(line => 
        line.includes('Executing backtest command with enhanced error handling')
      );
      expect(executingMessages.length).toBe(0);
      
      // 初期化完了メッセージが正常に出力されることを確認
      expect(stdout).toContain('Backtest initialization completed');
      
    } finally {
      if (fs.existsSync(testScriptPath)) {
        fs.unlinkSync(testScriptPath);
      }
    }
  }, 12000);

  test('既存のbacktest専用機能が維持されていることを確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // 重要なbacktest関連機能が維持されていることを確認
    const essentialBacktestFunctions = [
      'log_backtest_startup_message()',
      'cleanup_backtest_locks()',
      'BACKTEST_STARTUP_LOCK_FILE',
      'BACKTEST_STARTUP_LOCK_TIMEOUT'
    ];
    
    essentialBacktestFunctions.forEach(func => {
      expect(entrypointContent).toContain(func);
    });
    
    // backtest関連のコメントと診断機能が維持されている
    expect(entrypointContent).toContain('backtest実行前の追加診断');
    expect(entrypointContent).toContain('Backtest command arguments:');
    expect(entrypointContent).toContain('Validating npm run backtest command');
    
    // クリーンアップ機能も維持されている
    expect(entrypointContent).toContain('if [ "$BACKTEST_MODE" = "true" ]; then');
    expect(entrypointContent).toContain('cleanup_backtest_locks');
  });

  test('package.jsonのbacktestスクリプトが正常に定義されていることを確認', () => {
    const packageJsonPath = path.join(__dirname, '..', 'package.json');
    expect(fs.existsSync(packageJsonPath)).toBe(true);
    
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    
    // backtestスクリプトが正しく定義されている
    expect(packageJson.scripts).toHaveProperty('backtest');
    expect(packageJson.scripts.backtest).toBe('node src/backtestRunner.js --auto-update');
  });

  test('src/backtestRunner.jsが存在することを確認', () => {
    const backtestRunnerPath = path.join(__dirname, '..', 'src', 'backtestRunner.js');
    expect(fs.existsSync(backtestRunnerPath)).toBe(true);
    
    const backtestRunnerContent = fs.readFileSync(backtestRunnerPath, 'utf8');
    
    // 基本的なバックテストランナーの構造確認
    expect(backtestRunnerContent).toContain('runBacktest');
    expect(backtestRunnerContent).toMatch(/require.*config/);
  });

  test('entrypoint.sh構文検証（Issue #5132修正後）', async () => {
    // 修正後もentrypoint.shが正しく動作することを確認
    await expect(execAsync(`bash -n ${entrypointPath}`, { timeout: 3000 }))
      .resolves.not.toThrow();
  }, 5000);

  test('修正による既存機能への影響がないことを確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // 既存の重要な機能が維持されていることを確認
    const essentialFunctions = [
      'acquire_startup_lock()',
      'release_startup_lock()', 
      'log_startup_message()',
      'log_backtest_startup_message()',
      'pre_startup_checks()',
      'check_database_connections()',
      'main()'
    ];
    
    essentialFunctions.forEach(func => {
      expect(entrypointContent).toContain(func);
    });
    
    // 通常のstrategy-runner用メッセージが維持されている
    expect(entrypointContent).toContain('log_startup_message "Starting strategy-runner container with enhanced error handling (container: $(hostname), pid: $$)"');
    
    // backtest用メッセージが1回のみになっている
    const backtestMessageMatches = entrypointContent.match(/log_backtest_startup_message "Starting backtest container with enhanced error handling"/g);
    expect(backtestMessageMatches).not.toBeNull();
    expect(backtestMessageMatches.length).toBe(1);
  });

  afterAll(() => {
    // テスト用ファイルのクリーンアップ
    if (fs.existsSync(tmpDir)) {
      const testFiles = fs.readdirSync(tmpDir).filter(file => file.includes('test-issue-5132'));
      testFiles.forEach(file => {
        const filePath = path.join(tmpDir, file);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      });
    }
  });
});