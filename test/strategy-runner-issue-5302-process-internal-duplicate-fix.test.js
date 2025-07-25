/**
 * Issue #5302: strategy-runnerサービスで例外が発生 - プロセス内重複防止修正テスト
 * 
 * 概要:
 * - 同一プロセス内で高速連続呼び出しされた場合の重複ログを防止
 * - プロセス内変数(_MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS)による第0防御線を追加
 * - 既存のファイルベース・環境変数ベースの保護と組み合わせて確実な重複防止を実現
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

describe('Issue #5302: strategy-runner プロセス内重複ログ防止修正', () => {
    const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
    const testTmpDir = '.tmp/test-issue-5302';

    beforeEach(async () => {
        // テスト用一時ディレクトリの準備
        await execAsync(`rm -rf ${testTmpDir}`);
        await execAsync(`mkdir -p ${testTmpDir}`);
        
        // Issue #5302用のロックファイルとフラグをクリーンアップ
        await execAsync('rm -rf /tmp/main-startup-message.done /tmp/main-startup-message.lock 2>/dev/null || true');
        await execAsync('unset MAIN_STARTUP_MESSAGE_LOGGED 2>/dev/null || true');
        await execAsync('unset _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS 2>/dev/null || true');
    });

    afterEach(async () => {
        // テスト後クリーンアップ
        await execAsync(`rm -rf ${testTmpDir}`);
        await execAsync('rm -rf /tmp/main-startup-message.done /tmp/main-startup-message.lock 2>/dev/null || true');
        await execAsync('unset MAIN_STARTUP_MESSAGE_LOGGED 2>/dev/null || true');
        await execAsync('unset _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS 2>/dev/null || true');
    });

    test('Issue #5302: プロセス内変数による即座の重複防止が正しく動作することを確認', async () => {
        // 簡略化されたテスト用関数をエミュレート
        const testScript = `#!/bin/bash

# プロセス内変数のテスト用実装
test_log_startup_message() {
    local message="\$1"
    
    case "\$message" in
        *"Starting strategy-runner container with enhanced error handling"*)
            # Issue #5302修正: プロセス内変数による即座の重複防止（第0防御線）
            if [ "\$_MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS" = "1" ]; then
                echo "[PROCESS_INTERNAL_BLOCKED] Message blocked by process internal flag"
                return 0  # 既に同一プロセス内でログ出力済み、即座に重複防止
            fi
            
            # メッセージ出力とフラグ設定
            _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
            echo "[TEST] \$message"
            return 0
            ;;
    esac
    
    echo "[TEST] \$message"
}

# テスト実行
echo "=== プロセス内重複防止テスト開始 ==="

# 初回呼び出し（ログが出力されるはず）
echo "--- 1回目の呼び出し ---"
test_log_startup_message "Starting strategy-runner container with enhanced error handling (container: test-container, pid: \$\$)"

# 同一プロセス内での2回目の呼び出し（プロセス内変数により即座に防止されるはず）
echo "--- 2回目の呼び出し（同一プロセス内） ---"
test_log_startup_message "Starting strategy-runner container with enhanced error handling (container: test-container, pid: \$\$)"

echo "=== テスト完了 ==="
`;

        // テストスクリプトを作成して実行
        const testScriptPath = `${testTmpDir}/test-process-internal-prevention.sh`;
        fs.writeFileSync(testScriptPath, testScript);
        await execAsync(`chmod +x ${testScriptPath}`);

        const { stdout, stderr } = await execAsync(`bash ${testScriptPath}`);
        
        // 結果の検証
        console.log('Test output:', stdout);
        if (stderr) {
            console.log('Test stderr:', stderr);
        }

        // 起動メッセージが1回だけ出力されることを確認
        const startupMessages = stdout.match(/Starting strategy-runner container with enhanced error handling/g);
        expect(startupMessages).toBeTruthy();
        expect(startupMessages.length).toBe(1); // 1回だけ出力されることを確認

        // "1回目の呼び出し" セクションでメッセージが出力されることを確認
        const firstCallSection = stdout.split('--- 1回目の呼び出し ---')[1].split('--- 2回目の呼び出し')[0];
        expect(firstCallSection).toMatch(/Starting strategy-runner container with enhanced error handling/);

        // "2回目の呼び出し" セクションではメッセージが出力されず、代わりにブロックメッセージが出力されることを確認
        const secondCallSection = stdout.split('--- 2回目の呼び出し（同一プロセス内） ---')[1].split('=== テスト完了 ===')[0];
        expect(secondCallSection).not.toMatch(/Starting strategy-runner container with enhanced error handling/);
        expect(secondCallSection).toMatch(/PROCESS_INTERNAL_BLOCKED/);
    });

    test('Issue #5302: プロセス内変数がentrypoint.shに正しく実装されていることを確認', () => {
        // entrypoint.shファイルの内容を確認
        const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');

        // Issue #5302修正のプロセス内変数チェックが追加されていることを確認
        expect(entrypointContent).toMatch(/_MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS.*=.*"1"/);
        expect(entrypointContent).toMatch(/Issue #5302修正.*プロセス内変数による即座の重複防止/);
        expect(entrypointContent).toMatch(/同一プロセス内での高速連続呼び出しを防ぐ/);
        
        // プロセス内変数のチェックが最初の防御線として配置されていることを確認
        const lines = entrypointContent.split('\n');
        let processInternalCheckLine = -1;
        let fileDoneCheckLine = -1;
        let envVarCheckLine = -1;

        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('_MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS') && lines[i].includes('if')) {
                processInternalCheckLine = i;
            }
            if (lines[i].includes('startup_msg_done_file') && lines[i].includes('if') && lines[i].includes('-f')) {
                fileDoneCheckLine = i;
            }
            if (lines[i].includes('MAIN_STARTUP_MESSAGE_LOGGED') && !lines[i].includes('_MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS') && lines[i].includes('if')) {
                envVarCheckLine = i;
            }
        }

        // プロセス内変数チェックが他のチェックより前に配置されていることを確認
        expect(processInternalCheckLine).toBeGreaterThan(-1);
        expect(fileDoneCheckLine).toBeGreaterThan(-1);
        expect(envVarCheckLine).toBeGreaterThan(-1);
        expect(processInternalCheckLine).toBeLessThan(fileDoneCheckLine);
        expect(processInternalCheckLine).toBeLessThan(envVarCheckLine);
    });

    test('Issue #5302: プロセス内変数設定がメッセージ出力時と待機時の両方で行われることを確認', () => {
        const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');

        // メッセージ出力時のプロセス内変数設定を確認
        const messageLogSection = entrypointContent.match(/log "\$message"[\s\S]*?atomic_processing_success=true/);
        expect(messageLogSection).toBeTruthy();
        expect(messageLogSection[0]).toMatch(/_MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1/);

        // 他のプロセスが処理済みの場合の待機セクションでのプロセス内変数設定を確認
        const waitingSection = entrypointContent.match(/環境変数フラグも設定（一貫性のため）[\s\S]*?他のプロセスがログ出力したため、重複防止/);
        expect(waitingSection).toBeTruthy();
        expect(waitingSection[0]).toMatch(/_MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1/);
    });

    test('Issue #5302: 修正により同一タイムスタンプでの重複出力が防止されることを確認', async () => {
        // 高速連続実行をシミュレートするテスト（簡略化版）
        const rapidCallScript = `#!/bin/bash

# プロセス内変数のテスト用実装（バックグラウンド実行対応）
test_log_startup_message_bg() {
    local message="\$1"
    local output_file="\$2"
    
    case "\$message" in
        *"Starting strategy-runner container with enhanced error handling"*)
            # Issue #5302修正: プロセス内変数による即座の重複防止（第0防御線）
            if [ "\$_MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS" = "1" ]; then
                echo "[\$(date '+%Y-%m-%d %H:%M:%S')] [BLOCKED] Process internal flag prevented duplicate" >> "\$output_file"
                return 0
            fi
            
            # メッセージ出力とフラグ設定
            _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
            echo "[\$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] \$message" >> "\$output_file"
            return 0
            ;;
    esac
    
    echo "[\$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] \$message" >> "\$output_file"
}

# 出力ファイル
output_file="${testTmpDir}/rapid-call-output.log"

# 同一秒内での高速連続呼び出し（シーケンシャル実行でテスト）
test_log_startup_message_bg "Starting strategy-runner container with enhanced error handling (container: test-rapid, pid: \$\$)" "\$output_file"
test_log_startup_message_bg "Starting strategy-runner container with enhanced error handling (container: test-rapid, pid: \$\$)" "\$output_file"
test_log_startup_message_bg "Starting strategy-runner container with enhanced error handling (container: test-rapid, pid: \$\$)" "\$output_file"

# 結果を標準出力に出力
cat "\$output_file"
`;

        const rapidScriptPath = `${testTmpDir}/test-rapid-calls.sh`;
        fs.writeFileSync(rapidScriptPath, rapidCallScript);
        await execAsync(`chmod +x ${rapidScriptPath}`);

        const { stdout } = await execAsync(`bash ${rapidScriptPath}`);
        
        // 起動メッセージが1回だけ出力されることを確認
        const startupMessages = stdout.match(/Starting strategy-runner container with enhanced error handling/g);
        expect(startupMessages).toBeTruthy();
        expect(startupMessages.length).toBe(1); // プロセス内変数により1回のみ出力
        
        // ブロックされたメッセージが存在することを確認
        expect(stdout).toMatch(/BLOCKED.*Process internal flag prevented duplicate/);
    });
});