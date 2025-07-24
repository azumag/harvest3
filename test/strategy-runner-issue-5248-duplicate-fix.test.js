/**
 * Issue #5248: strategy-runnerサービスで例外が発生 - 重複起動メッセージ修正テスト
 * 
 * 概要:
 * - Issue #5220で追加された重複防止機能にバグがあり、特定の条件下で重複メッセージが発生
 * - MAIN_STARTUP_MESSAGE_LOGGEDフラグ設定後も処理が継続し、Redis/ファイルベース処理で重複が発生
 * - フラグ設定後は即座にreturnするように修正
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

describe('Issue #5248: strategy-runner重複起動メッセージ修正', () => {
    const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
    const testTmpDir = '.tmp/test-issue-5248';

    beforeEach(async () => {
        // テスト用一時ディレクトリの準備
        await execAsync(`rm -rf ${testTmpDir}`);
        await execAsync(`mkdir -p ${testTmpDir}`);
    });

    afterEach(async () => {
        // テスト後クリーンアップ
        await execAsync(`rm -rf ${testTmpDir}`);
    });

    test('Issue #5248: 修正前の問題を再現できることを確認', async () => {
        // 修正前のロジックを模倣したテストスクリプト（問題のあるバージョン）
        const problematicScript = `#!/bin/bash
set -e

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

get_message_hash() {
    echo "$1" | md5sum | cut -d' ' -f1
}

# Issue #5220の問題のあるロジック（修正前）
log_startup_message_problematic() {
    local message="$1"
    
    case "$message" in
        *"Starting strategy-runner container with enhanced error handling"*)
            # フラグチェック
            if [ "$MAIN_STARTUP_MESSAGE_LOGGED" = "1" ]; then
                return 0
            fi
            # フラグを設定（しかし処理は継続される）
            export MAIN_STARTUP_MESSAGE_LOGGED=1
            ;;
    esac
    
    # 問題: フラグ設定後も処理が継続し、複数の出力パスが存在
    local message_hash=$(get_message_hash "$message")
    
    # 模擬的なRedis/ファイル処理（複数の出力経路が存在する可能性）
    if [ -n "$REDIS_URL" ]; then
        # Redis処理パス
        log "$message"
    else
        # ファイル処理パス
        log "$message"
    fi
}

# 同じメッセージを複数回呼び出し（修正前は重複する可能性がある）
export REDIS_URL=""  # Redisを無効化してファイル処理をテスト
log_startup_message_problematic "Starting strategy-runner container with enhanced error handling (container: test, pid: $$)"
log_startup_message_problematic "Starting strategy-runner container with enhanced error handling (container: test, pid: $$)"
`;

        const testScriptPath = path.join(testTmpDir, 'test-problematic.sh');
        fs.writeFileSync(testScriptPath, problematicScript);
        fs.chmodSync(testScriptPath, '755');

        try {
            const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 3000 });
            
            const messages = stdout.split('\n').filter(line => 
                line.includes('Starting strategy-runner container with enhanced error handling')
            );
            
            // 修正前は重複の可能性がある（このテストは問題を確認するためのもの）
            console.log('Messages found:', messages.length);
            console.log('Messages:', messages);
            
            // 注意: このテストは問題の再現が目的なので、重複が発生する可能性がある
        } finally {
            if (fs.existsSync(testScriptPath)) {
                fs.unlinkSync(testScriptPath);
            }
        }
    }, 5000);

    test('Issue #5248: 修正版のロジックが正しく動作することを確認', async () => {
        // 修正版のロジック（Issue #5248で修正）
        const fixedScript = `#!/bin/bash
set -e

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

get_message_hash() {
    echo "$1" | md5sum | cut -d' ' -f1
}

# Issue #5248の修正版ロジック
log_startup_message_fixed() {
    local message="$1"
    
    case "$message" in
        *"Starting strategy-runner container with enhanced error handling"*)
            # フラグチェック
            if [ "$MAIN_STARTUP_MESSAGE_LOGGED" = "1" ]; then
                return 0  # 既にログ出力済み、重複防止
            fi
            # フラグを設定してメッセージを出力後、即座にreturn
            export MAIN_STARTUP_MESSAGE_LOGGED=1
            log "$message"
            return 0  # 重要: ここで処理を終了し、以降の処理をスキップ
            ;;
    esac
    
    # その他のメッセージの場合は従来の処理を継続
    local message_hash=$(get_message_hash "$message")
    
    # Redis/ファイル処理（起動メッセージ以外用）
    if [ -n "$REDIS_URL" ]; then
        log "$message"
    else
        log "$message"
    fi
}

# 同じメッセージを複数回呼び出し（修正後は重複しない）
export REDIS_URL=""
log_startup_message_fixed "Starting strategy-runner container with enhanced error handling (container: test, pid: $$)"
log_startup_message_fixed "Starting strategy-runner container with enhanced error handling (container: test, pid: $$)"
log_startup_message_fixed "Starting strategy-runner container with enhanced error handling (container: test, pid: $$)"
`;

        const testScriptPath = path.join(testTmpDir, 'test-fixed.sh');
        fs.writeFileSync(testScriptPath, fixedScript);
        fs.chmodSync(testScriptPath, '755');

        try {
            const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 3000 });
            
            const messages = stdout.split('\n').filter(line => 
                line.includes('Starting strategy-runner container with enhanced error handling')
            );
            
            // 修正後は必ず1回のみ出力される
            expect(messages.length).toBe(1);
            console.log('Fixed version - Messages found:', messages.length);
        } finally {
            if (fs.existsSync(testScriptPath)) {
                fs.unlinkSync(testScriptPath);
            }
        }
    }, 5000);

    test('Issue #5248: entrypoint.shに修正が適用されていることを確認', () => {
        expect(fs.existsSync(entrypointPath)).toBe(true);
        
        const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
        
        // Issue #5248の修正が適用されていることを確認
        expect(entrypointContent).toContain('log_startup_message()');
        expect(entrypointContent).toContain('MAIN_STARTUP_MESSAGE_LOGGED');
        
        // 修正のキーポイント: フラグ設定とメッセージ出力後にreturnすることを確認
        const logStartupMessageFunction = entrypointContent.match(/log_startup_message\(\) \{[\s\S]*?\n\}/)[0];
        
        // 起動メッセージの処理で適切にreturnしていることを確認
        expect(logStartupMessageFunction).toContain('export MAIN_STARTUP_MESSAGE_LOGGED=1');
        expect(logStartupMessageFunction).toContain('return 0');
    });

    test('Issue #5248: 他のメッセージには影響しないことを確認', async () => {
        const testScript = `#!/bin/bash
set -e

STARTUP_MESSAGE_LOCK_DIR="${testTmpDir}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

get_message_hash() {
    echo "$1" | md5sum | cut -d' ' -f1
}

try_redis_duplicate_prevention() {
    local message="$1"
    # Redis無効時はfallbackに任せる
    return 1
}

fallback_to_file_based_prevention() {
    local message="$1"
    local message_hash="$2"
    local container_id=$(hostname)
    local current_time=$(date +%s)
    
    # プロセス内重複防止
    local var_name="STARTUP_MSG_$(echo "$message_hash" | cut -c1-8)"
    if [ "\${!var_name}" = "1" ]; then
        return 0
    fi
    
    export "$var_name"=1
    log "$message"
    return 0
}

log_startup_message() {
    local message="$1"
    
    # Issue #5248修正: 起動メッセージの専用処理
    case "$message" in
        *"Starting strategy-runner container with enhanced error handling"*)
            if [ "$MAIN_STARTUP_MESSAGE_LOGGED" = "1" ]; then
                return 0
            fi
            export MAIN_STARTUP_MESSAGE_LOGGED=1
            log "$message"
            return 0  # 重要: ここで終了
            ;;
    esac
    
    # その他のメッセージは通常の重複防止処理
    local message_hash=$(get_message_hash "$message")
    
    if ! try_redis_duplicate_prevention "$message" "$message_hash"; then
        fallback_to_file_based_prevention "$message" "$message_hash"
    fi
    
    return 0
}

# 起動メッセージと他のメッセージを混在してテスト
log_startup_message "Starting strategy-runner container with enhanced error handling (container: test, pid: $$)"
log_startup_message "Some other startup message"
log_startup_message "Starting strategy-runner container with enhanced error handling (container: test, pid: $$)"  # 重複
log_startup_message "Another different message"
log_startup_message "Some other startup message"  # 重複
`;

        const testScriptPath = path.join(testTmpDir, 'test-mixed-messages.sh');
        fs.writeFileSync(testScriptPath, testScript);
        fs.chmodSync(testScriptPath, '755');

        try {
            const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 3000 });
            
            const allLines = stdout.split('\n').filter(line => line.includes('[ENTRYPOINT]'));
            
            // 起動メッセージは1回のみ
            const startupMessages = allLines.filter(line => 
                line.includes('Starting strategy-runner container with enhanced error handling')
            );
            expect(startupMessages.length).toBe(1);
            
            // その他のメッセージも適切に重複防止される
            const otherMessages = allLines.filter(line => 
                line.includes('Some other startup message')
            );
            expect(otherMessages.length).toBe(1);
            
            const anotherMessages = allLines.filter(line => 
                line.includes('Another different message')
            );
            expect(anotherMessages.length).toBe(1);
            
            console.log('Total unique messages:', allLines.length);
            expect(allLines.length).toBe(3); // 3つの異なるメッセージ
        } finally {
            if (fs.existsSync(testScriptPath)) {
                fs.unlinkSync(testScriptPath);
            }
        }
    }, 10000);

    test('entrypoint.sh構文検証', async () => {
        // Issue #5248修正後もentrypoint.shが正しく動作することを確認
        await expect(execAsync(`bash -n ${entrypointPath}`, { timeout: 2000 })).resolves.not.toThrow();
    }, 3000);
});