/**
 * Issue #5175: backtestサービスで例外が発生 - 修正確認テスト
 * 
 * backtestサービスで発生している重複起動メッセージ問題の修正テスト
 * - コンテナ再起動検出による重複防止機構の確認
 * - 60秒間のタイムアウト延長の効果確認
 * - npm エラー発生時の適切な処理確認
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

describe('Issue #5175: backtestサービス重複メッセージ修正', () => {
  const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
  const tmpDir = path.join(__dirname, '..', '.tmp');
  
  beforeAll(() => {
    // .tmpディレクトリが存在しない場合は作成
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  test('Issue #5175修正がentrypoint.shに適用されていることを確認', () => {
    expect(fs.existsSync(entrypointPath)).toBe(true);
    
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5175修正の確認
    expect(entrypointContent).toContain('Issue #5127, #5058 & #5175 & #5216: backtest container専用起動メッセージ関数（簡素化版）');
    // Issue #5159: flock方式による確実な重複防止機構への更新
    expect(entrypointContent).toContain('Issue #5159: flockによる確実なatomic lock実装（フォールバック対応）');
    
    // タイムアウト延長の確認
    expect(entrypointContent).toContain('BACKTEST_STARTUP_LOCK_TIMEOUT:-60');
    expect(entrypointContent).toContain('Issue #5175: 60秒に延長');
    
    // Issue #5159: flock方式の実装確認
    expect(entrypointContent).toContain('exec 200>"$lock_file"');
    expect(entrypointContent).toContain('flock -x -w "$max_wait_time" 200');
    expect(entrypointContent).toContain('exec 200>&-');
  });

  describe('コンテナ再起動検出機構テスト', () => {
    let testTimestampFile;
    let testLockDir;

    beforeEach(() => {
      // テスト用の一意なファイル名を生成
      const testId = Date.now() + Math.random().toString(36).substr(2, 9);
      testTimestampFile = path.join(tmpDir, `backtest-startup-timestamp-test-${testId}.lock`);
      testLockDir = path.join(tmpDir, `backtest-startup-lock-test-${testId}`);
    });

    afterEach(() => {
      // テスト後のクリーンアップ
      if (fs.existsSync(testTimestampFile)) {
        fs.unlinkSync(testTimestampFile);
      }
      if (fs.existsSync(`${testLockDir}.lock`)) {
        fs.unlinkSync(`${testLockDir}.lock`);
      }
    });

    test('コンテナ再起動検出による重複防止動作確認', async () => {
      const testScript = `#!/bin/bash
set -e

BACKTEST_STARTUP_LOCK_TIMEOUT=60
timestamp_file="${testTimestampFile}"
testLockDir="${testLockDir}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

# Issue #5159: flock方式による改良版のlog_backtest_startup_message関数（簡略版）
log_backtest_startup_message() {
    local message="$1"
    local current_time=$(date +%s)
    local lock_file="${testLockDir}.lock"
    local timestamp_file="$timestamp_file"
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
    
    # メッセージ出力とタイムスタンプ更新（原子的書き込み）
    log "$message"
    local temp_timestamp="\${timestamp_file}.tmp.$$"
    echo "$current_time" > "$temp_timestamp"
    chmod 600 "$temp_timestamp"
    mv "$temp_timestamp" "$timestamp_file"
    
    # ファイルディスクリプタを閉じてロック解放
    exec 200>&-
    return 0
}

# テスト実行：連続した3回の呼び出し（短時間で実行）
log_backtest_startup_message "Starting backtest container with enhanced error handling"
sleep 1
log_backtest_startup_message "Starting backtest container with enhanced error handling"
sleep 1
log_backtest_startup_message "Starting backtest container with enhanced error handling"
`;

      const testScriptPath = path.join(tmpDir, `test-restart-detection-${Date.now()}.sh`);
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
        
        // タイムスタンプファイルが作成されている
        expect(fs.existsSync(testTimestampFile)).toBe(true);
        
        // タイムスタンプファイルの内容確認
        const timestampContent = fs.readFileSync(testTimestampFile, 'utf8').trim();
        expect(timestampContent).toMatch(/^\d+$/);
        
      } finally {
        if (fs.existsSync(testScriptPath)) {
          fs.unlinkSync(testScriptPath);
        }
      }
    }, 15000);

    test('60秒タイムアウト延長の効果確認', async () => {
      // 先に1回メッセージを出力
      const firstScriptContent = `#!/bin/bash
set -e

BACKTEST_STARTUP_LOCK_TIMEOUT=60
timestamp_file="${testTimestampFile}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

# 現在時刻から61秒前のタイムスタンプを設定（タイムアウトを超える）
old_time=$(($(date +%s) - 61))
echo "$old_time" > "$timestamp_file"

log "Set old timestamp: $old_time"
`;

      const firstScriptPath = path.join(tmpDir, `test-timeout-setup-${Date.now()}.sh`);
      fs.writeFileSync(firstScriptPath, firstScriptContent);
      fs.chmodSync(firstScriptPath, '755');

      // 61秒前のタイムスタンプを設定
      await execAsync(`bash ${firstScriptPath}`, { timeout: 5000 });

      // 本テスト実行
      const testScriptContent = `#!/bin/bash
set -e

BACKTEST_STARTUP_LOCK_TIMEOUT=60
lock_dir="${testLockDir}"
timestamp_file="${testTimestampFile}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

# Issue #5159: flock方式による簡略版のlog_backtest_startup_message関数
log_backtest_startup_message() {
    local message="$1"
    local current_time=$(date +%s)
    local lock_file="${testLockDir}.lock"
    local max_wait_time=5
    
    # flock方式によるロック取得
    exec 200>"$lock_file"
    
    if ! flock -x -w "$max_wait_time" 200; then
        log "Backtest startup message suppressed (lock acquisition timeout)"
        exec 200>&-
        return 0
    fi
    
    # 既存のタイムスタンプファイルをチェック
    if [ -f "$timestamp_file" ]; then
        local last_time=$(cat "$timestamp_file" 2>/dev/null || echo 0)
        local time_diff=$((current_time - last_time))
        
        if [ $time_diff -lt $BACKTEST_STARTUP_LOCK_TIMEOUT ]; then
            log "Backtest startup message suppressed (last shown \${time_diff}s ago)"
            exec 200>&-
            return 0
        fi
    fi
    
    # タイムアウトを超えているのでメッセージ出力（原子的書き込み）
    local temp_timestamp="\${timestamp_file}.tmp.$$"
    echo "$current_time" > "$temp_timestamp"
    chmod 600 "$temp_timestamp"
    mv "$temp_timestamp" "$timestamp_file"
    log "$message"
    
    # ロック解放
    exec 200>&-
}

log_backtest_startup_message "Starting backtest container with enhanced error handling"
`;

      const testScriptPath = path.join(tmpDir, `test-timeout-effect-${Date.now()}.sh`);
      fs.writeFileSync(testScriptPath, testScriptContent);
      fs.chmodSync(testScriptPath, '755');

      try {
        const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 8000 });
        
        // 61秒経過しているのでメッセージが出力される
        const startupMessages = stdout.split('\n').filter(line => 
          line.includes('Starting backtest container with enhanced error handling')
        );
        expect(startupMessages.length).toBe(1);
        
      } finally {
        [firstScriptPath, testScriptPath].forEach(file => {
          if (fs.existsSync(file)) {
            fs.unlinkSync(file);
          }
        });
      }
    }, 12000);
  });

  test('クリーンアップ機能の更新確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5175対応のクリーンアップ機能の確認
    expect(entrypointContent).toContain('Issue #5127, #5058 & #5175: backtest専用クリーンアップ関数（改良版）');
    // Issue #5159: flock方式ではNPMエラー検出ファイルのクリーンアップを確認
    expect(entrypointContent).toContain('backtest-npm-error-detection.state');
    expect(entrypointContent).toContain('Removed backtest NPM error detection file');
  });

  test('entrypoint.sh構文検証（Issue #5175修正後）', async () => {
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
    expect(entrypointContent).toContain('log_backtest_startup_message "Starting backtest container with enhanced error handling"');
  });

  test('セキュリティ面での改良確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // ファイル権限の適切な設定（Issue #5159: flock方式）
    expect(entrypointContent).toContain('chmod 600 "$temp_timestamp"');
    expect(entrypointContent).toContain('chmod 600 "$npm_error_marker"');
    
    // エラーハンドリングの確認
    expect(entrypointContent).toContain('2>/dev/null || true');
    
    // Issue #5159: flock方式でのロック解放確認
    expect(entrypointContent).toContain('exec 200>&-');
  });
});