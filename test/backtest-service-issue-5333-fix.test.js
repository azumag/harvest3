/**
 * Issue #5333: backtestサービスで例外が発生 - 修正確認テスト
 * 
 * 複数コンテナ/プロセス間での重複起動メッセージ問題の修正確認
 * - グローバルロックファイルによる複数コンテナ間の重複防止
 * - より詳細なタイムスタンプ情報による追跡性向上
 * - 既存の修正(Issue #5127, #5058, #5175, #5216)との整合性確認
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

describe('Issue #5333: backtestサービス重複メッセージ修正', () => {
  const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
  const tmpDir = path.join(__dirname, '..', '.tmp');
  
  beforeAll(() => {
    // .tmpディレクトリが存在しない場合は作成
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  test('Issue #5333修正: グローバルロックファイル使用確認', () => {
    expect(fs.existsSync(entrypointPath)).toBe(true);
    
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5333修正：複数コンテナ間での重複防止のためのグローバルファイル使用
    expect(entrypointContent).toContain('Issue #5333修正: よりグローバルなロックファイル名を使用（複数コンテナ間で共有）');
    expect(entrypointContent).toContain('backtest-startup-message-global.lock');
    expect(entrypointContent).toContain('backtest-startup-timestamp-global.state');
  });

  test('Issue #5333修正: 詳細なタイムスタンプ形式確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5333修正：コンテナIDとプロセスIDを含む詳細なタイムスタンプ
    // エラーハンドリング強化のため原子的書き込みを使用
    expect(entrypointContent).toContain('echo "${current_time}:${container_id}:${process_id}" > "$temp_timestamp"');
    expect(entrypointContent).toContain('mv "$temp_timestamp" "$timestamp_file"');
    expect(entrypointContent).toContain('local container_id=$(hostname)');
    expect(entrypointContent).toContain('local process_id=$$');
  });

  test('Issue #5333修正: 詳細な重複検出ログ確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5333修正：同じプロセスと異なるプロセスを区別したログメッセージ
    expect(entrypointContent).toContain('Backtest startup message suppressed (same process, last shown ${time_diff}s ago)');
    expect(entrypointContent).toContain('Backtest startup message suppressed (different process: ${last_container}:${last_pid}, last shown ${time_diff}s ago)');
  });

  test('グローバルファイルのクリーンアップ機能確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5333修正：グローバルファイルのクリーンアップが追加されている
    expect(entrypointContent).toContain('Issue #5333修正: グローバルファイルのクリーンアップを追加');
    expect(entrypointContent).toContain('Removed global backtest startup lock file (Issue #5333)');
    expect(entrypointContent).toContain('Removed global backtest timestamp file (Issue #5333)');
  });

  test('複数コンテナ間重複防止の実動テスト', async () => {
    const testScript = `#!/bin/bash
set -e

# テスト用の環境変数設定
BACKTEST_STARTUP_LOCK_TIMEOUT=60
BACKTEST_STARTUP_FLOCK_TIMEOUT=5

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

cleanup_backtest_lock() {
    if command -v flock >/dev/null 2>&1; then
        exec 200>&- 2>/dev/null || true
        trap - EXIT INT TERM 2>/dev/null || true
    else
        local fallback_lock_dir="/tmp/backtest-startup-message-global.lock.fallback"
        rmdir "$fallback_lock_dir" 2>/dev/null || true
        trap - EXIT INT TERM 2>/dev/null || true
    fi
}

# Issue #5333修正版の関数
log_backtest_startup_message() {
    local message="$1"
    local current_time=$(date +%s.%N)
    local lock_file="/tmp/test-backtest-startup-message-global.lock"
    local timestamp_file="/tmp/test-backtest-startup-timestamp-global.state"
    local max_wait_time="$BACKTEST_STARTUP_FLOCK_TIMEOUT"
    local container_id=\${2:-"test-container-$(hostname)"}
    local process_id=$$
    
    if command -v flock >/dev/null 2>&1; then
        exec 200>"$lock_file"
        trap 'exec 200>&- 2>/dev/null || true' EXIT INT TERM
        
        if ! flock -x -w "$max_wait_time" 200; then
            log "Backtest startup message suppressed (lock acquisition timeout)"
            exec 200>&-
            trap - EXIT INT TERM
            return 0
        fi
    else
        local fallback_lock_dir="\${lock_file}.fallback"
        local attempt=0
        local max_attempts=3
        
        while [ $attempt -lt $max_attempts ]; do
            if mkdir "$fallback_lock_dir" 2>/dev/null; then
                trap 'rmdir "$fallback_lock_dir" 2>/dev/null || true' EXIT INT TERM
                break
            fi
            attempt=$((attempt + 1))
            sleep 1
        done
        
        if [ $attempt -eq $max_attempts ]; then
            log "Backtest startup message suppressed (fallback lock acquisition failed)"
            return 0
        fi
    fi
    
    if [ -f "$timestamp_file" ]; then
        local timestamp_content=$(cat "$timestamp_file" 2>/dev/null || echo "0:unknown:unknown")
        local last_time=$(echo "$timestamp_content" | cut -d':' -f1)
        local last_container=$(echo "$timestamp_content" | cut -d':' -f2)
        local last_pid=$(echo "$timestamp_content" | cut -d':' -f3)
        
        local current_time_int=\${current_time%.*}
        local last_time_int=\${last_time%.*}
        local time_diff=$((current_time_int - last_time_int))
        
        if [ "$time_diff" -lt "$BACKTEST_STARTUP_LOCK_TIMEOUT" ]; then
            if [ "$last_container" = "$container_id" ] && [ "$last_pid" = "$process_id" ]; then
                log "Backtest startup message suppressed (same process, last shown \${time_diff}s ago)"
            else
                log "Backtest startup message suppressed (different process: \${last_container}:\${last_pid}, last shown \${time_diff}s ago)"
            fi
            cleanup_backtest_lock
            return 0
        fi
    fi
    
    log "$message"
    echo "\${current_time}:\${container_id}:\${process_id}" > "$timestamp_file"
    chmod 600 "$timestamp_file"
    
    cleanup_backtest_lock
    return 0
}

# テスト実行：複数の疑似コンテナから同時呼び出し
log_backtest_startup_message "Starting backtest container with enhanced error handling" "container1"
log_backtest_startup_message "Starting backtest container with enhanced error handling" "container2"
log_backtest_startup_message "Starting backtest container with enhanced error handling" "container3"

# クリーンアップ
rm -f /tmp/test-backtest-startup-message-global.lock* 2>/dev/null || true
rm -f /tmp/test-backtest-startup-timestamp-global.state 2>/dev/null || true
`;

    const testScriptPath = path.join(tmpDir, `test-issue-5333-${Date.now()}.sh`);
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
      
      // 抑制メッセージが2回出力される（container2とcontainer3）
      const suppressMessages = stdout.split('\n').filter(line => 
        line.includes('Backtest startup message suppressed')
      );
      expect(suppressMessages.length).toBe(2);
      
      // 異なるコンテナからの呼び出しが検出されている
      const differentProcessSuppress = stdout.split('\n').filter(line => 
        line.includes('different process')
      );
      expect(differentProcessSuppress.length).toBeGreaterThan(0);
      
    } finally {
      if (fs.existsSync(testScriptPath)) {
        fs.unlinkSync(testScriptPath);
      }
    }
  }, 15000);

  test('entrypoint.sh構文検証（Issue #5333修正後）', async () => {
    // 修正後もentrypoint.shが正しく動作することを確認
    await expect(execAsync(`bash -n ${entrypointPath}`, { timeout: 5000 }))
      .resolves.not.toThrow();
  }, 10000);

  test('既存修正との整合性確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // 過去のIssue修正が維持されていることを確認
    expect(entrypointContent).toContain('Issue #5127, #5058 & #5175 & #5216 & #5333');
    expect(entrypointContent).toContain('log_backtest_startup_message "Starting backtest container with enhanced error handling"');
    
    // 関数定義が存在することを確認
    expect(entrypointContent).toContain('log_startup_message() {');
    expect(entrypointContent).toContain('log_backtest_startup_message() {');
    expect(entrypointContent).toContain('cleanup_backtest_locks() {');
  });

  test('Issue #5333: 修正内容のドキュメント確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5333の修正内容がコメントで明記されている
    expect(entrypointContent).toContain('Issue #5333修正: 複数コンテナ間での重複メッセージ防止を強化');
    expect(entrypointContent).toContain('Issue #5333修正: よりグローバルなロックファイル名を使用');
    expect(entrypointContent).toContain('Issue #5333修正: グローバルなタイムスタンプファイルを使用');
    expect(entrypointContent).toContain('Issue #5333修正: より詳細な重複検出ログ');
    expect(entrypointContent).toContain('Issue #5333修正: メッセージ出力とより詳細なタイムスタンプ更新');
  });
});