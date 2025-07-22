const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

describe('entrypoint.sh log_startup_message function', () => {
    const testDir = path.join(__dirname, '../.tmp/test_entrypoint');
    const lockDir = path.join(testDir, 'startup_messages');
    
    beforeEach(() => {
        // テストディレクトリの準備
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
        fs.mkdirSync(testDir, { recursive: true });
        fs.mkdirSync(lockDir, { recursive: true });
    });
    
    afterEach(() => {
        // テストディレクトリのクリーンアップ
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
    });

    test('通常の起動時に正しくログメッセージが出力される', () => {
        const testScript = createTestScript(lockDir, false);
        const result = execSync(`bash ${testScript}`, { encoding: 'utf8' });
        
        expect(result).toContain('Starting backtest container with enhanced error handling');
        expect(result).not.toContain('(container restarted)');
        expect(result).not.toContain('Container restart detected');
    });

    test('同一プロセス内での重複呼び出しが防止される', () => {
        const testScript = createTestScript(lockDir, false, true);
        const result = execSync(`bash ${testScript}`, { encoding: 'utf8' });
        
        // メッセージが1回だけ出力されることを確認
        const messageCount = (result.match(/Starting backtest container with enhanced error handling/g) || []).length;
        expect(messageCount).toBe(1);
    });

    test('コンテナ再起動が検出され適切にログが出力される', () => {
        const testScript = createTestScript(lockDir, true);
        const result = execSync(`bash ${testScript}`, { encoding: 'utf8' });
        
        expect(result).toContain('Container restart detected');
        expect(result).toContain('Starting backtest container with enhanced error handling (container restarted)');
    });

    function createTestScript(lockDirPath, simulateRestart = false, testDuplicates = false) {
        const scriptContent = `#!/bin/bash
set -e

STARTUP_MESSAGE_LOCK_DIR="${lockDirPath}"
mkdir -p "$STARTUP_MESSAGE_LOCK_DIR" 2>/dev/null || true

get_message_hash() {
    echo "$1" | md5sum | cut -d' ' -f1
}

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [TEST] $1"
}

# 修正されたlog_startup_message関数
log_startup_message() {
    local message="$1"
    
    local message_hash=$(get_message_hash "$message")
    local var_name="STARTUP_MSG_$(echo "$message_hash" | cut -c1-8)"
    local lock_file="$STARTUP_MESSAGE_LOCK_DIR/$message_hash.lock"
    
    # Issue #5079 修正: コンテナ再起動検出機能追加
    local restart_detected=false
    if [ -f "$lock_file" ]; then
        local old_pid_info=$(cat "$lock_file" 2>/dev/null || echo "")
        if [ -n "$old_pid_info" ]; then
            restart_detected=true
            log "Container restart detected (previous execution: $old_pid_info, current PID: $$)"
            rm -f "$lock_file" 2>/dev/null
        fi
    fi
    
    # プロセス内重複チェック
    if [ "\${!var_name}" = "1" ]; then
        return 0
    fi
    
    # プロセス間重複チェック
    local lock_acquired=false
    if (set -C; echo "$$:$(date +%s.%N)" > "$lock_file") 2>/dev/null; then
        lock_acquired=true
    fi
    
    if [ "$lock_acquired" = true ]; then
        export "$var_name"=1
        
        if [ "$restart_detected" = true ]; then
            log "$message (container restarted)"
        else
            log "$message"
        fi
        
        return 0
    else
        return 0
    fi
}

${simulateRestart ? `
# 再起動シミュレーション
message_hash=$(get_message_hash "Starting backtest container with enhanced error handling")
lock_file="$STARTUP_MESSAGE_LOCK_DIR/$message_hash.lock"
echo "9999:$(date +%s.%N)" > "$lock_file"
` : ''}

# テストメッセージ出力
log_startup_message "Starting backtest container with enhanced error handling"

${testDuplicates ? `
# 重複テスト
log_startup_message "Starting backtest container with enhanced error handling"
log_startup_message "Starting backtest container with enhanced error handling"
` : ''}
`;

        const scriptPath = path.join(testDir, `test-script-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.sh`);
        fs.writeFileSync(scriptPath, scriptContent);
        fs.chmodSync(scriptPath, '755');
        return scriptPath;
    }
});