/**
 * Issue #5415: KISS原則によるstrategy-runner重複防止機能簡素化テスト
 * 旧Issue #2536の重複起動メッセージ修正をKISS原則に基づき簡素化
 * 
 * 概要:
 * - Issue #5415でKISS原則に基づき複雑な4段階防御線をシンプルなflock実装に簡素化
 * - CPU使用量15-20%削減予想、可読性とメンテナンス性の向上
 * - 後方互換性維持しつつシンプルな重複防止機能を提供
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
      
      // 重複防止機能がatomic実装されていることを確認
      expect(entrypointContent).toContain('STARTUP_MESSAGE_LOCK_DIR');
      expect(entrypointContent).toContain('log_startup_message()');
      
      // 複雑な実装が削除されていることを確認
      expect(entrypointContent).not.toContain('STARTUP_INSTANCE_ID');
      expect(entrypointContent).not.toContain('STARTUP_LOG_FILE');
    });

    test('atomic重複防止機能が正しく実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Issue #5121 修正: 簡素化・安定化版の実装確認
      expect(entrypointContent).toContain('message_hash=$(get_message_hash "$message")');
      expect(entrypointContent).toContain('lock_file="$STARTUP_MESSAGE_LOCK_DIR/$message_hash.lock"');
      expect(entrypointContent).toContain('if mkdir "$lock_file" 2>/dev/null; then');
      
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
      // atomic実装の関数テストスクリプトを作成
      const atomicTestScript = `#!/bin/bash
set -e

# 重複起動メッセージ防止（ファイルベースの atomic 実装）
STARTUP_MESSAGE_LOCK_DIR="/tmp/startup_messages"
mkdir -p "$STARTUP_MESSAGE_LOCK_DIR" 2>/dev/null || true

# ログ関数
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

# 重複起動ログ防止関数（atomic ファイルベース実装）
log_startup_message() {
    local message="$1"
    local message_hash=$(echo "$message" | md5sum | cut -d' ' -f1)
    local lock_file="$STARTUP_MESSAGE_LOCK_DIR/$message_hash.lock"
    
    # atomicな方法でメッセージの重複をチェック
    if mkdir "$lock_file" 2>/dev/null; then
        # ロックが取得できた場合のみメッセージを出力
        log "$message"
        
        # 短時間でのクリーンアップ（テスト用）
        (sleep 1 && rm -rf "$lock_file") &
    else
        # 既に同じメッセージが処理済みの場合は何もしない
        return 0
    fi
}

# テスト実行
echo "=== Testing atomic log_startup_message function ==="
log_startup_message "Test message 1"
log_startup_message "Test message 1"  # 抑制されるべき
log_startup_message "Test message 2"
sleep 2  # ロックファイルのクリーンアップを待つ
log_startup_message "Test message 1"  # クリーンアップ後なので出力される
echo "Test completed"
`;

      const testPath = path.join(__dirname, '..', '.tmp', 'kiss_test.sh');
      fs.writeFileSync(testPath, kissTestScript);
      fs.chmodSync(testPath, '755');

      try {
        const output = execSync(`bash ${testPath}`, { encoding: 'utf8' });
        
        // 出力の解析（ログメッセージのみをカウント）
        const lines = output.split('\n').filter(line => line.trim() !== '');
        const logMessages = lines.filter(line => line.includes('[ENTRYPOINT]'));
        
        // "Starting strategy-runner container" が2回出力されることを確認（最初とdone_markerクリーンアップ後）
        const startupMsgOccurrences = logMessages.filter(line => line.includes('Starting strategy-runner container with enhanced error handling')).length;
        expect(startupMsgOccurrences).toBe(2);
        
        // "Other message" が一度だけログ出力されることを確認
        const otherMsgOccurrences = logMessages.filter(line => line.includes('Other message')).length;
        expect(otherMsgOccurrences).toBe(1);
        
        // テスト完了メッセージがあることを確認
        expect(output).toContain('Test completed');
        
        // クリーンアップ
        fs.unlinkSync(testPath);
      } catch (error) {
        if (fs.existsSync(testPath)) {
fs.unlinkSync(testPath);
}
        throw error;
      }
    });

    test('異なるメッセージは正常に出力される', () => {
      const differentMessagesTest = `#!/bin/bash
set -e

# 重複起動メッセージ防止（ファイルベースの atomic 実装）
STARTUP_MESSAGE_LOCK_DIR="/tmp/startup_messages_diff"
mkdir -p "$STARTUP_MESSAGE_LOCK_DIR" 2>/dev/null || true

# ログ関数
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

# 重複起動ログ防止関数（atomic ファイルベース実装）
log_startup_message() {
    local message="$1"
    local message_hash=$(echo "$message" | md5sum | cut -d' ' -f1)
    local lock_file="$STARTUP_MESSAGE_LOCK_DIR/$message_hash.lock"
    
    # atomicな方法でメッセージの重複をチェック
    if mkdir "$lock_file" 2>/dev/null; then
        # ロックが取得できた場合のみメッセージを出力
        log "$message"
        
        # 短時間でのクリーンアップ（テスト用）
        (sleep 1 && rm -rf "$lock_file") &
    else
        # 既に同じメッセージが処理済みの場合は何もしない
        return 0
    fi
}

# テスト実行
echo "=== Testing different messages ==="
log_startup_message "Message A"
log_startup_message "Message B"
log_startup_message "Message C"
log_startup_message "Message C"  # 連続した同じメッセージ（抑制されるべき）
sleep 2  # ロックファイルのクリーンアップを待つ
log_startup_message "Message A"  # クリーンアップ後なので出力される
log_startup_message "Message D"
echo "Test completed"
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
        
        // Message A が2回出力されることを確認（最初とクリーンアップ後）
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
        if (fs.existsSync(testPath)) {
fs.unlinkSync(testPath);
}
        throw error;
      }
    });
  });

  describe('Issue #2536 の問題解決確認', () => {
    test('KISS原則簡素化による重複防止機能が適切に動作する', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Issue #5415: KISS原則簡素化実装の確認
      expect(entrypointContent).toContain('Issue #5415: KISS原則に基づく簡素化');
      expect(entrypointContent).toContain('flock -n 200 || exit 0');
      expect(entrypointContent).toContain('touch "$done_marker"');
      
      // シンプルな実装が使用されていることを確認
      expect(entrypointContent).toContain('log_startup_message()');
    });

    test('重複ログ原因だったexec 1>&1が削除されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Issue #5049修正: 重複ログの原因だったexec 1>&1が削除されていることを確認
      expect(entrypointContent).not.toContain('exec 1>&1');
      
      // log関数がシンプルになっていることを確認
      expect(entrypointContent).toContain('log() {');
      expect(entrypointContent).toContain('echo "[$(date \'+%Y-%m-%d %H:%M:%S\')] [ENTRYPOINT] $1"');
    });

    test('KISS原則簡素化後も必要な起動ロック機能が保持されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 既存の起動ロック機能が保持されていることを確認
      expect(entrypointContent).toContain('acquire_startup_lock');
      expect(entrypointContent).toContain('release_startup_lock');
      expect(entrypointContent).toContain('STARTUP_LOCK_FILE');
    });

    test('Issue #5415: KISS原則により複雑な実装が削除されシンプルになっている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Issue #5415: KISS原則により複雑な実装が削除されていることを確認
      expect(entrypointContent).not.toContain('STARTUP_INSTANCE_ID');
      expect(entrypointContent).not.toContain('STARTUP_LOG_FILE');
      expect(entrypointContent).not.toContain('instance_signature');
      expect(entrypointContent).not.toContain('tail -n 10');
      expect(entrypointContent).not.toContain('grep -v "$STARTUP_INSTANCE_ID"');
      expect(entrypointContent).not.toContain('_MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS');
      
      // シンプルなflock実装が使用されていることを確認
      expect(entrypointContent).toContain('flock -n 200');
      expect(entrypointContent).toContain('done_marker');
    });
  });

  describe('パフォーマンスとセキュリティの改善確認', () => {
    test('Issue #5415: KISS原則により不要なファイル操作が削減されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Issue #5415: KISS原則により不要なファイル操作が削除されていることを確認
      expect(entrypointContent).not.toContain('tail -n 10 "$STARTUP_LOG_FILE"');
      expect(entrypointContent).not.toContain('grep -q "$instance_signature"');
      expect(entrypointContent).not.toContain('message_hash=$(');
      
      // シンプルなflock実装が使用されていることを確認
      expect(entrypointContent).toContain('flock -n 200');
      expect(entrypointContent).toContain('done_marker');
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