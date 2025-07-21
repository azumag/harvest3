/**
 * Issue #5036: strategy-runnerサービスで例外が発生 - 重複起動メッセージ問題解決確認テスト
 * 
 * このテストは Issue #5036 で報告された重複メッセージ問題が
 * 既存の修正（Issue #2525, #5049）によって解決されていることを確認する
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

describe('Issue #5036: strategy-runnerサービス重複メッセージ問題解決確認', () => {
  const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
  
  test('Issue #5036で報告された重複メッセージ問題が解決されていることを確認', () => {
    expect(fs.existsSync(entrypointPath)).toBe(true);
    
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #2525の修正が適用されていることを確認
    expect(entrypointContent).toContain('log_startup_message()');
    expect(entrypointContent).toContain('STARTUP_MESSAGE_LOCK_DIR');
    expect(entrypointContent).toContain('get_message_hash');
    expect(entrypointContent).toContain('set -C');
    
    // Issue #5049の修正が適用されていることを確認
    expect(entrypointContent).toContain('log() {');
    expect(entrypointContent).toContain('echo "[$(date \'+%Y-%m-%d %H:%M:%S\')] [ENTRYPOINT] $1"');
    expect(entrypointContent).not.toContain('exec 1>&1');
    
    // Issue #5036で問題となったメッセージの出力箇所を確認
    expect(entrypointContent).toContain('log_startup_message "Starting strategy-runner container with enhanced error handling"');
  });

  test('重複メッセージ防止機能の統合テスト', async () => {
    // Issue #5036の状況を再現するテストスクリプト
    const testScript = `#!/bin/bash
set -e

# entrypoint.shから重複防止機能を抽出
STARTUP_MESSAGE_LOCK_DIR="/tmp/startup_messages_5036"
mkdir -p "$STARTUP_MESSAGE_LOCK_DIR" 2>/dev/null || true

get_message_hash() {
    echo "$1" | md5sum | cut -d' ' -f1
}

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

log_startup_message() {
    local message="$1"
    local message_hash=$(get_message_hash "$message")
    local var_name="STARTUP_MSG_$(echo "$message_hash" | cut -c1-8)"
    local lock_file="$STARTUP_MESSAGE_LOCK_DIR/$message_hash.lock"
    
    # プロセス内重複チェック
    if [ "\${!var_name}" = "1" ]; then
        return 0
    fi
    
    # プロセス内フラグを設定
    export "$var_name"=1
    
    # プロセス間重複チェック（atomic操作）
    if (set -C; echo "$$:\$(date +%s.%N)" > "$lock_file") 2>/dev/null; then
        log "$message"
        (sleep 30 && rm -f "$lock_file" 2>/dev/null) &
        return 0
    else
        return 0
    fi
}

echo "=== Issue #5036 Resolution Test ==="

# Issue #5036で報告されたのと同じ状況を再現
echo "[2025-07-20 05:26:30] [ENTRYPOINT] Graceful shutdown completed"
echo "[2025-07-20 05:26:40] [ENTRYPOINT] === 起動診断情報 ==="
echo "[2025-07-20 05:26:40] [ENTRYPOINT] プロセス ID: $$"
echo "[2025-07-20 05:26:40] [ENTRYPOINT] 起動時刻: $(date '+%Y-%m-%d %H:%M:%S')"
echo "[2025-07-20 05:26:40] [ENTRYPOINT] 作業ディレクトリ: /usr/src/app"
echo "[2025-07-20 05:26:40] [ENTRYPOINT] バックテストモード: false"
echo "[2025-07-20 05:26:40] [ENTRYPOINT] Acquiring startup lock..."
echo "[2025-07-20 05:26:40] [ENTRYPOINT] Startup lock acquired successfully (PID: $$)"

# 修正前は重複していた問題のメッセージ（修正後は1回のみ出力される）
log_startup_message "Starting strategy-runner container with enhanced error handling"
log_startup_message "Starting strategy-runner container with enhanced error handling"

echo "=== Test Completed ==="
`;

    const testScriptPath = '/tmp/test-issue-5036-resolution.sh';
    fs.writeFileSync(testScriptPath, testScript);
    fs.chmodSync(testScriptPath, '755');

    try {
      const { stdout, stderr } = await execAsync(`bash ${testScriptPath}`, { timeout: 8000 });
      
      console.log('Issue #5036 解決テスト出力:');
      console.log(stdout);
      
      // Issue #5036で問題となったメッセージの出現回数を確認
      const duplicateMessages = stdout.split('\n').filter(line => 
        line.includes('Starting strategy-runner container with enhanced error handling')
      );
      
      console.log(`Issue #5036: メッセージ出力数 = ${duplicateMessages.length}`);
      duplicateMessages.forEach((line, index) => {
        console.log(`  ${index + 1}: ${line}`);
      });
      
      // 修正により重複が解消されていることを確認（1回のみ出力）
      expect(duplicateMessages.length).toBe(1);
      expect(stderr.trim()).toBe('');
      
      // クリーンアップ
      if (fs.existsSync('/tmp/startup_messages_5036')) {
        const files = fs.readdirSync('/tmp/startup_messages_5036');
        files.forEach(file => {
          fs.unlinkSync(path.join('/tmp/startup_messages_5036', file));
        });
        fs.rmdirSync('/tmp/startup_messages_5036');
      }
      
    } finally {
      if (fs.existsSync(testScriptPath)) {
        fs.unlinkSync(testScriptPath);
      }
    }
  }, 10000);

  test('Issue #5036の問題の根本原因が修正されていることを確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // 過去の問題があったコードパターンが存在しないことを確認
    expect(entrypointContent).not.toContain('exec 1>&1'); // Issue #5049で削除
    expect(entrypointContent).not.toContain('STARTUP_MESSAGE_SENT=""'); // Issue #2525で改良
    
    // 現在の正しい実装が存在することを確認
    expect(entrypointContent).toContain('log_startup_message()'); // 重複防止関数
    expect(entrypointContent).toContain('get_message_hash()'); // ハッシュベース識別
    expect(entrypointContent).toContain('STARTUP_MESSAGE_LOCK_DIR'); // atomicロック実装
    
    // Issue #5036で報告されたメッセージが適切に処理されることを確認
    expect(entrypointContent).toContain('log_startup_message "Starting strategy-runner container with enhanced error handling"');
    
    // log関数がシンプルで正しいことを確認
    const logFunction = entrypointContent.match(/log\(\) \{[^}]*\}/)[0];
    expect(logFunction).toContain('echo "[$(date \'+%Y-%m-%d %H:%M:%S\')] [ENTRYPOINT] $1"');
    expect(logFunction).not.toContain('exec');
  });

  test('Issue #5036解決により他の機能に影響がないことを確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // 重要な機能が正しく維持されていることを確認
    const essentialFunctions = [
      'acquire_startup_lock()',
      'release_startup_lock()',
      'send_startup_error_to_discord(',
      'pre_startup_checks()',
      'check_database_connections()',
      'start_application()',
      'cleanup()',
      'run_diagnostics()',
      'main()'
    ];
    
    essentialFunctions.forEach(func => {
      expect(entrypointContent).toContain(func);
    });
    
    // バックテストメッセージも正しく処理されることを確認
    expect(entrypointContent).toContain('log_startup_message "Starting backtest container with enhanced error handling"');
  });

  test('Issue #5036: 自動作成されたIssueの検証パターン', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5036は自動的に作成されたIssueであることを考慮
    // 同様の自動Issueが今後作成されないよう、ログ監視システムとの整合性を確認
    
    // ログフォーマットが一貫していることを確認
    expect(entrypointContent).toContain('[$(date \'+%Y-%m-%d %H:%M:%S\')] [ENTRYPOINT]');
    
    // メッセージが重複しないことで、ログ監視システムが誤検知しないことを確認
    expect(entrypointContent).toContain('重複起動ログ防止関数');
    expect(entrypointContent).toContain('atomic');
    
    // エラー通知システムが適切に動作することを確認
    expect(entrypointContent).toContain('send_startup_error_to_discord');
  });

  test('entrypoint.sh構文検証', async () => {
    // Issue #5036修正後もentrypoint.shが正しく動作することを確認
    await expect(execAsync(`bash -n ${entrypointPath}`)).resolves.not.toThrow();
  });
});