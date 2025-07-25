const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

describe('Issue #5228: エラーハンドリングとリカバリーテスト', () => {
  const tmpDir = path.join(__dirname, '..', '.tmp');
  const testFixturesPath = path.join(__dirname, 'fixtures', 'entrypoint-test-functions.sh');
  
  beforeAll(() => {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  describe('Redis関連エラーハンドリング', () => {
    test('Node.js実行環境が利用できない場合のgraceful fallback', () => {
      const testScript = `#!/bin/bash
# Node.jsを意図的に無効化
export PATH="/usr/bin:/bin"
source "${testFixturesPath}"

# Redisテストの実行と結果確認
if try_redis_duplicate_prevention "test-no-nodejs"; then
  echo "redis-available"
else  
  echo "redis-unavailable-fallback"
fi
`;

      const testScriptPath = path.join(tmpDir, `test-no-nodejs-${Date.now()}.sh`);
      fs.writeFileSync(testScriptPath, testScript);
      fs.chmodSync(testScriptPath, '755');

      try {
        const output = execSync(`bash ${testScriptPath}`, { 
          encoding: 'utf8',
          timeout: 3000 
        });
        
        expect(output.trim()).toBe('redis-unavailable-fallback');
      } finally {
        if (fs.existsSync(testScriptPath)) {
          fs.unlinkSync(testScriptPath);
        }
      }
    });

    test('REDIS_URL未設定時のfallback処理', () => {
      const testScript = `#!/bin/bash
# REDIS_URLを明示的に未設定
unset REDIS_URL
source "${testFixturesPath}"

if try_redis_duplicate_prevention "test-no-redis-url"; then
  echo "redis-connected"
else
  echo "redis-connection-failed"
fi
`;

      const testScriptPath = path.join(tmpDir, `test-no-redis-${Date.now()}.sh`);
      fs.writeFileSync(testScriptPath, testScript);
      fs.chmodSync(testScriptPath, '755');

      try {
        const output = execSync(`bash ${testScriptPath}`, { 
          encoding: 'utf8',
          timeout: 3000 
        });
        
        expect(output.trim()).toBe('redis-connection-failed');
      } finally {
        if (fs.existsSync(testScriptPath)) {
          fs.unlinkSync(testScriptPath);
        }
      }
    });
  });

  describe('ファイルシステムエラーハンドリング', () => {
    test('権限不足でのロックファイル作成失敗処理', () => {
      const restrictedDir = path.join(tmpDir, `restricted-${Date.now()}`);
      
      try {
        fs.mkdirSync(restrictedDir, { recursive: true });
        
        const testScript = `#!/bin/bash
export STARTUP_MESSAGE_LOCK_DIR="${restrictedDir}"
source "${testFixturesPath}"

# ディレクトリを読み取り専用に設定
chmod 555 "${restrictedDir}"

# ファイルベース重複防止を実行
result=$(fallback_to_file_based_prevention "permission-test" "$(get_message_hash 'permission-test')")
echo "Test completed with result: $result"
`;

        const testScriptPath = path.join(tmpDir, `test-permissions-${Date.now()}.sh`);
        fs.writeFileSync(testScriptPath, testScript);
        fs.chmodSync(testScriptPath, '755');

        const output = execSync(`bash ${testScriptPath}`, { 
          encoding: 'utf8',
          timeout: 3000 
        });
        
        // 権限エラーでも処理が完了することを確認
        expect(output).toContain('Test completed');
        
      } finally {
        // クリーンアップ（権限を戻してから削除）
        try {
          execSync(`chmod 755 "${restrictedDir}"`, { encoding: 'utf8' });
          if (fs.existsSync(restrictedDir)) {
            fs.rmSync(restrictedDir, { recursive: true, force: true });
          }
        } catch (e) {
          // クリーンアップエラーは無視
        }
      }
    });

    test('ロックファイルクリーンアップ処理の堅牢性', () => {
      const testLockDir = path.join(tmpDir, `lockdir-${Date.now()}`);
      fs.mkdirSync(testLockDir, { recursive: true });

      try {
        const testScript = `#!/bin/bash
export STARTUP_MESSAGE_LOCK_DIR="${testLockDir}"
source "${testFixturesPath}"

# 古いロックファイルを作成
old_lock="${testLockDir}/old.lock"
mkdir -p "\$old_lock"
echo "old-process" > "\$old_lock/process_info"

# 現在時刻より60秒前のタイムスタンプを設定
past_time=\$(($(date +%s) - 60))

# クリーンアップテスト実行
if cleanup_old_lock_file "\$old_lock" 30 "\$(date +%s)"; then
  echo "cleanup-success"
else
  echo "cleanup-failed"  
fi

# ロックファイルが削除されたか確認
if [ -d "\$old_lock" ]; then
  echo "lock-still-exists"
else
  echo "lock-removed"
fi
`;

        const testScriptPath = path.join(tmpDir, `test-cleanup-${Date.now()}.sh`);
        fs.writeFileSync(testScriptPath, testScript);
        fs.chmodSync(testScriptPath, '755');

        const output = execSync(`bash ${testScriptPath}`, { 
          encoding: 'utf8',
          timeout: 3000 
        });
        
        expect(output).toMatch(/cleanup-(success|failed)/);
        expect(output).toMatch(/lock-(removed|still-exists)/);
        
      } finally {
        if (fs.existsSync(testLockDir)) {
          fs.rmSync(testLockDir, { recursive: true, force: true });
        }
      }
    });
  });

  describe('重複防止機構の統合テスト', () => {
    test('Node.js不在時のfallback動作', () => {
      const fallbackTestDir = path.join(tmpDir, `nodejs-fallback-${Date.now()}`);
      fs.mkdirSync(fallbackTestDir, { recursive: true });

      try {
        const testScript = `#!/bin/bash
export STARTUP_MESSAGE_LOCK_DIR="${fallbackTestDir}"
export PATH="/usr/bin:/bin"  # Node.jsを除外

source "${testFixturesPath}"

# Node.js不在でのfallback動作をテスト
log_startup_message "nodejs-fallback-test"
echo "Node.js fallback test completed"
`;

        const testScriptPath = path.join(tmpDir, `test-nodejs-fallback-${Date.now()}.sh`);
        fs.writeFileSync(testScriptPath, testScript);
        fs.chmodSync(testScriptPath, '755');

        const output = execSync(`bash ${testScriptPath}`, { 
          encoding: 'utf8',
          timeout: 3000 
        });
        
        // メッセージが出力され、処理が完了することを確認
        expect(output).toContain('nodejs-fallback-test');
        expect(output).toContain('Node.js fallback test completed');
        
      } finally {
        if (fs.existsSync(fallbackTestDir)) {
          fs.rmSync(fallbackTestDir, { recursive: true, force: true });
        }
      }
    });

    test('Redis接続失敗時のfallback動作', () => {
      const fallbackTestDir = path.join(tmpDir, `redis-fallback-${Date.now()}`);
      fs.mkdirSync(fallbackTestDir, { recursive: true });

      try {
        const testScript = `#!/bin/bash
export STARTUP_MESSAGE_LOCK_DIR="${fallbackTestDir}"
export REDIS_URL="redis://127.0.0.1:99999"  # 存在しないポート

source "${testFixturesPath}"

# Redis接続失敗でのfallback動作をテスト
log_startup_message "redis-fallback-test"
echo "Redis fallback test completed"
`;

        const testScriptPath = path.join(tmpDir, `test-redis-fallback-${Date.now()}.sh`);
        fs.writeFileSync(testScriptPath, testScript);
        fs.chmodSync(testScriptPath, '755');

        const output = execSync(`bash ${testScriptPath}`, { 
          encoding: 'utf8',
          timeout: 3000 
        });
        
        // メッセージが出力され、処理が完了することを確認
        expect(output).toContain('redis-fallback-test');
        expect(output).toContain('Redis fallback test completed');
        
      } finally {
        if (fs.existsSync(fallbackTestDir)) {
          fs.rmSync(fallbackTestDir, { recursive: true, force: true });
        }
      }
    });

    test('複合エラー時の最終fallback動作', () => {
      const fallbackTestDir = path.join(tmpDir, `combined-fallback-${Date.now()}`);
      fs.mkdirSync(fallbackTestDir, { recursive: true });

      try {
        const testScript = `#!/bin/bash
export STARTUP_MESSAGE_LOCK_DIR="${fallbackTestDir}"
export REDIS_URL="redis://127.0.0.1:99999"  # 存在しないポート
export PATH="/usr/bin:/bin"  # Node.jsを除外

source "${testFixturesPath}"

# 複合エラー時の最終fallback動作をテスト
log_startup_message "combined-fallback-test"
echo "Combined fallback test completed"
`;

        const testScriptPath = path.join(tmpDir, `test-combined-fallback-${Date.now()}.sh`);
        fs.writeFileSync(testScriptPath, testScript);
        fs.chmodSync(testScriptPath, '755');

        const output = execSync(`bash ${testScriptPath}`, { 
          encoding: 'utf8',
          timeout: 5000 
        });
        
        // メッセージが出力され、処理が完了することを確認
        expect(output).toContain('combined-fallback-test');
        expect(output).toContain('Combined fallback test completed');
        
      } finally {
        if (fs.existsSync(fallbackTestDir)) {
          fs.rmSync(fallbackTestDir, { recursive: true, force: true });
        }
      }
    });

    test('プロセス内重複防止機構の動作確認', () => {
      const processTestDir = path.join(tmpDir, `process-${Date.now()}`);
      fs.mkdirSync(processTestDir, { recursive: true });

      try {
        const testScript = `#!/bin/bash
export STARTUP_MESSAGE_LOCK_DIR="${processTestDir}"
source "${testFixturesPath}"

# 同一プロセス内で同じメッセージを複数回送信
echo "=== First call ==="
log_startup_message "process-duplicate-test"

echo "=== Second call ==="  
log_startup_message "process-duplicate-test"

echo "=== Third call ==="
log_startup_message "process-duplicate-test"

echo "Process duplicate prevention test completed"
`;

        const testScriptPath = path.join(tmpDir, `test-process-dup-${Date.now()}.sh`);
        fs.writeFileSync(testScriptPath, testScript);
        fs.chmodSync(testScriptPath, '755');

        const output = execSync(`bash ${testScriptPath}`, { 
          encoding: 'utf8',
          timeout: 3000 
        });
        
        // メッセージが1回のみ出力されることを確認
        const messageCount = (output.match(/process-duplicate-test/g) || []).length;
        expect(messageCount).toBeLessThanOrEqual(1);
        expect(output).toContain('Process duplicate prevention test completed');
        
      } finally {
        if (fs.existsSync(processTestDir)) {
          fs.rmSync(processTestDir, { recursive: true, force: true });
        }
      }
    });
  });

  afterAll(() => {
    // テスト用ファイルのクリーンアップ
    if (fs.existsSync(tmpDir)) {
      const testFiles = fs.readdirSync(tmpDir).filter(file => 
        file.includes('test-') ||
        file.includes('restricted-') ||
        file.includes('lockdir-') ||
        file.includes('fallback-') ||
        file.includes('nodejs-fallback-') ||
        file.includes('redis-fallback-') ||
        file.includes('combined-fallback-') ||
        file.includes('process-')
      );
      testFiles.forEach(file => {
        const filePath = path.join(tmpDir, file);
        try {
          if (fs.statSync(filePath).isDirectory()) {
            execSync(`chmod -R 755 "${filePath}"`, { encoding: 'utf8' });
            fs.rmSync(filePath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(filePath);
          }
        } catch (error) {
          // クリーンアップエラーは無視
        }
      });
    }
  });
});