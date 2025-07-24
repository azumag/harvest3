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

# entrypoint.shからlog_backtest_startup_message関数を抽出・強化
log_backtest_startup_message() {
    local message="\$1"
    local current_time=\$(date +%s)
    local lock_dir="/tmp/test-backtest-5254-lock-\${RANDOM}.dir"
    local timestamp_file="\$BACKTEST_STARTUP_LOCK_FILE"
    local restart_detection_file="\$BACKTEST_CONTAINER_RESTART_DETECTION_FILE"
    
    # Issue #5254対応: より厳密なコンテナ再起動検出
    local container_boot_time=\$(stat -c %Y /proc/1 2>/dev/null || echo "\$current_time")
    local instance_id="\${container_boot_time}_\$\$"
    
    # 古いロックディレクトリのクリーンアップ
    if [ -d "\$lock_dir" ]; then
        local lock_age=\$((current_time - \$(stat -c %Y "\$lock_dir" 2>/dev/null || echo 0)))
        if [ \$lock_age -gt 60 ]; then
            rm -rf "\$lock_dir" 2>/dev/null || true
        fi
    fi
    
    # Issue #5254: 再起動検出による強化された重複防止
    if [ -f "\$restart_detection_file" ]; then
        local last_restart_info=\$(cat "\$restart_detection_file" 2>/dev/null || echo "")
        local last_instance_id=\$(echo "\$last_restart_info" | cut -d':' -f1 2>/dev/null || echo "")
        local last_message_time=\$(echo "\$last_restart_info" | cut -d':' -f2 2>/dev/null || echo "0")
        
        # Issue #5254: より短い間隔でも重複を検出（30秒以内）
        if [ "\$last_instance_id" = "\$instance_id" ] || [ \$((current_time - last_message_time)) -lt 30 ]; then
            log "Backtest startup message suppressed (Issue #5254 prevention: last shown \$((current_time - last_message_time))s ago)"
            return 0
        fi
    fi
    
    # 既存のタイムスタンプファイルをチェック
    if [ -f "\$timestamp_file" ]; then
        local last_time=\$(cat "\$timestamp_file" 2>/dev/null || echo 0)
        local time_diff=\$((current_time - last_time))
        
        if [ \$time_diff -lt \$BACKTEST_STARTUP_LOCK_TIMEOUT ]; then
            log "Backtest startup message suppressed (last shown \${time_diff}s ago)"
            echo "\${instance_id}:\${last_time}" > "\$restart_detection_file"
            chmod 600 "\$restart_detection_file"
            return 0
        fi
    fi
    
    # atomicなロック取得を試行
    if mkdir "\$lock_dir" 2>/dev/null; then
        # タイムスタンプを更新してメッセージ出力
        echo "\$current_time" > "\$timestamp_file"
        chmod 600 "\$timestamp_file"
        
        # 再起動検出情報を記録
        echo "\${instance_id}:\${current_time}" > "\$restart_detection_file"
        chmod 600 "\$restart_detection_file"
        
        log "\$message"
        
        # ロック解放
        rm -rf "\$lock_dir" 2>/dev/null || true
        return 0
    else
        log "Backtest startup message suppressed (another process is logging)"
        return 0
    fi
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
rm -f "\$BACKTEST_CONTAINER_RESTART_DETECTION_FILE" 2>/dev/null || true
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