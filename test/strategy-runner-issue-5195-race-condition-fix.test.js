/**
 * テストファイル: Strategy-runner Issue #5195 レースコンディション修正テスト
 * 
 * Issue #5195の修正内容をテスト：
 * - コンテナ再起動時のレースコンディション防止
 * - 強化されたatomicロック機構（リトライ付き）
 * - コンテナID検証機能
 * - success fileの強化されたatomic作成
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// テスト用の一時ディレクトリ
const TEST_TMP_DIR = '/tmp/test-issue-5195';
const ENTRYPOINT_PATH = path.join(__dirname, 'fixtures', 'entrypoint-test-functions.sh');

describe('Issue #5195: Strategy-runnerレースコンディション修正', () => {
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

    describe('コンテナ再起動時レースコンディション防止', () => {
        test('コンテナIDによる重複防止が動作する', async () => {
            const testScript = `
#!/bin/bash
source "${ENTRYPOINT_PATH}"

# テスト用の設定
STARTUP_MESSAGE_LOCK_DIR="${TEST_TMP_DIR}/startup_messages"
mkdir -p "$STARTUP_MESSAGE_LOCK_DIR"

MESSAGE="Container ID test message"
HASH=$(get_message_hash "$MESSAGE")
SUCCESS_FILE="$STARTUP_MESSAGE_LOCK_DIR/$HASH.done"

# 異なるコンテナIDでsuccess fileを作成
# eslint-disable-next-line no-undef
CURRENT_TIME=$(date +%s)
echo "\${CURRENT_TIME}:12345:different-container" > "$SUCCESS_FILE"

# 現在のコンテナIDで実行（different-containerとは異なるため出力される）
log_startup_message "$MESSAGE"

echo "Test completed"
            `;

            const scriptPath = path.join(TEST_TMP_DIR, 'test_container_id.sh');
            fs.writeFileSync(scriptPath, testScript);
            fs.chmodSync(scriptPath, '755');

            const { stdout } = await execAsync(`bash ${scriptPath}`);
            
            // 異なるコンテナIDの場合はメッセージが出力される
            expect(stdout).toContain('Container ID test message');
            expect(stdout).toContain('Test completed');
        }, 10000);

        test('同一コンテナの30秒以内重複実行は防止される', async () => {
            const testScript = `
#!/bin/bash
source "${ENTRYPOINT_PATH}"

# テスト用の設定
STARTUP_MESSAGE_LOCK_DIR="${TEST_TMP_DIR}/startup_messages"
mkdir -p "$STARTUP_MESSAGE_LOCK_DIR"

MESSAGE="Same container duplicate test"
HASH=$(get_message_hash "$MESSAGE")
SUCCESS_FILE="$STARTUP_MESSAGE_LOCK_DIR/$HASH.done"

# 現在のコンテナIDとタイムスタンプでsuccess fileを作成（最近の実行として）
# eslint-disable-next-line no-undef
CURRENT_TIME=$(date +%s)
# eslint-disable-next-line no-undef
CONTAINER_ID=$(hostname)
echo "\${CURRENT_TIME}:12345:\${CONTAINER_ID}" > "$SUCCESS_FILE"

# 同一コンテナで再実行（30秒以内なので出力されない）
log_startup_message "$MESSAGE"

# success fileの内容確認
if [ -f "$SUCCESS_FILE" ]; then
    echo "Success file still exists"
fi

echo "Duplicate prevention test completed"
            `;

            const scriptPath = path.join(TEST_TMP_DIR, 'test_same_container.sh');
            fs.writeFileSync(scriptPath, testScript);
            fs.chmodSync(scriptPath, '755');

            const { stdout } = await execAsync(`bash ${scriptPath}`);
            
            // 30秒以内の同一コンテナからの重複実行は防止される
            expect(stdout).not.toContain('Same container duplicate test');
            expect(stdout).toContain('Success file still exists');
            expect(stdout).toContain('Duplicate prevention test completed');
        }, 10000);

        test('古いsuccess fileは適切にクリーンアップされる', async () => {
            const testScript = `
#!/bin/bash
source "${ENTRYPOINT_PATH}"

# テスト用の設定
STARTUP_MESSAGE_LOCK_DIR="${TEST_TMP_DIR}/startup_messages"
mkdir -p "$STARTUP_MESSAGE_LOCK_DIR"

MESSAGE="Old success file cleanup test"
HASH=$(get_message_hash "$MESSAGE")
SUCCESS_FILE="$STARTUP_MESSAGE_LOCK_DIR/$HASH.done"

# 5分以上前のタイムスタンプでsuccess fileを作成
# eslint-disable-next-line no-undef
OLD_TIME=$(($(date +%s) - 301))
# eslint-disable-next-line no-undef
CONTAINER_ID=$(hostname)
echo "\${OLD_TIME}:12345:\${CONTAINER_ID}" > "$SUCCESS_FILE"

echo "Old success file created"

# 新しい実行（古いsuccess fileはクリーンアップされ、メッセージが出力される）
log_startup_message "$MESSAGE"

echo "New execution completed"
            `;

            const scriptPath = path.join(TEST_TMP_DIR, 'test_cleanup.sh');
            fs.writeFileSync(scriptPath, testScript);
            fs.chmodSync(scriptPath, '755');

            const { stdout } = await execAsync(`bash ${scriptPath}`);
            
            expect(stdout).toContain('Old success file created');
            expect(stdout).toContain('Old success file cleanup test');
            expect(stdout).toContain('New execution completed');
        }, 10000);
    });

    describe('強化されたatomicロック機構', () => {
        test('リトライ機構付きロック取得が動作する', async () => {
            const testScript = `
#!/bin/bash
source "${ENTRYPOINT_PATH}"

# テスト用の設定
STARTUP_MESSAGE_LOCK_DIR="${TEST_TMP_DIR}/startup_messages"
mkdir -p "$STARTUP_MESSAGE_LOCK_DIR"

MESSAGE="Retry lock test message"
HASH=$(get_message_hash "$MESSAGE")
LOCK_FILE="$STARTUP_MESSAGE_LOCK_DIR/$HASH.lock"

# バックグラウンドで先にロックを取得（短時間保持）
(
    mkdir "$LOCK_FILE" 2>/dev/null
    echo "Background lock acquired"
    sleep 2
    rm -rf "$LOCK_FILE"
    echo "Background lock released"
) &

sleep 0.5  # バックグラウンドプロセスがロックを取得するのを待つ

# メインプロセスでリトライ付きロック取得を試行
log_startup_message "$MESSAGE"

wait  # バックグラウンドプロセスの完了を待つ

echo "Retry test completed"
            `;

            const scriptPath = path.join(TEST_TMP_DIR, 'test_retry_lock.sh');
            fs.writeFileSync(scriptPath, testScript);
            fs.chmodSync(scriptPath, '755');

            const { stdout } = await execAsync(`bash ${scriptPath}`);
            
            expect(stdout).toContain('Background lock acquired');
            expect(stdout).toContain('Background lock released');
            expect(stdout).toContain('Retry lock test message');
            expect(stdout).toContain('Retry test completed');
        }, 15000);

        test('プロセス情報がロックディレクトリに記録される', async () => {
            const testScript = `
#!/bin/bash
source "${ENTRYPOINT_PATH}"

# テスト用の設定
STARTUP_MESSAGE_LOCK_DIR="${TEST_TMP_DIR}/startup_messages"
mkdir -p "$STARTUP_MESSAGE_LOCK_DIR"

MESSAGE="Process info test message"
HASH=$(get_message_hash "$MESSAGE")
LOCK_FILE="$STARTUP_MESSAGE_LOCK_DIR/$HASH.lock"

# バックグラウンドでメッセージ実行
log_startup_message "$MESSAGE" &
MSG_PID=$!

# 少し待ってからロックディレクトリの内容確認
sleep 0.2
if [ -d "$LOCK_FILE" ] && [ -f "$LOCK_FILE/process_info" ]; then
    echo "Process info file exists"
    PROCESS_INFO=$(cat "$LOCK_FILE/process_info" 2>/dev/null || echo "")
    if [[ "$PROCESS_INFO" == *":"*":"* ]]; then
        echo "Process info format is correct (container:pid:time)"
    fi
fi

wait $MSG_PID

echo "Process info test completed"
            `;

            const scriptPath = path.join(TEST_TMP_DIR, 'test_process_info.sh');
            fs.writeFileSync(scriptPath, testScript);
            fs.chmodSync(scriptPath, '755');

            const { stdout } = await execAsync(`bash ${scriptPath}`);
            
            expect(stdout).toContain('Process info test message');
            expect(stdout).toContain('Process info format is correct (container:pid:time)');
            expect(stdout).toContain('Process info test completed');
        }, 10000);
    });

    describe('success fileの強化されたatomic作成', () => {
        test('一時ファイル経由のatomic move操作が動作する', async () => {
            const testScript = `
#!/bin/bash
source "${ENTRYPOINT_PATH}"

# テスト用の設定
STARTUP_MESSAGE_LOCK_DIR="${TEST_TMP_DIR}/startup_messages"
mkdir -p "$STARTUP_MESSAGE_LOCK_DIR"

MESSAGE="Atomic move test message"
HASH=$(get_message_hash "$MESSAGE")
SUCCESS_FILE="$STARTUP_MESSAGE_LOCK_DIR/$HASH.done"

# メッセージ実行
log_startup_message "$MESSAGE"

# success fileの存在と内容確認
if [ -f "$SUCCESS_FILE" ]; then
    echo "Success file created via atomic move"
    CONTENT=$(cat "$SUCCESS_FILE")
    # 新しい形式（time:pid:container）を確認
    if [[ "$CONTENT" == *":"*":"* ]]; then
        echo "Success file has enhanced format (time:pid:container)"
    fi
fi

# 一時ファイルが残っていないことを確認
# eslint-disable-next-line no-undef
TEMP_FILES=$(ls \${SUCCESS_FILE}.tmp.* 2>/dev/null | wc -l)
if [ "$TEMP_FILES" -eq 0 ]; then
    echo "No temporary files left behind"
fi

echo "Atomic move test completed"
            `;

            const scriptPath = path.join(TEST_TMP_DIR, 'test_atomic_move.sh');
            fs.writeFileSync(scriptPath, testScript);
            fs.chmodSync(scriptPath, '755');

            const { stdout } = await execAsync(`bash ${scriptPath}`);
            
            expect(stdout).toContain('Atomic move test message');
            expect(stdout).toContain('Success file created via atomic move');
            expect(stdout).toContain('Success file has enhanced format (time:pid:container)');
            expect(stdout).toContain('No temporary files left behind');
            expect(stdout).toContain('Atomic move test completed');
        }, 10000);
    });

    describe('ロッククリーンアップの強化', () => {
        test('30秒以上古いロックファイルがクリーンアップされる', async () => {
            const testScript = `
#!/bin/bash
source "${ENTRYPOINT_PATH}"

# テスト用の設定
STARTUP_MESSAGE_LOCK_DIR="${TEST_TMP_DIR}/startup_messages"
mkdir -p "$STARTUP_MESSAGE_LOCK_DIR"

MESSAGE="Lock cleanup test message"
HASH=$(get_message_hash "$MESSAGE")
LOCK_FILE="$STARTUP_MESSAGE_LOCK_DIR/$HASH.lock"

# 古いロックディレクトリを作成
mkdir -p "$LOCK_FILE"
echo "Old lock directory created"

# ファイルのタイムスタンプを31秒前に変更
touch -d "31 seconds ago" "$LOCK_FILE"

# 新しい実行（古いロックがクリーンアップされる）
log_startup_message "$MESSAGE"

echo "Lock cleanup test completed"
            `;

            const scriptPath = path.join(TEST_TMP_DIR, 'test_lock_cleanup.sh');
            fs.writeFileSync(scriptPath, testScript);
            fs.chmodSync(scriptPath, '755');

            const { stdout } = await execAsync(`bash ${scriptPath}`);
            
            expect(stdout).toContain('Old lock directory created');
            expect(stdout).toContain('Lock cleanup test message');
            expect(stdout).toContain('Lock cleanup test completed');
        }, 10000);
    });

    describe('修正内容のコードレビュー', () => {
        test('Issue #5195の修正がentrypoint.shに含まれている', () => {
            const entrypointContent = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');
            
            // Issue #5195のコメントが含まれていることを確認
            expect(entrypointContent).toContain('Issue #5195');
            
            // 強化されたatomicロック機構が含まれていることを確認
            expect(entrypointContent).toContain('Enhanced atomic file creation with race condition prevention');
            
            // コンテナIDによる検証が含まれていることを確認
            expect(entrypointContent).toContain('local container_id=$(hostname)');
            
            // リトライ機構が含まれていることを確認
            expect(entrypointContent).toContain('max_lock_attempts=3');
            
            // atomic move操作が含まれていることを確認
            expect(entrypointContent).toContain('mv "$temp_success_file" "$success_file"');
        });

        test('30秒のクリーンアップタイムアウトが設定されている', () => {
            const entrypointContent = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');
            
            // より厳格な30秒クリーンアップタイムアウトが設定されていることを確認
            expect(entrypointContent).toContain('if [ $lock_age -gt 30 ]');
            expect(entrypointContent).toContain('if [ $((current_time - file_time)) -lt 30 ]');
        });
    });
});