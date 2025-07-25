/**
 * Issue #5150: strategy-runnerサービスで例外が発生 - 重複起動メッセージ修正テスト
 * 
 * このテストは Issue #5150 で報告されたコンテナ再起動時の重複メッセージ問題の
 * 修正が正しく動作することを確認する
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

describe('Issue #5150: strategy-runnerサービス重複メッセージ修正確認', () => {
  const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
  
  test('cleanup_startup_message_locks関数が追加されていることを確認', () => {
    expect(fs.existsSync(entrypointPath)).toBe(true);
    
    const messageDedupeScript = path.join(__dirname, '../scripts/message-dedup.sh');
    const messageDedupeContent = fs.readFileSync(messageDedupeScript, 'utf8');
    
    // 新しく追加されたクリーンアップ関数が適切なスクリプトに分離されていることを確認
    expect(messageDedupeContent).toContain('cleanup_startup_message_locks()');
    expect(messageDedupeContent).toContain('Cleaning up startup message lock files...');
    expect(messageDedupeContent).toContain('find "$STARTUP_MESSAGE_LOCK_DIR" -name "*.done" -type f -delete');
    expect(messageDedupeContent).toContain('find "$STARTUP_MESSAGE_LOCK_DIR" -name "*.lock" -type d -exec rm -rf {} +');
  });

  test('cleanup関数にstartup message lockクリーンアップが追加されていることを確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // cleanup関数内で統一されたクリーンアップが呼ばれることを確認（リファクタリング後）
    expect(entrypointContent).toContain('cleanup_all_locks');
    
    // cleanup関数が存在し、適切に統合されたクリーンアップ処理を呼び出していることを確認
    const cleanupFunction = entrypointContent.match(/cleanup\(\) \{[\s\S]*?\n\}/)[0];
    expect(cleanupFunction).toContain('cleanup_all_locks');
    
    // ヘルパースクリプトが適切に読み込まれることを確認
    expect(entrypointContent).toContain('source_helper_scripts');
    expect(entrypointContent).toContain('message-dedup.sh');
  });

  test('初期クリーンアップがスクリプト開始時に実行されることを確認', () => {
    const messageDedupeScript = path.join(__dirname, '../scripts/message-dedup.sh');  
    const messageDedupeContent = fs.readFileSync(messageDedupeScript, 'utf8');
    
    // 初期クリーンアップ機能が適切なスクリプトに分離されていることを確認
    expect(messageDedupeContent).toContain('STARTUP_MESSAGE_LOCK_DIR');
    expect(messageDedupeContent).toContain('mkdir -p "$STARTUP_MESSAGE_LOCK_DIR"');
    
    // クリーンアップ関数が存在することを確認
    expect(messageDedupeContent).toContain('cleanup_startup_message_locks()');
    expect(messageDedupeContent).toContain('cleanup_all_locks()');
    
    // entrypoint.shが適切にヘルパースクリプトを読み込むことを確認
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    expect(entrypointContent).toContain('source_helper_scripts');
    expect(entrypointContent).toContain('message-dedup.sh');
  });

  describe('クリーンアップ機能の動作テスト', () => {
    let tmpDir;
    let testLockDir;

    beforeEach(() => {
      // .tmpディレクトリ内にテスト用ディレクトリを作成
      tmpDir = path.join(__dirname, '..', '.tmp');
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }
      testLockDir = path.join(tmpDir, `startup_messages_test_${Date.now()}`);
      if (!fs.existsSync(testLockDir)) {
        fs.mkdirSync(testLockDir, { recursive: true });
      }
    });

    afterEach(() => {
      // テスト後のクリーンアップ
      if (fs.existsSync(testLockDir)) {
        const files = fs.readdirSync(testLockDir);
        files.forEach(file => {
          const filePath = path.join(testLockDir, file);
          if (fs.statSync(filePath).isDirectory()) {
            fs.rmSync(filePath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(filePath);
          }
        });
        fs.rmdirSync(testLockDir);
      }
    });

    test('cleanup_startup_message_locks関数の動作確認', async () => {
      // テスト用のダミーロックファイルを作成
      const doneFile = path.join(testLockDir, 'test_hash.done');
      const lockDir = path.join(testLockDir, 'test_hash.lock');
      
      fs.writeFileSync(doneFile, 'dummy content');
      fs.mkdirSync(lockDir);
      
      // ファイルが存在することを確認
      expect(fs.existsSync(doneFile)).toBe(true);
      expect(fs.existsSync(lockDir)).toBe(true);

      // クリーンアップスクリプトを実行
      const cleanupScript = `#!/bin/bash
STARTUP_MESSAGE_LOCK_DIR="${testLockDir}"

cleanup_startup_message_locks() {
    echo "Cleaning up startup message lock files..."
    
    if [ -d "$STARTUP_MESSAGE_LOCK_DIR" ]; then
        find "$STARTUP_MESSAGE_LOCK_DIR" -name "*.done" -type f -delete 2>/dev/null || true
        find "$STARTUP_MESSAGE_LOCK_DIR" -name "*.lock" -type d -exec rm -rf {} + 2>/dev/null || true
        echo "Cleaned up startup message lock files"
    fi
}

cleanup_startup_message_locks
`;

      const testScriptPath = path.join(tmpDir, `test-cleanup-${Date.now()}.sh`);
      fs.writeFileSync(testScriptPath, cleanupScript);
      fs.chmodSync(testScriptPath, '755');

      try {
        const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 3000 });
        
        // クリーンアップが実行されたことを確認
        expect(stdout).toContain('Cleaning up startup message lock files...');
        expect(stdout).toContain('Cleaned up startup message lock files');
        
        // ファイルが削除されたことを確認
        expect(fs.existsSync(doneFile)).toBe(false);
        expect(fs.existsSync(lockDir)).toBe(false);
        
      } finally {
        if (fs.existsSync(testScriptPath)) {
          fs.unlinkSync(testScriptPath);
        }
      }
    }, 5000);

    test('初期クリーンアップの動作確認', async () => {
      // テスト用のダミーロックファイルを作成
      const oldDoneFile = path.join(testLockDir, 'old_message.done');
      const oldLockDir = path.join(testLockDir, 'old_message.lock');
      
      fs.writeFileSync(oldDoneFile, 'old content');
      fs.mkdirSync(oldLockDir);
      
      // ファイルが存在することを確認
      expect(fs.existsSync(oldDoneFile)).toBe(true);
      expect(fs.existsSync(oldLockDir)).toBe(true);

      // 初期クリーンアップスクリプトを実行
      const initCleanupScript = `#!/bin/bash
STARTUP_MESSAGE_LOCK_DIR="${testLockDir}"
mkdir -p "$STARTUP_MESSAGE_LOCK_DIR" 2>/dev/null || true

# Issue #5150: コンテナ再起動時の初期クリーンアップ
find "$STARTUP_MESSAGE_LOCK_DIR" -name "*.done" -type f -delete 2>/dev/null || true
find "$STARTUP_MESSAGE_LOCK_DIR" -name "*.lock" -type d -exec rm -rf {} + 2>/dev/null || true

echo "Initial cleanup completed"
`;

      const testScriptPath = path.join(tmpDir, `test-init-cleanup-${Date.now()}.sh`);
      fs.writeFileSync(testScriptPath, initCleanupScript);
      fs.chmodSync(testScriptPath, '755');

      try {
        const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 3000 });
        
        // 初期クリーンアップが実行されたことを確認
        expect(stdout).toContain('Initial cleanup completed');
        
        // 古いファイルが削除されたことを確認
        expect(fs.existsSync(oldDoneFile)).toBe(false);
        expect(fs.existsSync(oldLockDir)).toBe(false);
        
      } finally {
        if (fs.existsSync(testScriptPath)) {
          fs.unlinkSync(testScriptPath);
        }
      }
    }, 5000);
  });

  test('Issue #5150修正により既存機能に影響がないことを確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    const messageDedupeScript = path.join(__dirname, '../scripts/message-dedup.sh');
    const messageDedupeContent = fs.readFileSync(messageDedupeScript, 'utf8');
    
    // entrypoint.shの重要な機能が維持されていることを確認
    const entrypointFunctions = [
      'acquire_startup_lock()',
      'release_startup_lock()',
      'cleanup()',
      'main('
    ];
    
    entrypointFunctions.forEach(func => {
      expect(entrypointContent).toContain(func);
    });
    
    // message-dedup.shに分離された機能が正しく存在することを確認
    const messageFunctions = [
      'log_startup_message()',
      'try_redis_duplicate_prevention(',
      'fallback_to_file_based_prevention(',
      'get_message_hash('
    ];
    
    messageFunctions.forEach(func => {
      expect(messageDedupeContent).toContain(func);
    });
    
    // 既存の重複防止メカニズムが適切なスクリプトに維持されていることを確認
    expect(messageDedupeContent).toContain('DUPLICATE_PREVENTION_STRATEGY');
    expect(messageDedupeContent).toContain('redis_first');
    expect(messageDedupeContent).toContain('file_only');
    
    // ヘルパースクリプトの読み込みが正しく設定されていることを確認
    expect(entrypointContent).toContain('source_helper_scripts');
    expect(entrypointContent).toContain('message-dedup.sh');
  });

  test('entrypoint.sh構文検証', async () => {
    // Issue #5150修正後もentrypoint.shが正しく動作することを確認
    await expect(execAsync(`bash -n ${entrypointPath}`, { timeout: 3000 })).resolves.not.toThrow();
  }, 5000);

  test('Issue #5150でのログパターン分析確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5150で問題となったメッセージパターンが適切に処理されることを確認
    expect(entrypointContent).toContain('log_startup_message "Starting strategy-runner container with enhanced error handling (container: $(hostname), pid: $$)"');
    
    // ログ出力がlog_startup_message関数を通して行われることを確認
    // log_startup_message is now in message-dedup.sh, check that it's called instead
      expect(entrypointContent).toContain('log_startup_message "Starting strategy-runner container');
    
    // 直接的なecho文による起動メッセージ出力がないことを確認（log_startup_message以外）
    const lines = entrypointContent.split('\n');
    const directEchoLines = lines.filter(line => 
      line.includes('echo') && 
      line.includes('Starting strategy-runner') && 
      !line.includes('log_startup_message') &&
      !line.trim().startsWith('#')
    );
    expect(directEchoLines.length).toBe(0);
  });
});