/**
 * Issue #5127: [自動] backtestサービスで例外が発生 - 修正確認テスト
 * 
 * backtest containerで発生していた重複起動メッセージ問題の修正を確認するテスト
 * - 急速な再起動時の重複メッセージ防止
 * - backtest専用ロック機構の動作確認
 * - npm run backtestコマンド実行前の検証強化
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

describe('Issue #5127: backtestサービス例外対応および重複メッセージ修正', () => {
  const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
  
  test('Issue #5127の修正が適用されていることを確認', () => {
    expect(fs.existsSync(entrypointPath)).toBe(true);
    
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5127専用設定の確認
    expect(entrypointContent).toContain('Issue #5127 専用設定: backtest container重複起動メッセージ防止強化');
    expect(entrypointContent).toContain('BACKTEST_STARTUP_LOCK_FILE');
    expect(entrypointContent).toContain('BACKTEST_STARTUP_LOCK_TIMEOUT');
    
    // backtest専用関数の存在確認
    expect(entrypointContent).toContain('log_backtest_startup_message()');
    expect(entrypointContent).toContain('cleanup_backtest_locks()');
    
    // 強化されたエラーハンドリングの確認
    expect(entrypointContent).toContain('Issue #5127: backtest実行前の追加診断');
    expect(entrypointContent).toContain('Backtest command arguments:');
  });

  describe('backtest専用重複メッセージ防止機能', () => {
    let tmpDir;
    let lockFile;

    beforeEach(() => {
      // .tmpディレクトリ内にテスト用ディレクトリを作成
      tmpDir = path.join(__dirname, '..', '.tmp');
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }
      lockFile = path.join(tmpDir, `backtest-startup-message-test-${Date.now()}.lock`);
    });

    afterEach(() => {
      // テスト後のクリーンアップ
      if (fs.existsSync(lockFile)) {
        fs.unlinkSync(lockFile);
      }
    });

    test('backtest専用メッセージ関数の重複防止確認', async () => {
      const testScript = `#!/bin/bash
set -e

BACKTEST_STARTUP_LOCK_FILE="${lockFile}"
BACKTEST_STARTUP_LOCK_TIMEOUT=10

# Issue #5127: backtest専用起動メッセージ関数の実装
log_backtest_startup_message() {
    local message="$1"
    local current_time=$(date +%s)
    
    if [ -f "$BACKTEST_STARTUP_LOCK_FILE" ]; then
        local lock_time=$(stat -c %Y "$BACKTEST_STARTUP_LOCK_FILE" 2>/dev/null || echo 0)
        local lock_age=$((current_time - lock_time))
        
        if [ $lock_age -lt $BACKTEST_STARTUP_LOCK_TIMEOUT ]; then
            echo "Backtest startup message suppressed (last shown \${lock_age}s ago)"
            return 0
        fi
    fi
    
    echo "$current_time" > "$BACKTEST_STARTUP_LOCK_FILE"
    chmod 600 "$BACKTEST_STARTUP_LOCK_FILE"
    echo "[ENTRYPOINT] $message"
    return 0
}

# 1回目の呼び出し（出力されるべき）
log_backtest_startup_message "Starting backtest container with enhanced error handling"

# 即座に2回目の呼び出し（抑制されるべき）
log_backtest_startup_message "Starting backtest container with enhanced error handling"

# 3回目も抑制
log_backtest_startup_message "Starting backtest container with enhanced error handling"
`;

      const testScriptPath = path.join(tmpDir, `test-backtest-duplicate-${Date.now()}.sh`);
      fs.writeFileSync(testScriptPath, testScript);
      fs.chmodSync(testScriptPath, '755');

      try {
        const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 5000 });
        
        // 実際のメッセージ出力は1回のみ
        const startupMessages = stdout.split('\n').filter(line => 
          line.includes('Starting backtest container with enhanced error handling')
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
    }, 10000);

    test('時間経過後の再メッセージ許可確認', async () => {
      const testScript = `#!/bin/bash
set -e

BACKTEST_STARTUP_LOCK_FILE="${lockFile}"
BACKTEST_STARTUP_LOCK_TIMEOUT=2  # 2秒に短縮

log_backtest_startup_message() {
    local message="$1"
    local current_time=$(date +%s)
    
    if [ -f "$BACKTEST_STARTUP_LOCK_FILE" ]; then
        local lock_time=$(stat -c %Y "$BACKTEST_STARTUP_LOCK_FILE" 2>/dev/null || echo 0)
        local lock_age=$((current_time - lock_time))
        
        if [ $lock_age -lt $BACKTEST_STARTUP_LOCK_TIMEOUT ]; then
            echo "Backtest startup message suppressed (last shown \${lock_age}s ago)"
            return 0
        fi
    fi
    
    echo "$current_time" > "$BACKTEST_STARTUP_LOCK_FILE"
    chmod 600 "$BACKTEST_STARTUP_LOCK_FILE"
    echo "[ENTRYPOINT] $message"
    return 0
}

# 1回目の呼び出し
log_backtest_startup_message "Starting backtest container with enhanced error handling"

# 3秒待機
sleep 3

# 時間経過後の2回目の呼び出し（許可されるべき）
log_backtest_startup_message "Starting backtest container with enhanced error handling"
`;

      const testScriptPath = path.join(tmpDir, `test-backtest-timeout-${Date.now()}.sh`);
      fs.writeFileSync(testScriptPath, testScript);
      fs.chmodSync(testScriptPath, '755');

      try {
        const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 10000 });
        
        // 2回の実際のメッセージ出力
        const startupMessages = stdout.split('\n').filter(line => 
          line.includes('Starting backtest container with enhanced error handling')
        );
        expect(startupMessages.length).toBe(2);
        
        // 抑制メッセージは出力されない
        const suppressMessages = stdout.split('\n').filter(line => 
          line.includes('Backtest startup message suppressed')
        );
        expect(suppressMessages.length).toBe(0);
      } finally {
        if (fs.existsSync(testScriptPath)) {
          fs.unlinkSync(testScriptPath);
        }
      }
    }, 15000);
  });

  test('log_startup_message関数のbacktest mode分岐確認', async () => {
    const tmpDir = path.join(__dirname, '..', '.tmp');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    
    const testScript = `#!/bin/bash
set -e

# テスト用のlockファイル設定
BACKTEST_STARTUP_LOCK_FILE="/tmp/test-backtest-startup-message.lock"
BACKTEST_STARTUP_LOCK_TIMEOUT=10

log_backtest_startup_message() {
    local message="$1"
    echo "[BACKTEST-SPECIFIC] $message"
    return 0
}

log_startup_message() {
    local message="$1"
    
    # backtest containerの場合は専用関数を使用
    if [ "$BACKTEST_MODE" = "true" ]; then
        log_backtest_startup_message "$message"
        return $?
    fi
    
    echo "[GENERIC] $message"
    return 0
}

# BACKTEST_MODE=true での呼び出し
export BACKTEST_MODE=true
log_startup_message "Starting container with enhanced error handling"

# BACKTEST_MODE=false での呼び出し  
export BACKTEST_MODE=false
log_startup_message "Starting container with enhanced error handling"

# BACKTEST_MODE未設定での呼び出し
unset BACKTEST_MODE
log_startup_message "Starting container with enhanced error handling"
`;

    const testScriptPath = path.join(tmpDir, `test-backtest-mode-branch-${Date.now()}.sh`);
    
    fs.writeFileSync(testScriptPath, testScript);
    fs.chmodSync(testScriptPath, '755');

    try {
      const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 5000 });
      
      const lines = stdout.trim().split('\n');
      expect(lines[0]).toContain('[BACKTEST-SPECIFIC]');  // BACKTEST_MODE=true
      expect(lines[1]).toContain('[GENERIC]');            // BACKTEST_MODE=false
      expect(lines[2]).toContain('[GENERIC]');            // BACKTEST_MODE未設定
    } finally {
      if (fs.existsSync(testScriptPath)) {
        fs.unlinkSync(testScriptPath);
      }
    }
  }, 8000);

  test('backtest実行前診断機能の確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // backtest実行前の診断ロジック確認
    expect(entrypointContent).toContain('Backtest command arguments:');
    expect(entrypointContent).toContain('No command arguments provided for backtest execution');
    expect(entrypointContent).toContain('Validating npm run backtest command');
    expect(entrypointContent).toContain('Backtest script found in package.json');
    expect(entrypointContent).toContain('Backtest runner found: src/backtestRunner.js');
    
    // 実行時マーカーファイルの確認
    expect(entrypointContent).toContain('echo "$(date +%s)" > /tmp/backtest-start-time.marker');
  });

  test('cleanup_backtest_locks関数の確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // クリーンアップ関数の存在
    expect(entrypointContent).toContain('cleanup_backtest_locks()');
    expect(entrypointContent).toContain('Cleaning up backtest-specific lock files');
    expect(entrypointContent).toContain('Removed backtest start time marker');
    
    // main cleanup処理での呼び出し確認
    expect(entrypointContent).toContain('if [ "$BACKTEST_MODE" = "true" ]; then');
    expect(entrypointContent).toContain('cleanup_backtest_locks');
  });

  test('Issue #5127修正により既存機能に影響がないことを確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // 既存の重要な機能が維持されていることを確認
    const essentialFunctions = [
      'acquire_startup_lock()',
      'release_startup_lock()',
      'log_startup_message()',
      'get_message_hash()',
      'pre_startup_checks()',
      'check_database_connections()',
      'main()'
    ];
    
    essentialFunctions.forEach(func => {
      expect(entrypointContent).toContain(func);
    });
    
    // 既存のstrategy-runner用メッセージも正しく処理されることを確認
    expect(entrypointContent).toContain('log_startup_message "Starting strategy-runner container with enhanced error handling (container: $(hostname), pid: $$)"');
    
    // backtest用メッセージが正しく処理されることを確認
    expect(entrypointContent).toContain('log_startup_message "Starting backtest container with enhanced error handling"');
  });

  test('entrypoint.sh構文検証（Issue #5127修正後）', async () => {
    // 修正後もentrypoint.shが正しく動作することを確認
    await expect(execAsync(`bash -n ${entrypointPath}`, { timeout: 3000 })).resolves.not.toThrow();
  }, 5000);

  test('Issue #5127: 修正内容のセキュリティ確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // ファイル権限の適切な設定
    expect(entrypointContent).toContain('chmod 600 "$timestamp_file"');
    
    // /tmpディレクトリ使用のセキュリティ注記が維持されている
    expect(entrypointContent).toContain('セキュリティ注記: /tmp使用について');
    
    // 適切なエラーハンドリング
    expect(entrypointContent).toContain('2>/dev/null || true');
  });
});