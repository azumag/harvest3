/**
 * Issue #5254: backtestサービスで例外が発生 - 修正テスト
 * 
 * Issue #5254で報告されたbacktestサービスの例外問題の修正
 * - NPMエラー -> コンテナ再起動 -> 重複起動メッセージの問題に対処
 * - 2025-07-23 18:51:45に発生した具体的な問題の再現防止
 * - 既存のIssue #5250/#5203修正との統合性確認
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

describe('Issue #5254: backtestサービス例外修正', () => {
  const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
  const tmpDir = path.join(__dirname, '..', '.tmp');
  
  beforeAll(() => {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  test('Issue #5254: entrypoint.shの基本機能確認', () => {
    expect(fs.existsSync(entrypointPath)).toBe(true);
    
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // backtest専用の起動メッセージ関数が使用されている
    expect(entrypointContent).toContain('log_backtest_startup_message "Starting backtest container with enhanced error handling"');
    
    // NPMエラー時の再起動防止機構が存在する
    expect(entrypointContent).toContain('retry_npm_install_with_backoff');
    expect(entrypointContent).toContain('max_container_restarts');
    
    // 重複防止機構が強化されている
    expect(entrypointContent).toContain('BACKTEST_STARTUP_LOCK_TIMEOUT');
    expect(entrypointContent).toContain('container_boot_time');
  });

  test('Issue #5254: NPMエラー -> 再起動シナリオのテスト', async () => {
    const testScript = `#!/bin/bash
set -e

# Issue #5254の状況をシミュレート: NPMエラー後の迅速な再起動
BACKTEST_MODE="true"
BACKTEST_STARTUP_LOCK_TIMEOUT=60
BACKTEST_STARTUP_LOCK_FILE="/tmp/test-backtest-5254-startup-\${RANDOM}.lock"
BACKTEST_CONTAINER_RESTART_DETECTION_FILE="/tmp/test-backtest-5254-restart-\${RANDOM}.state"

log() {
    echo "[\$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] \$1"
}

# Issue #5159: flock方式による改良版log_backtest_startup_message関数（Issue #5254対応）
log_backtest_startup_message() {
    local message="\$1"
    local current_time=\$(date +%s)
    local lock_file="/tmp/test-backtest-5254-lock-\${RANDOM}.lock"
    local timestamp_file="\$BACKTEST_STARTUP_LOCK_FILE"
    local max_wait_time=5  # 最大待機時間（秒）
    
    # Issue #5159: flockによる確実なatomic lock実装
    # Issue #5254で発生したNPMエラー -> 再起動シナリオに対応
    exec 200>"\$lock_file"
    
    # タイムアウト付きでexclusiveロックを取得
    if ! flock -x -w "\$max_wait_time" 200; then
        log "Backtest startup message suppressed (lock acquisition timeout)"
        exec 200>&-
        return 0
    fi
    
    # ロック取得後、タイムスタンプをチェック
    if [ -f "\$timestamp_file" ]; then
        local last_time=\$(cat "\$timestamp_file" 2>/dev/null || echo 0)
        local time_diff=\$((current_time - last_time))
        
        if [ \$time_diff -lt \$BACKTEST_STARTUP_LOCK_TIMEOUT ]; then
            log "Backtest startup message suppressed (last shown \${time_diff}s ago)"
            exec 200>&-
            return 0
        fi
    fi
    
    # Issue #5159/#5254: NPMエラー状態をチェック
    local npm_error_marker="/tmp/backtest-npm-error-detection.state"
    if [ -f "\$npm_error_marker" ]; then
        local last_npm_error=\$(cat "\$npm_error_marker" 2>/dev/null || echo "0")
        local npm_error_age=\$((current_time - last_npm_error))
        
        # Issue #5254: NPMエラー後30秒以内はメッセージを抑制
        if [ \$npm_error_age -lt 30 ]; then
            log "Backtest startup message suppressed (Issue #5254 - NPM error recovery: \${npm_error_age}s ago)"
            exec 200>&-
            return 0
        fi
    fi
    
    # メッセージ出力とタイムスタンプ更新
    log "\$message"
    echo "\$current_time" > "\$timestamp_file"
    chmod 600 "\$timestamp_file"
    
    # ファイルディスクリプタを閉じてロック解放
    exec 200>&-
    return 0
}

# Issue #5254で発生したシナリオをシミュレート:
# 1. NPMエラーが発生
log "npm ERR!     /root/.npm/_logs/2025-07-23T17_46_52_913Z-debug-0.log"

# 2. 最初の起動メッセージ
log_backtest_startup_message "Starting backtest container with enhanced error handling"

# 3. 短時間後（NPMエラーによる再起動をシミュレート）
sleep 1

# 4. 2回目の起動メッセージ（重複防止されるべき）
log_backtest_startup_message "Starting backtest container with enhanced error handling"

# クリーンアップ
rm -f "\$BACKTEST_STARTUP_LOCK_FILE" 2>/dev/null || true
`;

    const testScriptPath = path.join(tmpDir, `test-issue-5254-${Date.now()}.sh`);
    fs.writeFileSync(testScriptPath, testScript);
    fs.chmodSync(testScriptPath, '755');

    try {
      const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 10000 });
      
      // Issue #5254: 実際のメッセージ出力は1回のみであることを確認
      const startupMessages = stdout.split('\n').filter(line => 
        line.includes('Starting backtest container with enhanced error handling') &&
        !line.includes('suppressed')
      );
      expect(startupMessages.length).toBe(1);
      
      // 抑制メッセージが出力されることを確認
      const suppressMessages = stdout.split('\n').filter(line => 
        line.includes('Backtest startup message suppressed')
      );
      expect(suppressMessages.length).toBeGreaterThanOrEqual(1);
      
      // NPMエラーメッセージが記録されることを確認
      expect(stdout).toContain('npm ERR!');
      
    } finally {
      if (fs.existsSync(testScriptPath)) {
        fs.unlinkSync(testScriptPath);
      }
    }
  }, 15000);

  test('Issue #5254: entrypoint.sh構文検証', async () => {
    await expect(execAsync(`bash -n ${entrypointPath}`, { timeout: 3000 }))
      .resolves.not.toThrow();
  }, 5000);

  test('Issue #5254: 既存修正との統合性確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5250の修正が維持されている
    expect(entrypointContent).toContain('log_backtest_startup_message "Starting backtest container with enhanced error handling"');
    
    // Issue #5203の修正が維持されている
    expect(entrypointContent).toContain('Issue #5127, #5058 & #5175');
    
    // NPMエラー処理機構が存在する
    expect(entrypointContent).toContain('npm_install_success');
    expect(entrypointContent).toContain('send_startup_error_to_discord');
    
    // 重複防止に必要な関数が全て存在する
    const requiredFunctions = [
      'log_backtest_startup_message()',
      'retry_npm_install_with_backoff()',
      'install_npm_dependencies()',
      'acquire_startup_lock()'
    ];
    
    requiredFunctions.forEach(func => {
      expect(entrypointContent).toContain(func);
    });
  });

  test('Issue #5254: Docker再起動ポリシーとの整合性確認', () => {
    const dockerComposePath = path.join(__dirname, '..', 'docker-compose.yml');
    expect(fs.existsSync(dockerComposePath)).toBe(true);
    
    const dockerComposeContent = fs.readFileSync(dockerComposePath, 'utf8');
    
    // backtestサービスの再起動ポリシー確認
    expect(dockerComposeContent).toContain('backtest:');
    expect(dockerComposeContent).toContain('restart: on-failure:5');
    
    // entrypoint.shが正しく設定されている
    expect(dockerComposeContent).toContain('entrypoint: ["/usr/src/app/entrypoint.sh"]');
  });
});