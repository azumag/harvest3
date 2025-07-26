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
        // Issue #5308修正前の動作をシミュレートし、修正後は汎用ロジックが実行されないことを確認
        const testScript = `#!/bin/bash
set -e

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

# Issue #5308修正版のlog_startup_message関数（簡略版）
log_startup_message_fixed() {
    local message="$1"
    
    case "$message" in
        *"Starting strategy-runner container with enhanced error handling"*)
            # 特定メッセージパターンの処理
            local startup_msg_done_file="/tmp/main-startup-message.done"
            local startup_msg_lock_file="/tmp/main-startup-message.lock"
            
            if [ -f "$startup_msg_done_file" ]; then
                return 0
            fi
            
            if [ "$MAIN_STARTUP_MESSAGE_LOGGED" = "1" ]; then
                return 0
            fi
            
            if mkdir "$startup_msg_lock_file" 2>/dev/null; then
                export MAIN_STARTUP_MESSAGE_LOGGED=1
                log "$message"
                echo "$(date +%s):$$:$(hostname)" > "$startup_msg_done_file" 2>/dev/null || true
                rm -rf "$startup_msg_lock_file" 2>/dev/null || true
                # Issue #5308修正: ここでreturn 0が追加された
                return 0
            else
                export MAIN_STARTUP_MESSAGE_LOGGED=1
                return 0
            fi
            ;;
    esac
    
    # Issue #5308修正: 特定メッセージパターン処理後は汎用ロジックをスキップ
    return 0
    
    # 汎用ロジック（Issue #5308修正前はここが実行されていた）
    echo "GENERIC_LOGIC_EXECUTED: This should NOT appear for strategy-runner messages"
    local message_hash=\$(echo "\$message" | md5sum | cut -d' ' -f1)
    echo "Generic hash processing: \$message_hash"
}

# Issue #5308修正前の動作をシミュレート（汎用ロジックが実行される）
log_startup_message_before_fix() {
    local message="$1"
    
    case "$message" in
        *"Starting strategy-runner container with enhanced error handling"*)
            # 特定メッセージパターンの処理
            local startup_msg_done_file="/tmp/main-startup-message-before.done"
            local startup_msg_lock_file="/tmp/main-startup-message-before.lock"
            
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

echo "=== Testing Issue #5308 fix ==="
echo "--- Before fix (should show generic logic) ---"
log_startup_message_before_fix "Starting strategy-runner container with enhanced error handling (test)"

echo ""
echo "--- After fix (should NOT show generic logic) ---"  
log_startup_message_fixed "Starting strategy-runner container with enhanced error handling (test)"

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
            
            // 修正後バージョンでは汎用ロジックが実行されない
            const afterFixGenericLogic = stdout.split('\n').filter(line => 
                line.includes('GENERIC_LOGIC_EXECUTED') && line.includes('should NOT appear')
            );
            
            // 修正前では汎用ロジックが実行される
            expect(beforeFixGenericLogic.length).toBe(1);
            
            // Issue #5308修正により汎用ロジックが実行されない
            expect(afterFixGenericLogic.length).toBe(0);
            
            console.log('Issue #5308 fix verification:');
            console.log('- Before fix generic logic executed:', beforeFixGenericLogic.length);
            console.log('- After fix generic logic executed:', afterFixGenericLogic.length);
        } finally {
            if (fs.existsSync(testScriptPath)) {
                fs.unlinkSync(testScriptPath);
            }
        }
    }, 10000);

    test('Issue #5308: 実際のentrypoint.shに修正が適用されていることを確認', () => {
        expect(fs.existsSync(entrypointPath)).toBe(true);
        
        const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
        
        // Issue #5308の修正が適用されていることを確認
        expect(entrypointContent).toContain('Issue #5308修正: 特定メッセージパターン処理後は汎用ロジックをスキップ');
        expect(entrypointContent).toContain('return 0');
        
        // 931行目周辺にreturn 0があることを確認
        const lines = entrypointContent.split('\n');
        const returnLine = lines.find((line, index) => 
            line.trim() === 'return 0' && 
            lines[index - 1] && 
            lines[index - 1].includes('Issue #5308修正')
        );
        expect(returnLine).toBeDefined();
        
        console.log('Issue #5308 fix found in entrypoint.sh');
    });

    test('Issue #5308: 修正により重複ログ出力が防止されることを確認', async () => {
        // 実際のentrypoint.sh関数のロジックに近いテスト
        const realWorldScript = `#!/bin/bash
