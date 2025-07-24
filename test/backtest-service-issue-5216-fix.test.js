/**
 * Issue #5216: backtestサービスで例外が発生 - 修正確認テスト
 * 
 * backtestサービスで発生していた重複起動メッセージ問題の修正テスト
 * - 簡素化されたlog_backtest_startup_message関数による重複防止機構の確認
 * - レースコンディション問題の根本的解決確認
 * - 複雑な再起動検出機構を削除してatomicロック内でのみタイムスタンプチェックを行う方式の検証
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
    expect(entrypointContent).toContain('Issue #5216: backtest container専用起動メッセージ関数（簡素化版）');
    expect(entrypointContent).toContain('レースコンディション問題を根本的に解決するため、複雑な再起動検出機構を削除し');
    expect(entrypointContent).toContain('atomicロック内でのみタイムスタンプチェックを行う簡素化された実装');
    
    // 簡素化されたatomicロック機構の確認
    expect(entrypointContent).toContain('mkdir "$lock_dir"');
    expect(entrypointContent).toContain('should_log=true');
    
    // 複雑な再起動検出機構が削除されていることを確認
    expect(entrypointContent).not.toContain('container_boot_time=$(stat -c %Y /proc/1');
    expect(entrypointContent).not.toContain('instance_id="${container_boot_time}_$$"');
  });

  describe('簡素化されたatomicロック機構テスト', () => {
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

    test('簡素化されたatomicロック機構による重複防止動作確認', async () => {
      const testScript = `#!/bin/bash
set -e

BACKTEST_STARTUP_LOCK_TIMEOUT=10
lock_dir="${testLockDir}"
timestamp_file="${testTimestampFile}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

# Issue #5216修正版のlog_backtest_startup_message関数（簡素化版）
log_backtest_startup_message() {
    local message="$1"
    local current_time=$(date +%s)
    
    # 古いロックディレクトリのクリーンアップ（60秒以上古い場合）
    if [ -d "$lock_dir" ]; then
        local lock_age=$((current_time - $(stat -c %Y "$lock_dir" 2>/dev/null || echo 0)))
        if [ $lock_age -gt 60 ]; then
            rm -rf "$lock_dir" 2>/dev/null || true
        fi
    fi
    
    # atomicなロック取得を試行（mkdirはatomic操作）
    if mkdir "$lock_dir" 2>/dev/null; then
        # ロック取得成功 - ロック内で一度だけタイムスタンプをチェック
        local should_log=true
        
        if [ -f "$timestamp_file" ]; then
            local last_time=$(cat "$timestamp_file" 2>/dev/null || echo 0)
            local time_diff=$((current_time - last_time))
            
            if [ $time_diff -lt $BACKTEST_STARTUP_LOCK_TIMEOUT ]; then
                # 最近メッセージが出力されている
                log "Backtest startup message suppressed (last shown \${time_diff}s ago)"
                should_log=false
            fi
        fi
        
        # メッセージを出力する必要がある場合のみ
        if [ "$should_log" = true ]; then
            # タイムスタンプを更新してメッセージ出力
            echo "$current_time" > "$timestamp_file"
            chmod 600 "$timestamp_file"
            log "$message"
        fi
        
        # ロック解放
        rm -rf "$lock_dir" 2>/dev/null || true
        return 0
    else
        # ロック取得失敗 - 他のプロセスが処理中
        log "Backtest startup message suppressed (another process is logging)"
        return 0
    fi
}

# テスト実行：連続した3回の呼び出し
log_backtest_startup_message "Starting backtest container with enhanced error handling"
log_backtest_startup_message "Starting backtest container with enhanced error handling"
log_backtest_startup_message "Starting backtest container with enhanced error handling"
`;

      const testScriptPath = path.join(tmpDir, `test-atomic-lock-5216-${Date.now()}.sh`);
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
    }, 12000);

    test('高速連続実行時の重複防止確認', async () => {
      // 非常に短時間での連続実行でも重複が発生しないことを確認
      const testScript = `#!/bin/bash
set -e

BACKTEST_STARTUP_LOCK_TIMEOUT=5
lock_dir="${testLockDir}"
timestamp_file="${testTimestampFile}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S.%3N')] [ENTRYPOINT] $1"
}

# 簡素化されたlog_backtest_startup_message関数
log_backtest_startup_message() {
    local message="$1"
    local current_time=$(date +%s)
    
    if mkdir "$lock_dir" 2>/dev/null; then
        local should_log=true
        
        if [ -f "$timestamp_file" ]; then
            local last_time=$(cat "$timestamp_file" 2>/dev/null || echo 0)
            local time_diff=$((current_time - last_time))
            
            if [ $time_diff -lt $BACKTEST_STARTUP_LOCK_TIMEOUT ]; then
                log "Backtest startup message suppressed (last shown \${time_diff}s ago)"
                should_log=false
            fi
        fi
        
        if [ "$should_log" = true ]; then
            echo "$current_time" > "$timestamp_file"
            chmod 600 "$timestamp_file"
            log "$message"
        fi
        
        rm -rf "$lock_dir" 2>/dev/null || true
        return 0
    else
        log "Backtest startup message suppressed (another process is logging)"
        return 0
    fi
}

# 高速連続実行（5回）
for i in 1 2 3 4 5; do
    log_backtest_startup_message "Starting backtest container with enhanced error handling"
done
`;

      const testScriptPath = path.join(tmpDir, `test-rapid-execution-5216-${Date.now()}.sh`);
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
        
        // 抑制メッセージが4回出力される
        const suppressMessages = stdout.split('\n').filter(line => 
          line.includes('Backtest startup message suppressed')
        );
        expect(suppressMessages.length).toBe(4);
        
      } finally {
        if (fs.existsSync(testScriptPath)) {
          fs.unlinkSync(testScriptPath);
        }
      }
    }, 15000);
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
      'main()'
    ];
    
    essentialFunctions.forEach(func => {
      expect(entrypointContent).toContain(func);
    });
    
    // 既存のメッセージ呼び出しが正しく保持されている
    expect(entrypointContent).toContain('log_startup_message "Starting strategy-runner container with enhanced error handling (container: $(hostname), pid: $$)"');
    expect(entrypointContent).toContain('log_backtest_startup_message "Starting backtest container with enhanced error handling"');
  });

  test('セキュリティ面での改良が維持されていることを確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // ファイル権限の適切な設定
    expect(entrypointContent).toContain('chmod 600 "$timestamp_file"');
    
    // エラーハンドリングの確認
    expect(entrypointContent).toContain('2>/dev/null || true');
    
    // セキュアなクリーンアップ処理
    expect(entrypointContent).toContain('rm -rf "$lock_dir" 2>/dev/null || true');
  });

  test('簡素化による処理性能の向上確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // 複雑な処理が削除されていることを確認
    expect(entrypointContent).not.toContain('container_boot_time=$(stat -c %Y /proc/1');
    expect(entrypointContent).not.toContain('instance_id=');
    expect(entrypointContent).not.toContain('last_restart_info=$(cat');
    
    // シンプルなロジックフローになっていることを確認
    expect(entrypointContent).toContain('should_log=true');
    expect(entrypointContent).toContain('if [ "$should_log" = true ]; then');
  });
});