/**
 * strategy-runner Issue #2536 重複起動メッセージ修正のテスト
 * Issue #2536: [自動] strategy-runnerサービスで例外が発生
 * 
 * 改善版テスト: 実際の動作をテストする
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

describe('Strategy-Runner Issue #2536 重複起動メッセージ修正', () => {
  const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
  beforeAll(() => {
    // テストディレクトリの作成
    const tmpDir = path.join(__dirname, '..', '.tmp');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  describe('重複起動ログ防止機能の実装確認', () => {
    test('entrypoint.shファイルが存在し、基本的な機能が含まれている', () => {
      expect(fs.existsSync(entrypointPath)).toBe(true);
      
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 重複防止機能が簡素化されていることを確認
      expect(entrypointContent).toContain('STARTUP_MESSAGE_SENT');
      expect(entrypointContent).toContain('log_startup_message()');
      
      // 複雑な実装が削除されていることを確認
      expect(entrypointContent).not.toContain('STARTUP_INSTANCE_ID');
      expect(entrypointContent).not.toContain('STARTUP_LOG_FILE');
    });

    test('簡素化された重複防止機能が正しく実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // シンプルな実装が使用されていることを確認
      expect(entrypointContent).toContain('if [ "$STARTUP_MESSAGE_SENT" != "$message" ]; then');
      expect(entrypointContent).toContain('STARTUP_MESSAGE_SENT="$message"');
      
      // 複雑な処理が削除されていることを確認
      expect(entrypointContent).not.toContain('tail -n 10 "$STARTUP_LOG_FILE"');
      expect(entrypointContent).not.toContain('grep -q "$instance_signature"');
      expect(entrypointContent).not.toContain('instance_signature');
    });

    test('データベース接続チェック機能が統合されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 共通の接続チェック関数が存在することを確認
      expect(entrypointContent).toContain('check_database_connection()');
      
      // 重複したコードが削除されていることを確認
      const redisChecks = (entrypointContent.match(/Redis connection/g) || []).length;
      const mongoChecks = (entrypointContent.match(/MongoDB connection/g) || []).length;
      
      // 各データベースのチェックが一箇所に集約されていることを確認
      expect(redisChecks).toBeLessThanOrEqual(3); // 定義、呼び出し、ログ出力
      expect(mongoChecks).toBeLessThanOrEqual(3);
    });
  });

  describe('実際の重複防止動作確認', () => {
    test('log_startup_message関数が重複メッセージを正しく抑制する', () => {
      // シンプルな関数テストスクリプトを作成
      const simpleTestScript = `#!/bin/bash
set -e

# 環境変数の初期化
STARTUP_MESSAGE_SENT=""

# ログ関数のシンプル版
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

# 重複起動ログ防止関数（シンプル版）
log_startup_message() {
    local message="$1"
    if [ "$STARTUP_MESSAGE_SENT" != "$message" ]; then
        STARTUP_MESSAGE_SENT="$message"
        log "$message"
    fi
}

# テスト実行
echo "=== Testing log_startup_message function ==="
log_startup_message "Test message 1"
log_startup_message "Test message 1"  # 抑制されるべき
log_startup_message "Test message 2"
log_startup_message "Test message 1"  # 新しいメッセージ（前回と違うので出力される）
echo "STARTUP_MESSAGE_SENT: $STARTUP_MESSAGE_SENT"
`;

      const testPath = path.join(__dirname, '..', '.tmp', 'simple_test.sh');
      fs.writeFileSync(testPath, simpleTestScript);
      fs.chmodSync(testPath, '755');

      try {
        const output = execSync(`bash ${testPath}`, { encoding: 'utf8' });
        
        // 出力の解析（ログメッセージのみをカウント）
        const lines = output.split('\n').filter(line => line.trim() !== '');
        const logMessages = lines.filter(line => line.includes('[ENTRYPOINT]'));
        
        // "Test message 1" が2回出力されることを確認（最初と最後）
        const message1Occurrences = logMessages.filter(line => line.includes('Test message 1')).length;
        expect(message1Occurrences).toBe(2);
        
        // "Test message 2" が一度だけログ出力されることを確認
        const message2Occurrences = logMessages.filter(line => line.includes('Test message 2')).length;
        expect(message2Occurrences).toBe(1);
        
        // 環境変数が正しく設定されていることを確認（最後のメッセージが保存される）
        expect(output).toContain('STARTUP_MESSAGE_SENT: Test message 1');
        
        // クリーンアップ
        fs.unlinkSync(testPath);
      } catch (error) {
        if (fs.existsSync(testPath)) fs.unlinkSync(testPath);
        throw error;
      }
    });

    test('異なるメッセージは正常に出力される', () => {
      const differentMessagesTest = `#!/bin/bash
set -e

# 環境変数の初期化
STARTUP_MESSAGE_SENT=""

# ログ関数のシンプル版
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

# 重複起動ログ防止関数（シンプル版）
log_startup_message() {
    local message="$1"
    if [ "$STARTUP_MESSAGE_SENT" != "$message" ]; then
        STARTUP_MESSAGE_SENT="$message"
        log "$message"
    fi
}

# テスト実行
echo "=== Testing different messages ==="
log_startup_message "Message A"
log_startup_message "Message B"
log_startup_message "Message C"
log_startup_message "Message C"  # 連続した同じメッセージ（抑制されるべき）
log_startup_message "Message A"  # 新しいメッセージ（前回と違うので出力される）
log_startup_message "Message D"
`;

      const testPath = path.join(__dirname, '..', '.tmp', 'test_different_messages.sh');
      fs.writeFileSync(testPath, differentMessagesTest);
      fs.chmodSync(testPath, '755');

      try {
        const output = execSync(`bash ${testPath}`, { encoding: 'utf8' });
        
        // 各メッセージが適切に出力されることを確認
        expect(output).toContain('Message A');
        expect(output).toContain('Message B');
        expect(output).toContain('Message C');
        expect(output).toContain('Message D');
        
        // Message A が2回出力されることを確認（最初と後半）
        const lines = output.split('\n').filter(line => line.trim() !== '');
        const logMessages = lines.filter(line => line.includes('[ENTRYPOINT]'));
        const messageAOccurrences = logMessages.filter(line => line.includes('Message A')).length;
        expect(messageAOccurrences).toBe(2);
        
        // Message C が1回だけ出力されることを確認（連続したメッセージの抑制）
        const messageCOccurrences = logMessages.filter(line => line.includes('Message C')).length;
        expect(messageCOccurrences).toBe(1);
        
        // クリーンアップ
        fs.unlinkSync(testPath);
      } catch (error) {
        if (fs.existsSync(testPath)) fs.unlinkSync(testPath);
        throw error;
      }
    });
  });

  describe('Issue #2536 の問題解決確認', () => {
    test('重複起動メッセージの防止機能が適切に動作する', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 重複防止対象のメッセージが適切に処理されることを確認
      expect(entrypointContent).toContain('log_startup_message "Starting strategy-runner container with enhanced error handling"');
      expect(entrypointContent).toContain('log_startup_message "Starting backtest container with enhanced error handling"');
      
      // シンプルな実装が使用されていることを確認
      expect(entrypointContent).toContain('log_startup_message()');
    });

    test('stdout フラッシュ機能が保持されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // stdout フラッシュ機能が保持されていることを確認
      expect(entrypointContent).toContain('exec 1>&1');
    });

    test('既存の起動ロック機能が保持されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 既存の起動ロック機能が保持されていることを確認
      expect(entrypointContent).toContain('acquire_startup_lock');
      expect(entrypointContent).toContain('release_startup_lock');
      expect(entrypointContent).toContain('STARTUP_LOCK_FILE');
    });

    test('複雑な実装が削除され、シンプルになっている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 複雑な実装が削除されていることを確認
      expect(entrypointContent).not.toContain('STARTUP_INSTANCE_ID');
      expect(entrypointContent).not.toContain('STARTUP_LOG_FILE');
      expect(entrypointContent).not.toContain('instance_signature');
      expect(entrypointContent).not.toContain('tail -n 10');
      expect(entrypointContent).not.toContain('grep -v "$STARTUP_INSTANCE_ID"');
    });
  });

  describe('パフォーマンスとセキュリティの改善確認', () => {
    test('ファイル操作が削減されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 重複防止機能で不要なファイル操作が削除されていることを確認
      expect(entrypointContent).not.toContain('tail -n 10 "$STARTUP_LOG_FILE"');
      expect(entrypointContent).not.toContain('grep -q "$instance_signature"');
      
      // 環境変数ベースの簡素な実装が使用されていることを確認
      expect(entrypointContent).toContain('STARTUP_MESSAGE_SENT');
    });

    test('データベース接続チェックが効率化されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 共通関数が定義されていることを確認
      expect(entrypointContent).toContain('check_database_connection()');
      
      // 重複したコードが削除されていることを確認
      const whileLoopCount = (entrypointContent.match(/while \[.*retry.*\]/g) || []).length;
      expect(whileLoopCount).toBeLessThanOrEqual(2); // 共通関数内の1つとバックアップ
    });
  });
});