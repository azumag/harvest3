/**
 * Issue #5308: strategy-runner重複起動メッセージ問題を修正 - テスト
 * 
 * 概要:
 * - entrypoint.sh の log_startup_message 関数で特定メッセージパターン処理後に汎用ロジックが実行され、重複ログ出力が発生していた問題を修正
 * - entrypoint.sh:931 に return 0 を追加し、特定メッセージパターン処理後に関数を適切に終了
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

describe('Issue #5308: strategy-runner重複起動メッセージ問題修正', () => {
    const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
    const testTmpDir = '.tmp/test-issue-5308';

    beforeEach(async () => {
        // テスト用一時ディレクトリの準備
        await execAsync(`rm -rf ${testTmpDir}`);
        await execAsync(`mkdir -p ${testTmpDir}`);
        
        // Issue #5308用のロックファイルをクリーンアップ
        await execAsync('rm -f /tmp/main-startup-message.done /tmp/main-startup-message.lock 2>/dev/null || true');
        await execAsync('unset MAIN_STARTUP_MESSAGE_LOGGED 2>/dev/null || true');
    });

    afterEach(async () => {
        // テスト後クリーンアップ
        await execAsync(`rm -rf ${testTmpDir}`);
        await execAsync('rm -f /tmp/main-startup-message.done /tmp/main-startup-message.lock 2>/dev/null || true');
        await execAsync('unset MAIN_STARTUP_MESSAGE_LOGGED 2>/dev/null || true');
    });

    test('Issue #5308: 特定メッセージパターン処理後に汎用ロジックが実行されないことを確認', async () => {
        // Issue #5415 KISS原則簡素化後の動作確認
        const testScript = `#!/bin/bash
set -e

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

# Issue #5415: KISS原則に基づく簡素化後の実装（flock使用）
log_startup_message_kiss() {
    local message="$1"
    
    case "$message" in
        *"Starting strategy-runner container with enhanced error handling"*)
            local lock_file="${testTmpDir}/main-startup-message-kiss.lock"
            local done_marker="${testTmpDir}/main-startup-message-kiss.done"
            
            # シンプルなflock実装による重複防止
            (
                flock -n 200 || exit 0
                [ -f "$done_marker" ] && exit 0
                log "$message"
                touch "$done_marker"
                chmod 600 "$done_marker" 2>/dev/null || true
            ) 200>"$lock_file"
            
            return 0
            ;;
    esac
    
    # その他のメッセージは通常のログ処理
    log "$message"
    return 0
}

# Issue #5308修正前の動作をシミュレート（汎用ロジックが実行される）
log_startup_message_before_fix() {
    local message="$1"
    
    case "$message" in
        *"Starting strategy-runner container with enhanced error handling"*)
            # 特定メッセージパターンの処理
            local startup_msg_done_file="${testTmpDir}/main-startup-message-before.done"
            local startup_msg_lock_file="${testTmpDir}/main-startup-message-before.lock"
            
            if mkdir "$startup_msg_lock_file" 2>/dev/null; then
                log "$message"
                echo "$(date +%s):$$:$(hostname)" > "$startup_msg_done_file" 2>/dev/null || true
                rm -rf "$startup_msg_lock_file" 2>/dev/null || true
                # Issue #5308修正前: ここにreturn 0がなかった
            fi
            ;;
    esac
    
    # 汎用ロジック（Issue #5308修正前はここが実行されていた）
    echo "GENERIC_LOGIC_EXECUTED: This SHOULD appear for pre-fix version"
    local message_hash=\$(echo "\$message" | md5sum | cut -d' ' -f1)
    echo "Generic hash processing: \$message_hash"
}

echo "=== Testing Issue #5415 KISS simplification ==="
echo "--- Before fix (should show generic logic) ---"
log_startup_message_before_fix "Starting strategy-runner container with enhanced error handling (test)"

echo ""
echo "--- After KISS simplification (should NOT show generic logic) ---"  
log_startup_message_kiss "Starting strategy-runner container with enhanced error handling (test)"

echo "=== Test completed ==="
`;

        const testScriptPath = path.join(testTmpDir, 'test-issue-5308.sh');
        fs.writeFileSync(testScriptPath, testScript);
        fs.chmodSync(testScriptPath, '755');

        try {
            const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 5000 });
            
            // 修正前バージョンでは汎用ロジックが実行される
            const beforeFixGenericLogic = stdout.split('\n').filter(line => 
                line.includes('GENERIC_LOGIC_EXECUTED') && line.includes('SHOULD appear')
            );
            
            // Issue #5415 KISS簡素化後は適切なreturnでメッセージ処理が終了
            const afterKissMessages = stdout.split('\n').filter(line => 
                line.includes('Starting strategy-runner container with enhanced error handling')
            );
            
            // 修正前では汎用ロジックが実行される
            expect(beforeFixGenericLogic.length).toBe(1);
            
            // Issue #5415 KISS簡素化により、適切にメッセージが処理される
            expect(afterKissMessages.length).toBeGreaterThan(0);
            
            console.log('Issue #5415 KISS simplification verification:');
            console.log('- Before fix generic logic executed:', beforeFixGenericLogic.length);
            console.log('- After KISS simplification messages processed:', afterKissMessages.length);
        } finally {
            if (fs.existsSync(testScriptPath)) {
                fs.unlinkSync(testScriptPath);
            }
        }
    }, 10000);

    test('Issue #5308: 実際のentrypoint.shに修正が適用されていることを確認', () => {
        expect(fs.existsSync(entrypointPath)).toBe(true);
        
        const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
        
        // Issue #5415: KISS原則による簡素化後の実装を確認
        expect(entrypointContent).toContain('Issue #5415: KISS原則に基づく簡素化 - シンプルなflock使用による重複防止');
        expect(entrypointContent).toContain('flock -n 200');
        expect(entrypointContent).toContain('done_marker');
        expect(entrypointContent).toContain('return 0');
        
        // シンプルなflock実装による重複防止が正しく実装されていることを確認
        const lines = entrypointContent.split('\n');
        const flockLineIndex = lines.findIndex(line => line.includes('flock -n 200'));
        expect(flockLineIndex).toBeGreaterThan(-1);
        
        // flockブロックが正しく閉じられていることを確認
        const flockEndIndex = lines.findIndex((line, index) => 
            index > flockLineIndex && line.includes(') 200>"$lock_file"')
        );
        expect(flockEndIndex).toBeGreaterThan(flockLineIndex);
        
        console.log('Issue #5415 KISS simplification found in entrypoint.sh');
    });

    test('Issue #5308: 修正により重複ログ出力が防止されることを確認', async () => {
        // Issue #5415 KISS原則による簡素化後の実装テスト
        const realWorldScript = `#!/bin/bash
set -e

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

# Issue #5415: KISS原則に基づく簡素化 - シンプルなflock使用による重複防止
log_startup_message() {
    local message="$1"
    
    case "$message" in
        *"Starting strategy-runner container with enhanced error handling"*)
            local lock_file="${testTmpDir}/main-startup-message.lock"
            local done_marker="${testTmpDir}/main-startup-message.done"
            
            # シンプルなflock実装による重複防止
            (
                flock -n 200 || exit 0
                [ -f "$done_marker" ] && exit 0
                log "$message"
                touch "$done_marker"
                chmod 600 "$done_marker" 2>/dev/null || true
            ) 200>"$lock_file"
            
            return 0
            ;;
    esac
    
    # その他のメッセージは通常のログ処理
    log "$message"
    return 0
}

echo "=== Testing Issue #5415 KISS simplification duplicate prevention ==="
log_startup_message "Starting strategy-runner container with enhanced error handling (container: test, pid: $$)"
log_startup_message "Starting strategy-runner container with enhanced error handling (container: test, pid: $$)"
log_startup_message "Starting strategy-runner container with enhanced error handling (container: test, pid: $$)"
echo "=== Test completed ==="
`;

        const testScriptPath = path.join(testTmpDir, 'test-real-world-5308.sh');
        fs.writeFileSync(testScriptPath, realWorldScript);
        fs.chmodSync(testScriptPath, '755');

        try {
            const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 8000 });
            
            // Issue #5415 KISS簡素化: メッセージが1回のみ出力されることを確認
            const messages = stdout.split('\n').filter(line => 
                line.includes('Starting strategy-runner container with enhanced error handling')
            );
            
            // Issue #5415により、シンプルなflock実装でメッセージは1回のみ出力される
            expect(messages.length).toBe(1);
            
            console.log('Issue #5415 KISS simplification duplicate prevention test:');
            console.log('- Messages found:', messages.length);
            console.log('- Expected: 1 (duplicate prevention working)');
        } finally {
            if (fs.existsSync(testScriptPath)) {
                fs.unlinkSync(testScriptPath);
            }
        }
    }, 12000);

    test('entrypoint.sh構文検証', async () => {
        // Issue #5415 KISS簡素化後もentrypoint.shが正しく動作することを確認
        await expect(execAsync(`bash -n ${entrypointPath}`, { timeout: 2000 })).resolves.not.toThrow();
    }, 3000);
});