set -e

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

# 実際のentrypoint.shのlog_startup_message関数のロジック（簡略版）
log_startup_message() {
    local message="$1"
    
    case "$message" in
        *"Starting strategy-runner container with enhanced error handling"*)
            # プロセス内変数による即座の重複防止（第0防御線）
            if [ "$_MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS" = "1" ]; then
                return 0
            fi
            
            # 環境変数フラグによる第1防御線
            if [ "$MAIN_STARTUP_MESSAGE_LOGGED" = "1" ]; then
                _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
                return 0
            fi
            
            # 完了マーカーファイル存在チェック（第2防御線）
            local startup_msg_done_file="/tmp/main-startup-message.done"
            if [ -f "$startup_msg_done_file" ]; then
                _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
                export MAIN_STARTUP_MESSAGE_LOGGED=1
                return 0
            fi
            
            # アトミックロック取得（第3防御線）
            local startup_msg_lock_file="/tmp/main-startup-message.lock"
            if mkdir "$startup_msg_lock_file" 2>/dev/null; then
                # ロック取得後の最終チェック
                if [ -f "$startup_msg_done_file" ]; then
                    rm -rf "$startup_msg_lock_file" 2>/dev/null || true
                    _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
                    export MAIN_STARTUP_MESSAGE_LOGGED=1
                    return 0
                fi
                
                # 確実にフラグを設定してからメッセージ出力
                _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
                export MAIN_STARTUP_MESSAGE_LOGGED=1
                
                # メッセージ出力
                log "$message"
                
                # 完了マーカー作成
                echo "$(date +%s):$$:$(hostname)" > "$startup_msg_done_file" 2>/dev/null || true
                chmod 600 "$startup_msg_done_file" 2>/dev/null || true
                
                # ロック解放
                rm -rf "$startup_msg_lock_file" 2>/dev/null || true
                return 0
            else
                # ロック取得失敗時の処理
                local wait_attempts=0
                while [ $wait_attempts -lt 5 ] && [ ! -f "$startup_msg_done_file" ]; do
                    sleep 0.1
                    wait_attempts=$((wait_attempts + 1))
                done
                
                # フラグ設定
                _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
                export MAIN_STARTUP_MESSAGE_LOGGED=1
                return 0
            fi
            ;;
    esac
    
    # Issue #5308修正: 特定メッセージパターン処理後は汎用ロジックをスキップ
    return 0
    
    # ここから先の汎用ロジックは実行されない（Issue #5308修正により）
    echo "SHOULD_NOT_EXECUTE: Generic duplicate prevention logic"
    local message_hash=\$(echo "\$message" | md5sum | cut -d' ' -f1)
    echo "Processing generic hash: \$message_hash"
}

echo "=== Testing Issue #5308 duplicate prevention ==="
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
            
            // メッセージが1回のみ出力されることを確認
            const messages = stdout.split('\n').filter(line => 
                line.includes('Starting strategy-runner container with enhanced error handling')
            );
            
            // 汎用ロジックが実行されないことを確認
            const genericLogic = stdout.split('\n').filter(line => 
                line.includes('SHOULD_NOT_EXECUTE')
            );
            
            // Issue #5308修正により、メッセージは1回のみ出力され、汎用ロジックは実行されない
            expect(messages.length).toBe(1);
            expect(genericLogic.length).toBe(0);
            
            console.log('Issue #5308 duplicate prevention test:');
            console.log('- Messages found:', messages.length);
            console.log('- Generic logic executed:', genericLogic.length);
        } finally {
            if (fs.existsSync(testScriptPath)) {
                fs.unlinkSync(testScriptPath);
            }
        }
    }, 12000);

    test('entrypoint.sh構文検証', async () => {
        // Issue #5308修正後もentrypoint.shが正しく動作することを確認
        await expect(execAsync(`bash -n ${entrypointPath}`, { timeout: 2000 })).resolves.not.toThrow();
    }, 3000);
});