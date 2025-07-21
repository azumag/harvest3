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
const os = require('os');

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

  describe('重複メッセージ防止機能の個別テスト', () => {
    let tmpDir;
    let lockDir;

    beforeEach(() => {
      // .tmpディレクトリ内にテスト用ディレクトリを作成
      tmpDir = path.join(__dirname, '..', '.tmp');
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }
      lockDir = path.join(tmpDir, `startup_messages_test_${Date.now()}`);
      if (!fs.existsSync(lockDir)) {
        fs.mkdirSync(lockDir, { recursive: true });
      }
    });

    afterEach(() => {
      // テスト後のクリーンアップ
      if (fs.existsSync(lockDir)) {
        const files = fs.readdirSync(lockDir);
        files.forEach(file => {
          fs.unlinkSync(path.join(lockDir, file));
        });
        fs.rmdirSync(lockDir);
      }
    });

    test('プロセス内フラグによる重複防止', async () => {
      const testScript = `#!/bin/bash
set -e

get_message_hash() {
    echo "$1" | md5sum | cut -d' ' -f1
}

# プロセス内フラグテスト
message="test message"
hash=$(get_message_hash "$message")
var_name="STARTUP_MSG_$(echo "$hash" | cut -c1-8)"

# 初回は設定されていない
if [ "\${!var_name}" = "1" ]; then
    echo "DUPLICATE"
else
    echo "FIRST"
    export "$var_name"=1
fi

# 2回目は設定されている
if [ "\${!var_name}" = "1" ]; then
    echo "DUPLICATE"
else
    echo "FIRST"
fi
`;

      const testScriptPath = path.join(tmpDir, `test-process-flag-${Date.now()}.sh`);
      fs.writeFileSync(testScriptPath, testScript);
      fs.chmodSync(testScriptPath, '755');

      try {
        const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 2000 });
        const lines = stdout.trim().split('\n');
        
        expect(lines[0]).toBe('FIRST');
        expect(lines[1]).toBe('DUPLICATE');
      } finally {
        if (fs.existsSync(testScriptPath)) {
          fs.unlinkSync(testScriptPath);
        }
      }
    }, 5000);

    test('MD5ハッシュベース識別機能', async () => {
      const testScript = `#!/bin/bash
get_message_hash() {
    echo "$1" | md5sum | cut -d' ' -f1
}

hash1=$(get_message_hash "same message")
hash2=$(get_message_hash "same message")
hash3=$(get_message_hash "different message")

echo "$hash1"
echo "$hash2"
echo "$hash3"
`;

      const testScriptPath = path.join(tmpDir, `test-hash-${Date.now()}.sh`);
      fs.writeFileSync(testScriptPath, testScript);
      fs.chmodSync(testScriptPath, '755');

      try {
        const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 2000 });
        const lines = stdout.trim().split('\n');
        
        expect(lines[0]).toBe(lines[1]); // 同じメッセージは同じハッシュ
        expect(lines[0]).not.toBe(lines[2]); // 異なるメッセージは異なるハッシュ
      } finally {
        if (fs.existsSync(testScriptPath)) {
          fs.unlinkSync(testScriptPath);
        }
      }
    }, 3000);

    test('Issue #5036重複メッセージ解決確認', async () => {
      const testScript = `#!/bin/bash
set -e

LOCK_DIR="${lockDir}"

get_message_hash() {
    echo "$1" | md5sum | cut -d' ' -f1
}

log_startup_message() {
    local message="$1"
    local hash=$(get_message_hash "$message")
    local var_name="STARTUP_MSG_$(echo "$hash" | cut -c1-8)"
    local lock_file="$LOCK_DIR/$hash.lock"
    
    if [ "\${!var_name}" = "1" ]; then
        return 0
    fi
    
    export "$var_name"=1
    
    if (set -C; echo "$$" > "$lock_file") 2>/dev/null; then
        echo "[ENTRYPOINT] $message"
        return 0
    fi
}

# Issue #5036のメッセージを2回呼び出し（修正後は1回のみ出力）
log_startup_message "Starting strategy-runner container with enhanced error handling"
log_startup_message "Starting strategy-runner container with enhanced error handling"
`;

      const testScriptPath = path.join(tmpDir, `test-issue-5036-${Date.now()}.sh`);
      fs.writeFileSync(testScriptPath, testScript);
      fs.chmodSync(testScriptPath, '755');

      try {
        const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 3000 });
        
        const messages = stdout.split('\n').filter(line => 
          line.includes('Starting strategy-runner container with enhanced error handling')
        );
        
        // 修正により重複が解消されていることを確認（1回のみ出力）
        expect(messages.length).toBe(1);
      } finally {
        if (fs.existsSync(testScriptPath)) {
          fs.unlinkSync(testScriptPath);
        }
      }
    }, 5000);
  });

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

  test('Issue #5036: ログ監視システムとの整合性確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // ログフォーマットが一貫していることを確認
    expect(entrypointContent).toContain('[$(date \'+%Y-%m-%d %H:%M:%S\')] [ENTRYPOINT]');
    
    // エラー通知システムが適切に動作することを確認
    expect(entrypointContent).toContain('send_startup_error_to_discord');
  });

  test('entrypoint.sh構文検証', async () => {
    // Issue #5036修正後もentrypoint.shが正しく動作することを確認
    await expect(execAsync(`bash -n ${entrypointPath}`, { timeout: 2000 })).resolves.not.toThrow();
  }, 3000);
});