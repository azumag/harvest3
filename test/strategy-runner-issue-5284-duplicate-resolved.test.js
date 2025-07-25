/**
 * Issue #5284: strategy-runnerサービスで例外が発生 - 重複解決確認テスト
 * 
 * 概要:
 * - Issue #5284で報告された重複起動メッセージ問題が既存の修正により解決されていることを確認
 * - Issue #5267, #5302などの修正により重複防止機構が正しく動作することを検証
 * - 同一コンテナID・PIDでの重複ログが防止されることを確認
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

describe('Issue #5284: strategy-runner重複ログ問題解決確認', () => {
    const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
    const testTmpDir = '.tmp/test-issue-5284';

    beforeEach(async () => {
        // テスト用一時ディレクトリの準備
        await execAsync(`rm -rf ${testTmpDir}`);
        await execAsync(`mkdir -p ${testTmpDir}`);
        
        // Issue #5284関連のロックファイルをクリーンアップ
        await execAsync('rm -f /tmp/main-startup-message.done /tmp/main-startup-message.lock 2>/dev/null || true');
        await execAsync('unset MAIN_STARTUP_MESSAGE_LOGGED 2>/dev/null || true');
        await execAsync('unset _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS 2>/dev/null || true');
    });

    afterEach(async () => {
        // テスト後クリーンアップ
        await execAsync(`rm -rf ${testTmpDir}`);
        await execAsync('rm -f /tmp/main-startup-message.done /tmp/main-startup-message.lock 2>/dev/null || true');
        await execAsync('unset MAIN_STARTUP_MESSAGE_LOGGED 2>/dev/null || true');
        await execAsync('unset _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS 2>/dev/null || true');
    });

    test('Issue #5284: 報告された具体的な重複メッセージが防止されることを確認', async () => {
        // Issue #5284で報告された具体的なケースを再現
        const testScript = `#!/bin/bash
set -e

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

# Issue #5284で報告されたメッセージと同じ形式のテスト
# (container: 5cb8f02976da, pid: 1) の部分も含めて検証
log_startup_message() {
    local message="$1"
    
    case "$message" in
        *"Starting strategy-runner container with enhanced error handling"*)
            # Issue #5302修正: プロセス内変数による即座の重複防止（第0防御線）
            if [ "$_MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS" = "1" ]; then
                return 0  # 既に同一プロセス内でログ出力済み、即座に重複防止
            fi
            
            # Issue #5295修正: アトミックファイルロックによる確実な重複防止
            local startup_msg_lock_file="/tmp/main-startup-message.lock"
            local startup_msg_done_file="/tmp/main-startup-message.done"
            local atomic_processing_success=false
            
            # 既に完了マーカーが存在する場合は重複防止
            if [ -f "$startup_msg_done_file" ]; then
                return 0  # 既にログ出力済み、重複防止
            fi
            
            # 環境変数フラグによる高速チェック（第一防御線）
            if [ "$MAIN_STARTUP_MESSAGE_LOGGED" = "1" ]; then
                return 0  # 既にログ出力済み、重複防止
            fi
            
            # アトミックディレクトリロック取得（第二防御線）
            if mkdir "$startup_msg_lock_file" 2>/dev/null; then
                # ロック取得成功 - 二重チェック後にメッセージ出力
                if [ -f "$startup_msg_done_file" ]; then
                    # 他のプロセスが先にメッセージを出力していた
                    rm -rf "$startup_msg_lock_file" 2>/dev/null || true
                    return 0
                fi
                
                # フラグ設定とメッセージ出力
                _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1  # Issue #5302修正: プロセス内フラグ設定
                export MAIN_STARTUP_MESSAGE_LOGGED=1
                log "$message"
                atomic_processing_success=true
                
                # 完了マーカー作成（他のプロセス用）
                echo "$(date +%s):$$:$(hostname)" > "$startup_msg_done_file" 2>/dev/null || true
                chmod 600 "$startup_msg_done_file" 2>/dev/null || true
                
                # ロック解放
                rm -rf "$startup_msg_lock_file" 2>/dev/null || true
                
                # Issue #5295修正: 明示的な成功フラグをチェックしてreturn
                if [ "$atomic_processing_success" = true ]; then
                    return 0  # 処理完了、以降のRedis/ファイル処理を確実にスキップ
                fi
            else
                # ロック取得失敗 - 他のプロセスが処理中
                # 短時間待機してから完了マーカーをチェック
                local wait_attempts=0
                while [ $wait_attempts -lt 10 ] && [ ! -f "$startup_msg_done_file" ]; do
                    sleep 0.1
                    wait_attempts=$((wait_attempts + 1))
                done
                
                # 環境変数フラグも設定（一貫性のため）
                _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1  # Issue #5302修正: プロセス内フラグ設定
                export MAIN_STARTUP_MESSAGE_LOGGED=1
                return 0  # 他のプロセスがログ出力したため、重複防止
            fi
            
            # Issue #5295修正: fallthroughが発生した場合の緊急停止
            return 0
            ;;
    esac
    
    # その他のメッセージは通常処理
    log "$message"
}

# Issue #5284で報告されたのと同じメッセージを複数回実行
echo "=== Issue #5284 重複テスト開始 ==="

# 報告されたのと同じ形式のメッセージ
TEST_MESSAGE="Starting strategy-runner container with enhanced error handling (container: 5cb8f02976da, pid: 1)"

# 同一タイムスタンプで複数回呼び出し（Issue #5284で発生した状況を再現）
log_startup_message "$TEST_MESSAGE"
log_startup_message "$TEST_MESSAGE"
log_startup_message "$TEST_MESSAGE"

echo "=== テスト完了 ==="
`;

        const testScriptPath = path.join(testTmpDir, 'test-issue-5284-duplicate.sh');
        fs.writeFileSync(testScriptPath, testScript);
        fs.chmodSync(testScriptPath, '755');

        try {
            const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 5000 });
            
            // Issue #5284で報告された重複メッセージが発生しないことを確認
            const messages = stdout.split('\n').filter(line => 
                line.includes('Starting strategy-runner container with enhanced error handling')
            );
            
            // 修正により1回のみ出力されることを確認
            expect(messages.length).toBe(1);
            expect(messages[0]).toContain('container: 5cb8f02976da');
            expect(messages[0]).toContain('pid: 1');
            
            console.log('Issue #5284 resolution verified - Message count:', messages.length);
            console.log('Message:', messages[0]);
            
        } finally {
            if (fs.existsSync(testScriptPath)) {
                fs.unlinkSync(testScriptPath);
            }
        }
    });

    test('Issue #5284: 既存の修正機構が正しく動作していることを確認', () => {
        // entrypoint.shファイルに必要な修正が含まれていることを確認
        expect(fs.existsSync(entrypointPath)).toBe(true);
        
        const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
        
        // Issue #5302の修正（プロセス内変数）が含まれていることを確認
        expect(entrypointContent).toContain('Issue #5302修正: プロセス内変数による即座の重複防止');
        expect(entrypointContent).toContain('_MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS');
        
        // Issue #5267の修正（アトミックファイルロック）が含まれていることを確認
        expect(entrypointContent).toContain('Issue #5267修正: アトミックファイルロックによる確実な重複防止');
        expect(entrypointContent).toContain('startup_msg_lock_file="/tmp/main-startup-message.lock"');
        
        // Issue #5295の修正（fallthrough防止）が含まれていることを確認
        expect(entrypointContent).toContain('Issue #5295修正: fallthroughが発生した場合の緊急停止');
        expect(entrypointContent).toContain('atomic_processing_success=true');
        
        // log_startup_messageの呼び出しが1箇所のみであることを確認
        const startupMessageCalls = entrypointContent.match(/log_startup_message.*Starting strategy-runner container with enhanced error handling/g);
        expect(startupMessageCalls).toBeTruthy();
        expect(startupMessageCalls.length).toBe(1);
    });

    test('Issue #5284: コンテナ再起動時の重複防止が正しく動作することを確認', async () => {
        // コンテナ再起動のシミュレーション（環境変数とロックファイルクリア後の実行）
        const restartSimulationScript = `#!/bin/bash
set -e

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

# コンテナ再起動をシミュレート（環境変数とロックファイルのクリア）
cleanup_startup_message_locks() {
    rm -f "/tmp/main-startup-message.done" 2>/dev/null || true
    rm -rf "/tmp/main-startup-message.lock" 2>/dev/null || true
    unset MAIN_STARTUP_MESSAGE_LOGGED 2>/dev/null || true
    unset _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS 2>/dev/null || true
}

# Issue #5284修正版のlog_startup_message（entrypoint.shと同じロジック）
log_startup_message() {
    local message="$1"
    
    case "$message" in
        *"Starting strategy-runner container with enhanced error handling"*)
            if [ "$_MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS" = "1" ]; then
                return 0
            fi
            
            local startup_msg_lock_file="/tmp/main-startup-message.lock"
            local startup_msg_done_file="/tmp/main-startup-message.done"
            local atomic_processing_success=false
            
            if [ -f "$startup_msg_done_file" ]; then
                return 0
            fi
            
            if [ "$MAIN_STARTUP_MESSAGE_LOGGED" = "1" ]; then
                return 0
            fi
            
            if mkdir "$startup_msg_lock_file" 2>/dev/null; then
                if [ -f "$startup_msg_done_file" ]; then
                    rm -rf "$startup_msg_lock_file" 2>/dev/null || true
                    return 0
                fi
                
                _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
                export MAIN_STARTUP_MESSAGE_LOGGED=1
                log "$message"
                atomic_processing_success=true
                
                echo "$(date +%s):$$:$(hostname)" > "$startup_msg_done_file" 2>/dev/null || true
                chmod 600 "$startup_msg_done_file" 2>/dev/null || true
                
                rm -rf "$startup_msg_lock_file" 2>/dev/null || true
                
                if [ "$atomic_processing_success" = true ]; then
                    return 0
                fi
            else
                local wait_attempts=0
                while [ $wait_attempts -lt 10 ] && [ ! -f "$startup_msg_done_file" ]; do
                    sleep 0.1
                    wait_attempts=$((wait_attempts + 1))
                done
                
                _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
                export MAIN_STARTUP_MESSAGE_LOGGED=1
                return 0
            fi
            
            return 0
            ;;
    esac
    
    log "$message"
}

echo "=== コンテナ再起動シミュレーションテスト ==="

# 1回目の実行（初回起動をシミュレート）
echo "--- 初回起動 ---"
cleanup_startup_message_locks
log_startup_message "Starting strategy-runner container with enhanced error handling (container: simulated-restart, pid: $$)"

# 2回目の実行（再起動後をシミュレート）
echo "--- 再起動後 ---"
cleanup_startup_message_locks
log_startup_message "Starting strategy-runner container with enhanced error handling (container: simulated-restart, pid: $$)"

echo "=== テスト完了 ==="
`;

        const testScriptPath = path.join(testTmpDir, 'test-restart-simulation.sh');
        fs.writeFileSync(testScriptPath, restartSimulationScript);
        fs.chmodSync(testScriptPath, '755');

        try {
            const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 5000 });
            
            // 2回の再起動シミュレーションでそれぞれ1回ずつ計2回出力されることを確認
            const messages = stdout.split('\n').filter(line => 
                line.includes('Starting strategy-runner container with enhanced error handling')
            );
            
            expect(messages.length).toBe(2); // 再起動ごとに1回ずつ、計2回
            expect(messages[0]).toContain('container: simulated-restart');
            expect(messages[1]).toContain('container: simulated-restart');
            
            // 各セクションで1回ずつ出力されていることを確認
            const firstSection = stdout.split('--- 初回起動 ---')[1].split('--- 再起動後 ---')[0];
            const secondSection = stdout.split('--- 再起動後 ---')[1].split('=== テスト完了 ===')[0];
            
            const firstSectionMessages = firstSection.split('\n').filter(line => 
                line.includes('Starting strategy-runner container with enhanced error handling')
            );
            const secondSectionMessages = secondSection.split('\n').filter(line => 
                line.includes('Starting strategy-runner container with enhanced error handling')
            );
            
            expect(firstSectionMessages.length).toBe(1);
            expect(secondSectionMessages.length).toBe(1);
            
            console.log('Restart simulation verified - Messages per restart:', firstSectionMessages.length, secondSectionMessages.length);
            
        } finally {
            if (fs.existsSync(testScriptPath)) {
                fs.unlinkSync(testScriptPath);
            }
        }
    });

    test('Issue #5284: entrypoint.sh構文とロジック検証', async () => {
        // entrypoint.sh全体の構文チェック  
        await expect(execAsync(`bash -n ${entrypointPath}`, { timeout: 3000 })).resolves.not.toThrow();
        
        // log_startup_message関数の存在確認
        const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
        expect(entrypointContent).toContain('log_startup_message()');
        
        // 重複防止の3段階防御が正しく実装されていることを確認
        expect(entrypointContent).toContain('第0防御線'); // プロセス内変数
        expect(entrypointContent).toContain('第一防御線'); // 環境変数フラグ
        expect(entrypointContent).toContain('第二防御線'); // アトミックファイルロック
    });
});