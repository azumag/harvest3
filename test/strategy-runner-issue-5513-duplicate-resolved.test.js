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

// DRY原則適用: 既存のヘルパーを使用
const {
    runDuplicatePreventionTest,
    testEnvironment,
    behaviorValidation
} = require('./helpers/startup-message-test-helper');
const { getTempPath, cleanup } = require('./helpers/temp-path-helper');

describe('Issue #5513: strategy-runnerサービス重複メッセージ解決確認', () => {
    const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
    const tmpDir = path.join(__dirname, '..', '.tmp');

    beforeAll(() => {
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }
    });

    test('Issue #5513解決確認: 既存の多層防御機構により重複が防がれることを確認', async () => {
        // KISS原則適用: 単純で明確なテスト構造
        const testTmpDir = getTempPath('tests', 'issue-5513-test', { unique: true });
        
        await testEnvironment.setup(testTmpDir);
        
        try {
            // DRY原則適用: 共通ヘルパーを使用し、Issue #5513の具体的シナリオをテスト
            const testResult = await runDuplicatePreventionTest({
                testName: 'issue-5513-duplicate-resolution',
                testTmpDir,
                testMessage: 'Starting strategy-runner container with enhanced error handling (container: test-container, pid: $$)',
                callCount: 4, // Issue #5513で想定される複数回呼び出しシナリオ
                expectedOutputCount: 1, // 重複が防がれ、1回のみ出力されることを期待
                scriptOptions: {
                    enableProcessInternal: true,
                    enableFilelock: true
                }
            });
            
            // 動作に焦点を当てた検証（実装詳細に依存しない）
            behaviorValidation.validateDuplicatePrevention(testResult, 1);
            
        } finally {
            await testEnvironment.cleanup(testTmpDir);
        }
    }, 10000); // セキュリティ修正: 適切なタイムアウト設定

    test('Issue #5513解決確認: entrypoint.sh構文検証', async () => {
        try {
            // 構文チェック
            await execAsync(`bash -n ${entrypointPath}`, { timeout: 5000 });
            // 基本機能確認（実装詳細に依存しない）
            behaviorValidation.validateEntrypointBasicFunctionality(entrypointPath);
        } catch (error) {
            throw new Error(`entrypoint.sh has syntax errors: ${error.message}`);
        }
    }, 10000);

    test('Issue #5513解決確認: 関連修正が適用されていることを確認', () => {
        const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
        
        // Issue #5513で言及された関連修正の存在確認（キー機能のみ）
        const requiredFeatures = [
            '_MAIN_STARTUP_MESSAGE_LOGGED_IN_PROCESS', // プロセス内重複防止
            'MAIN_STARTUP_MESSAGE_LOGGED', // 環境変数による防止
            'main-startup-message.lock', // ファイルロック機構
            '_GLOBAL_STARTUP_MESSAGE_SENT', // グローバルフラグ
            'log_startup_message' // 中核となる関数
        ];
        
        requiredFeatures.forEach(feature => {
            expect(entrypointContent).toContain(feature);
        });
    });

    // YAGNI原則適用: Issue #5513の解決確認に不要な他テスト実行は削除
    // 既存の関連テストの動作確認は、個別のCIプロセスで実行される
});