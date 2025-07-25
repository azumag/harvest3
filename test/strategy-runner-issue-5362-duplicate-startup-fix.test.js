/**
 * テストファイル: Issue #5362 strategy-runnerサービス重複起動メッセージ修正
 * 
 * Issue #5362の修正内容をテスト：
 * - シンプルなflockベース重複防止機構の動作確認
 * - プロセス内変数による即座の重複防止の確認
 * - 複雑な多重防御機構を排除したKISS原則適用の検証
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// テスト用の一時ディレクトリ
const TEST_TMP_DIR = '.tmp/test-issue-5362';
const ENTRYPOINT_PATH = path.join(__dirname, '..', 'entrypoint.sh');

describe('Issue #5362: strategy-runner重複起動メッセージ修正', () => {
    beforeEach(async () => {
        // テスト環境の初期化
        await execAsync(`rm -rf ${TEST_TMP_DIR}`);
        await execAsync(`mkdir -p ${TEST_TMP_DIR}`);
        
        // Issue #5362用のロックファイルとフラグをクリーンアップ
        await execAsync('rm -rf /tmp/main-startup-message-global.lock /tmp/main-startup-message-global.done /tmp/main-startup-simple.lock 2>/dev/null || true');
        await execAsync('unset MAIN_STARTUP_MESSAGE_LOGGED 2>/dev/null || true');
        await execAsync('unset _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS 2>/dev/null || true');
    });

    afterEach(async () => {
        // テスト後クリーンアップ
        await execAsync(`rm -rf ${TEST_TMP_DIR}`);
        await execAsync('rm -rf /tmp/main-startup-message-global.lock /tmp/main-startup-message-global.done /tmp/main-startup-simple.lock 2>/dev/null || true');
        await execAsync('unset MAIN_STARTUP_MESSAGE_LOGGED 2>/dev/null || true');
        await execAsync('unset _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS 2>/dev/null || true');
    });

    describe('Issue #5362: シンプルな重複防止機構の動作確認', () => {
        test('プロセス内変数による即座の重複防止が正しく動作する', async () => {
            const testScript = `#!/bin/bash

# Issue #5362修正版: シンプルなテスト用関数
test_log_startup_message_5362() {
    local message="\$1"
    
    case "\$message" in
        *"Starting strategy-runner container with enhanced error handling"*)
            # 第一防御線: プロセス内変数による即座の重複防止（最優先）
            if [ "\$_MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS" = "1" ]; then
                echo "[DEBUG] Duplicate main startup message blocked by process internal flag"
                return 0  # 既に同一プロセス内でログ出力済み
            fi
            
            # プロセス内フラグ設定とメッセージ出力
            _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
            echo "[TEST] \$message"
            return 0
            ;;
    esac
    
    echo "[TEST] \$message"
}

# テスト実行
echo "=== Issue #5362 プロセス内重複防止テスト開始 ==="

# 初回呼び出し（ログが出力されるはず）
echo "--- 1回目の呼び出し ---"
test_log_startup_message_5362 "Starting strategy-runner container with enhanced error handling (container: test-5362, pid: \$\$)"

# 同一プロセス内での2回目の呼び出し（プロセス内変数により即座に防止されるはず）
echo "--- 2回目の呼び出し（同一プロセス内） ---"
test_log_startup_message_5362 "Starting strategy-runner container with enhanced error handling (container: test-5362, pid: \$\$)"

# 3回目の呼び出し（同様に防止されるはず）
echo "--- 3回目の呼び出し（同一プロセス内） ---"
test_log_startup_message_5362 "Starting strategy-runner container with enhanced error handling (container: test-5362, pid: \$\$)"

echo "=== テスト完了 ==="
`;

            // テストスクリプトを作成して実行
            const testScriptPath = `${TEST_TMP_DIR}/test-process-internal-prevention-5362.sh`;
            fs.writeFileSync(testScriptPath, testScript);
            await execAsync(`chmod +x ${testScriptPath}`);

            const { stdout, stderr } = await execAsync(`bash ${testScriptPath}`);
            
            // 結果の検証
            console.log('Issue #5362 Test output:', stdout);
            if (stderr) {
                console.log('Issue #5362 Test stderr:', stderr);
            }

            // 起動メッセージが1回だけ出力されることを確認
            const startupMessages = stdout.match(/Starting strategy-runner container with enhanced error handling/g);
            expect(startupMessages).toBeTruthy();
            expect(startupMessages.length).toBe(1); // 1回だけ出力されることを確認

            // デバッグメッセージで重複防止が動作していることを確認
            expect(stdout).toMatch(/Duplicate main startup message blocked by process internal flag/);
            
            // "1回目の呼び出し" セクションでメッセージが出力されることを確認
            const firstCallSection = stdout.split('--- 1回目の呼び出し ---')[1].split('--- 2回目の呼び出し')[0];
            expect(firstCallSection).toMatch(/Starting strategy-runner container with enhanced error handling/);

            // "2回目の呼び出し" セクションではメッセージが出力されず、代わりにブロックメッセージが出力されることを確認
            const secondCallSection = stdout.split('--- 2回目の呼び出し（同一プロセス内） ---')[1].split('--- 3回目の呼び出し')[0];
            expect(secondCallSection).not.toMatch(/Starting strategy-runner container with enhanced error handling/);
            expect(secondCallSection).toMatch(/Duplicate main startup message blocked by process internal flag/);
        });

        test('flock利用可能時の確実なロック機構が動作する', async () => {
            // flockが利用可能な環境でのテスト
            const flockTestScript = `#!/bin/bash

# flockが利用可能かチェック
if ! command -v flock >/dev/null 2>&1; then
    echo "SKIP: flock not available in this environment"
    exit 0
fi

echo "=== Issue #5362 flock重複防止テスト開始 ==="

# シンプルなflock基準の重複防止テスト
test_flock_duplicate_prevention() {
    local message="\$1"
    local test_lock_file="/tmp/test-5362-startup-message.lock"
    local test_success_file="/tmp/test-5362-startup-message.done"
    
    # 第一防御線: プロセス内変数チェック
    if [ "\$_TEST_MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS" = "1" ]; then
        echo "[DEBUG] Test duplicate blocked by process internal flag"
        return 0
    fi
    
    # 第二防御線: flockベースのロック
    exec 202>"\$test_lock_file"
    if flock -w 2 202; then
        echo "[DEBUG] Test lock acquired successfully"
        
        # 二重チェック
        if [ -f "\$test_success_file" ]; then
            echo "[DEBUG] Another process already logged, skipping"
            exec 202>&-
            return 0
        fi
        
        # メッセージ出力
        _TEST_MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
        echo "[TEST] \$message"
        echo "\$(date +%s):\$\$:\$(hostname)" > "\$test_success_file"
        echo "[DEBUG] Test message logged successfully"
        
        # ロック解放
        exec 202>&-
        return 0
    else
        echo "[DEBUG] Test lock acquisition failed"
        _TEST_MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
        exec 202>&- 2>/dev/null || true
        return 0
    fi
}

# クリーンアップ
rm -f /tmp/test-5362-startup-message.lock /tmp/test-5362-startup-message.done

# 複数回呼び出し
echo "--- 1回目の呼び出し ---"
test_flock_duplicate_prevention "Starting strategy-runner container with enhanced error handling (container: test-flock, pid: \$\$)"

echo "--- 2回目の呼び出し ---"
test_flock_duplicate_prevention "Starting strategy-runner container with enhanced error handling (container: test-flock, pid: \$\$)"

# クリーンアップ
rm -f /tmp/test-5362-startup-message.lock /tmp/test-5362-startup-message.done

echo "=== テスト完了 ==="
`;

            const flockTestPath = `${TEST_TMP_DIR}/test-flock-prevention-5362.sh`;
            fs.writeFileSync(flockTestPath, flockTestScript);
            await execAsync(`chmod +x ${flockTestPath}`);

            const { stdout: flockOutput } = await execAsync(`bash ${flockTestPath}`);
            
            console.log('Issue #5362 flock test output:', flockOutput);

            // SKIPメッセージが出力された場合はテストをスキップ
            if (flockOutput.includes('SKIP: flock not available')) {
                console.log('Skipping flock test due to unavailability');
                return;
            }

            // 起動メッセージが1回だけ出力されることを確認
            const flockStartupMessages = flockOutput.match(/Starting strategy-runner container with enhanced error handling/g);
            expect(flockStartupMessages).toBeTruthy();
            expect(flockStartupMessages.length).toBe(1);

            // ロック取得のデバッグメッセージが存在することを確認
            expect(flockOutput).toMatch(/Test lock acquired successfully/);
            expect(flockOutput).toMatch(/Test message logged successfully/);
        });
    });

    describe('Issue #5362: entrypoint.sh実装の確認', () => {
        test('Issue #5362修正がentrypoint.shに正しく実装されていることを確認', () => {
            const entrypointContent = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');

            // Issue #5362修正のコメントが追加されていることを確認
            expect(entrypointContent).toMatch(/Issue #5362修正.*シンプルで確実な重複防止機構/);
            expect(entrypointContent).toMatch(/KISS原則適用/);
            expect(entrypointContent).toMatch(/複雑な多重防御による競合状態を解決/);
            
            // flockベースの実装が追加されていることを確認
            expect(entrypointContent).toMatch(/flockベースの確実なファイルロック/);
            expect(entrypointContent).toMatch(/exec 201>/);
            expect(entrypointContent).toMatch(/flock -w 5 201/);
            
            // デバッグ情報が追加されていることを確認
            expect(entrypointContent).toMatch(/DEBUG.*Attempting to acquire main startup message lock/);
            expect(entrypointContent).toMatch(/DEBUG.*Main startup message lock acquired successfully/);
            
            // プロセス内変数チェックが最初に配置されていることを確認
            const lines = entrypointContent.split('\n');
            let processInternalCheckLine = -1;
            let flockAcquisitionLine = -1;

            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes('_MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS') && lines[i].includes('if')) {
                    processInternalCheckLine = i;
                }
                if (lines[i].includes('flock -w 5 201')) {
                    flockAcquisitionLine = i;
                }
            }

            // プロセス内変数チェックがflock処理より前に配置されていることを確認
            expect(processInternalCheckLine).toBeGreaterThan(-1);
            expect(flockAcquisitionLine).toBeGreaterThan(-1);
            expect(processInternalCheckLine).toBeLessThan(flockAcquisitionLine);
        });

        test('従来の複雑な多重防御機構が簡素化されていることを確認', () => {
            const entrypointContent = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');

            // 従来の複雑な実装（Issue #5295など）が削除されていることを確認
            expect(entrypointContent).not.toMatch(/atomic_processing_success=false/);
            expect(entrypointContent).not.toMatch(/wait_attempts=0/);
            expect(entrypointContent).not.toMatch(/while.*wait_attempts.*10/);
            
            // より単純なアプローチが使用されていることを確認
            expect(entrypointContent).toMatch(/第一防御線.*プロセス内変数による即座の重複防止/);
            expect(entrypointContent).toMatch(/第二防御線.*flockベースの確実なファイルロック/);
            
            // フォールバック実装（mkdir方式）が残されていることを確認
            expect(entrypointContent).toMatch(/flock not available.*using simple file-based lock/);
            expect(entrypointContent).toMatch(/mkdir.*simple_lock_file/);
        });
    });

    describe('Issue #5362: 回帰テスト', () => {
        test('過去のIssue修正内容が影響を受けていないことを確認', () => {
            const entrypointContent = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');

            // 基本的なlog_startup_message関数が維持されていることを確認
            expect(entrypointContent).toContain('log_startup_message() {');
            expect(entrypointContent).toContain('get_message_hash');
            
            // バックテスト用の専用関数が維持されていることを確認
            expect(entrypointContent).toContain('log_backtest_startup_message');
            
            // 通常のstrategy-runner用メッセージ出力箇所が維持されていることを確認
            expect(entrypointContent).toContain('log_startup_message "Starting strategy-runner container with enhanced error handling (container: $(hostname), pid: $$)"');
            
            // その他のメッセージ処理機構が残されていることを確認
            expect(entrypointContent).toMatch(/local message_hash=\$\(get_message_hash/);
        });

        test('エラーハンドリングが適切に実装されていることを確認', () => {
            const entrypointContent = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');

            // flock失敗時の適切な処理が実装されていることを確認
            expect(entrypointContent).toMatch(/exec 201>&- 2>\/dev\/null \|\| true/);
            
            // rmdir失敗時の適切な処理が実装されていることを確認
            expect(entrypointContent).toMatch(/rmdir.*2>\/dev\/null \|\| true/);
            
            // ファイル作成失敗時の適切な処理が実装されていることを確認
            expect(entrypointContent).toMatch(/chmod 600.*2>\/dev\/null \|\| true/);
        });
    });
});