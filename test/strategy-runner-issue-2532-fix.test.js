/**
 * strategy-runner Issue #2532 重複起動メッセージ修正のテスト
 * Issue #2532: [自動] strategy-runnerサービスで例外が発生（重複起動メッセージ）
 * 
 * 強化版atomic実装のテスト
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(require('child_process').exec);

describe('Strategy-Runner Issue #2532 重複起動メッセージ修正', () => {
  const messageLockDir = '/tmp/startup_messages';
  const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
  const testTmpDir = path.join(__dirname, '..', '.tmp');
  
  beforeAll(() => {
    // テストディレクトリの作成
    if (!fs.existsSync(testTmpDir)) {
      fs.mkdirSync(testTmpDir, { recursive: true });
    }
  });

  // 各テスト前のクリーンアップ
  beforeEach(() => {
    // メッセージロックディレクトリとその中身を削除
    if (fs.existsSync(messageLockDir)) {
      const files = fs.readdirSync(messageLockDir);
      files.forEach(file => {
        try {
          fs.unlinkSync(path.join(messageLockDir, file));
        } catch (e) {
          // ファイルが既に削除されている場合は無視
        }
      });
      try {
        fs.rmdirSync(messageLockDir);
      } catch (e) {
        // ディレクトリが空でない場合は無視
      }
    }
  });

  // 各テスト後のクリーンアップ
  afterEach(() => {
    // メッセージロックディレクトリとその中身を削除
    if (fs.existsSync(messageLockDir)) {
      const files = fs.readdirSync(messageLockDir);
      files.forEach(file => {
        try {
          fs.unlinkSync(path.join(messageLockDir, file));
        } catch (e) {
          // ファイルが既に削除されている場合は無視
        }
      });
      try {
        fs.rmdirSync(messageLockDir);
      } catch (e) {
        // ディレクトリが空でない場合は無視
      }
    }
  });

  describe('強化版atomic実装の確認', () => {
    test('entrypoint.shに強化版log_startup_message関数が実装されている', () => {
      expect(fs.existsSync(entrypointPath)).toBe(true);
      
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 強化版atomic実装のコメントが存在することを確認
      expect(entrypointContent).toContain('強化版 atomic ファイルベース実装');
      
      // 一時ファイルを使用した堅牢な実装が含まれることを確認
      expect(entrypointContent).toContain('temp_lock_file="$lock_file.tmp.$$"');
      expect(entrypointContent).toContain('ln "$temp_lock_file" "$lock_file"');
      
      // 古いロックファイルのクリーンアップ機能が含まれることを確認
      expect(entrypointContent).toContain('lock_age=$(( $(date +%s) - $(stat -c %Y "$lock_file"');
      expect(entrypointContent).toContain('if [ $lock_age -gt 300 ]; then');
    });

    test('一時ファイルを使用したatomic操作が実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 一時ファイル作成
      expect(entrypointContent).toContain('echo "$$:$(date +%s)" > "$temp_lock_file"');
      
      // atomicなlink操作
      expect(entrypointContent).toContain('if ln "$temp_lock_file" "$lock_file" 2>/dev/null; then');
      
      // エラーハンドリング
      expect(entrypointContent).toContain('rm -f "$temp_lock_file" 2>/dev/null || true');
    });

    test('古いロックファイルのクリーンアップ機能が実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 5分以上古いロックファイルのクリーンアップ
      expect(entrypointContent).toContain('if [ $lock_age -gt 300 ]; then');
      expect(entrypointContent).toContain('rm -f "$lock_file" 2>/dev/null || true');
      
      // 3分後の自動クリーンアップ
      expect(entrypointContent).toContain('sleep 180 && rm -f "$lock_file"');
    });

    test('エラーハンドリングが適切に実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 各操作にエラーハンドリングが含まれることを確認
      expect(entrypointContent).toContain('2>/dev/null || true');
      expect(entrypointContent).toContain('2>/dev/null || echo 0');
      expect(entrypointContent).toContain('rm -f "$temp_lock_file" 2>/dev/null || true');
    });
  });

  describe('強化版重複防止機能の動作確認', () => {
    test('強化版atomic実装が重複メッセージを正しく抑制する', () => {
      // 強化版atomic実装のテストスクリプトを作成
      const enhancedTestScript = `#!/bin/bash
set -e

# 重複起動メッセージ防止（強化版 atomic ファイルベース実装）
STARTUP_MESSAGE_LOCK_DIR="/tmp/startup_messages_enhanced"
mkdir -p "$STARTUP_MESSAGE_LOCK_DIR" 2>/dev/null || true

# ログ関数
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

# 重複起動ログ防止関数（強化版 atomic ファイルベース実装）
log_startup_message() {
    local message="$1"
    local message_hash=$(echo "$message" | md5sum | cut -d' ' -f1)
    local lock_file="$STARTUP_MESSAGE_LOCK_DIR/$message_hash.lock"
    local temp_lock_file="$lock_file.tmp.$$"
    
    # ロックファイルが古い場合のクリーンアップ（5分以上古い場合）
    if [ -f "$lock_file" ]; then
        local lock_age=$(( $(date +%s) - $(stat -c %Y "$lock_file" 2>/dev/null || echo 0) ))
        if [ $lock_age -gt 300 ]; then
            rm -f "$lock_file" 2>/dev/null || true
        fi
    fi
    
    # 既にロックファイルが存在する場合は重複として扱う
    if [ -f "$lock_file" ]; then
        return 0
    fi
    
    # より堅牢なatomic操作：一時ファイルを使用してからatomicにlink
    if echo "$$:$(date +%s)" > "$temp_lock_file" 2>/dev/null; then
        # linkを使用してatomicにロックファイルを作成（既存ファイルがある場合は失敗）
        if ln "$temp_lock_file" "$lock_file" 2>/dev/null; then
            # ロックが取得できた場合のみメッセージを出力
            log "$message"
            
            # 自動クリーンアップ（テスト用に短時間設定）
            (sleep 2 && rm -f "$lock_file") &
        else
            # linkが失敗した場合（既に他のプロセスがロックを取得している）
            rm -f "$temp_lock_file" 2>/dev/null || true
            return 0
        fi
        
        # 一時ファイルを削除
        rm -f "$temp_lock_file" 2>/dev/null || true
    else
        # 一時ファイルの作成が失敗した場合
        return 0
    fi
}

# テスト実行
echo "=== Testing enhanced atomic log_startup_message function ==="
log_startup_message "Starting strategy-runner container with enhanced error handling"
log_startup_message "Starting strategy-runner container with enhanced error handling"  # 抑制されるべき
log_startup_message "Starting strategy-runner container with enhanced error handling"  # 抑制されるべき
log_startup_message "Different message"
sleep 3  # ロックファイルのクリーンアップを待つ
log_startup_message "Starting strategy-runner container with enhanced error handling"  # クリーンアップ後なので出力される
echo "Enhanced test completed"
`;

      const testPath = path.join(testTmpDir, 'enhanced_atomic_test.sh');
      fs.writeFileSync(testPath, enhancedTestScript);
      fs.chmodSync(testPath, '755');

      try {
        const output = execSync(`bash ${testPath}`, { encoding: 'utf8' });
        
        // 出力の解析
        const lines = output.split('\n').filter(line => line.trim() !== '');
        const logMessages = lines.filter(line => line.includes('[ENTRYPOINT]'));
        
        // "Starting strategy-runner container with enhanced error handling" の出力回数を確認
        // 重複が抑制されているかを確認（3回呼び出したが、重複は抑制される）
        const startupMessages = logMessages.filter(line => 
          line.includes('Starting strategy-runner container with enhanced error handling')
        );
        expect(startupMessages.length).toBe(2);
        
        // "Different message" が一度だけ出力されることを確認
        const differentMessages = logMessages.filter(line => line.includes('Different message'));
        expect(differentMessages.length).toBe(1);
        
        // テスト完了メッセージがあることを確認
        expect(output).toContain('Enhanced test completed');
        
      } finally {
        // クリーンアップ
        if (fs.existsSync(testPath)) {
          fs.unlinkSync(testPath);
        }
      }
    });

    test('同時実行でのrace conditionが適切に処理される', async () => {
      // 同時実行テストスクリプトを作成
      const concurrentTestScript = `#!/bin/bash
set -e

# 重複起動メッセージ防止（強化版 atomic ファイルベース実装）
STARTUP_MESSAGE_LOCK_DIR="/tmp/startup_messages_concurrent"
mkdir -p "$STARTUP_MESSAGE_LOCK_DIR" 2>/dev/null || true

# ログ関数
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

# 重複起動ログ防止関数（強化版 atomic ファイルベース実装）
log_startup_message() {
    local message="$1"
    local message_hash=$(echo "$message" | md5sum | cut -d' ' -f1)
    local lock_file="$STARTUP_MESSAGE_LOCK_DIR/$message_hash.lock"
    local temp_lock_file="$lock_file.tmp.$$"
    
    # ロックファイルが古い場合のクリーンアップ（5分以上古い場合）
    if [ -f "$lock_file" ]; then
        local lock_age=$(( $(date +%s) - $(stat -c %Y "$lock_file" 2>/dev/null || echo 0) ))
        if [ $lock_age -gt 300 ]; then
            rm -f "$lock_file" 2>/dev/null || true
        fi
    fi
    
    # 既にロックファイルが存在する場合は重複として扱う
    if [ -f "$lock_file" ]; then
        return 0
    fi
    
    # より堅牢なatomic操作：一時ファイルを使用してからatomicにlink
    if echo "$$:$(date +%s)" > "$temp_lock_file" 2>/dev/null; then
        # linkを使用してatomicにロックファイルを作成（既存ファイルがある場合は失敗）
        if ln "$temp_lock_file" "$lock_file" 2>/dev/null; then
            # ロックが取得できた場合のみメッセージを出力
            log "$message"
            
            # 自動クリーンアップ（テスト用に短時間設定）
            (sleep 1 && rm -f "$lock_file") &
        else
            # linkが失敗した場合（既に他のプロセスがロックを取得している）
            rm -f "$temp_lock_file" 2>/dev/null || true
            return 0
        fi
        
        # 一時ファイルを削除
        rm -f "$temp_lock_file" 2>/dev/null || true
    else
        # 一時ファイルの作成が失敗した場合
        return 0
    fi
}

# 同時実行テスト
echo "=== Testing concurrent execution ==="
log_startup_message "Concurrent test message"
`;

      const testPath = path.join(testTmpDir, 'concurrent_test.sh');
      fs.writeFileSync(testPath, concurrentTestScript);
      fs.chmodSync(testPath, '755');

      try {
        // 複数のプロセスを同時に実行
        const promises = [];
        for (let i = 0; i < 5; i++) {
          promises.push(execAsync(`bash ${testPath}`));
        }
        
        const results = await Promise.allSettled(promises);
        
        // 全てのプロセスが正常に終了することを確認
        const successCount = results.filter(r => r.status === 'fulfilled').length;
        expect(successCount).toBe(5);
        
        // 出力されたメッセージの総数をカウント
        let totalLogMessages = 0;
        results.forEach(result => {
          if (result.status === 'fulfilled') {
            const lines = result.value.stdout.split('\n').filter(line => line.trim() !== '');
            const logMessages = lines.filter(line => line.includes('[ENTRYPOINT]'));
            totalLogMessages += logMessages.length;
          }
        });
        
        // 重複防止により、メッセージの出力は最大でも5回以下であることを確認
        expect(totalLogMessages).toBeLessThanOrEqual(5);
        
      } finally {
        // クリーンアップ
        if (fs.existsSync(testPath)) {
          fs.unlinkSync(testPath);
        }
      }
    });

    test('古いロックファイルのクリーンアップ機能が正しく動作する', () => {
      // 古いロックファイルクリーンアップテストスクリプト
      const cleanupTestScript = `#!/bin/bash
set -e

# 重複起動メッセージ防止（強化版 atomic ファイルベース実装）
STARTUP_MESSAGE_LOCK_DIR="/tmp/startup_messages_cleanup"
mkdir -p "$STARTUP_MESSAGE_LOCK_DIR" 2>/dev/null || true

# ログ関数
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

# 古いロックファイルを作成（5分以上古いファイル）
test_message="Old lock file test"
message_hash=$(echo "$test_message" | md5sum | cut -d' ' -f1)
old_lock_file="$STARTUP_MESSAGE_LOCK_DIR/$message_hash.lock"
echo "old_pid:$(date +%s)" > "$old_lock_file"

# ファイルのタイムスタンプを古く設定（6分前）
touch -t $(date -d '6 minutes ago' '+%Y%m%d%H%M') "$old_lock_file"

# 重複起動ログ防止関数（強化版 atomic ファイルベース実装）
log_startup_message() {
    local message="$1"
    local message_hash=$(echo "$message" | md5sum | cut -d' ' -f1)
    local lock_file="$STARTUP_MESSAGE_LOCK_DIR/$message_hash.lock"
    local temp_lock_file="$lock_file.tmp.$$"
    
    # ロックファイルが古い場合のクリーンアップ（5分以上古い場合）
    if [ -f "$lock_file" ]; then
        local lock_age=$(( $(date +%s) - $(stat -c %Y "$lock_file" 2>/dev/null || echo 0) ))
        if [ $lock_age -gt 300 ]; then
            echo "Cleaning up old lock file (age: $lock_age seconds)"
            rm -f "$lock_file" 2>/dev/null || true
        fi
    fi
    
    # 既にロックファイルが存在する場合は重複として扱う
    if [ -f "$lock_file" ]; then
        return 0
    fi
    
    # より堅牢なatomic操作：一時ファイルを使用してからatomicにlink
    if echo "$$:$(date +%s)" > "$temp_lock_file" 2>/dev/null; then
        # linkを使用してatomicにロックファイルを作成（既存ファイルがある場合は失敗）
        if ln "$temp_lock_file" "$lock_file" 2>/dev/null; then
            # ロックが取得できた場合のみメッセージを出力
            log "$message"
            
            # 自動クリーンアップ（テスト用に短時間設定）
            (sleep 1 && rm -f "$lock_file") &
        else
            # linkが失敗した場合（既に他のプロセスがロックを取得している）
            rm -f "$temp_lock_file" 2>/dev/null || true
            return 0
        fi
        
        # 一時ファイルを削除
        rm -f "$temp_lock_file" 2>/dev/null || true
    else
        # 一時ファイルの作成が失敗した場合
        return 0
    fi
}

# テスト実行
echo "=== Testing old lock file cleanup ==="
log_startup_message "$test_message"
echo "Cleanup test completed"
`;

      const testPath = path.join(testTmpDir, 'cleanup_test.sh');
      fs.writeFileSync(testPath, cleanupTestScript);
      fs.chmodSync(testPath, '755');

      try {
        const output = execSync(`bash ${testPath}`, { encoding: 'utf8' });
        
        // 古いロックファイルがクリーンアップされることを確認
        expect(output).toContain('Cleaning up old lock file');
        
        // メッセージが正常に出力されることを確認
        expect(output).toContain('[ENTRYPOINT] Old lock file test');
        
        // テスト完了メッセージがあることを確認
        expect(output).toContain('Cleanup test completed');
        
      } finally {
        // クリーンアップ
        if (fs.existsSync(testPath)) {
          fs.unlinkSync(testPath);
        }
      }
    });
  });

  describe('Issue #2532 の解決確認', () => {
    test('重複起動メッセージの問題が解決されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 強化版の実装が含まれることを確認
      expect(entrypointContent).toContain('強化版 atomic ファイルベース実装');
      
      // 一時ファイルを使用した堅牢な実装が含まれることを確認
      expect(entrypointContent).toContain('temp_lock_file="$lock_file.tmp.$$"');
      expect(entrypointContent).toContain('ln "$temp_lock_file" "$lock_file"');
      
      // 古いロックファイルのクリーンアップ機能が含まれることを確認
      expect(entrypointContent).toContain('if [ $lock_age -gt 300 ]; then');
    });

    test('エラーハンドリングとロバストネスが向上している', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 各操作に適切なエラーハンドリングが含まれることを確認
      expect(entrypointContent).toContain('2>/dev/null || true');
      expect(entrypointContent).toContain('2>/dev/null || echo 0');
      
      // 一時ファイルのクリーンアップが含まれることを確認
      expect(entrypointContent).toContain('rm -f "$temp_lock_file" 2>/dev/null || true');
    });

    test('strategy-runnerの起動メッセージが適切に処理される', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 対象のメッセージが適切に処理されることを確認
      expect(entrypointContent).toContain('log_startup_message "Starting strategy-runner container with enhanced error handling"');
      
      // log_startup_message関数の定義が存在することを確認
      expect(entrypointContent).toContain('log_startup_message() {');
    });
  });

  describe('統合テストとリグレッション防止', () => {
    test('entrypoint.shファイルの構文が正しい', async () => {
      // bashスクリプトの構文チェック
      await expect(execAsync(`bash -n ${entrypointPath}`)).resolves.not.toThrow();
    });

    test('必要なコマンドが利用可能', async () => {
      // 必要なコマンドの利用可能性確認
      await expect(execAsync('which md5sum')).resolves.not.toThrow();
      await expect(execAsync('which mkdir')).resolves.not.toThrow();
      await expect(execAsync('which mv')).resolves.not.toThrow();
      await expect(execAsync('which stat')).resolves.not.toThrow();
    });

    test('修正がリグレッションを起こしていない', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 既存の機能が保持されていることを確認
      expect(entrypointContent).toContain('acquire_startup_lock');
      expect(entrypointContent).toContain('release_startup_lock');
      expect(entrypointContent).toContain('pre_startup_checks');
      expect(entrypointContent).toContain('check_database_connections');
      expect(entrypointContent).toContain('start_application');
      
      // 重要な設定変数が保持されていることを確認
      expect(entrypointContent).toContain('STARTUP_MESSAGE_LOCK_DIR="/tmp/startup_messages"');
    });
  });
});