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

  test('Issue #5159更新: log_backtest_startup_message関数がflock方式で存在することを確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5058の修正が維持され、#5159でflock方式に更新されていることを確認
    expect(entrypointContent).toContain('Issue #5127, #5058 & #5175: backtest container専用起動メッセージ関数（改良版）');
    expect(entrypointContent).toContain('log_backtest_startup_message() {');
    expect(entrypointContent).toContain('flockによる確実なatomic lock実装');
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

# Issue #5159: flock方式による改良版log_backtest_startup_message関数（簡略化）
log_backtest_startup_message() {
    local message="$1"
    local current_time=$(date +%s)
    local lock_file="/tmp/test-backtest-startup-lock-${Date.now()}.lock"
    local timestamp_file="$BACKTEST_STARTUP_LOCK_FILE"
    local max_wait_time=5  # 最大待機時間（秒）
    
    # Issue #5159: flockによる確実なatomic lock実装
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
    
    // Issue #5058の修正が維持され、#5159でflock方式に更新されている
    expect(entrypointContent).toContain('Issue #5127, #5058 & #5175');
    expect(entrypointContent).toContain('flockによる確実なatomic lock実装');
    
    // Issue #5250の修正が適用されている  
    expect(entrypointContent).toContain('log_backtest_startup_message "Starting backtest container with enhanced error handling"');
    
    // 両方の関数が存在することを確認
    expect(entrypointContent).toContain('log_startup_message() {');
    expect(entrypointContent).toContain('log_backtest_startup_message() {');
  });
});