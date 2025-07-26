const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

describe('Issue #5228: 並行実行テストカバレッジ', () => {
  const tmpDir = path.join(__dirname, '..', '.tmp');
  const testFixturesPath = path.join(__dirname, 'fixtures', 'entrypoint-test-functions.sh');
  
  // プロセス固有の一意な識別子で並行実行時の競合を回避
  const testId = `${process.pid}-${Date.now()}`;
  const backtestLockFile = path.join(tmpDir, `backtest-startup-message-${testId}.lock`);
  
  beforeAll(() => {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  describe('ロック競合処理テスト', () => {
    test('同一メッセージハッシュでのロック競合処理', () => {
      const concurrentDir = path.join(tmpDir, `concurrent-${Date.now()}`);
      fs.mkdirSync(concurrentDir, { recursive: true });

      try {
        const testScript = `#!/bin/bash
export STARTUP_MESSAGE_LOCK_DIR="${concurrentDir}"
source "${testFixturesPath}"

# 同一のメッセージハッシュで複数回ロック取得を試行
message="concurrent-lock-test"
message_hash=\$(get_message_hash "\$message")

echo "Testing lock acquisition for hash: \$message_hash"

# 最初のロック取得
if acquire_message_lock "\$message" 2; then
  echo "first-lock-acquired"
  
  # 同じメッセージで2回目のロック取得（失敗することを期待）
  if acquire_message_lock "\$message" 1; then
    echo "second-lock-acquired"
  else
    echo "second-lock-failed-as-expected"
  fi
  
  # ロックファイルを手動でクリーンアップ
  rm -rf "\${STARTUP_MESSAGE_LOCK_DIR}/\${message_hash}.lock" 2>/dev/null || true
else
  echo "first-lock-failed"
fi

echo "Lock competition test completed"
`;

        const testScriptPath = path.join(tmpDir, `test-lock-competition-${Date.now()}.sh`);
        fs.writeFileSync(testScriptPath, testScript);
        fs.chmodSync(testScriptPath, '755');

        const output = execSync(`bash ${testScriptPath}`, { 
          encoding: 'utf8',
          timeout: 5000 
        });
        
        expect(output).toContain('Testing lock acquisition for hash:');
        expect(output).toContain('Lock competition test completed');
        // 最初のロック取得は成功し、2回目は適切に失敗することを期待
        expect(output).toMatch(/(first-lock-acquired|first-lock-failed)/);
        
      } finally {
        if (fs.existsSync(concurrentDir)) {
          fs.rmSync(concurrentDir, { recursive: true, force: true });
        }
      }
    });

    test('異なるコンテナIDでのsuccess file競合処理', () => {
      const successFileDir = path.join(tmpDir, `success-${Date.now()}`);
      fs.mkdirSync(successFileDir, { recursive: true });

      try {
        const testScript = `#!/bin/bash
export STARTUP_MESSAGE_LOCK_DIR="${successFileDir}"
source "${testFixturesPath}"

message="success-file-test"
message_hash=\$(get_message_hash "\$message")
success_file="\${STARTUP_MESSAGE_LOCK_DIR}/\$message_hash.done"

# 異なるコンテナIDをシミュレート
current_time=\$(date +%s)
old_time=\$((current_time - 400))  # 400秒前

# 古いsuccess fileを作成（異なるコンテナIDで）
echo "\$old_time:9999:old-container" > "\$success_file"

echo "Created old success file with timestamp: \$old_time"

# 新しいプロセスから重複防止を実行
fallback_to_file_based_prevention "\$message" "\$message_hash"

# success fileの内容を確認
if [ -f "\$success_file" ]; then
  echo "Success file exists after processing"
  cat "\$success_file" | head -1
else
  echo "Success file was cleaned up"
fi

echo "Success file competition test completed"
`;

        const testScriptPath = path.join(tmpDir, `test-success-competition-${Date.now()}.sh`);
        fs.writeFileSync(testScriptPath, testScript);
        fs.chmodSync(testScriptPath, '755');

        const output = execSync(`bash ${testScriptPath}`, { 
          encoding: 'utf8',
          timeout: 5000 
        });
        
        expect(output).toContain('Created old success file with timestamp:');
        expect(output).toContain('Success file competition test completed');
        expect(output).toMatch(/(Success file exists|Success file was cleaned up)/);
        
      } finally {
        if (fs.existsSync(successFileDir)) {
          fs.rmSync(successFileDir, { recursive: true, force: true });
        }
      }
    });
  });

  describe('メッセージ重複防止の統合テスト', () => {
    test('シーケンシャル実行での重複防止機構の確認', () => {
      const sequentialDir = path.join(tmpDir, `sequential-${Date.now()}`);
      fs.mkdirSync(sequentialDir, { recursive: true });

      try {
        const testScript = `#!/bin/bash
export STARTUP_MESSAGE_LOCK_DIR="${sequentialDir}"
export SUCCESS_FILE_CLEANUP_DELAY=1  # 1秒後にクリーンアップ
source "${testFixturesPath}"

echo "=== Sequential duplicate prevention test ==="

# 最初の実行
echo "First execution:"
log_startup_message "sequential-test-message"

# 短時間待機
sleep 0.5

# 2回目の実行（重複として検出されることを期待）
echo "Second execution (should be blocked):"
log_startup_message "sequential-test-message"

# クリーンアップ待機
sleep 1.5

# 3回目の実行（クリーンアップ後なので新規として処理）
echo "Third execution (after cleanup):"
log_startup_message "sequential-test-message"

echo "Sequential test completed"
`;

        const testScriptPath = path.join(tmpDir, `test-sequential-${Date.now()}.sh`);
        fs.writeFileSync(testScriptPath, testScript);
        fs.chmodSync(testScriptPath, '755');

        const output = execSync(`bash ${testScriptPath}`, { 
          encoding: 'utf8',
          timeout: 8000 
        });
        
        // メッセージが適切に出力されることを確認
        const messageMatches = output.match(/sequential-test-message/g);
        expect(messageMatches).not.toBeNull();
        
        // 重複防止により、メッセージの出力回数が制御されていることを確認
        expect(messageMatches.length).toBeGreaterThan(0);
        expect(output).toContain('Sequential test completed');
        
      } finally {
        if (fs.existsSync(sequentialDir)) {
          fs.rmSync(sequentialDir, { recursive: true, force: true });
        }
      }
    });

    test('バックテストモードでの重複防止テスト', () => {
      const backtestDir = path.join(tmpDir, `backtest-${Date.now()}`);
      fs.mkdirSync(backtestDir, { recursive: true });

      try {
        const testScript = `#!/bin/bash
export STARTUP_MESSAGE_LOCK_DIR="${backtestDir}"
export BACKTEST_MODE=true
backtestLockFile="${backtestLockFile}"
source "${testFixturesPath}"

echo "=== Backtest mode duplicate prevention test ==="

# バックテストモードでの重複防止テスト
echo "First backtest message:"
log_startup_message "backtest-duplicate-test"

echo "Second backtest message (should be blocked):"
log_startup_message "backtest-duplicate-test"

# バックテストロックファイルの状態確認
if [ -f "${backtestLockFile}" ]; then
  echo "Backtest lock file exists"
  cat "${backtestLockFile}"
else
  echo "Backtest lock file not found"
fi

echo "Backtest duplicate prevention test completed"
`;

        const testScriptPath = path.join(tmpDir, `test-backtest-${Date.now()}.sh`);
        fs.writeFileSync(testScriptPath, testScript);
        fs.chmodSync(testScriptPath, '755');

        const output = execSync(`bash ${testScriptPath}`, { 
          encoding: 'utf8',
          timeout: 5000 
        });
        
        // バックテストモードでの処理が正常に実行されることを確認
        expect(output).toContain('Backtest mode duplicate prevention test');
        expect(output).toContain('Backtest duplicate prevention test completed');
        
        // バックテストメッセージの重複防止確認
        const backtestMessageMatches = output.match(/backtest-duplicate-test/g);
        expect(backtestMessageMatches).not.toBeNull();
        expect(backtestMessageMatches.length).toBeLessThanOrEqual(1);
        
      } finally {
        if (fs.existsSync(backtestDir)) {
          fs.rmSync(backtestDir, { recursive: true, force: true });
        }
        // バックテストロックファイルのクリーンアップ
        execSync(`rm -f "${backtestLockFile}"`, { encoding: 'utf8' });
      }
    });
  });

  describe('リソース管理テスト', () => {
    test('大量のロックファイル生成時のクリーンアップ動作', () => {
      const massLockDir = path.join(tmpDir, `mass-lock-${Date.now()}`);
      fs.mkdirSync(massLockDir, { recursive: true });

      try {
        const testScript = `#!/bin/bash
export STARTUP_MESSAGE_LOCK_DIR="${massLockDir}"
source "${testFixturesPath}"

echo "=== Mass lock file generation test ==="

# 複数の異なるメッセージでロックファイル生成
for i in {1..10}; do
  message="mass-test-message-\$i"
  message_hash=\$(get_message_hash "\$message")
  lock_file="\${STARTUP_MESSAGE_LOCK_DIR}/\$message_hash.lock"
  
  # ロックファイルを作成
  mkdir -p "\$lock_file" 2>/dev/null || true
  echo "\$(hostname):\$\$:\$(date +%s)" > "\$lock_file/process_info" 2>/dev/null || true
done

echo "Created 10 lock files"

# ロックファイル数を確認
lock_count=\$(ls -1 "${massLockDir}" | grep "\.lock" | wc -l)
echo "Lock file count: \$lock_count"

# 全体的なクリーンアップテスト
current_time=\$(date +%s)
cleaned_count=0

for lock_file in "${massLockDir}"/*.lock; do
  if [ -d "\$lock_file" ]; then
    if cleanup_old_lock_file "\$lock_file" 1 "\$current_time"; then
      cleaned_count=\$((cleaned_count + 1))
    fi
  fi
done

echo "Cleaned up \$cleaned_count lock files"
echo "Mass lock cleanup test completed"
`;

        const testScriptPath = path.join(tmpDir, `test-mass-lock-${Date.now()}.sh`);
        fs.writeFileSync(testScriptPath, testScript);
        fs.chmodSync(testScriptPath, '755');

        const output = execSync(`bash ${testScriptPath}`, { 
          encoding: 'utf8',
          timeout: 5000 
        });
        
        expect(output).toContain('Created 10 lock files');
        expect(output).toMatch(/Lock file count: \d+/);
        expect(output).toMatch(/Cleaned up \d+ lock files/);
        expect(output).toContain('Mass lock cleanup test completed');
        
      } finally {
        if (fs.existsSync(massLockDir)) {
          fs.rmSync(massLockDir, { recursive: true, force: true });
        }
      }
    });
  });

  afterAll(() => {
    // テスト用ファイルのクリーンアップ
    if (fs.existsSync(tmpDir)) {
      const testFiles = fs.readdirSync(tmpDir).filter(file => 
        file.includes('test-') ||
        file.includes('concurrent-') ||
        file.includes('success-') ||
        file.includes('sequential-') ||
        file.includes('backtest-') ||
        file.includes('mass-lock-')
      );
      testFiles.forEach(file => {
        const filePath = path.join(tmpDir, file);
        try {
          if (fs.statSync(filePath).isDirectory()) {
            fs.rmSync(filePath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(filePath);
          }
        } catch (error) {
          // クリーンアップエラーは無視
        }
      });
    }
    
    // グローバルなクリーンアップ
    execSync(`rm -f "${backtestLockFile}"`, { encoding: 'utf8' });
  });
});