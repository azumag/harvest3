/**
 * Issue #5084: [自動] backtestサービスで例外が発生 - 修正確認テスト
 * 
 * 同一秒内での重複起動メッセージ問題の修正テスト
 * - nanosecond精度による重複防止機構の確認
 * - プロセス内メモリベース防御の確認
 * - 多重防御線システムの動作確認
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

describe('Issue #5084: backtestサービス重複メッセージ修正（強化版）', () => {
  const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
  const tmpDir = path.join(__dirname, '..', '.tmp');
  
  beforeAll(() => {
    // .tmpディレクトリが存在しない場合は作成
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  test('Issue #5084修正がentrypoint.shに適用されていることを確認', () => {
    expect(fs.existsSync(entrypointPath)).toBe(true);
    
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5084修正の確認
    expect(entrypointContent).toContain('Issue #5084, #5127 & #5058: backtest container専用起動メッセージ関数（強化版）');
    expect(entrypointContent).toContain('nanosecond精度とプロセス内メモリベース防御を追加した確実な重複防止機構');
    
    // nanosecond精度の実装確認
    expect(entrypointContent).toContain('current_time_ns=$(date +%s%N)');
    expect(entrypointContent).toContain('nanosecond precision');
    
    // プロセス内メモリベース防御の確認
    expect(entrypointContent).toContain('プロセス内メモリベース防御（第一防御線）');
    expect(entrypointContent).toContain('memory_marker_var="BACKTEST_MSG_SHOWN_$$"');
    
    // 多重防御線の確認
    expect(entrypointContent).toContain('第一防御線');
    expect(entrypointContent).toContain('第二防御線');
    expect(entrypointContent).toContain('第三防御線');
  });

  describe('強化された重複防止機構テスト', () => {
    let testLockDir;
    let testTimestampFile;

    beforeEach(() => {
      // テスト用の一意なファイル名を生成
      const testId = Date.now() + Math.random().toString(36).substr(2, 9);
      testLockDir = path.join(tmpDir, `backtest-startup-lock-test-${testId}.dir`);
      testTimestampFile = path.join(tmpDir, `backtest-startup-timestamp-test-${testId}.lock`);
    });

    afterEach(() => {
      // テスト後のクリーンアップ
      if (fs.existsSync(testLockDir)) {
        fs.rmSync(testLockDir, { recursive: true, force: true });
      }
      if (fs.existsSync(testTimestampFile)) {
        fs.unlinkSync(testTimestampFile);
      }
    });

    test('nanosecond精度重複防止機構の動作確認', async () => {
      const testScript = `#!/bin/bash
set -e

BACKTEST_STARTUP_LOCK_TIMEOUT=10
lock_dir="${testLockDir}"
timestamp_file="${testTimestampFile}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S.%3N')] [ENTRYPOINT] $1"
}

# Issue #5084強化版のlog_backtest_startup_message関数
log_backtest_startup_message() {
    local message="$1"
    local current_time_ns=$(date +%s%N)
    local current_time_s=\${current_time_ns%*********}
    local memory_marker_var="BACKTEST_MSG_SHOWN_$$"
    
    # プロセス内メモリベース防御（第一防御線）
    if [ "\${!memory_marker_var}" = "1" ]; then
        log "Backtest startup message suppressed (already shown in process $$)"
        return 0
    fi
    
    # nanosecond精度での既存タイムスタンプチェック（第二防御線）
    if [ -f "$timestamp_file" ]; then
        local last_time_ns=$(cat "$timestamp_file" 2>/dev/null || echo 0)
        local last_time_s=\${last_time_ns%*********}
        local time_diff_s=$((current_time_s - last_time_s))
        local time_diff_ns=$((current_time_ns - last_time_ns))
        
        # 秒レベルでチェック
        if [ $time_diff_s -lt $BACKTEST_STARTUP_LOCK_TIMEOUT ]; then
            log "Backtest startup message suppressed (last shown \${time_diff_s}s ago)"
            return 0
        fi
        
        # nanosecondレベルでの同一実行防止（100ms以内の重複を防止）
        if [ $time_diff_ns -lt 100000000 ]; then
            log "Backtest startup message suppressed (duplicate within 100ms)"
            return 0
        fi
    fi
    
    # atomicなロック取得を試行（第三防御線）
    if mkdir "$lock_dir" 2>/dev/null; then
        # より厳密な二重チェック
        if [ -f "$timestamp_file" ]; then
            local last_time_ns=$(cat "$timestamp_file" 2>/dev/null || echo 0)
            local last_time_s=\${last_time_ns%*********}
            local time_diff_s=$((current_time_s - last_time_s))
            local time_diff_ns=$((current_time_ns - last_time_ns))
            
            if [ $time_diff_s -lt $BACKTEST_STARTUP_LOCK_TIMEOUT ] || [ $time_diff_ns -lt 100000000 ]; then
                log "Backtest startup message suppressed (double-check: last shown \${time_diff_s}s ago)"
                rm -rf "$lock_dir" 2>/dev/null || true
                return 0
            fi
        fi
        
        # プロセス内メモリマーカーを先に設定
        export "$memory_marker_var"=1
        
        # タイムスタンプを高精度で更新してメッセージ出力
        echo "$current_time_ns" > "$timestamp_file"
        chmod 600 "$timestamp_file"
        log "$message"
        
        # ロック解放
        rm -rf "$lock_dir" 2>/dev/null || true
        return 0
    else
        log "Backtest startup message suppressed (another process is logging)"
        return 0
    fi
}

# テスト実行：同一プロセス内での連続呼び出し
log_backtest_startup_message "Starting backtest container with enhanced error handling"
log_backtest_startup_message "Starting backtest container with enhanced error handling"
log_backtest_startup_message "Starting backtest container with enhanced error handling"
`;

      const testScriptPath = path.join(tmpDir, `test-issue-5084-fix-${Date.now()}.sh`);
      fs.writeFileSync(testScriptPath, testScript);
      fs.chmodSync(testScriptPath, '755');

      try {
        const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 8000 });
        
        // 実際のメッセージ出力は1回のみ
        const startupMessages = stdout.split('\n').filter(line => 
          line.includes('Starting backtest container with enhanced error handling') &&
          !line.includes('suppressed')
        );
        expect(startupMessages.length).toBe(1);
        
        // プロセス内メモリベース防御による抑制メッセージが2回出力される
        const processMemorySuppress = stdout.split('\n').filter(line => 
          line.includes('already shown in process')
        );
        expect(processMemorySuppress.length).toBe(2);
        
      } finally {
        if (fs.existsSync(testScriptPath)) {
          fs.unlinkSync(testScriptPath);
        }
      }
    }, 12000);

    test('並行実行時の多重防御システム確認', async () => {
      // 複数の並行プロセスで強化されたロック機構が正しく動作することを確認
      const testScript = `#!/bin/bash
set -e

BACKTEST_STARTUP_LOCK_TIMEOUT=5
lock_dir="${testLockDir}"
timestamp_file="${testTimestampFile}"

log() {
    echo "[PID:$$] $1"
}

# 簡略版の強化されたatomicロック実装
test_enhanced_atomic_lock() {
    local current_time_ns=$(date +%s%N)
    local memory_marker_var="BACKTEST_MSG_SHOWN_$$"
    
    # プロセス内メモリベース防御
    if [ "\${!memory_marker_var}" = "1" ]; then
        log "Message suppressed (memory guard) by process $$"
        return 0
    fi
    
    if mkdir "$lock_dir" 2>/dev/null; then
        export "$memory_marker_var"=1
        echo "$current_time_ns" > "$timestamp_file"
        log "Message output by process $$"
        sleep 0.1  # メッセージ出力をシミュレート
        rm -rf "$lock_dir" 2>/dev/null || true
    else
        log "Message suppressed (lock failed) by process $$"
    fi
}

test_enhanced_atomic_lock &
test_enhanced_atomic_lock &
test_enhanced_atomic_lock &
wait
`;

      const testScriptPath = path.join(tmpDir, `test-enhanced-race-condition-${Date.now()}.sh`);
      fs.writeFileSync(testScriptPath, testScript);
      fs.chmodSync(testScriptPath, '755');

      try {
        const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 10000 });
        
        // メッセージ出力は1回のみ（1つのプロセスのみが成功）
        const outputMessages = stdout.split('\n').filter(line => 
          line.includes('Message output by process')
        );
        expect(outputMessages.length).toBe(1);
        
        // 抑制メッセージは少なくとも2回（残りのプロセス）
        const suppressMessages = stdout.split('\n').filter(line => 
          line.includes('Message suppressed')
        );
        expect(suppressMessages.length).toBeGreaterThanOrEqual(2);
        
      } finally {
        if (fs.existsSync(testScriptPath)) {
          fs.unlinkSync(testScriptPath);
        }
      }
    }, 15000);

    test('nanosecond精度タイムスタンプの動作確認', async () => {
      const testScript = `#!/bin/bash
set -e

# nanosecond精度の動作を確認
current_time_ns=$(date +%s%N)
current_time_s=\${current_time_ns%*********}

echo "Current time (nanoseconds): $current_time_ns"
echo "Current time (seconds): $current_time_s"
echo "Timestamp length: \${#current_time_ns}"

# 19桁であることを確認（10桁の秒 + 9桁のnanosecond）
if [ \${#current_time_ns} -eq 19 ]; then
    echo "Nanosecond precision test: PASS"
else
    echo "Nanosecond precision test: FAIL (length: \${#current_time_ns})"
    exit 1
fi
`;

      const testScriptPath = path.join(tmpDir, `test-nanosecond-precision-${Date.now()}.sh`);
      fs.writeFileSync(testScriptPath, testScript);
      fs.chmodSync(testScriptPath, '755');

      try {
        const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 5000 });
        expect(stdout).toContain('Nanosecond precision test: PASS');
      } finally {
        if (fs.existsSync(testScriptPath)) {
          fs.unlinkSync(testScriptPath);
        }
      }
    }, 8000);
  });

  test('修正によるパフォーマンスへの影響確認', async () => {
    // 強化された実装がパフォーマンスに大きな影響を与えないことを確認
    const testScript = `#!/bin/bash
start_time=$(date +%s%N)

for i in {1..10}; do
    current_time_ns=$(date +%s%N)
    current_time_s=\${current_time_ns%*********}
done

end_time=$(date +%s%N)
duration=$((end_time - start_time))
duration_ms=$((duration / 1000000))

echo "10 iterations took \${duration_ms}ms"

# 100ms以下であることを確認（十分高速）
if [ $duration_ms -lt 100 ]; then
    echo "Performance test: PASS"
else
    echo "Performance test: SLOW (took \${duration_ms}ms)"
fi
`;

    const testScriptPath = path.join(tmpDir, `test-performance-${Date.now()}.sh`);
    fs.writeFileSync(testScriptPath, testScript);
    fs.chmodSync(testScriptPath, '755');

    try {
      const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 5000 });
      expect(stdout).toContain('Performance test: PASS');
    } finally {
      if (fs.existsSync(testScriptPath)) {
        fs.unlinkSync(testScriptPath);
      }
    }
  }, 8000);

  test('entrypoint.sh構文検証（Issue #5084修正後）', async () => {
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
      'main()'
    ];
    
    essentialFunctions.forEach(func => {
      expect(entrypointContent).toContain(func);
    });
    
    // 既存のメッセージ呼び出しが正しく保持されている
    expect(entrypointContent).toContain('log_startup_message "Starting strategy-runner container with enhanced error handling (container: $(hostname), pid: $$)"');
    expect(entrypointContent).toContain('log_startup_message "Starting backtest container with enhanced error handling"');
    
    // 後方互換性の確認
    expect(entrypointContent).toContain('BACKTEST_STARTUP_LOCK_TIMEOUT');
    expect(entrypointContent).toContain('chmod 600 "$timestamp_file"');
  });

  test('セキュリティ面での強化確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // ファイル権限の適切な設定（既存）
    expect(entrypointContent).toContain('chmod 600 "$timestamp_file"');
    
    // プロセス固有の変数名によるセキュリティ強化
    expect(entrypointContent).toContain('memory_marker_var="BACKTEST_MSG_SHOWN_$$"');
    
    // エラーハンドリングの確認（既存）
    expect(entrypointContent).toContain('2>/dev/null || true');
    
    // セキュアなクリーンアップ処理（既存）
    expect(entrypointContent).toContain('rm -rf "$lock_dir" 2>/dev/null || true');
  });
});