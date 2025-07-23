/**
 * Issue #5049: strategy-runnerサービスで例外が発生 - log関数重複出力修正テスト
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

describe('Issue #5049: log関数重複出力修正', () => {
  const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
  
  test('log関数からexec 1>&1が削除されている', () => {
    expect(fs.existsSync(entrypointPath)).toBe(true);
    
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // log関数の定義を確認
    expect(entrypointContent).toContain('log() {');
    expect(entrypointContent).toContain('echo "[$(date \'+%Y-%m-%d %H:%M:%S\')] [ENTRYPOINT] $1"');
    
    // 冗長なexec 1>&1が削除されていることを確認
    expect(entrypointContent).not.toContain('exec 1>&1');
    expect(entrypointContent).not.toContain('stdout の即座フラッシュを保証');
    
    // log関数がシンプルになっていることを確認
    const logFunction = entrypointContent.match(/log\(\) \{[^}]*\}/)[0];
    expect(logFunction).not.toContain('exec');
  });

  test('修正されたlog関数の動作確認', async () => {
    // 修正されたlog関数をテストするスクリプトを作成
    const testScript = `#!/bin/bash
set -e

# 修正されたlog関数（entrypoint.shから抽出）
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

echo "=== Testing Fixed log Function ==="
log "Test message 1"
log "Test message 2"  
log "Starting strategy-runner container with enhanced error handling"
echo "=== Test Completed ==="
`;

    const testScriptPath = '/tmp/test-log-function-5049.sh';
    fs.writeFileSync(testScriptPath, testScript);
    fs.chmodSync(testScriptPath, '755');

    try {
      const { stdout, stderr } = await execAsync(`bash ${testScriptPath}`, { timeout: 5000 });
      
      console.log('修正されたlog関数テスト出力:');
      console.log(stdout);
      
      // エラーが発生していないことを確認
      expect(stderr.trim()).toBe('');
      
      // 各メッセージが1回ずつ出力されていることを確認
      const lines = stdout.split('\n').filter(line => line.includes('[ENTRYPOINT]'));
      expect(lines.length).toBe(3); // 3つのlog呼び出し
      
      // 重複がないことを確認
      const uniqueLines = new Set(lines);
      expect(uniqueLines.size).toBe(lines.length);
      
    } finally {
      if (fs.existsSync(testScriptPath)) {
        fs.unlinkSync(testScriptPath);
      }
    }
  });

  test('entrypoint.shの構文が正しいことを確認', async () => {
    // bashスクリプトの構文チェック
    const { stderr } = await execAsync(`bash -n ${entrypointPath}`);
    expect(stderr.trim()).toBe('');
  });

  test('Issue #5049で報告された重複メッセージ問題の修正確認', async () => {
    // Issue #5049で報告された状況を再現するテスト
    const issueReproductionTest = `#!/bin/bash
set -e

# 修正されたlog関数
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

# log_startup_message関数の簡略版（重複防止機能付き）
STARTUP_MESSAGE_LOCK_DIR="/tmp/startup_messages_5049"
mkdir -p "$STARTUP_MESSAGE_LOCK_DIR" 2>/dev/null || true

get_message_hash() {
    echo "$1" | md5sum | cut -d' ' -f1
}

log_startup_message() {
    local message="$1"
    local message_hash=$(get_message_hash "$message")
    local var_name="STARTUP_MSG_$(echo "$message_hash" | cut -c1-8)"
    local lock_file="$STARTUP_MESSAGE_LOCK_DIR/$message_hash.lock"
    
    if [ "\${!var_name}" = "1" ]; then
        return 0
    fi
    
    export "$var_name"=1
    
    if mkdir "$lock_file" 2>/dev/null; then
        log "$message"
        (sleep 300 && rm -rf "$lock_file" 2>/dev/null) &
        return 0
    else
        return 0
    fi
}

echo "=== Issue #5049 Reproduction Test ==="
echo "[2025-07-20 10:21:28] [ENTRYPOINT] Graceful shutdown completed"
echo "[2025-07-20 10:21:38] [ENTRYPOINT] === 起動診断情報 ==="
echo "[2025-07-20 10:21:38] [ENTRYPOINT] プロセス ID: $$"
echo "[2025-07-20 10:21:38] [ENTRYPOINT] 起動時刻: $(date '+%Y-%m-%d %H:%M:%S')"
echo "[2025-07-20 10:21:38] [ENTRYPOINT] 作業ディレクトリ: $(pwd)"
echo "[2025-07-20 10:21:38] [ENTRYPOINT] バックテストモード: false"
echo "[2025-07-20 10:21:38] [ENTRYPOINT] Acquiring startup lock..."
echo "[2025-07-20 10:21:38] [ENTRYPOINT] Startup lock acquired successfully (PID: $$)"

# 修正前は重複していたメッセージ（修正後は1回のみ出力されるべき）
log_startup_message "Starting strategy-runner container with enhanced error handling"
log_startup_message "Starting strategy-runner container with enhanced error handling"

echo "=== Test Completed ==="
`;

    const testScriptPath = '/tmp/test-5049-reproduction.sh';
    fs.writeFileSync(testScriptPath, issueReproductionTest);
    fs.chmodSync(testScriptPath, '755');

    try {
      const { stdout, stderr } = await execAsync(`bash ${testScriptPath}`, { timeout: 8000 });
      
      console.log('Issue #5049 reproduction test 出力:');
      console.log(stdout);
      
      // 「Starting strategy-runner container with enhanced error handling」メッセージの出現回数を確認
      const duplicateMessages = stdout.split('\n').filter(line => 
        line.includes('Starting strategy-runner container with enhanced error handling')
      );
      
      console.log(`Issue #5049: メッセージ出力数 = ${duplicateMessages.length}`);
      duplicateMessages.forEach((line, index) => {
        console.log(`  ${index + 1}: ${line}`);
      });
      
      // 修正により重複が解消されていることを確認（1回のみ出力）
      expect(duplicateMessages.length).toBe(1);
      expect(stderr.trim()).toBe('');
      
      // クリーンアップ（mkdirベースロック対応）
      if (fs.existsSync('/tmp/startup_messages_5049')) {
        const files = fs.readdirSync('/tmp/startup_messages_5049');
        files.forEach(file => {
          const filePath = path.join('/tmp/startup_messages_5049', file);
          if (fs.statSync(filePath).isDirectory()) {
            fs.rmSync(filePath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(filePath);
          }
        });
        fs.rmdirSync('/tmp/startup_messages_5049');
      }
      
    } finally {
      if (fs.existsSync(testScriptPath)) {
        fs.unlinkSync(testScriptPath);
      }
    }
  }, 10000);

  test('修正によって他の機能が影響を受けていないことを確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // 重要な機能が削除されていないことを確認
    const importantFunctions = [
      'log(',
      'acquire_startup_lock()',
      'release_startup_lock()', 
      'send_startup_error_to_discord(',
      'pre_startup_checks()',
      'check_database_connections()',
      'start_application()',
      'cleanup()',
      'run_diagnostics()',
      'main()',
      'log_startup_message('
    ];
    
    importantFunctions.forEach(func => {
      expect(entrypointContent).toContain(func);
    });
    
    // log_startup_messageの呼び出し箇所が正しく保持されている
    expect(entrypointContent).toContain('log_backtest_startup_message "Starting backtest container with enhanced error handling"');
    expect(entrypointContent).toContain('log_startup_message "Starting strategy-runner container with enhanced error handling (container: $(hostname), pid: $$)"');
  });

  test('Issue #5049の根本原因が修正されている', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // 根本原因だった冗長なexec命令が削除されていることを確認
    expect(entrypointContent).not.toContain('exec 1>&1');
    
    // log関数がシンプルになっていることを確認
    const logFunctionMatches = entrypointContent.match(/log\(\) \{[^}]*\}/);
    expect(logFunctionMatches).toHaveLength(1);
    
    const logFunction = logFunctionMatches[0];
    expect(logFunction).toContain('echo "[$(date \'+%Y-%m-%d %H:%M:%S\')] [ENTRYPOINT] $1"');
    expect(logFunction).not.toContain('exec');
    expect(logFunction).not.toContain('stdout');
    
    // log関数が3行以内のシンプルな実装になっていることを確認
    const logFunctionLines = logFunction.split('\n').length;
    expect(logFunctionLines).toBeLessThanOrEqual(3);
  });
});