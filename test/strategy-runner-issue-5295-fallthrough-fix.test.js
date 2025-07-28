/**
 * Issue #5295: strategy-runnerサービスで例外が発生 - fallthrough修正テスト
 * 
 * 概要:
 * - log_startup_message関数でアトミックロック処理後にfallthroughが発生し、重複ログが出力される問題を修正
 * - 明示的なフラグチェックと緊急停止機構を追加してfallthrough防止を確実にする
 * - 同一プロセス内での重複ログを完全に防止することを確認
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const { getTempDir, getTempPath, cleanup } = require('./helpers/temp-path-helper');
const { 
    createStartupMessageTestScript, 
    runDuplicatePreventionTest,
    testEnvironment,
    behaviorValidation 
} = require('./helpers/startup-message-test-helper');

const execAsync = promisify(exec);

describe('Issue #5295: strategy-runner重複ログfallthrough修正', () => {
    const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
    let testTmpDir;

    beforeEach(async () => {
        // テスト用一時ディレクトリの準備（各テストごとに新規作成）
        testTmpDir = getTempDir('tests', 'issue-5295');
        
        // 共通ヘルパーを使用してテスト環境をセットアップ
        await testEnvironment.setup(testTmpDir);
    });

    afterEach(async () => {
        // 共通ヘルパーを使用してテスト環境をクリーンアップ
        await testEnvironment.cleanup(testTmpDir);
    });

    test('Issue #5295: fallthrough防止機構が正しく動作することを確認', async () => {
        // Issue #5295修正: 共通ヘルパーを使用してfallthrough防止テスト
        const testResult = await runDuplicatePreventionTest({
            testName: 'issue-5295-fallthrough-fix',
            testTmpDir,
            testMessage: "Starting strategy-runner container with enhanced error handling (container: test, pid: $$)",
            callCount: 3,
            expectedOutputCount: 1,
            scriptOptions: {
                enableProcessInternal: true,
                enableFilelock: true
            }
        });

        // 動作検証（実装詳細ではなく）
        behaviorValidation.validateDuplicatePrevention(testResult, 1);
        
        console.log('Fallthrough fix - Messages found:', testResult.messageCount);
        console.log('Message:', testResult.messages[0]);
        
        // fallthroughが発生しないことを確認（追加検証）
        expect(testResult.stdout).not.toContain('FALLTHROUGH');
    }, 10000);

    test('Issue #5295: 修正が実際のentrypoint.shに適用されていることを確認', () => {
        expect(fs.existsSync(entrypointPath)).toBe(true);
        
        const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
        
        // Issue #5362のKISS原則実装が適用されていることを確認（PR #5529の簡素化後）
        expect(entrypointContent).toContain('Issue #5362: KISS原則に基づく重複防止機構（簡素化・確実性の向上）');
        expect(entrypointContent).toContain('_STARTUP_MESSAGE_LOGGED');
        expect(entrypointContent).toContain('_STARTUP_MESSAGE_LOGGED=1');
        expect(entrypointContent).toContain('export _STARTUP_MESSAGE_LOGGED');
        expect(entrypointContent).toContain('flockベースの確実なファイルロック');
        expect(entrypointContent).toContain('flock -w 5 200');
        
        console.log('Issue #5295 fix found in entrypoint.sh');
    });

    test('Issue #5295: 同一プロセス内での複数回呼び出し重複防止テスト', async () => {
        // Issue #5295修正: 共通ヘルパーを使用して実際のentrypoint.sh相当のテスト
        const testResult = await runDuplicatePreventionTest({
            testName: 'issue-5295-real-world',
            testTmpDir,
            testMessage: "Starting strategy-runner container with enhanced error handling (container: test, pid: $$)",
            callCount: 3,
            expectedOutputCount: 1,
            scriptOptions: {
                enableProcessInternal: true,
                enableFilelock: true,
                customLogic: `
# テスト用の追加処理
echo "=== Testing Issue #5295 fix ==="
sleep 0.1  # 処理時間をシミュレート
echo "=== Test completed ==="
`
            }
        });

        // 動作検証（実装詳細ではなく）
        behaviorValidation.validateDuplicatePrevention(testResult, 1);
        
        console.log('Real world test - Messages found:', testResult.messageCount);
        console.log('Message:', testResult.messages[0]);
    }, 12000);

    test('entrypoint.sh構文検証', async () => {
        // Issue #5295修正後もentrypoint.shが正しく動作することを確認
        await expect(execAsync(`bash -n ${entrypointPath}`, { timeout: 2000 })).resolves.not.toThrow();
    }, 3000);
});