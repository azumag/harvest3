/**
 * Issue #5058: backtestサービスで例外が発生 - 修正確認テスト
 * 
 * backtestサービスで発生していた重複起動メッセージ問題の修正テスト
 * - atomicディレクトリロックによる重複防止機構の確認
 * - レースコンディション問題の解決確認
 * - Discord Webhook URL未設定警告の適切な処理確認
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

describe('Issue #5058: backtestサービス重複メッセージ修正', () => {
  const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
  const tmpDir = path.join(__dirname, '..', '.tmp');
  
  beforeAll(() => {
    // .tmpディレクトリが存在しない場合は作成
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  test('Issue #5058修正がentrypoint.shに適用されていることを確認', () => {
    expect(fs.existsSync(entrypointPath)).toBe(true);
    
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5058修正の確認（#5175で拡張済み、#5159でflock方式に更新）
    expect(entrypointContent).toContain('Issue #5127, #5058 & #5175: backtest container専用起動メッセージ関数（改良版）');
    expect(entrypointContent).toContain('flockによる確実なatomic lock実装');
    
    // Issue #5159: flock方式のロック機構の確認
    expect(entrypointContent).toContain('exec 200>"$lock_file"');
    expect(entrypointContent).toContain('flock -x -w "$max_wait_time" 200');
    expect(entrypointContent).toContain('exec 200>&-');
    
    // クリーンアップ機能の更新確認（#5175で拡張済み）
    expect(entrypointContent).toContain('Issue #5127, #5058 & #5175: backtest専用クリーンアップ関数（改良版）');
    expect(entrypointContent).toContain('Removed backtest startup lock directory');
  });

  describe('改良されたatomicロック機構テスト', () => {
    let testLockDir;
    let testTimestampFile;

    beforeEach(() => {
      // テスト用の一意なファイル名を生成
      const testId = Date.now() + Math.random().toString(36).substr(2, 9);
      testLockDir = path.join(tmpDir, `backtest-startup-lock-test-${testId}`);
      testTimestampFile = path.join(tmpDir, `backtest-startup-timestamp-test-${testId}.lock`);
    });

    afterEach(() => {
      // テスト後のクリーンアップ
      if (fs.existsSync(`${testLockDir}.lock`)) {
        fs.unlinkSync(`${testLockDir}.lock`);
      }
      if (fs.existsSync(testTimestampFile)) {
        fs.unlinkSync(testTimestampFile);
      }
    });

    test('atomicロック機構による重複防止動作確認', async () => {
      const testScript = `#!/bin/bash
set -e

BACKTEST_STARTUP_LOCK_TIMEOUT=10
testLockDir="${testLockDir}"
timestamp_file="${testTimestampFile}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

# Issue #5159: flock方式による改良版のlog_backtest_startup_message関数
log_backtest_startup_message() {
    local message="$1"
    local current_time=$(date +%s)
    local lock_file="${testLockDir}.lock"
    local max_wait_time=5  # 最大待機時間（秒）
    
    # Issue #5159: flockによる確実なatomic lock実装
    # 複数プロセス間でのrace conditionを完全に防止
    exec 200>"$lock_file"
    
    # タイムアウト付きでexclusiveロックを取得
    if ! flock -x -w "$max_wait_time" 200; then
        log "Backtest startup message suppressed (lock acquisition timeout)"
        exec 200>&-
        return 0
    fi
    
    # ロック取得後、タイムスタンプをチェック
    if [ -f "$timestamp_file" ]; then
        local last_time=$(cat "$timestamp_file" 2>/dev/null || echo 0)
        local time_diff=$((current_time - last_time))
        
        if [ $time_diff -lt $BACKTEST_STARTUP_LOCK_TIMEOUT ]; then
            log "Backtest startup message suppressed (last shown \${time_diff}s ago)"
            exec 200>&-
            return 0
        fi
    fi
    
    # NPMエラー状態をチェック（Issue #5159）
    local npm_error_marker="/tmp/backtest-npm-error-detection.state"
    if [ -f "$npm_error_marker" ]; then
        local last_npm_error=$(cat "$npm_error_marker" 2>/dev/null || echo "0")
        local npm_error_age=$((current_time - last_npm_error))
        
        # NPMエラー後30秒以内はメッセージを抑制
        if [ $npm_error_age -lt 30 ]; then
            log "Backtest startup message suppressed (NPM error recovery: \${npm_error_age}s ago)"
            exec 200>&-
            return 0
        fi
    fi
    
    # メッセージ出力とタイムスタンプ更新
    log "$message"
    echo "$current_time" > "$timestamp_file"
    chmod 600 "$timestamp_file"
    
    # ファイルディスクリプタを閉じてロック解放
    exec 200>&-
    return 0
}

# テスト実行：連続した3回の呼び出し
log_backtest_startup_message "Starting backtest container with enhanced error handling"
log_backtest_startup_message "Starting backtest container with enhanced error handling"
log_backtest_startup_message "Starting backtest container with enhanced error handling"
`;

      const testScriptPath = path.join(tmpDir, `test-atomic-lock-${Date.now()}.sh`);
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

    test('並行実行時のレースコンディション解決確認', async () => {
      // 複数の並行プロセスでatomicロックが正しく動作することを確認
      const testScript = `#!/bin/bash
set -e

BACKTEST_STARTUP_LOCK_TIMEOUT=5
testLockDir="${testLockDir}"
timestamp_file="${testTimestampFile}"

log() {
    echo "[PID:$$] $1"
}

# Issue #5159: flock方式による簡略版のatomicロック実装
test_atomic_lock() {
    local current_time=$(date +%s)
    local lock_file="${testLockDir}.lock"
    local max_wait_time=0.1  # 短いタイムアウトで重複防止をテスト
    
    # flock方式によるロック取得
    exec 200>"$lock_file"
    
    if flock -x -w "$max_wait_time" 200; then
        echo "$current_time" > "$timestamp_file"
        log "Message output by process $$"
        sleep 2  # 他のプロセスがタイムアウトするまで保持
        exec 200>&-
    else
        log "Message suppressed by process $$"
        exec 200>&-
    fi
}

test_atomic_lock &
test_atomic_lock &
test_atomic_lock &
wait
`;

      const testScriptPath = path.join(tmpDir, `test-race-condition-${Date.now()}.sh`);
      fs.writeFileSync(testScriptPath, testScript);
      fs.chmodSync(testScriptPath, '755');

      try {
        const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 10000 });
        
        // メッセージ出力は1回のみ（1つのプロセスのみが成功）
        const outputMessages = stdout.split('\n').filter(line => 
          line.includes('Message output by process')
        );
        expect(outputMessages.length).toBe(1);
        
        // 抑制メッセージは2回（残り2つのプロセス）
        const suppressMessages = stdout.split('\n').filter(line => 
          line.includes('Message suppressed by process')
        );
        expect(suppressMessages.length).toBe(2);
        
      } finally {
        if (fs.existsSync(testScriptPath)) {
          fs.unlinkSync(testScriptPath);
        }
      }
    }, 15000);
  });

  test('Discord Webhook未設定警告の適切な処理確認', () => {
    const webhookUtilsPath = path.join(__dirname, '..', 'src', 'common', 'webhookUtils.js');
    expect(fs.existsSync(webhookUtilsPath)).toBe(true);
    
    const webhookUtilsContent = fs.readFileSync(webhookUtilsPath, 'utf8');
    
    // バックテストモード時の適切なメッセージ処理
    expect(webhookUtilsContent).toContain('process.env.BACKTEST_MODE === \'true\'');
    expect(webhookUtilsContent).toContain('バックテストモードのため通知をスキップ');
    
    // checkWebhookUrl関数の存在確認
    expect(webhookUtilsContent).toContain('function checkWebhookUrl');
    expect(webhookUtilsContent).toContain('logWebhookNotSet(context)');
  });

  test('entrypoint.sh構文検証（Issue #5058修正後）', async () => {
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

  test('セキュリティ面での改良確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // ファイル権限の適切な設定（Issue #5159: flock方式対応）
    expect(entrypointContent).toContain('chmod 600 "$timestamp_file"');
    expect(entrypointContent).toContain('chmod 600 "$npm_error_marker"');
    
    // エラーハンドリングの確認
    expect(entrypointContent).toContain('2>/dev/null || true');
    
    // Issue #5159: flock方式でのロック解放確認
    expect(entrypointContent).toContain('exec 200>&-');
  });
});