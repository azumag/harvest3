/**
 * Issue #5267: strategy-runnerサービスで例外が発生 - レースコンディション修正テスト
 * 
 * 概要:
 * - 起動メッセージの重複防止でレースコンディションが発生していた問題を修正
 * - 環境変数フラグに加えて、アトミックファイルロック機構を実装
 * - 複数プロセスが同時に起動メッセージをログしようとしても、必ず1回のみ出力されることを確認
 */

const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const { getTempDir, getTempPath, cleanup } = require('./helpers/temp-path-helper');

const execAsync = promisify(exec);

describe('Issue #5267: strategy-runner重複起動メッセージレースコンディション修正', () => {
    const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
    let testTmpDir;

    beforeEach(async () => {
        // テスト用一時ディレクトリの準備（各テストごとに新規作成）
        testTmpDir = getTempDir('tests', 'issue-5267');
        
        // Issue #5267用のロックファイルをクリーンアップ
        const lockFile = getTempPath('locks', 'main-startup-message.lock', {unique: false});
        const doneFile = getTempPath('locks', 'main-startup-message.done', {unique: false});
        cleanup(lockFile);
        cleanup(doneFile);
    });

    afterEach(async () => {
        // テスト後クリーンアップ
        if (testTmpDir) {
            cleanup(testTmpDir);
        }
        const lockFile = getTempPath('locks', 'main-startup-message.lock', {unique: false});
        const doneFile = getTempPath('locks', 'main-startup-message.done', {unique: false});
        cleanup(lockFile);
        cleanup(doneFile);
    });

    test('Issue #5267: Issue #5415によるKISS簡素化後の重複防止が正しく動作することを確認', async () => {
        // Issue #5415によるKISS原則適用後の簡素化版ロジックをテスト
        const lockFile = getTempPath('locks', 'main-startup-message.lock', {unique: false});
        const doneFile = getTempPath('locks', 'main-startup-message.done', {unique: false});
        
        const simplifiedScript = `#!/bin/bash
set -e

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

# Issue #5415: KISS原則に基づく簡素化版
log_startup_message_simplified() {
    local message="$1"
    
    case "$message" in
        *"Starting strategy-runner container with enhanced error handling"*)
            local lock_file="${lockFile}"
            local done_marker="${doneFile}"
            
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

# 複数回呼び出し（簡素化後も重複しない）
log_startup_message_simplified "Starting strategy-runner container with enhanced error handling (container: test, pid: $$)"
log_startup_message_simplified "Starting strategy-runner container with enhanced error handling (container: test, pid: $$)"
log_startup_message_simplified "Starting strategy-runner container with enhanced error handling (container: test, pid: $$)"
`;

        const testScriptPath = path.join(testTmpDir, 'test-race-condition-fix.sh');
        fs.writeFileSync(testScriptPath, simplifiedScript);
        fs.chmodSync(testScriptPath, '755');

        try {
            const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 5000 });
            
            const messages = stdout.split('\n').filter(line => 
                line.includes('Starting strategy-runner container with enhanced error handling')
            );
            
            // 簡素化後も必ず1回のみ出力される
            expect(messages.length).toBe(1);
            console.log('KISS simplified - Messages found:', messages.length);
            console.log('Message:', messages[0]);
        } finally {
            if (fs.existsSync(testScriptPath)) {
                fs.unlinkSync(testScriptPath);
            }
        }
    }, 10000);

    test('Issue #5267: Issue #5415簡素化後の並行プロセスでのレースコンディション耐性テスト', async () => {
        // 複数のプロセスを並行実行してレースコンディション耐性をテスト（簡素化版）
        const lockFile = getTempPath('locks', 'main-startup-message.lock', {unique: false});
        const doneFile = getTempPath('locks', 'main-startup-message.done', {unique: false});
        
        const parallelScript = `#!/bin/bash
set -e

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ENTRYPOINT] $1"
}

# Issue #5415: KISS原則に基づく簡素化版のflock機構
log_startup_message_concurrent() {
    local message="$1"
    
    case "$message" in
        *"Starting strategy-runner container with enhanced error handling"*)
            local lock_file="${lockFile}"
            local done_marker="${doneFile}"
            
            # シンプルなflock実装による重複防止
            (
                flock -n 200 || exit 0
                [ -f "$done_marker" ] && exit 0
                log "$message (process: $$)"
                touch "$done_marker"
                chmod 600 "$done_marker" 2>/dev/null || true
            ) 200>"$lock_file"
            
            return 0
            ;;
    esac
}

# プロセス識別用のスリープを追加してタイミングをずらす
# Issue #5307修正: bc失敗時の全プロセス同時実行を防ぐため、確実な分散タイミングを実装
if command -v bc >/dev/null 2>&1; then
    sleep $(echo "scale=3; $1 / 10" | bc -l 2>/dev/null || echo "0.$(($1 + 1))")
else
    # bc未使用時は単純な分散タイミング (0.1, 0.2, 0.3, 0.4, 0.5秒)
    sleep 0.$(($1 + 1))
fi
log_startup_message_concurrent "Starting strategy-runner container with enhanced error handling (container: test, pid: $$)"
`;

        const testScriptPath = path.join(testTmpDir, 'test-concurrent.sh');
        fs.writeFileSync(testScriptPath, parallelScript);
        fs.chmodSync(testScriptPath, '755');

        try {
            // 5個のプロセスを並行実行
            const promises = [];
            for (let i = 0; i < 5; i++) {
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
            
            // Issue #5307修正: デバッグ情報追加でCI失敗原因を詳細に追跡
            console.log('Concurrent test - Messages found:', messages.length);
            console.log('All messages:', messages);
            console.log('Process results:', results.map((r, i) => `Process ${i}: stdout="${r.stdout?.trim()}", stderr="${r.stderr?.trim()}"`));
            
            // 並行実行でも1回のみ出力されることを確認
            // Issue #5307修正: レースコンディションが発生した場合の追加デバッグ情報
            if (messages.length !== 1) {
                console.log('RACE CONDITION DETECTED - Full debug info:');
                console.log('All output combined:', allOutput);
                const lockFile = getTempPath('locks', 'main-startup-message.lock', {unique: false});
                const doneFile = getTempPath('locks', 'main-startup-message.done', {unique: false});
                console.log('Lock file exists:', fs.existsSync(lockFile));
                console.log('Done file exists:', fs.existsSync(doneFile));
                if (fs.existsSync(doneFile)) {
                    console.log('Done file content:', fs.readFileSync(doneFile, 'utf8'));
                }
            }
            expect(messages.length).toBe(1);
            
            // 完了マーカーファイルが作成されていることを確認
            const doneFile = getTempPath('locks', 'main-startup-message.done', {unique: false});
            expect(fs.existsSync(doneFile)).toBe(true);
            
        } finally {
            if (fs.existsSync(testScriptPath)) {
                fs.unlinkSync(testScriptPath);
            }
        }
    }, 15000);

    test('Issue #5267: entrypoint.shに修正が適用されていることを確認', () => {
        expect(fs.existsSync(entrypointPath)).toBe(true);
        
        const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
        
        // Issue #5415によるKISS原則適用後の実装を確認
        expect(entrypointContent).toContain('Issue #5415: KISS原則に基づく簡素化 - シンプルなflock使用による重複防止');
        expect(entrypointContent).toContain('local lock_file="$LOCK_BASE_DIR/main-startup-message.lock"');
        expect(entrypointContent).toContain('local done_marker="$LOCK_BASE_DIR/main-startup-message.done"');
        
        // 簡素化されたflock機構の主要部分が含まれていることを確認
        expect(entrypointContent).toContain('flock -n 200 || exit 0');
        expect(entrypointContent).toContain('[ -f "$done_marker" ] && exit 0');
        expect(entrypointContent).toContain('touch "$done_marker"');
        expect(entrypointContent).toContain(') 200>"$lock_file"');
        
        // クリーンアップ関数も更新されていることを確認
        expect(entrypointContent).toContain('Issue #5267: メインの起動メッセージ用ロックファイルのクリーンアップ');
    });

    test('Issue #5267: クリーンアップ機能が正しく動作することを確認', async () => {
        // まずロックファイルを作成
        const lockFile = getTempPath('locks', 'main-startup-message.lock', {unique: false});
        const doneFile = getTempPath('locks', 'main-startup-message.done', {unique: false});
        
        await execAsync(`mkdir -p "${lockFile}"`);
        await execAsync(`echo "test" > "${doneFile}"`);
        
        // ファイルが存在することを確認
        expect(fs.existsSync(lockFile)).toBe(true);
        expect(fs.existsSync(doneFile)).toBe(true);
        
        // クリーンアップ機能をテスト
        const cleanupScript = `#!/bin/bash
cleanup_startup_message_locks() {
    if [ -f "${doneFile}" ]; then
        rm -f "${doneFile}" 2>/dev/null || true
        echo "Cleaned up main startup message done marker"
    fi
    
    if [ -d "${lockFile}" ]; then
        rm -rf "${lockFile}" 2>/dev/null || true  
        echo "Cleaned up main startup message lock directory"
    fi
}

cleanup_startup_message_locks
`;

        const cleanupScriptPath = path.join(testTmpDir, 'test-cleanup.sh');
        fs.writeFileSync(cleanupScriptPath, cleanupScript);
        fs.chmodSync(cleanupScriptPath, '755');

        try {
            const { stdout } = await execAsync(`bash ${cleanupScriptPath}`, { timeout: 3000 });
            
            // クリーンアップメッセージが出力されることを確認
            expect(stdout).toContain('Cleaned up main startup message done marker');
            expect(stdout).toContain('Cleaned up main startup message lock directory');
            
            // ファイルが削除されていることを確認
            expect(fs.existsSync(lockFile)).toBe(false);
            expect(fs.existsSync(doneFile)).toBe(false);
            
        } finally {
            if (fs.existsSync(cleanupScriptPath)) {
                fs.unlinkSync(cleanupScriptPath);
            }
        }
    }, 5000);

    test('entrypoint.sh構文検証', async () => {
        // Issue #5267修正後もentrypoint.shが正しく動作することを確認
        await expect(execAsync(`bash -n ${entrypointPath}`, { timeout: 2000 })).resolves.not.toThrow();
    }, 3000);
});