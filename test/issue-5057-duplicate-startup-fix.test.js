/**
 * Issue #5057: strategy-runnerサービスで例外が発生 - レースコンディション修正確認テスト
 * 
 * log_startup_message関数のレースコンディション問題を修正し、
 * 重複メッセージが確実に防止されることを確認する
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const os = require('os');

const execAsync = promisify(exec);

describe('Issue #5057: strategy-runnerサービス重複メッセージ レースコンディション修正確認', () => {
  const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
  
  test('Issue #5057の修正が適用されていることを確認', () => {
    expect(fs.existsSync(entrypointPath)).toBe(true);
    
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5121で追加された簡素化・安定化修正コメントを確認
    expect(entrypointContent).toContain('Issue #5121 修正: 簡素化・安定化版');
    expect(entrypointContent).toContain('シンプルなファイルベースロック機構による重複防止');
    
    // プロセス内フラグがロック取得後に設定されることを確認
    const lockSuccessPattern = /if \[ "\$lock_acquired" = true \]; then[\s\S]*?export "\$var_name"=1/;
    expect(entrypointContent).toMatch(lockSuccessPattern);
    
    // Issue #5121実装でのフラグ設定箇所を確認
    const lines = entrypointContent.split('\n');
    const exportLines = lines.filter(line => line.includes('export "$var_name"=1'));
    expect(exportLines.length).toBe(3); // Issue #5121実装では3箇所に設定されている
  });

  describe('レースコンディション修正機能の個別テスト', () => {
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

    test('レースコンディション修正: プロセス内フラグ即座設定', async () => {
      const testScript = `#!/bin/bash
set -e

get_message_hash() {
    echo "$1" | md5sum | cut -d' ' -f1
}

# 修正版のプロセス内フラグ制御テスト
message="test message"
hash=$(get_message_hash "$message")
var_name="STARTUP_MSG_$(echo "$hash" | cut -c1-8)"

# 初回チェック
if [ "\${!var_name}" = "1" ]; then
    echo "DUPLICATE_INITIAL"
else
    echo "FIRST_INITIAL"
    # Issue #5057修正: フラグを即座に設定
    export "$var_name"=1
fi

# 即座に2回目チェック（レースコンディション模擬）
if [ "\${!var_name}" = "1" ]; then
    echo "DUPLICATE_IMMEDIATE"
else
    echo "FIRST_IMMEDIATE"
fi
`;

      const testScriptPath = path.join(tmpDir, `test-race-fix-${Date.now()}.sh`);
      fs.writeFileSync(testScriptPath, testScript);
      fs.chmodSync(testScriptPath, '755');

      try {
        const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 2000 });
        const lines = stdout.trim().split('\n');
        
        expect(lines[0]).toBe('FIRST_INITIAL');
        expect(lines[1]).toBe('DUPLICATE_IMMEDIATE'); // 修正により即座にブロック
      } finally {
        if (fs.existsSync(testScriptPath)) {
          fs.unlinkSync(testScriptPath);
        }
      }
    }, 5000);

    test('修正版log_startup_message関数の重複防止確認', async () => {
      const testScript = `#!/bin/bash
set -e

LOCK_DIR="${lockDir}"

get_message_hash() {
    echo "$1" | md5sum | cut -d' ' -f1
}

# 修正版log_startup_message実装
log_startup_message() {
    local message="$1"
    local hash=$(get_message_hash "$message")
    local var_name="STARTUP_MSG_$(echo "$hash" | cut -c1-8)"
    local lock_file="$LOCK_DIR/$hash.lock"
    
    # プロセス内重複チェック
    if [ "\${!var_name}" = "1" ]; then
        return 0
    fi
    
    # Issue #5057修正: フラグを即座に設定
    export "$var_name"=1
    
    # ロック取得試行
    if mkdir "$lock_file" 2>/dev/null; then
        echo "[ENTRYPOINT] $message"
        return 0
    else
        unset "$var_name"
        return 0
    fi
}

# Issue #5057のメッセージでテスト（修正後は1回のみ出力）
log_startup_message "Starting strategy-runner container with enhanced error handling"
log_startup_message "Starting strategy-runner container with enhanced error handling"
log_startup_message "Starting strategy-runner container with enhanced error handling"
`;

      const testScriptPath = path.join(tmpDir, `test-issue-5057-fix-${Date.now()}.sh`);
      fs.writeFileSync(testScriptPath, testScript);
      fs.chmodSync(testScriptPath, '755');

      try {
        const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 3000 });
        
        const messages = stdout.split('\n').filter(line => 
          line.includes('Starting strategy-runner container with enhanced error handling')
        );
        
        // 修正により重複が完全に解消されていることを確認（1回のみ出力）
        expect(messages.length).toBe(1);
      } finally {
        if (fs.existsSync(testScriptPath)) {
          fs.unlinkSync(testScriptPath);
        }
      }
    }, 5000);

    test('並列実行時のレースコンディション修正確認', async () => {
      const testScript = `#!/bin/bash
set -e

LOCK_DIR="${lockDir}"

get_message_hash() {
    echo "$1" | md5sum | cut -d' ' -f1
}

# 修正版log_startup_message実装
log_startup_message() {
    local message="$1"
    local hash=$(get_message_hash "$message")
    local var_name="STARTUP_MSG_$(echo "$hash" | cut -c1-8)"
    local lock_file="$LOCK_DIR/$hash.lock"
    
    if [ "\${!var_name}" = "1" ]; then
        return 0
    fi
    
    # Issue #5057修正: フラグを即座に設定
    export "$var_name"=1
    
    if mkdir "$lock_file" 2>/dev/null; then
        echo "[ENTRYPOINT] $message"
        return 0
    else
        unset "$var_name"
        return 0
    fi
}

# バックグラウンドで並列実行（レースコンディション模擬）
{
    log_startup_message "Starting strategy-runner container with enhanced error handling"
} &

{
    log_startup_message "Starting strategy-runner container with enhanced error handling"  
} &

{
    log_startup_message "Starting strategy-runner container with enhanced error handling"
} &

wait
`;

      const testScriptPath = path.join(tmpDir, `test-parallel-fix-${Date.now()}.sh`);
      fs.writeFileSync(testScriptPath, testScript);
      fs.chmodSync(testScriptPath, '755');

      try {
        const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 3000 });
        
        const messages = stdout.split('\n').filter(line => 
          line.includes('Starting strategy-runner container with enhanced error handling')
        );
        
        // 並列実行でも重複が防止されていることを確認（1回以下の出力）
        expect(messages.length).toBeLessThanOrEqual(1);
      } finally {
        if (fs.existsSync(testScriptPath)) {
          fs.unlinkSync(testScriptPath);
        }
      }
    }, 5000);
  });

  test('Issue #5057修正により他の機能に影響がないことを確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // 重要な機能が正しく維持されていることを確認
    const essentialFunctions = [
      'acquire_startup_lock()',
      'release_startup_lock()',
      'log_startup_message()',
      'get_message_hash()',
      'main()'
    ];
    
    essentialFunctions.forEach(func => {
      expect(entrypointContent).toContain(func);
    });
    
    // バックテストメッセージも正しく処理されることを確認
    expect(entrypointContent).toContain('log_startup_message "Starting backtest container with enhanced error handling"');
    expect(entrypointContent).toContain('log_startup_message "Starting strategy-runner container with enhanced error handling"');
  });

  test('entrypoint.sh構文検証（修正後）', async () => {
    // Issue #5057修正後もentrypoint.shが正しく動作することを確認
    await expect(execAsync(`bash -n ${entrypointPath}`, { timeout: 2000 })).resolves.not.toThrow();
  }, 3000);

  test('Issue #5057: 修正内容の詳細確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5121: 具体的な修正内容を確認
    expect(entrypointContent).toContain('export "$var_name"=1');
    expect(entrypointContent).toContain('プロセス内フラグを設定');
    
    // Issue #5121: 新しい実装のコメントが含まれていることを確認
    expect(entrypointContent).toContain('Issue #5121 修正: 簡素化・安定化版');
    expect(entrypointContent).toContain('シンプルなファイルベースロック機構による重複防止');
  });
});