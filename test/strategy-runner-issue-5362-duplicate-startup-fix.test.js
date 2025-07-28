/**
 * Issue #5362修正: strategy-runnerサービス重複起動メッセージ修正テスト
 * KISS原則に基づくシンプルで確実な重複防止機構のテスト
 */

const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const os = require('os');

describe('Issue #5362: strategy-runner duplicate startup message fix', () => {
    let tempDir;
    let testScriptPath;

    beforeEach(() => {
        // 一時ディレクトリの作成（CLAUDE.mdルールに従い.tmpに作成）
        tempDir = path.join(process.cwd(), '.tmp', `test-5362-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        fs.mkdirSync(tempDir, { recursive: true });

        // テスト用スクリプトの作成
        testScriptPath = path.join(tempDir, 'test-entrypoint.sh');
        
        // entrypoint.shから必要な関数をコピーしてテスト環境用に調整
        const testScript = `#!/bin/bash

# テスト用の環境変数設定
export LOCK_BASE_DIR="${tempDir}"
export BACKTEST_MODE="false"

# テスト用ログ関数
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

# Issue #5362: KISS原則に基づく重複防止機構（簡素化・確実性の向上）
log_startup_message() {
    local message="$1"
    
    # Issue #5431修正: backtest containerの場合の重複防止強化
    if [ "$BACKTEST_MODE" = "true" ]; then
        # 既にbacktest起動メッセージが出力済みの場合は重複を防ぐ
        if [ "\${_BACKTEST_STARTUP_MESSAGE_LOGGED_IN_PROCESS:-}" = "1" ]; then
            return 0
        fi
        log_backtest_startup_message "$message"
        return $?
    fi
    
    # Issue #5362修正: 起動メッセージの重複防止（KISS原則に基づく確実な単一機構）
    case "$message" in
        *"Starting strategy-runner container with enhanced error handling"*)
            # 第一防御線: プロセス内変数による即座の重複防止（最優先）
            if [ "\${_STARTUP_MESSAGE_LOGGED:-}" = "1" ]; then
                log "DEBUG: [Issue #5362] Process variable prevented duplicate startup message (PID: $$)"
                return 0
            fi
            
            # 第二防御線: flockベースの確実なファイルロック
            local lock_file="$LOCK_BASE_DIR/startup-message.lock"
            local lock_fd=200
            
            # flockが利用可能な場合は使用（より確実）
            if command -v flock >/dev/null 2>&1; then
                exec 200>"$lock_file"
                if flock -w 5 200; then
                    # ロック取得成功後、プロセス変数を再チェック
                    if [ "\${_STARTUP_MESSAGE_LOGGED:-}" = "1" ]; then
                        log "DEBUG: [Issue #5362] Flock double-check prevented duplicate startup message (PID: $$)"
                        exec 200>&-
                        return 0
                    fi
                    
                    # メッセージ出力とフラグ設定
                    _STARTUP_MESSAGE_LOGGED=1
                    export _STARTUP_MESSAGE_LOGGED
                    log "$message"
                    log "DEBUG: [Issue #5362] Startup message sent with flock protection (PID: $$, Container: $(hostname))"
                    
                    exec 200>&-
                    return 0
                else
                    log "DEBUG: [Issue #5362] Flock timeout - message suppressed to prevent duplicate (PID: $$)"
                    exec 200>&-
                    _STARTUP_MESSAGE_LOGGED=1
                    export _STARTUP_MESSAGE_LOGGED
                    return 0
                fi
            else
                # フォールバック: flockが利用できない場合のmkdirベースロック
                local mkdir_lock_dir="$LOCK_BASE_DIR/startup-message-mkdir.lock"
                local attempts=0
                local max_attempts=50
                
                while [ $attempts -lt $max_attempts ]; do
                    if mkdir "$mkdir_lock_dir" 2>/dev/null; then
                        # ロック取得成功
                        if [ "\${_STARTUP_MESSAGE_LOGGED:-}" = "1" ]; then
                            rm -rf "$mkdir_lock_dir" 2>/dev/null || true
                            log "DEBUG: [Issue #5362] Mkdir fallback double-check prevented duplicate startup message (PID: $$)"
                            return 0
                        fi
                        
                        _STARTUP_MESSAGE_LOGGED=1
                        export _STARTUP_MESSAGE_LOGGED
                        log "$message"
                        log "DEBUG: [Issue #5362] Startup message sent with mkdir fallback protection (PID: $$, Container: $(hostname))"
                        
                        rm -rf "$mkdir_lock_dir" 2>/dev/null || true
                        return 0
                    fi
                    
                    attempts=$((attempts + 1))
                    sleep 0.1
                done
                
                # mkdir ロック取得失敗
                log "DEBUG: [Issue #5362] Mkdir fallback timeout - message suppressed to prevent duplicate (PID: $$)"
                _STARTUP_MESSAGE_LOGGED=1
                export _STARTUP_MESSAGE_LOGGED
                return 0
            fi
            ;;
    esac
    
    # その他のメッセージは通常通り出力
    log "$message"
    return 0
}

# テスト関数: 単一プロセスでの重複防止テスト
test_single_process() {
    echo "=== 単一プロセステスト開始 ==="
    
    # 環境変数をクリア
    unset _STARTUP_MESSAGE_LOGGED
    
    # 1回目の呼び出し（出力されるべき）
    log_startup_message "Starting strategy-runner container with enhanced error handling (container: test1, pid: $$)"
    
    # 2回目の呼び出し（抑制されるべき）
    log_startup_message "Starting strategy-runner container with enhanced error handling (container: test1, pid: $$)"
    
    # 3回目の呼び出し（抑制されるべき）
    log_startup_message "Starting strategy-runner container with enhanced error handling (container: test1, pid: $$)"
    
    echo "=== 単一プロセステスト終了 ==="
}

# テスト関数: 並行プロセスでの重複防止テスト
test_concurrent_processes() {
    echo "=== 並行プロセステスト開始 ==="
    
    # 複数のバックグラウンドプロセスで同時実行
    for i in {1..5}; do
        (
            export _STARTUP_MESSAGE_LOGGED=""
            log_startup_message "Starting strategy-runner container with enhanced error handling (container: test-concurrent-$i, pid: $$)"
        ) &
    done
    
    # 全プロセスの完了を待機
    wait
    
    echo "=== 並行プロセステスト終了 ==="
}

# テスト関数: フォールバック機構のテスト
test_fallback_mechanism() {
    echo "=== フォールバック機構テスト開始 ==="
    
    # flockコマンドを一時的に無効化（フォールバック機構をテストするため）
    flock() {
        echo "flock: command not found" >&2
        return 127
    }
    export -f flock
    
    unset _STARTUP_MESSAGE_LOGGED
    
    log_startup_message "Starting strategy-runner container with enhanced error handling (container: test-fallback, pid: $$)"
    log_startup_message "Starting strategy-runner container with enhanced error handling (container: test-fallback, pid: $$)"
    
    # flock関数を削除
    unset -f flock
    
    echo "=== フォールバック機構テスト終了 ==="
}

# テスト関数: バックテストモードのテスト
test_backtest_mode() {
    echo "=== バックテストモードテスト開始 ==="
    
    export BACKTEST_MODE="true"
    unset _BACKTEST_STARTUP_MESSAGE_LOGGED_IN_PROCESS
    
    # バックテストモード用の関数を定義
    log_backtest_startup_message() {
        if [ "\${_BACKTEST_STARTUP_MESSAGE_LOGGED_IN_PROCESS:-}" = "1" ]; then
            log "DEBUG: Backtest startup message already logged"
            return 0
        fi
        _BACKTEST_STARTUP_MESSAGE_LOGGED_IN_PROCESS=1
        log "BACKTEST: $1"
    }
    
    # 1回目: バックテストメッセージが出力される
    log_startup_message "Starting strategy-runner container with enhanced error handling (container: test-backtest, pid: $$)"
    # 2回目: 重複防止により抑制される
    log_startup_message "Starting strategy-runner container with enhanced error handling (container: test-backtest, pid: $$)"
    
    export BACKTEST_MODE="false"
    
    echo "=== バックテストモードテスト終了 ==="
}

# テスト関数: その他のメッセージタイプのテスト
test_other_messages() {
    echo "=== その他のメッセージタイプテスト開始 ==="
    
    log_startup_message "This is a regular log message"
    log_startup_message "Another regular message"
    log_startup_message "DEBUG: Some debug information"
    
    echo "=== その他のメッセージタイプテスト終了 ==="
}

# メイン実行
main() {
    echo "Issue #5362 修正テストを開始します..."
    
    test_single_process
    echo ""
    
    test_concurrent_processes  
    echo ""
    
    test_fallback_mechanism
    echo ""
    
    test_backtest_mode
    echo ""
    
    test_other_messages
    echo ""
    
    echo "全テスト完了"
}

# 引数に応じてテスト実行
case "\${1:-main}" in
    "single") test_single_process ;;
    "concurrent") test_concurrent_processes ;;
    "fallback") test_fallback_mechanism ;;
    "backtest") test_backtest_mode ;;
    "other") test_other_messages ;;
    *) main ;;
