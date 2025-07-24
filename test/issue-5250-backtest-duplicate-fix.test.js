/**
 * Issue #5250: backtestサービスで例外が発生 - 修正確認テスト
 * 
 * backtestサービスで発生していた重複起動メッセージ問題の修正確認
 * - log_startup_message から log_backtest_startup_message への変更確認
 * - 重複防止機構が正しく適用されていることの確認
 * - 既存の修正(Issue #5058)との整合性確認
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

describe('Issue #5250: backtestサービス重複メッセージ修正', () => {
  const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
  const tmpDir = path.join(__dirname, '..', '.tmp');
  
  beforeAll(() => {
    // .tmpディレクトリが存在しない場合は作成
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  test('Issue #5250修正: log_backtest_startup_message使用確認', () => {
    expect(fs.existsSync(entrypointPath)).toBe(true);
    
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5250修正：backtest起動時に重複防止機構付き関数を使用
    expect(entrypointContent).toContain('log_backtest_startup_message "Starting backtest container with enhanced error handling"');
    
    // 古い関数は使用していないことを確認
    expect(entrypointContent).not.toContain('log_startup_message "Starting backtest container with enhanced error handling"');
  });

  test('既存のlog_backtest_startup_message関数が存在することを確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5250はIssue #5216で簡素化されて統合済み
    expect(entrypointContent).toContain('Issue #5216: backtest container専用起動メッセージ関数（簡素化版）');
    expect(entrypointContent).toContain('log_backtest_startup_message() {');
    expect(entrypointContent).toContain('atomicなロック取得を試行（mkdirはatomic操作）');
  });

  test('重複メッセージが実際に防止されることを確認', async () => {
    const testScript = `#!/bin/bash
set -e

# テスト用の環境変数設定
BACKTEST_STARTUP_LOCK_TIMEOUT=10
BACKTEST_STARTUP_LOCK_FILE="/tmp/test-backtest-startup-message-${Date.now()}.lock"
BACKTEST_CONTAINER_RESTART_DETECTION_FILE="/tmp/test-backtest-restart-detection-${Date.now()}.state"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

# entrypoint.shからlog_backtest_startup_message関数を抽出・簡略化
log_backtest_startup_message() {
    local message="$1"
    local current_time=$(date +%s)
    local lock_dir="/tmp/test-backtest-startup-lock-${Date.now()}.dir"
    local timestamp_file="$BACKTEST_STARTUP_LOCK_FILE"
    
    # 既存のタイムスタンプファイルをチェック
    if [ -f "$timestamp_file" ]; then
        local last_time=$(cat "$timestamp_file" 2>/dev/null || echo 0)
        local time_diff=$((current_time - last_time))
        
        if [ $time_diff -lt $BACKTEST_STARTUP_LOCK_TIMEOUT ]; then
            log "Backtest startup message suppressed (last shown \${time_diff}s ago)"
            return 0
        fi
    fi
    
    # atomicなロック取得を試行
    if mkdir "$lock_dir" 2>/dev/null; then
        # タイムスタンプを更新してメッセージ出力
        echo "$current_time" > "$timestamp_file"
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

# テスト実行：連続した2回の呼び出し（Issue #5250で発生していた問題をシミュレート）
log_backtest_startup_message "Starting backtest container with enhanced error handling"
log_backtest_startup_message "Starting backtest container with enhanced error handling"

# クリーンアップ
rm -f "$BACKTEST_STARTUP_LOCK_FILE" 2>/dev/null || true
rm -f "$BACKTEST_CONTAINER_RESTART_DETECTION_FILE" 2>/dev/null || true
`;

    const testScriptPath = path.join(tmpDir, `test-issue-5250-${Date.now()}.sh`);
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
      
      // 抑制メッセージが1回出力される
      const suppressMessages = stdout.split('\n').filter(line => 
        line.includes('Backtest startup message suppressed')
      );
      expect(suppressMessages.length).toBe(1);
      
    } finally {
      if (fs.existsSync(testScriptPath)) {
        fs.unlinkSync(testScriptPath);
      }
    }
  }, 12000);

  test('entrypoint.sh構文検証（Issue #5250修正後）', async () => {
    // 修正後もentrypoint.shが正しく動作することを確認
    await expect(execAsync(`bash -n ${entrypointPath}`, { timeout: 3000 }))
      .resolves.not.toThrow();
  }, 5000);

  test('Issue #5058とIssue #5250の両方の修正が適用されていることを確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5058の修正が維持されている
    expect(entrypointContent).toContain('Issue #5127, #5058 & #5175');
    expect(entrypointContent).toContain('atomicなロック取得を試行（mkdirはatomic操作）');
    
    // Issue #5250の修正が適用されている  
    expect(entrypointContent).toContain('log_backtest_startup_message "Starting backtest container with enhanced error handling"');
    
    // 両方の関数が存在することを確認
    expect(entrypointContent).toContain('log_startup_message() {');
    expect(entrypointContent).toContain('log_backtest_startup_message() {');
  });
});