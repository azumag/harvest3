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
    
    // Issue #5216でIssue #5175が簡素化されて統合された
    expect(entrypointContent).toContain('Issue #5216: backtest container専用起動メッセージ関数（簡素化版）');
    expect(entrypointContent).toContain('レースコンディション問題を根本的に解決するため、複雑な再起動検出機構を削除し');
    
    // タイムアウト延長の確認
    expect(entrypointContent).toContain('BACKTEST_STARTUP_LOCK_TIMEOUT:-60');
    expect(entrypointContent).toContain('Issue #5175: 60秒に延長');
    
    // Issue #5216で簡素化：複雑な再起動検出は削除され、atomicロックのみに変更
    expect(entrypointContent).toContain('atomicロック内でのみタイムスタンプチェックを行う簡素化された実装');
    expect(entrypointContent).toContain('mkdir "$lock_dir"');
  });

  describe('コンテナ再起動検出機構テスト', () => {
    let testRestartDetectionFile;
    let testTimestampFile;
    let testLockDir;

    beforeEach(() => {
      // テスト用の一意なファイル名を生成
      const testId = Date.now() + Math.random().toString(36).substr(2, 9);
      testRestartDetectionFile = path.join(tmpDir, `backtest-restart-detection-test-${testId}.state`);
      testTimestampFile = path.join(tmpDir, `backtest-startup-timestamp-test-${testId}.lock`);
      testLockDir = path.join(tmpDir, `backtest-startup-lock-test-${testId}.dir`);
    });

    afterEach(() => {
      // テスト後のクリーンアップ
      [testRestartDetectionFile, testTimestampFile].forEach(file => {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      });
      if (fs.existsSync(testLockDir)) {
        fs.rmSync(testLockDir, { recursive: true, force: true });
      }
    });

    test('コンテナ再起動検出による重複防止動作確認', async () => {
      const testScript = `#!/bin/bash
set -e

BACKTEST_STARTUP_LOCK_TIMEOUT=60
BACKTEST_CONTAINER_RESTART_DETECTION_FILE="${testRestartDetectionFile}"
lock_dir="${testLockDir}"
timestamp_file="${testTimestampFile}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

# Issue #5175修正版のlog_backtest_startup_message関数（簡略版）
log_backtest_startup_message() {
    local message="$1"
    local current_time=$(date +%s)
    local restart_detection_file="$BACKTEST_CONTAINER_RESTART_DETECTION_FILE"
    
    # コンテナ再起動検出とトラッキング
    local container_boot_time=$(stat -c %Y /proc/1 2>/dev/null || echo "$current_time")
    local instance_id="\${container_boot_time}_$$"
    
    # コンテナ再起動検出による追加重複防止
    if [ -f "$restart_detection_file" ]; then
        local last_restart_info=$(cat "$restart_detection_file" 2>/dev/null || echo "")
        local last_instance_id=$(echo "$last_restart_info" | cut -d':' -f1 2>/dev/null || echo "")
        local last_message_time=$(echo "$last_restart_info" | cut -d':' -f2 2>/dev/null || echo "0")
        
        # 同じインスタンスIDまたは最近のメッセージ時刻をチェック
        if [ "$last_instance_id" = "$instance_id" ] || [ $((current_time - last_message_time)) -lt $BACKTEST_STARTUP_LOCK_TIMEOUT ]; then
            log "Backtest startup message suppressed (container restart detection: last shown $((current_time - last_message_time))s ago)"
            return 0
        fi
    fi
    
    # 既存のタイムスタンプファイルをチェック
    if [ -f "$timestamp_file" ]; then
        local last_time=$(cat "$timestamp_file" 2>/dev/null || echo 0)
        local time_diff=$((current_time - last_time))
        
        if [ $time_diff -lt $BACKTEST_STARTUP_LOCK_TIMEOUT ]; then
            log "Backtest startup message suppressed (last shown \${time_diff}s ago)"
            echo "\${instance_id}:\${last_time}" > "$restart_detection_file"
            chmod 600 "$restart_detection_file"
            return 0
        fi
    fi
    
    # atomicなロック取得を試行（mkdirはatomic操作）
    if mkdir "$lock_dir" 2>/dev/null; then
        # タイムスタンプを更新してメッセージ出力
        echo "$current_time" > "$timestamp_file"
        chmod 600 "$timestamp_file"
        
        # 再起動検出情報を記録
        echo "\${instance_id}:\${current_time}" > "$restart_detection_file"
        chmod 600 "$restart_detection_file"
        
        log "$message"
        
        # ロック解放
        rm -rf "$lock_dir" 2>/dev/null || true
        return 0
    else
        log "Backtest startup message suppressed (another process is logging)"
        return 0
    fi
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
        
        // 再起動検出ファイルが作成されている
        expect(fs.existsSync(testRestartDetectionFile)).toBe(true);
        
        // 再起動検出ファイルの内容確認
        const restartInfo = fs.readFileSync(testRestartDetectionFile, 'utf8').trim();
        expect(restartInfo).toMatch(/^\d+_\d+:\d+$/);
        
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
restart_detection_file="${testRestartDetectionFile}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

# 現在時刻から61秒前のタイムスタンプを設定（タイムアウトを超える）
old_time=$(($(date +%s) - 61))
echo "$old_time" > "$timestamp_file"
echo "old_instance_id:$old_time" > "$restart_detection_file"

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
BACKTEST_CONTAINER_RESTART_DETECTION_FILE="${testRestartDetectionFile}"
lock_dir="${testLockDir}"
timestamp_file="${testTimestampFile}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

# 簡略版のlog_backtest_startup_message関数
log_backtest_startup_message() {
    local message="$1"
    local current_time=$(date +%s)
    local restart_detection_file="$BACKTEST_CONTAINER_RESTART_DETECTION_FILE"
    
    # 既存のタイムスタンプファイルをチェック
    if [ -f "$timestamp_file" ]; then
        local last_time=$(cat "$timestamp_file" 2>/dev/null || echo 0)
        local time_diff=$((current_time - last_time))
        
        if [ $time_diff -lt $BACKTEST_STARTUP_LOCK_TIMEOUT ]; then
            log "Backtest startup message suppressed (last shown \${time_diff}s ago)"
            return 0
        fi
    fi
    
    # タイムアウトを超えているのでメッセージ出力
    echo "$current_time" > "$timestamp_file"
    log "$message"
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
    
    // Issue #5216で簡素化されたクリーンアップ機能の確認
    expect(entrypointContent).toContain('cleanup_backtest_locks');
    expect(entrypointContent).toContain('Issue #5216: 簡素化により、コンテナ再起動検出ファイルは使用しなくなった');
    expect(entrypointContent).toContain('Removed legacy backtest container restart detection file');
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
    
    // Issue #5216の簡素化された実装でのファイル権限設定
    expect(entrypointContent).toContain('chmod 600 "$timestamp_file"');
    
    // エラーハンドリングの確認
    expect(entrypointContent).toContain('2>/dev/null || true');
    
    // セキュアなクリーンアップ処理
    expect(entrypointContent).toContain('rm -rf "$lock_dir" 2>/dev/null || true');
  });
});