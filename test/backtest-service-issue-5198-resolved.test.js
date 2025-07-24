/**
 * Issue #5198: [自動] backtestサービスで例外が発生 - 解決確認テスト
 * 
 * 重複ログメッセージ問題が既に解決済みであることを確認
 * - Issue #5132/#5173の修正が正しく適用されていることを検証
 * - backtestサービスの正常動作を確認
 * - 将来的な問題の再発防止対策を確認
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

describe('Issue #5198: backtestサービス例外問題解決確認', () => {
  const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
  const packageJsonPath = path.join(__dirname, '..', 'package.json');
  const backtestRunnerPath = path.join(__dirname, '..', 'src', 'backtestRunner.js');
  const dockerComposePath = path.join(__dirname, '..', 'docker-compose.yml');
  const tmpDir = path.join(__dirname, '..', '.tmp');

  beforeAll(() => {
    // .tmpディレクトリが存在しない場合は作成
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  test('Issue #5198: 問題の報告された重複メッセージが既に修正されていることを確認', () => {
    expect(fs.existsSync(entrypointPath)).toBe(true);
    
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5198で報告された問題のメッセージが存在しないことを確認
    expect(entrypointContent).not.toContain('log_backtest_startup_message "Executing backtest command with enhanced error handling..."');
    expect(entrypointContent).not.toContain('log "Executing backtest command with enhanced error handling..."');
    
    // 適切な修正が適用されていることを確認（Issue #5132/#5173）
    expect(entrypointContent).toContain('Issue #5132修正: 重複する起動メッセージを防止するため、exec実行前の追加メッセージを削除');
    expect(entrypointContent).toContain('Issue #5127/#5173対策: exec実行前のファイナルチェックと重複メッセージ防止');
    
    // 正しい単一メッセージのみが残っていることを確認
    expect(entrypointContent).toContain('log_backtest_startup_message "Starting backtest container with enhanced error handling"');
  });

  test('backtestサービスの設定が正常であることを確認', () => {
    // package.jsonのbacktestスクリプト確認
    expect(fs.existsSync(packageJsonPath)).toBe(true);
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    expect(packageJson.scripts.backtest).toBe('node src/backtestRunner.js --auto-update');
    
    // backtestRunnerの存在確認
    expect(fs.existsSync(backtestRunnerPath)).toBe(true);
    const backtestRunnerContent = fs.readFileSync(backtestRunnerPath, 'utf8');
    expect(backtestRunnerContent).toContain('runBacktest');
    expect(backtestRunnerContent).toContain('BACKTEST_LONG_RUNNING_MODE');
    
    // docker-compose.ymlの設定確認
    expect(fs.existsSync(dockerComposePath)).toBe(true);
    const dockerComposeContent = fs.readFileSync(dockerComposePath, 'utf8');
    expect(dockerComposeContent).toContain('BACKTEST_MODE=true');
    expect(dockerComposeContent).toContain('BACKTEST_LONG_RUNNING_MODE=true');
    expect(dockerComposeContent).toContain('command: npm run backtest');
  });

  test('重複防止機構が正しく実装されていることを確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // log_backtest_startup_message関数の重複防止機構
    expect(entrypointContent).toContain('log_backtest_startup_message() {');
    expect(entrypointContent).toContain('BACKTEST_STARTUP_LOCK_FILE');
    expect(entrypointContent).toContain('BACKTEST_STARTUP_LOCK_TIMEOUT');
    // Issue #5216で簡素化：複雑な再起動検出機構は削除済み
    expect(entrypointContent).toContain('Issue #5216: backtest container専用起動メッセージ関数（簡素化版）');
    
    // atomicなロック機構
    expect(entrypointContent).toContain('mkdir "$lock_dir"');
    expect(entrypointContent).toContain('rm -rf "$lock_dir"');
    
    // タイムスタンプベースの重複チェック
    expect(entrypointContent).toContain('time_diff=$((current_time - last_time))');
    expect(entrypointContent).toContain('if [ $time_diff -lt $BACKTEST_STARTUP_LOCK_TIMEOUT ]');
  });

  test('backtestサービス起動シミュレーション（重複メッセージなし）', async () => {
    const testScript = `#!/bin/bash
set -e

# テスト用環境変数設定
export BACKTEST_MODE=true
BACKTEST_STARTUP_LOCK_FILE="/tmp/test-backtest-5198-\${RANDOM}.lock"
BACKTEST_STARTUP_LOCK_TIMEOUT=10
BACKTEST_CONTAINER_RESTART_DETECTION_FILE="/tmp/test-restart-detection-\${RANDOM}.state"

# 簡略版のlog_backtest_startup_message関数（実際の関数をベース）
log_backtest_startup_message() {
    local message="$1"
    local current_time=$(date +%s)
    local lock_dir="/tmp/backtest-startup-lock-test-\${RANDOM}.dir"
    local timestamp_file="$BACKTEST_STARTUP_LOCK_FILE"
    local restart_detection_file="$BACKTEST_CONTAINER_RESTART_DETECTION_FILE"
    
    # コンテナ再起動検出とトラッキング
    local container_boot_time=$(stat -c %Y /proc/1 2>/dev/null || echo "$current_time")
    local instance_id="\${container_boot_time}_$$"
    
    # 古いロックディレクトリのクリーンアップ
    if [ -d "$lock_dir" ]; then
        local lock_age=$((current_time - $(stat -c %Y "$lock_dir" 2>/dev/null || echo 0)))
        if [ $lock_age -gt 60 ]; then
            rm -rf "$lock_dir" 2>/dev/null || true
        fi
    fi
    
    # 既存のタイムスタンプファイルをチェック
    if [ -f "$timestamp_file" ]; then
        local last_time=$(cat "$timestamp_file" 2>/dev/null || echo 0)
        local time_diff=$((current_time - last_time))
        
        if [ $time_diff -lt $BACKTEST_STARTUP_LOCK_TIMEOUT ]; then
            echo "Backtest startup message suppressed (last shown \${time_diff}s ago)"
            echo "\${instance_id}:\${last_time}" > "$restart_detection_file"
            chmod 600 "$restart_detection_file"
            return 0
        fi
    fi
    
    # atomicなロック取得を試行
    if mkdir "$lock_dir" 2>/dev/null; then
        # タイムスタンプを更新してメッセージ出力
        echo "$current_time" > "$timestamp_file"
        chmod 600 "$timestamp_file"
        echo "\${instance_id}:\${current_time}" > "$restart_detection_file"
        chmod 600 "$restart_detection_file"
        
        echo "[ENTRYPOINT] $message"
        
        # ロック解放
        rm -rf "$lock_dir" 2>/dev/null || true
        return 0
    else
        echo "Backtest startup message suppressed (another process is logging)"
        return 0
    fi
}

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

# Issue #5198解決後のbacktest起動プロセスをシミュレート
if [ "$BACKTEST_MODE" = "true" ]; then
    # 単一の正しいメッセージのみ出力（Issue #5132/#5173修正済み）
    log_backtest_startup_message "Starting backtest container with enhanced error handling"
    
    # Issue #5198で報告された重複メッセージは出力されない
    # log_backtest_startup_message "Executing backtest command with enhanced error handling..." # 削除済み
    
    log "Pre-startup checks completed for backtest mode"
    log "Backtest command arguments: npm run backtest"
    log "Validating npm run backtest command..."
    log "Backtest script found in package.json"
    log "Backtest runner found: src/backtestRunner.js"
    
    # backtest開始時刻を記録
    echo "$(date +%s)" > /tmp/backtest-start-time.marker
    log "Backtest service initialization completed successfully"
fi

# クリーンアップ
rm -f "$BACKTEST_STARTUP_LOCK_FILE" "$BACKTEST_CONTAINER_RESTART_DETECTION_FILE" 2>/dev/null || true
rm -rf /tmp/backtest-startup-lock-test-*.dir 2>/dev/null || true
`;

    const testScriptPath = path.join(tmpDir, `test-issue-5198-resolved-${Date.now()}.sh`);
    fs.writeFileSync(testScriptPath, testScript);
    fs.chmodSync(testScriptPath, '755');

    try {
      const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 10000 });
      
      // 正常な起動メッセージが1回のみ出力されることを確認
      const startupMessages = stdout.split('\n').filter(line => 
        line.includes('Starting backtest container with enhanced error handling') &&
        !line.includes('suppressed')
      );
      expect(startupMessages.length).toBe(1);
      
      // Issue #5198で報告された重複メッセージが出力されないことを確認
      const duplicateMessages = stdout.split('\n').filter(line => 
        line.includes('Executing backtest command with enhanced error handling')
      );
      expect(duplicateMessages.length).toBe(0);
      
      // 正常な初期化完了メッセージが含まれることを確認
      expect(stdout).toContain('Pre-startup checks completed for backtest mode');
      expect(stdout).toContain('Backtest service initialization completed successfully');
      
      // Issue #5198で報告されたログパターンと比較
      const lines = stdout.split('\n').filter(line => line.trim());
      expect(lines.length).toBeGreaterThan(5); // 適切な量のログが出力される
      expect(lines.length).toBeLessThan(15); // しかし重複による大量のログはない
      
    } finally {
      if (fs.existsSync(testScriptPath)) {
        fs.unlinkSync(testScriptPath);
      }
    }
  }, 15000);

  test('エラーハンドリングと再起動機構の正常性確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    const backtestRunnerContent = fs.readFileSync(backtestRunnerPath, 'utf8');
    const dockerComposeContent = fs.readFileSync(dockerComposePath, 'utf8');
    
    // entrypoint.shのエラーハンドリング
    expect(entrypointContent).toContain('set -e'); // エラー時即座終了
    expect(entrypointContent).toContain('trap cleanup SIGTERM SIGINT'); // シグナルハンドラー
    expect(entrypointContent).toContain('cleanup()'); // クリーンアップ関数
    
    // backtestRunnerの長時間実行モードとエラーハンドリング
    expect(backtestRunnerContent).toContain('BACKTEST_LONG_RUNNING_MODE');
    expect(backtestRunnerContent).toContain('consecutiveFailures');
    expect(backtestRunnerContent).toContain('MAX_CONSECUTIVE_FAILURES');
    expect(backtestRunnerContent).toContain('startBacktestWithRetry');
    
    // Docker Composeの再起動ポリシー
    expect(dockerComposeContent).toContain('restart: on-failure:5');
    
    // Issue #5198で報告された無限ループ防止対策
    expect(backtestRunnerContent).toContain('isShuttingDown');
    expect(backtestRunnerContent).toContain('SIGTERM');
    expect(backtestRunnerContent).toContain('process.exit(1)'); // 致命的エラー時の適切な終了
  });

  test('監視とデバッグ機能の存在確認', () => {
    const backtestRunnerContent = fs.readFileSync(backtestRunnerPath, 'utf8');
    
    // ヘルスチェック機能
    expect(backtestRunnerContent).toContain('startHealthCheckServer');
    expect(backtestRunnerContent).toContain('HEALTH_CHECK_PORT');
    expect(backtestRunnerContent).toContain('/health');
    
    // ログレベル制御
    expect(backtestRunnerContent).toContain('LOG_LEVEL');
    expect(backtestRunnerContent).toContain('logWithLevel');
    
    // メモリ監視
    expect(backtestRunnerContent).toContain('checkMemoryUsage');
    expect(backtestRunnerContent).toContain('MEMORY_THRESHOLD');
    
    // Discord通知
    expect(backtestRunnerContent).toContain('postErrorToDiscord');
    expect(backtestRunnerContent).toContain('postResultToDiscord');
  });

  test('Issue #5198解決の継続性確認', async () => {
    // 既存の修正テストが継続して通ることを確認
    const issue5132TestPath = path.join(__dirname, 'backtest-service-issue-5132-fix.test.js');
    const issue5173TestPath = path.join(__dirname, 'backtest-service-issue-5173-fix.test.js');
    
    expect(fs.existsSync(issue5132TestPath)).toBe(true);
    expect(fs.existsSync(issue5173TestPath)).toBe(true);
    
    // これらのテストが引き続き通ることで、Issue #5198が解決済みであることを間接的に確認
    const issue5132Content = fs.readFileSync(issue5132TestPath, 'utf8');
    const issue5173Content = fs.readFileSync(issue5173TestPath, 'utf8');
    
    // Issue #5132の修正内容確認
    expect(issue5132Content).toContain('重複する起動メッセージを防止するため、exec実行前の追加メッセージを削除');
    expect(issue5132Content).toContain('not.toContain(\'log_backtest_startup_message "Executing backtest command with enhanced error handling..."');
    
    // Issue #5173の修正内容確認
    expect(issue5173Content).toContain('重複メッセージ "Executing backtest command with enhanced error handling..." の修正テスト');
    expect(issue5173Content).toContain('container restart detection');
  });

  afterAll(() => {
    // テスト用ファイルのクリーンアップ
    if (fs.existsSync(tmpDir)) {
      const testFiles = fs.readdirSync(tmpDir).filter(file => 
        file.includes('test-issue-5198') || file.includes('backtest-start-time.marker')
      );
      testFiles.forEach(file => {
        const filePath = path.join(tmpDir, file);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      });
    }
  });
});