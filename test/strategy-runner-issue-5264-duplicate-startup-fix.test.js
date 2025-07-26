/**
 * Issue #5264: strategy-runnerサービスで例外が発生 - 重複起動メッセージ修正テスト
 * 
 * 概要:
 * - 起動メッセージが2回出力される問題を修正
 * - fallthrough防止とより確実な重複防止機構を実装
 * - 4段階の防御線による完全な重複防止システムを確認
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

describe('Issue #5264: strategy-runner重複起動メッセージ修正', () => {
    const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
    const testTmpDir = '.tmp/test-issue-5264';

    beforeEach(async () => {
        // テスト用一時ディレクトリの準備
        await execAsync(`rm -rf ${testTmpDir}`);
        await execAsync(`mkdir -p ${testTmpDir}`);
        
        // Issue #5264用のロックファイルとフラグをクリーンアップ
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

    test('Issue #5264: 修正版の4段階防御線が正しく動作することを確認', async () => {
        // Issue #5264修正版のロジックをテスト
        const fixedScript = `#!/bin/bash
set -e

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

# Issue #5264修正版: 完全分離処理による重複防止
log_startup_message_5264_fixed() {
    local message="$1"
    
    case "$message" in
        *"Starting strategy-runner container with enhanced error handling"*)
            # 第0防御線: プロセス内変数チェック
            if [ "$_MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS" = "1" ]; then
                echo "[DEBUG] Blocked by process internal flag"
                return 0
            fi
            
            # 第1防御線: 環境変数フラグチェック
            if [ "$MAIN_STARTUP_MESSAGE_LOGGED" = "1" ]; then
                _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
                echo "[DEBUG] Blocked by environment variable flag"
                return 0
            fi
            
            # 第2防御線: 完了マーカーファイル存在チェック
            local startup_msg_done_file="/tmp/main-startup-message.done"
            if [ -f "$startup_msg_done_file" ]; then
                _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
                export MAIN_STARTUP_MESSAGE_LOGGED=1
                echo "[DEBUG] Blocked by done marker file"
                return 0
            fi
            
            # 第3防御線: アトミックロック取得
            local startup_msg_lock_file="/tmp/main-startup-message.lock"
            if mkdir "$startup_msg_lock_file" 2>/dev/null; then
                # ロック取得後の最終チェック
                if [ -f "$startup_msg_done_file" ]; then
                    rm -rf "$startup_msg_lock_file" 2>/dev/null || true
                    _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
                    export MAIN_STARTUP_MESSAGE_LOGGED=1
                    echo "[DEBUG] Blocked by final check after lock"
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
                
                _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
                export MAIN_STARTUP_MESSAGE_LOGGED=1
                echo "[DEBUG] Blocked by lock acquisition failure"
                return 0
            fi
            ;;
    esac
    
    # その他のメッセージは通常処理
    echo "[DEBUG] Non-startup message processed"
    log "$message"
}

# テスト実行
echo "=== Issue #5264 修正テスト開始 ==="

# 1回目の呼び出し（ログが出力されるはず）
echo "--- 1回目の呼び出し ---"
log_startup_message_5264_fixed "Starting strategy-runner container with enhanced error handling (container: test, pid: $$)"

# 2回目の呼び出し（第0防御線で防止されるはず）
echo "--- 2回目の呼び出し ---"
log_startup_message_5264_fixed "Starting strategy-runner container with enhanced error handling (container: test, pid: $$)"

# 3回目の呼び出し（第0防御線で防止されるはず）
echo "--- 3回目の呼び出し ---"
log_startup_message_5264_fixed "Starting strategy-runner container with enhanced error handling (container: test, pid: $$)"

echo "=== テスト完了 ==="
`;

        const testScriptPath = path.join(testTmpDir, 'test-5264-fix.sh');
        fs.writeFileSync(testScriptPath, fixedScript);
        fs.chmodSync(testScriptPath, '755');

        try {
            const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 5000 });
            
            const messages = stdout.split('\n').filter(line => 
                line.includes('Starting strategy-runner container with enhanced error handling')
            );
            
            // DEBUG情報の確認
            const debugMessages = stdout.split('\n').filter(line => 
                line.includes('[DEBUG]')
            );
            
            // 修正後は必ず1回のみ出力される
            expect(messages.length).toBe(1);
            
            // 2回目と3回目の呼び出しが適切にブロックされていることを確認
            expect(debugMessages.length).toBeGreaterThanOrEqual(2);
            expect(debugMessages.some(msg => msg.includes('Blocked by process internal flag'))).toBe(true);
            
            console.log('Issue #5264 fix - Messages found:', messages.length);
            console.log('Debug messages:', debugMessages);
        } finally {
            if (fs.existsSync(testScriptPath)) {
                fs.unlinkSync(testScriptPath);
            }
        }
    }, 10000);

    test('Issue #5264: 防御線の順序が正しく動作することを確認', async () => {
        // 各防御線を個別にテスト
        const defenseLineScript = `#!/bin/bash
set -e

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

test_defense_line() {
    local test_case="$1"
    local message="Starting strategy-runner container with enhanced error handling (container: test, pid: $$)"
    
    case "$test_case" in
        "env_flag")
            # 環境変数フラグを事前に設定
            export MAIN_STARTUP_MESSAGE_LOGGED=1
            ;;
        "done_file")
            # 完了マーカーファイルを事前に作成
            echo "$(date +%s):$$:$(hostname)" > "/tmp/main-startup-message.done"
            chmod 600 "/tmp/main-startup-message.done"
            ;;
        "process_flag")
            # プロセス内フラグを事前に設定
            _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
            ;;
    esac
    
    # 防御線テスト用の簡略化関数
    case "$message" in
        *"Starting strategy-runner container with enhanced error handling"*)
            if [ "$_MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS" = "1" ]; then
                echo "Defense Line 0: Process internal flag blocked"
                return 0
            fi
            
            if [ "$MAIN_STARTUP_MESSAGE_LOGGED" = "1" ]; then
                echo "Defense Line 1: Environment variable flag blocked"
                return 0
            fi
            
            if [ -f "/tmp/main-startup-message.done" ]; then
                echo "Defense Line 2: Done marker file blocked"
                return 0
            fi
            
            echo "Message would be output (no defense triggered)"
            ;;
    esac
}

# 各防御線のテスト
echo "=== 防御線順序テスト ==="
echo "--- プロセス内フラグ防御線テスト ---"
test_defense_line "process_flag"

echo "--- 環境変数フラグ防御線テスト ---"
unset _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS
test_defense_line "env_flag"

echo "--- 完了マーカーファイル防御線テスト ---"
unset MAIN_STARTUP_MESSAGE_LOGGED
unset _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS
test_defense_line "done_file"

echo "--- 防御線なしテスト ---"
rm -f "/tmp/main-startup-message.done"
unset MAIN_STARTUP_MESSAGE_LOGGED
unset _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS
test_defense_line "none"
`;

        const testScriptPath = path.join(testTmpDir, 'test-defense-lines.sh');
        fs.writeFileSync(testScriptPath, defenseLineScript);
        fs.chmodSync(testScriptPath, '755');

        try {
            const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 5000 });
            
            // 各防御線が正しく動作することを確認
            expect(stdout).toContain('Defense Line 0: Process internal flag blocked');
            expect(stdout).toContain('Defense Line 1: Environment variable flag blocked');
            expect(stdout).toContain('Defense Line 2: Done marker file blocked');
            expect(stdout).toContain('Message would be output (no defense triggered)');
            
            console.log('Defense lines test output:', stdout);
        } finally {
            if (fs.existsSync(testScriptPath)) {
                fs.unlinkSync(testScriptPath);
            }
        }
    }, 10000);

    test('Issue #5264: entrypoint.shに修正が適用されていることを確認', () => {
        expect(fs.existsSync(entrypointPath)).toBe(true);
        
        const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
        
        // Issue #5264の修正が適用されていることを確認
        expect(entrypointContent).toContain('Issue #5264修正: 起動メッセージの完全分離処理（fallthrough完全防止）');
        expect(entrypointContent).toContain('Issue #5264修正: 環境変数フラグによる第1防御線');
        expect(entrypointContent).toContain('Issue #5264修正: 完了マーカーファイル存在チェック（第2防御線）');
        expect(entrypointContent).toContain('Issue #5264修正: アトミックロック取得（第3防御線）');
        
        // 重複防止機構の主要部分が含まれていることを確認
        expect(entrypointContent).toContain('_MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1');
        expect(entrypointContent).toContain('export MAIN_STARTUP_MESSAGE_LOGGED=1');
        expect(entrypointContent).toContain('startup_msg_done_file="$LOCK_BASE_DIR/main-startup-message.done"');
        expect(entrypointContent).toContain('startup_msg_lock_file="$LOCK_BASE_DIR/main-startup-message.lock"');
    });

    test('Issue #5264: 並行プロセステスト', async () => {
        // 複数のプロセスを並行実行して重複防止機能をテスト
        const concurrentScript = `#!/bin/bash
set -e

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

log_startup_message_concurrent() {
    local message="$1"
    local process_id="$2"
    
    case "$message" in
        *"Starting strategy-runner container with enhanced error handling"*)
            if [ "$_MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS" = "1" ]; then
                return 0
            fi
            
            if [ "$MAIN_STARTUP_MESSAGE_LOGGED" = "1" ]; then
                _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
                return 0
            fi
            
            local startup_msg_done_file="/tmp/main-startup-message.done"
            if [ -f "$startup_msg_done_file" ]; then
                _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
                export MAIN_STARTUP_MESSAGE_LOGGED=1
                return 0
            fi
            
            local startup_msg_lock_file="/tmp/main-startup-message.lock"
            if mkdir "$startup_msg_lock_file" 2>/dev/null; then
                if [ -f "$startup_msg_done_file" ]; then
                    rm -rf "$startup_msg_lock_file" 2>/dev/null || true
                    _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
                    export MAIN_STARTUP_MESSAGE_LOGGED=1
                    return 0
                fi
                
                _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
                export MAIN_STARTUP_MESSAGE_LOGGED=1
                
                log "$message (process: $process_id)"
                
                echo "$(date +%s):$$:$(hostname)" > "$startup_msg_done_file" 2>/dev/null || true
                chmod 600 "$startup_msg_done_file" 2>/dev/null || true
                
                rm -rf "$startup_msg_lock_file" 2>/dev/null || true
                return 0
            else
                local wait_attempts=0
                while [ $wait_attempts -lt 5 ] && [ ! -f "$startup_msg_done_file" ]; do
                    sleep 0.1
                    wait_attempts=$((wait_attempts + 1))
                done
                
                _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
                export MAIN_STARTUP_MESSAGE_LOGGED=1
                return 0
            fi
            ;;
    esac
}

# プロセス識別用のスリープを追加
sleep $(echo "scale=3; $1 / 20" | bc -l 2>/dev/null || echo "0.05")
log_startup_message_concurrent "Starting strategy-runner container with enhanced error handling (container: test, pid: $$)" "$1"
`;

        const testScriptPath = path.join(testTmpDir, 'test-concurrent.sh');
        fs.writeFileSync(testScriptPath, concurrentScript);
        fs.chmodSync(testScriptPath, '755');

        try {
            // 3個のプロセスを並行実行
            const promises = [];
            for (let i = 0; i < 3; i++) {
                promises.push(
                    execAsync(`bash ${testScriptPath} ${i}`, { timeout: 5000 }).catch(err => {
                        console.log(`Process ${i} error:`, err.message);
                        return { stdout: '', stderr: err.message };
                    })
                );
            }
            
            const results = await Promise.all(promises);
            
            // すべての出力を結合
            const allOutput = results.map(r => r.stdout || '').join('\n');
            const messages = allOutput.split('\n').filter(line => 
                line.includes('Starting strategy-runner container with enhanced error handling')
            );
            
            // 並行実行でも1回のみ出力されることを確認
            expect(messages.length).toBe(1);
            console.log('Concurrent test - Messages found:', messages.length);
            console.log('Message:', messages[0]);
            
        } finally {
            if (fs.existsSync(testScriptPath)) {
                fs.unlinkSync(testScriptPath);
            }
        }
    }, 15000);

    test('entrypoint.sh構文検証', async () => {
        // Issue #5264修正後もentrypoint.shが正しく動作することを確認
        await expect(execAsync(`bash -n ${entrypointPath}`, { timeout: 2000 })).resolves.not.toThrow();
    }, 3000);
});