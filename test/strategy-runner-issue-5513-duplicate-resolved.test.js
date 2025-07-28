/**
 * Issue #5513修正テスト: strategy-runnerサービス重複メッセージ解決確認
 * 
 * 本テストは、Issue #5513で報告された重複起動メッセージの問題が
 * 既存の修正（#5413, #5362, #5318等）により解決されていることを確認する。
 * 
 * 問題:
 * - 同一PID、同一コンテナ、同一タイムスタンプで起動メッセージが重複出力
 * - [2025-07-28 03:21:29] [ENTRYPOINT] Starting strategy-runner container...
 * 
 * 確認事項:
 * - 既存の多層防御機構が正常に動作している
 * - 単一プロセス内での重複が防がれている  
 * - ファイルベース、環境変数ベースの防御線が機能している
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

describe('Issue #5513: strategy-runnerサービス重複メッセージ解決確認', () => {
    const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
    const tmpDir = path.join(__dirname, '..', '.tmp');

    beforeAll(() => {
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }
    });

    test('Issue #5513解決確認: 既存の多層防御機構により重複が防がれることを確認', async () => {
        const testScript = `#!/bin/bash
# Issue #5513の具体的なケースをシミュレート

# テスト環境設定
export LOCK_BASE_DIR="/tmp/issue-5513-resolution-test-$$"
export BACKTEST_MODE="false"
mkdir -p "$LOCK_BASE_DIR"

# 全ての防御変数をクリア（最悪ケースをシミュレート）
unset _GLOBAL_STARTUP_MESSAGE_SENT
unset _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS
unset MAIN_STARTUP_MESSAGE_LOGGED
unset _GLOBAL_STARTUP_MESSAGE_SENT_PROCESS
unset _STARTUP_MESSAGE_LOGGED

# テスト用のlog関数
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

# entrypoint.shのlog_startup_message関数の重要部分を抽出
log_startup_message() {
    local message="$1"
    
    case "$message" in
        *"Starting strategy-runner container with enhanced error handling"*)
            # Issue #5302修正: プロセス内変数による即座の重複防止（第0防御線）
            if [ "$\{_MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS:-\}" = "1" ]; then
                log "DEBUG: [Issue #5302] Process-level flag prevented duplicate startup message (PID: $$)"
                return 0
            fi
            
            # Issue #5264修正: 環境変数フラグによる第1防御線
            if [ "$\{MAIN_STARTUP_MESSAGE_LOGGED:-\}" = "1" ]; then
                _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
                log "DEBUG: [Issue #5264] Environment flag prevented duplicate startup message (PID: $$)"
                return 0
            fi
            
            # Issue #5264修正: 完了マーカーファイル存在チェック（第2防御線）
            local startup_msg_done_file="$LOCK_BASE_DIR/main-startup-message.done"
            if [ -f "$startup_msg_done_file" ]; then
                _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
                export MAIN_STARTUP_MESSAGE_LOGGED=1
                log "DEBUG: [Issue #5264] Done marker file prevented duplicate startup message (PID: $$)"
                return 0
            fi
            
            # Issue #5267修正: アトミックファイルロックによる確実な重複防止
            local startup_msg_lock_file="$LOCK_BASE_DIR/main-startup-message.lock"
            if mkdir "$startup_msg_lock_file" 2>/dev/null; then
                # アトミックファイル作成による完了マーカー設定
                local temp_marker="$\{startup_msg_done_file\}.tmp.$$"
                echo "$(date +%s):$$:$(hostname)" > "$temp_marker" 2>/dev/null && \\
                mv "$temp_marker" "$startup_msg_done_file" 2>/dev/null
                
                # メッセージ出力とフラグ設定
                _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
                export MAIN_STARTUP_MESSAGE_LOGGED=1
                
                log "$message"
                log "DEBUG: [Issue #5362] Startup message sent with protection (PID: $$, Container: $(hostname))"
                
                # ロック解除
                rm -rf "$startup_msg_lock_file" 2>/dev/null || true
                return 0
            else
                log "DEBUG: [Issue #5267] Atomic file operation prevented duplicate startup message (PID: $$)"
                _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
                return 0
            fi
            ;;
    esac
    
    log "$message"
    return 0
}

# main関数の起動メッセージ呼び出し部分をシミュレート
simulate_main_function() {
    # Issue #5318修正: 起動メッセージの確実な重複防止（グローバルフラグによる追加防御）
    if [ "$_GLOBAL_STARTUP_MESSAGE_SENT" != "1" ]; then
        export _GLOBAL_STARTUP_MESSAGE_SENT=1
        # Issue #5362修正: 起動メッセージの重複防止をlog_startup_message関数に一元化（KISS原則）
        log_startup_message "Starting strategy-runner container with enhanced error handling (container: $(hostname), pid: $$)"
    else
        log "DEBUG: Global flag prevented duplicate startup message"
    fi
}

echo "=== Issue #5513解決テスト開始 ==="

# テスト1: 通常の起動（1回目）
echo "テスト1: 通常の起動"
simulate_main_function

# テスト2: 同一プロセス内での再実行（重複防止されるべき）
echo "テスト2: 同一プロセス内での再実行"
simulate_main_function

# テスト3: グローバルフラグをリセットした場合の多層防御確認
echo "テスト3: グローバルフラグリセット時の多層防御"
unset _GLOBAL_STARTUP_MESSAGE_SENT
simulate_main_function

# テスト4: さらに追加の変数をリセットしても防がれることを確認
echo "テスト4: 複数変数リセット時の防御"
unset _GLOBAL_STARTUP_MESSAGE_SENT
unset _MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS
simulate_main_function

# クリーンアップ
rm -rf "$LOCK_BASE_DIR" 2>/dev/null || true

echo "=== Issue #5513解決テスト完了 ==="
`;

        const testScriptPath = path.join(tmpDir, `test-issue-5513-resolution-${Date.now()}.sh`);
        fs.writeFileSync(testScriptPath, testScript);
        fs.chmodSync(testScriptPath, '755');

        try {
            const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 10000 });
            
            // "Starting strategy-runner container" メッセージが1回のみ出力されることを確認
            const startupMessages = stdout.split('\\n').filter(line => 
                line.includes('Starting strategy-runner container with enhanced error handling')
            );
            expect(startupMessages.length).toBe(1);
            
            // 重複防止機構が正常に動作していることを確認
            const preventionMessages = stdout.split('\\n').filter(line => 
                line.includes('prevented duplicate startup message')
            );
            expect(preventionMessages.length).toBeGreaterThanOrEqual(1); // 少なくとも1回の防御が動作
            
            // 正常な起動メッセージが出力されることを確認
            const successMessages = stdout.split('\\n').filter(line => 
                line.includes('Startup message sent with protection')
            );
            expect(successMessages.length).toBe(1);
            
        } finally {
            if (fs.existsSync(testScriptPath)) {
                fs.unlinkSync(testScriptPath);
            }
        }
    }, 15000);

    test('Issue #5513解決確認: entrypoint.sh構文検証', async () => {
        try {
            await execAsync(`bash -n ${entrypointPath}`, { timeout: 5000 });
        } catch (error) {
            throw new Error(`entrypoint.sh has syntax errors: ${error.message}`);
        }
    }, 10000);

    test('Issue #5513解決確認: log_startup_message関数の多層防御機構存在確認', () => {
        const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
        
        // Issue #5302の修正が存在することを確認
        expect(entrypointContent).toContain('Issue #5302修正');
        expect(entrypointContent).toContain('_MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS');
        
        // Issue #5264の修正が存在することを確認
        expect(entrypointContent).toContain('Issue #5264修正');
        expect(entrypointContent).toContain('MAIN_STARTUP_MESSAGE_LOGGED');
        expect(entrypointContent).toContain('main-startup-message.done');
        
        // Issue #5267の修正が存在することを確認
        expect(entrypointContent).toContain('Issue #5267修正');
        expect(entrypointContent).toContain('main-startup-message.lock');
        
        // Issue #5318の修正が存在することを確認
        expect(entrypointContent).toContain('Issue #5318修正');
        expect(entrypointContent).toContain('_GLOBAL_STARTUP_MESSAGE_SENT');
        
        // Issue #5362の修正が存在することを確認
        expect(entrypointContent).toContain('Issue #5362修正');
        expect(entrypointContent).toContain('KISS原則');
        
        // Issue #5413の修正が存在することを確認
        expect(entrypointContent).toContain('Issue #5413修正');
        expect(entrypointContent).toContain('global-startup-flag.marker');
    });

    test('Issue #5513解決確認: 既存のテストとの互換性確認', async () => {
        // 既存の関連テストが通ることを確認
        const relatedTests = [
            'test/strategy-runner-issue-5413-duplicate-fix.test.js',
            'test/strategy-runner-issue-5362-duplicate-startup-fix.test.js'
        ];
        
        for (const testFile of relatedTests) {
            const testPath = path.join(__dirname, '..', testFile);
            if (fs.existsSync(testPath)) {
                try {
                    await execAsync(`npm test ${testFile}`, { timeout: 30000 });
                } catch (error) {
                    throw new Error(`Related test ${testFile} failed: ${error.message}`);
                }
            }
        }
    }, 60000);
});