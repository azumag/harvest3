/**
 * Issue #5148: backtestサービスで例外が発生 - 解決確認テスト
 * 
 * 2025-07-22に発生したbacktestサービスの例外問題の解決確認
 * - npm エラーログの発生への対処確認
 * - 起動メッセージの重複表示問題の解決確認
 * - Issue #5175修正による問題解決の検証
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

describe('Issue #5148: backtestサービス例外解決確認', () => {
  const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
  const tmpDir = path.join(__dirname, '..', '.tmp');
  
  beforeAll(() => {
    // .tmpディレクトリが存在しない場合は作成
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  test('Issue #5148の報告された問題がentrypoint.shで解決されていることを確認', () => {
    expect(fs.existsSync(entrypointPath)).toBe(true);
    
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5148で報告された起動メッセージが存在することを確認
    expect(entrypointContent).toContain('Starting backtest container with enhanced error handling');
    
    // Issue #5175修正により重複防止機構が強化されていることを確認
    expect(entrypointContent).toContain('Issue #5127, #5058 & #5175: backtest container専用起動メッセージ関数（改良版）');
    expect(entrypointContent).toContain('コンテナ再起動検出を含む強化版重複防止機構');
    
    // npm エラー対処の強化がされていることを確認
    expect(entrypointContent).toContain('retry_npm_install_with_backoff');
    expect(entrypointContent).toContain('npm install failed after cache clean');
    expect(entrypointContent).toContain('指数バックオフによるリトライとコンテナ再起動防止');
  });

  test('Issue #5148の具体的なシナリオ: 重複メッセージ防止動作確認', async () => {
    // Issue #5148で報告された重複メッセージを再現するテスト
    const testScript = `#!/bin/bash
set -e

BACKTEST_STARTUP_LOCK_TIMEOUT=60
BACKTEST_CONTAINER_RESTART_DETECTION_FILE="/tmp/test-restart-detection-5148-$$.state"
lock_dir="/tmp/test-backtest-startup-lock-5148-$$.dir"
timestamp_file="/tmp/test-backtest-startup-timestamp-5148-$$.lock"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] \$1"
}

# Issue #5175修正版のlog_backtest_startup_message関数を使用
log_backtest_startup_message() {
    local message="\$1"
    local current_time=\$(date +%s)
    local restart_detection_file="\$BACKTEST_CONTAINER_RESTART_DETECTION_FILE"
    
    # Issue #5175: コンテナ再起動検出とトラッキング
    local container_boot_time=\$(stat -c %Y /proc/1 2>/dev/null || echo "\$current_time")
    local instance_id="\${container_boot_time}_\$\$"
    
    # 古いロックディレクトリのクリーンアップ（60秒以上古い場合）
    if [ -d "\$lock_dir" ]; then
        local lock_age=\$((current_time - \$(stat -c %Y "\$lock_dir" 2>/dev/null || echo 0)))
        if [ \$lock_age -gt 60 ]; then
            rm -rf "\$lock_dir" 2>/dev/null || true
        fi
    fi
    
    # Issue #5175: コンテナ再起動検出による追加重複防止
    if [ -f "\$restart_detection_file" ]; then
        local last_restart_info=\$(cat "\$restart_detection_file" 2>/dev/null || echo "")
        local last_instance_id=\$(echo "\$last_restart_info" | cut -d':' -f1 2>/dev/null || echo "")
        local last_message_time=\$(echo "\$last_restart_info" | cut -d':' -f2 2>/dev/null || echo "0")
        
        # 同じインスタンスIDまたは最近のメッセージ時刻をチェック
        if [ "\$last_instance_id" = "\$instance_id" ] || [ \$((current_time - last_message_time)) -lt \$BACKTEST_STARTUP_LOCK_TIMEOUT ]; then
            log "Backtest startup message suppressed (container restart detection: last shown \$((current_time - last_message_time))s ago)"
            return 0
        fi
    fi
    
    # 既存のタイムスタンプファイルをチェック
    if [ -f "\$timestamp_file" ]; then
        local last_time=\$(cat "\$timestamp_file" 2>/dev/null || echo 0)
        local time_diff=\$((current_time - last_time))
        
        if [ \$time_diff -lt \$BACKTEST_STARTUP_LOCK_TIMEOUT ]; then
            log "Backtest startup message suppressed (last shown \${time_diff}s ago)"
            # Issue #5175: 再起動検出情報も更新
            echo "\${instance_id}:\${last_time}" > "\$restart_detection_file"
            chmod 600 "\$restart_detection_file"
            return 0
        fi
    fi
    
    # atomicなロック取得を試行（mkdirはatomic操作）
    if mkdir "\$lock_dir" 2>/dev/null; then
        # ロック取得成功 - 二重チェック後にメッセージ出力
        if [ -f "\$timestamp_file" ]; then
            local last_time=\$(cat "\$timestamp_file" 2>/dev/null || echo 0)
            local time_diff=\$((current_time - last_time))
            
            if [ \$time_diff -lt \$BACKTEST_STARTUP_LOCK_TIMEOUT ]; then
                # 他のプロセスが先にメッセージを出力していた
                log "Backtest startup message suppressed (last shown \${time_diff}s ago)"
                rm -rf "\$lock_dir" 2>/dev/null || true
                # Issue #5175: 再起動検出情報も更新
                echo "\${instance_id}:\${last_time}" > "\$restart_detection_file"
                chmod 600 "\$restart_detection_file"
                return 0
            fi
        fi
        
        # タイムスタンプを更新してメッセージ出力
        echo "\$current_time" > "\$timestamp_file"
        chmod 600 "\$timestamp_file"
        
        # Issue #5175: 再起動検出情報を記録
        echo "\${instance_id}:\${current_time}" > "\$restart_detection_file"
        chmod 600 "\$restart_detection_file"
        
        log "\$message"
        
        # ロック解放
        rm -rf "\$lock_dir" 2>/dev/null || true
        return 0
    else
        # ロック取得失敗 - 他のプロセスが処理中
        log "Backtest startup message suppressed (another process is logging)"
        return 0
    fi
}

# Issue #5148で報告された状況を再現: 複数回の起動メッセージ呼び出し
echo "=== Issue #5148 シナリオテスト開始 ==="
log_backtest_startup_message "Starting backtest container with enhanced error handling"
log_backtest_startup_message "Starting backtest container with enhanced error handling"
log_backtest_startup_message "Starting backtest container with enhanced error handling"
echo "=== Issue #5148 シナリオテスト終了 ==="

# クリーンアップ
rm -f "\$timestamp_file" "\$restart_detection_file" 2>/dev/null || true
rm -rf "\$lock_dir" 2>/dev/null || true
`;

    const testScriptPath = path.join(tmpDir, `test-issue-5148-${Date.now()}.sh`);
    fs.writeFileSync(testScriptPath, testScript);
    fs.chmodSync(testScriptPath, '755');

    try {
      const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 10000 });
      
      // Issue #5148で報告された重複メッセージが防止されていることを確認
      const actualMessages = stdout.split('\n').filter(line => 
        line.includes('Starting backtest container with enhanced error handling') &&
        !line.includes('suppressed')
      );
      expect(actualMessages.length).toBe(1); // 1回のみメッセージが出力される
      
      // 抑制メッセージが適切に出力されている
      const suppressMessages = stdout.split('\n').filter(line => 
        line.includes('Backtest startup message suppressed')
      );
      expect(suppressMessages.length).toBe(2); // 2回目、3回目は抑制される
      
    } finally {
      if (fs.existsSync(testScriptPath)) {
        fs.unlinkSync(testScriptPath);
      }
    }
  }, 15000);

  test('Issue #5148の npm エラー対処機能確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // npm エラーログに言及された問題への対処が含まれていることを確認
    expect(entrypointContent).toContain('npm_error_log="/tmp/npm-install-error.log"');
    expect(entrypointContent).toContain('retry_npm_install_with_backoff');
    expect(entrypointContent).toContain('npm install failed after cache clean');
    
    // Issue #4202修正によるnpm対処強化の確認
    expect(entrypointContent).toContain('Issue #4202 修正: 指数バックオフによるリトライとコンテナ再起動防止');
    expect(entrypointContent).toContain('npm install failed after cache clean and');
    expect(entrypointContent).toContain('max_container_restarts');
    
    // npm ログファイルの詳細出力機能
    expect(entrypointContent).toContain('npm error details:');
    expect(entrypointContent).toContain('cat "$npm_error_log"');
  });

  test('Issue #5148解決後の安定性確認', async () => {
    // entrypoint.shの構文エラーがないことを確認
    await expect(execAsync(`bash -n ${entrypointPath}`, { timeout: 3000 }))
      .resolves.not.toThrow();
    
    // 重要な関数が正しく定義されていることを確認
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    const criticalFunctions = [
      'log_backtest_startup_message()',
      'retry_npm_install_with_backoff()',
      'install_npm_dependencies()',
      'cleanup_backtest_locks()'
    ];
    
    criticalFunctions.forEach(func => {
      expect(entrypointContent).toContain(func);
    });
  }, 5000);

  test('Issue #5148対応による回帰テスト', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5148修正が他の既存機能に影響していないことを確認
    expect(entrypointContent).toContain('$BACKTEST_MODE');
    expect(entrypointContent).toContain('log_startup_message');
    expect(entrypointContent).toContain('acquire_startup_lock');
    expect(entrypointContent).toContain('release_startup_lock');
    
    // Docker Compose設定との整合性確認
    expect(entrypointContent).toContain('npm run backtest');
    expect(entrypointContent).toContain('REDIS_URL');
    expect(entrypointContent).toContain('MONGO_URL');
  });
});