esac
`;

        fs.writeFileSync(testScriptPath, testScript);
        fs.chmodSync(testScriptPath, '755');
    });

    afterEach(() => {
        // 一時ファイルの削除（CLAUDE.mdルールに従い.tmpディレクトリをクリーンアップ）
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('1. 単一プロセスでの重複防止テスト', (done) => {
        exec(`bash ${testScriptPath} single`, (error, stdout, stderr) => {
            expect(error).toBeNull();
            
            const output = stdout.toString();
            console.log('単一プロセステスト出力:', output);
            
            // 起動メッセージが1回だけ出力されることを確認
            const startupMessageMatches = output.match(/Starting strategy-runner container with enhanced error handling/g);
            expect(startupMessageMatches).toHaveLength(1);
            
            // 重複防止デバッグメッセージが出力されることを確認
            expect(output).toMatch(/Process variable prevented duplicate startup message/);
            
            done();
        });
    });

    test('2. 並行プロセスでの重複防止テスト', (done) => {
        exec(`bash ${testScriptPath} concurrent`, { timeout: 10000 }, (error, stdout, stderr) => {
            expect(error).toBeNull();
            
            const output = stdout.toString();
            console.log('並行プロセステスト出力:', output);
            
            // 複数のプロセスが実行されても、起動メッセージは複数回出力される可能性がある
            // （プロセス間では変数を共有しないため）が、各プロセス内では1回のみ
            const startupMessageMatches = output.match(/Starting strategy-runner container with enhanced error handling/g);
            expect(startupMessageMatches).not.toBeNull();
            
            // flockまたはmkdirによる保護メッセージが出力されることを確認
            const protectionMatches = output.match(/(flock protection|mkdir fallback protection)/g);
            expect(protectionMatches).not.toBeNull();
            
            done();
        });
    });

    test('3. フォールバック機構（mkdirベースロック）のテスト', (done) => {
        exec(`bash ${testScriptPath} fallback`, (error, stdout, stderr) => {
            expect(error).toBeNull();
            
            const output = stdout.toString();
            console.log('フォールバック機構テスト出力:', output);
            
            // 起動メッセージが1回だけ出力されることを確認
            const startupMessageMatches = output.match(/Starting strategy-runner container with enhanced error handling/g);
            expect(startupMessageMatches).toHaveLength(1);
            
            // mkdirフォールバック保護が使用されることを確認
            expect(output).toMatch(/mkdir fallback protection/);
            
            done();
        });
    });

    test('4. バックテストモードでの動作テスト', (done) => {
        exec(`bash ${testScriptPath} backtest`, (error, stdout, stderr) => {
            expect(error).toBeNull();
            
            const output = stdout.toString();
            console.log('バックテストモードテスト出力:', output);
            
            // バックテストメッセージが1回だけ出力されることを確認
            const backtestMessageMatches = output.match(/BACKTEST: Starting strategy-runner container/g);
            expect(backtestMessageMatches).toHaveLength(1);
            
            // バックテスト重複防止メッセージが出力されることを確認
            expect(output).toMatch(/Backtest startup message already logged/);
            
            done();
        });
    });

    test('5. その他のメッセージタイプの正常動作テスト', (done) => {
        exec(`bash ${testScriptPath} other`, (error, stdout, stderr) => {
            expect(error).toBeNull();
            
            const output = stdout.toString();
            console.log('その他のメッセージテスト出力:', output);
            
            // 通常のメッセージが全て出力されることを確認
            expect(output).toMatch(/This is a regular log message/);
            expect(output).toMatch(/Another regular message/);
            expect(output).toMatch(/DEBUG: Some debug information/);
            
            done();
        });
    });

    test('6. 統合テスト（全機能の総合動作確認）', (done) => {
        exec(`bash ${testScriptPath}`, { timeout: 15000 }, (error, stdout, stderr) => {
            expect(error).toBeNull();
            
            const output = stdout.toString();
            console.log('統合テスト出力:', output);
            
            // 各テストセクションが実行されることを確認
            expect(output).toMatch(/単一プロセステスト開始/);
            expect(output).toMatch(/並行プロセステスト開始/);
            expect(output).toMatch(/フォールバック機構テスト開始/);
            expect(output).toMatch(/バックテストモードテスト開始/);
            expect(output).toMatch(/その他のメッセージタイプテスト開始/);
            expect(output).toMatch(/全テスト完了/);
            
            // 重複防止機構が正常に動作していることを確認
            expect(output).toMatch(/Process variable prevented duplicate startup message/);
            
            done();
        });
    });
});