/**
 * テストファイル: Strategy-runner Issue #5103 重複ログメッセージ修正
 * 
 * Issue #5103の修正内容をテスト：
 * - log_startup_message関数の重複防止機構
 * - atomicロック方式の動作確認
 * - プロセス内環境変数による第一防御線の確認
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// テスト用の一時ディレクトリ
const TEST_TMP_DIR = '/tmp/test-issue-5103';
const ENTRYPOINT_PATH = path.join(__dirname, 'fixtures', 'entrypoint-test-functions.sh');

describe('Issue #5103: Strategy-runner重複ログメッセージ修正', () => {
    beforeEach(() => {
        // テスト環境の初期化
        if (fs.existsSync(TEST_TMP_DIR)) {
            fs.rmSync(TEST_TMP_DIR, { recursive: true, force: true });
        }
        fs.mkdirSync(TEST_TMP_DIR, { recursive: true });
    });

    afterEach(() => {
        // クリーンアップ
        if (fs.existsSync(TEST_TMP_DIR)) {
            fs.rmSync(TEST_TMP_DIR, { recursive: true, force: true });
        }
    });

    describe('log_startup_message関数の重複防止機構', () => {
        test('同一メッセージの重複出力が防止される', async () => {
            const testScript = `
#!/bin/bash
source "${ENTRYPOINT_PATH}"

# テスト用の設定
STARTUP_MESSAGE_LOCK_DIR="${TEST_TMP_DIR}/startup_messages"
mkdir -p "$STARTUP_MESSAGE_LOCK_DIR"

# 同じメッセージを3回実行
log_startup_message "Test startup message"
log_startup_message "Test startup message"
log_startup_message "Test startup message"
            `;

            const scriptPath = path.join(TEST_TMP_DIR, 'test_duplicate.sh');
            fs.writeFileSync(scriptPath, testScript);
            fs.chmodSync(scriptPath, '755');

            const { stdout } = await execAsync(`bash ${scriptPath}`);
            
            // メッセージが1回のみ出力されることを確認
            const messageCount = (stdout.match(/Test startup message/g) || []).length;
            expect(messageCount).toBe(1);
        }, 30000); // CI環境でのシェルスクリプト実行のため30秒に設定（タイムアウト修正）

        test('異なるメッセージは各々出力される', async () => {
            const testScript = `
#!/bin/bash
source "${ENTRYPOINT_PATH}"

# テスト用の設定
STARTUP_MESSAGE_LOCK_DIR="${TEST_TMP_DIR}/startup_messages"
mkdir -p "$STARTUP_MESSAGE_LOCK_DIR"

# 異なるメッセージを実行
log_startup_message "First startup message"
log_startup_message "Second startup message"
log_startup_message "Third startup message"
            `;

            const scriptPath = path.join(TEST_TMP_DIR, 'test_different.sh');
            fs.writeFileSync(scriptPath, testScript);
            fs.chmodSync(scriptPath, '755');

            const { stdout } = await execAsync(`bash ${scriptPath}`);
            
            // 各メッセージが1回ずつ出力されることを確認
            expect(stdout).toContain('First startup message');
            expect(stdout).toContain('Second startup message');
            expect(stdout).toContain('Third startup message');
        }, 30000); // CI環境でのシェルスクリプト実行のため30秒に設定（タイムアウト修正）

        test('プロセス内環境変数による第一防御線の動作確認', async () => {
            const testScript = `
#!/bin/bash
source "${ENTRYPOINT_PATH}"

# テスト用の設定
STARTUP_MESSAGE_LOCK_DIR="${TEST_TMP_DIR}/startup_messages"
mkdir -p "$STARTUP_MESSAGE_LOCK_DIR"

# メッセージハッシュの確認
MESSAGE="Test message for hash"
HASH=$(get_message_hash "$MESSAGE")
VAR_NAME="STARTUP_MSG_$(echo "$HASH" | cut -c1-8)"

# 初回実行前は環境変数未設定
echo "Before: \${!VAR_NAME} = \${!VAR_NAME}"

# 初回実行
log_startup_message "$MESSAGE"

# 初回実行後は環境変数設定済み
echo "After: \${!VAR_NAME} = \${!VAR_NAME}"

# 2回目実行（重複防止により出力されない）
log_startup_message "$MESSAGE"
            `;

            const scriptPath = path.join(TEST_TMP_DIR, 'test_env_var.sh');
            fs.writeFileSync(scriptPath, testScript);
            fs.chmodSync(scriptPath, '755');

            const { stdout } = await execAsync(`bash ${scriptPath}`);
            
            // 環境変数の設定確認
            expect(stdout).toContain('Before: = ');  // 初期は未設定
            expect(stdout).toContain('After: = 1');   // 実行後は設定済み
            
            // メッセージが1回のみ出力
            const messageCount = (stdout.match(/Test message for hash/g) || []).length;
            expect(messageCount).toBe(1);
        }, 30000); // CI環境でのシェルスクリプト実行のため30秒に設定（タイムアウト修正）
    });

    describe('atomicロック機構の動作確認', () => {
        test('mkdirベースのatomicロックが正常動作する', async () => {
            const testScript = `
#!/bin/bash
source "${ENTRYPOINT_PATH}"

# テスト用の設定
STARTUP_MESSAGE_LOCK_DIR="${TEST_TMP_DIR}/startup_messages"
mkdir -p "$STARTUP_MESSAGE_LOCK_DIR"

MESSAGE="Atomic lock test message"
HASH=$(get_message_hash "$MESSAGE")
LOCK_FILE="$STARTUP_MESSAGE_LOCK_DIR/$HASH.lock"

# ロックディレクトリが作成されることを確認
log_startup_message "$MESSAGE" &
PID1=$!

# 少し待ってからロックディレクトリの存在確認
sleep 0.1
if [ -d "$LOCK_FILE" ]; then
    echo "Lock directory exists during execution"
fi

wait $PID1

# 実行完了後はロックディレクトリが削除されることを確認
if [ ! -d "$LOCK_FILE" ]; then
    echo "Lock directory cleaned up after execution"
fi
            `;

            const scriptPath = path.join(TEST_TMP_DIR, 'test_atomic_lock.sh');
            fs.writeFileSync(scriptPath, testScript);
            fs.chmodSync(scriptPath, '755');

            const { stdout } = await execAsync(`bash ${scriptPath}`);
            
            // ロック機構の動作確認
            expect(stdout).toContain('Atomic lock test message');
            expect(stdout).toContain('Lock directory cleaned up after execution');
        }, 30000); // CI環境でのシェルスクリプト実行のため30秒に設定（タイムアウト修正）

        test('古いロックファイルのクリーンアップが動作する', async () => {
            const testScript = `
#!/bin/bash
source "${ENTRYPOINT_PATH}"

# テスト用の設定
STARTUP_MESSAGE_LOCK_DIR="${TEST_TMP_DIR}/startup_messages"
mkdir -p "$STARTUP_MESSAGE_LOCK_DIR"

MESSAGE="Cleanup test message"
HASH=$(get_message_hash "$MESSAGE")
LOCK_FILE="$STARTUP_MESSAGE_LOCK_DIR/$HASH.lock"

# 古いロックファイルを手動作成（61秒前）
mkdir -p "$LOCK_FILE"
# touchは使用できないため、代替手段でタイムスタンプを古くする
sleep 1
find "$LOCK_FILE" -type d -exec touch -d "61 seconds ago" {} \\;

echo "Old lock file created"

# 新しい実行（古いロックファイルがクリーンアップされることを確認）
log_startup_message "$MESSAGE"

echo "New execution completed"
            `;

            const scriptPath = path.join(TEST_TMP_DIR, 'test_cleanup.sh');
            fs.writeFileSync(scriptPath, testScript);
            fs.chmodSync(scriptPath, '755');

            const { stdout } = await execAsync(`bash ${scriptPath}`);
            
            expect(stdout).toContain('Old lock file created');
            expect(stdout).toContain('Cleanup test message');
            expect(stdout).toContain('New execution completed');
        }, 30000); // CI環境でのシェルスクリプト実行のため30秒に設定（タイムアウト修正）
    });

    describe('success fileの動作確認', () => {
        test('success fileが正しく作成される', async () => {
            const testScript = `
#!/bin/bash
source "${ENTRYPOINT_PATH}"

# テスト用の設定
STARTUP_MESSAGE_LOCK_DIR="${TEST_TMP_DIR}/startup_messages"
mkdir -p "$STARTUP_MESSAGE_LOCK_DIR"

MESSAGE="Success file test message"
HASH=$(get_message_hash "$MESSAGE")
SUCCESS_FILE="$STARTUP_MESSAGE_LOCK_DIR/$HASH.done"

# 初回実行
log_startup_message "$MESSAGE"

# success fileの存在確認
if [ -f "$SUCCESS_FILE" ]; then
    echo "Success file created"
    CONTENT=$(cat "$SUCCESS_FILE")
    echo "Success file content: $CONTENT"
    
    # プロセスIDが含まれることを確認
    if [[ "$CONTENT" == *"$$"* ]]; then
        echo "Process ID found in success file"
    fi
fi
            `;

            const scriptPath = path.join(TEST_TMP_DIR, 'test_success_file.sh');
            fs.writeFileSync(scriptPath, testScript);
            fs.chmodSync(scriptPath, '755');

            const { stdout } = await execAsync(`bash ${scriptPath}`);
            
            expect(stdout).toContain('Success file test message');
            expect(stdout).toContain('Success file created');
            expect(stdout).toContain('Process ID found in success file');
        }, 30000); // CI環境でのシェルスクリプト実行のため30秒に設定（タイムアウト修正）
    });

    describe('バックグラウンドクリーンアップ機構', () => {
        test('バックグラウンドクリーンアップが開始される', async () => {
            const testScript = `
#!/bin/bash
source "${ENTRYPOINT_PATH}"

# テスト用の設定
STARTUP_MESSAGE_LOCK_DIR="${TEST_TMP_DIR}/startup_messages"
SUCCESS_FILE_CLEANUP_DELAY=2  # テスト用に短縮
mkdir -p "$STARTUP_MESSAGE_LOCK_DIR"

MESSAGE="Cleanup test message"
HASH=$(get_message_hash "$MESSAGE")
SUCCESS_FILE="$STARTUP_MESSAGE_LOCK_DIR/$HASH.done"

# メッセージ実行
log_startup_message "$MESSAGE"

# success fileが存在することを確認
if [ -f "$SUCCESS_FILE" ]; then
    echo "Success file exists immediately after execution"
fi

# クリーンアップ時間より少し長く待機
sleep 3

# success fileが削除されることを確認
if [ ! -f "$SUCCESS_FILE" ]; then
    echo "Success file cleaned up after delay"
fi
            `;

            const scriptPath = path.join(TEST_TMP_DIR, 'test_bg_cleanup.sh');
            fs.writeFileSync(scriptPath, testScript);
            fs.chmodSync(scriptPath, '755');

            const { stdout } = await execAsync(`bash ${scriptPath}`);
            
            expect(stdout).toContain('Cleanup test message');
            expect(stdout).toContain('Success file exists immediately after execution');
            expect(stdout).toContain('Success file cleaned up after delay');
        }, 15000); // CI環境を考慮して15秒に調整
    });

    describe('get_message_hash関数の動作確認', () => {
        test('同じメッセージは同じハッシュを生成する', async () => {
            const testScript = `
#!/bin/bash
source "${ENTRYPOINT_PATH}"

MESSAGE="Test message"
HASH1=$(get_message_hash "$MESSAGE")
HASH2=$(get_message_hash "$MESSAGE")

echo "Hash1: $HASH1"
echo "Hash2: $HASH2"

if [ "$HASH1" = "$HASH2" ]; then
    echo "Hashes match"
else
    echo "Hashes do not match"
fi
            `;

            const scriptPath = path.join(TEST_TMP_DIR, 'test_hash.sh');
            fs.writeFileSync(scriptPath, testScript);
            fs.chmodSync(scriptPath, '755');

            const { stdout } = await execAsync(`bash ${scriptPath}`);
            
            expect(stdout).toContain('Hashes match');
        }, 30000); // CI環境でのシェルスクリプト実行のため30秒に設定（タイムアウト修正）

        test('異なるメッセージは異なるハッシュを生成する', async () => {
            const testScript = `
#!/bin/bash
source "${ENTRYPOINT_PATH}"

MESSAGE1="First message"
MESSAGE2="Second message"
HASH1=$(get_message_hash "$MESSAGE1")
HASH2=$(get_message_hash "$MESSAGE2")

echo "Hash1: $HASH1"
echo "Hash2: $HASH2"

if [ "$HASH1" != "$HASH2" ]; then
    echo "Hashes are different"
else
    echo "Hashes are same (unexpected)"
fi
            `;

            const scriptPath = path.join(TEST_TMP_DIR, 'test_hash_diff.sh');
            fs.writeFileSync(scriptPath, testScript);
            fs.chmodSync(scriptPath, '755');

            const { stdout } = await execAsync(`bash ${scriptPath}`);
            
            expect(stdout).toContain('Hashes are different');
        }, 30000); // CI環境でのシェルスクリプト実行のため30秒に設定（タイムアウト修正）
    });

    describe('エラーハンドリング統一性の確認', () => {
        test('ロック解放でrm -rfが使用されている', () => {
            const entrypointContent = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');
            
            // Issue #5103で修正されたrm -rfの使用を確認
            expect(entrypointContent).toContain('rm -rf "$lock_file" 2>/dev/null || true');
            
            // 古いrmdir方式は使用されていないことを確認
            const lockReleaseContext = entrypointContent.match(/# ロック解放[\s\S]*?return 0/);
            expect(lockReleaseContext).toBeTruthy();
            expect(lockReleaseContext[0]).not.toContain('rmdir "$lock_file"');
        });
    });
});