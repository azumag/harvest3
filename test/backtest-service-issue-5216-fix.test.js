/**
 * Issue #5216: backtestサービスで例外が発生 - 修正確認テスト
 * 
 * backtestサービスで発生していた重複起動メッセージ問題の修正テスト
 * - レースコンディション問題の根本的解決確認
 * - 簡素化されたatomicロック機構の動作確認
 * - 高速連続実行時の重複防止確認
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

describe('Issue #5216: backtestサービス重複メッセージ修正', () => {
  const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
  const tmpDir = path.join(__dirname, '..', '.tmp');
  
  beforeAll(() => {
    // .tmpディレクトリが存在しない場合は作成
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  test('Issue #5216修正がentrypoint.shに適用されていることを確認', () => {
    expect(fs.existsSync(entrypointPath)).toBe(true);
    
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5216修正の確認
    expect(entrypointContent).toContain('Issue #5127, #5058 & #5175 & #5216: backtest container専用起動メッセージ関数（簡素化版）');
    expect(entrypointContent).toContain('Issue #5216修正: KISS原則に基づく簡素化でレースコンディション問題を根本解決');
    
    // 簡素化された実装の確認
    expect(entrypointContent).toContain('複雑な事前チェックを削除し、atomicロック内でのみタイムスタンプチェック');
    expect(entrypointContent).toContain('単一のクリティカルセクション内でタイムスタンプチェック');
    
    // 不要な複雑性が削除されていることを確認
    expect(entrypointContent).not.toContain('message_hash=$(echo "$message" | md5sum');
    expect(entrypointContent).not.toContain('check_timestamp_validity "$message_marker"');
  });

  describe('簡素化されたatomicロック機構テスト', () => {
    let testLockFile;
    let testTimestampFile;

    beforeEach(() => {
      // テスト用の一意なファイル名を生成
      const testId = Date.now() + Math.random().toString(36).substr(2, 9);
      testLockFile = path.join(tmpDir, `backtest-startup-message-test-${testId}.lock`);
      testTimestampFile = path.join(tmpDir, `backtest-startup-timestamp-test-${testId}.lock`);
    });

    afterEach(() => {
      // テスト後のクリーンアップ
      if (fs.existsSync(testLockFile)) {
        fs.unlinkSync(testLockFile);
      }
      if (fs.existsSync(`${testLockFile}.fallback`)) {
        try {
          fs.rmSync(`${testLockFile}.fallback`, { recursive: true });
        } catch (e) {
          // フォールバックディレクトリの削除エラーは無視
        }
      }
      if (fs.existsSync(testTimestampFile)) {
        fs.unlinkSync(testTimestampFile);
      }
    });

    test('atomicロック機構による重複防止動作確認', async () => {
      const testScript = '#!/bin/bash\n' +
        'set -e\n\n' +
        'BACKTEST_STARTUP_LOCK_TIMEOUT=30\n' +
        'BACKTEST_STARTUP_FLOCK_TIMEOUT=5\n' +
        'NPM_ERROR_SUPPRESS_DURATION=60\n' +
        'testLockFile="' + testLockFile + '"\n' +
        'timestamp_file="' + testTimestampFile + '"\n\n' +
        'log() {\n' +
        '    echo "[$(date \'+%Y-%m-%d %H:%M:%S\')] [ENTRYPOINT] $1"\n' +
        '}\n\n' +
        'cleanup_backtest_lock() {\n' +
        '    if command -v flock >/dev/null 2>&1; then\n' +
        '        exec 200>&- 2>/dev/null || true\n' +
        '        trap - EXIT INT TERM 2>/dev/null || true\n' +
        '    else\n' +
        '        local fallback_lock_dir="' + testLockFile + '.fallback"\n' +
        '        rmdir "$fallback_lock_dir" 2>/dev/null || true\n' +
        '        trap - EXIT INT TERM 2>/dev/null || true\n' +
        '    fi\n' +
        '}\n\n' +
        '# Issue #5216修正: 簡素化されたlog_backtest_startup_message関数\n' +
        'log_backtest_startup_message() {\n' +
        '    local message="$1"\n' +
        '    local current_time=$(date +%s)\n' +
        '    local lock_file="' + testLockFile + '"\n' +
        '    local max_wait_time=5\n' +
        '    \n' +
        '    # flockによるatomicロック取得\n' +
        '    if command -v flock >/dev/null 2>&1; then\n' +
        '        exec 200>"$lock_file"\n' +
        '        trap \'exec 200>&- 2>/dev/null || true\' EXIT INT TERM\n' +
        '        \n' +
        '        if ! flock -x -w "$max_wait_time" 200; then\n' +
        '            log "Backtest startup message suppressed (lock acquisition timeout)"\n' +
        '            exec 200>&-\n' +
        '            trap - EXIT INT TERM\n' +
        '            return 0\n' +
        '        fi\n' +
        '    else\n' +
        '        local fallback_lock_dir="${lock_file}.fallback"\n' +
        '        local attempt=0\n' +
        '        local max_attempts=3\n' +
        '        \n' +
        '        while [ $attempt -lt $max_attempts ]; do\n' +
        '            if mkdir "$fallback_lock_dir" 2>/dev/null; then\n' +
        '                trap \'rmdir "$fallback_lock_dir" 2>/dev/null || true\' EXIT INT TERM\n' +
        '                break\n' +
        '            fi\n' +
        '            attempt=$((attempt + 1))\n' +
        '            sleep 1\n' +
        '        done\n' +
        '        \n' +
        '        if [ $attempt -eq $max_attempts ]; then\n' +
        '            log "Backtest startup message suppressed (fallback lock acquisition failed)"\n' +
        '            return 0\n' +
        '        fi\n' +
        '    fi\n' +
        '    \n' +
        '    # ロック取得後、単一のクリティカルセクション内でタイムスタンプチェック\n' +
        '    if [ -f "$timestamp_file" ]; then\n' +
        '        local last_time=$(cat "$timestamp_file" 2>/dev/null || echo 0)\n' +
        '        local time_diff=$((current_time - last_time))\n' +
        '        \n' +
        '        if [ $time_diff -lt $BACKTEST_STARTUP_LOCK_TIMEOUT ]; then\n' +
        '            log "Backtest startup message suppressed (last shown ${time_diff}s ago)"\n' +
        '            cleanup_backtest_lock\n' +
        '            return 0\n' +
        '        fi\n' +
        '    fi\n' +
        '    \n' +
        '    # NPMエラー状態をチェック\n' +
        '    local npm_error_marker="/tmp/backtest-npm-error-detection.state"\n' +
        '    if [ -f "$npm_error_marker" ]; then\n' +
        '        local last_npm_error=$(cat "$npm_error_marker" 2>/dev/null || echo "0")\n' +
        '        local npm_error_age=$((current_time - last_npm_error))\n' +
        '        \n' +
        '        if [ $npm_error_age -lt $NPM_ERROR_SUPPRESS_DURATION ]; then\n' +
        '            log "Backtest startup message suppressed (NPM error recovery within ${npm_error_age}s)"\n' +
        '            cleanup_backtest_lock\n' +
        '            return 0\n' +
        '        fi\n' +
        '    fi\n' +
        '    \n' +
        '    # メッセージ出力とタイムスタンプ更新\n' +
        '    log "$message"\n' +
        '    echo "$current_time" > "$timestamp_file"\n' +
        '    chmod 600 "$timestamp_file"\n' +
        '    \n' +
        '    cleanup_backtest_lock\n' +
        '    return 0\n' +
        '}\n\n' +
        '# テスト実行：連続した3回の呼び出し\n' +
        'log_backtest_startup_message "Starting backtest container with enhanced error handling"\n' +
        'log_backtest_startup_message "Starting backtest container with enhanced error handling"\n' +
        'log_backtest_startup_message "Starting backtest container with enhanced error handling"\n';

      const testScriptPath = path.join(tmpDir, `test-atomic-lock-${Date.now()}.sh`);
      fs.writeFileSync(testScriptPath, testScript);
      fs.chmodSync(testScriptPath, '755');

      try {
        const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 10000 });
        
        // 実際のメッセージ出力は1回のみ
        const startupMessages = stdout.split('\n').filter(line => 
          line.includes('Starting backtest container with enhanced error handling') &&
          !line.includes('suppressed')
        );
        expect(startupMessages.length).toBe(1);
        
        // 抑制メッセージが2回出力される
        const suppressMessages = stdout.split('\n').filter(line => 
          line.includes('Backtest startup message suppressed')
        );
        expect(suppressMessages.length).toBe(2);
        
      } finally {
        if (fs.existsSync(testScriptPath)) {
          fs.unlinkSync(testScriptPath);
        }
      }
    }, 15000);

    test('高速連続実行時の重複防止確認', async () => {
      // 非常に短時間での連続実行をテスト
      const testScript = `#!/bin/bash
set -e

BACKTEST_STARTUP_LOCK_TIMEOUT=30
BACKTEST_STARTUP_FLOCK_TIMEOUT=1
NPM_ERROR_SUPPRESS_DURATION=60
testLockFile="${testLockFile}"
timestamp_file="${testTimestampFile}"

log() {
    echo "[PID:$$] $1"
}

cleanup_backtest_lock() {
    if command -v flock >/dev/null 2>&1; then
        exec 200>&- 2>/dev/null || true
        trap - EXIT INT TERM 2>/dev/null || true
    else
        local fallback_lock_dir="${testLockFile}.fallback"
        rmdir "$fallback_lock_dir" 2>/dev/null || true
        trap - EXIT INT TERM 2>/dev/null || true
    fi
}

# 高速実行用のテスト関数
test_rapid_execution() {
    local current_time=$(date +%s)
    local lock_file="$testLockFile"
    local max_wait_time=0.1  # 非常に短いタイムアウト
    
    # flock方式によるロック取得（高速テスト用）
    exec 200>"$lock_file"
    
    if flock -x -w "$max_wait_time" 200; then
        echo "$current_time" > "$timestamp_file"
        log "Message output by process $$"
        sleep 1  # 短時間保持
        exec 200>&-
    else
        log "Message suppressed by process $$"
        exec 200>&-
    fi
}

# 並行実行テスト
test_rapid_execution &
test_rapid_execution &
test_rapid_execution &
test_rapid_execution &
test_rapid_execution &
wait
`;

      const testScriptPath = path.join(tmpDir, `test-rapid-execution-${Date.now()}.sh`);
      fs.writeFileSync(testScriptPath, testScript);
      fs.chmodSync(testScriptPath, '755');

      try {
        const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 8000 });
        
        // メッセージ出力は1回のみ（1つのプロセスのみが成功）
        const outputMessages = stdout.split('\n').filter(line => 
          line.includes('Message output by process')
        );
        expect(outputMessages.length).toBe(1);
        
        // 抑制メッセージは複数回（他のプロセス）
        const suppressMessages = stdout.split('\n').filter(line => 
          line.includes('Message suppressed by process')
        );
        expect(suppressMessages.length).toBeGreaterThanOrEqual(3);
        
      } finally {
        if (fs.existsSync(testScriptPath)) {
          fs.unlinkSync(testScriptPath);
        }
      }
    }, 12000);
  });

  test('entrypoint.sh構文検証（Issue #5216修正後）', async () => {
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
      'cleanup_backtest_locks()',
      'cleanup_backtest_lock()',
      'main()'
    ];
    
    essentialFunctions.forEach(func => {
      expect(entrypointContent).toContain(func);
    });
    
    // 既存のメッセージ呼び出しが正しく保持されている
    expect(entrypointContent).toContain('log_startup_message "Starting strategy-runner container with enhanced error handling (container: $(hostname), pid: $$)"');
    expect(entrypointContent).toContain('log_backtest_startup_message "Starting backtest container with enhanced error handling"');
  });

  test('セキュリティ面での改良確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // ファイル権限の適切な設定
    expect(entrypointContent).toContain('chmod 600 "$timestamp_file"');
    
    // エラーハンドリングの確認
    expect(entrypointContent).toContain('2>/dev/null || true');
    
    // flockでのロック解放確認
    expect(entrypointContent).toContain('exec 200>&-');
    expect(entrypointContent).toContain('cleanup_backtest_lock');
  });
});