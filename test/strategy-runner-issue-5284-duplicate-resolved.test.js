/**
 * Issue #5284: strategy-runnerサービスで例外が発生 - 重複解決確認テスト
 * 
 * 概要:
 * - Issue #5284で報告された重複起動メッセージ問題が既存の修正により解決されていることを確認
 * - Issue #5267, #5302などの修正により重複防止機構が正しく動作することを検証
 * - 同一コンテナID・PIDでの重複ログが防止されることを確認
 * 
 * レビュー対応: DRY/KISS/YAGNI原則に従い、共通ヘルパーを使用してテストを簡素化
 */

const fs = require('fs');
const path = require('path');
const { 
  runDuplicatePreventionTest, 
  testEnvironment, 
  behaviorValidation 
} = require('./helpers/startup-message-test-helper');

describe('Issue #5284: strategy-runner重複ログ問題解決確認', () => {
  const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
  const testTmpDir = '.tmp/test-issue-5284';

  beforeEach(async () => {
    await testEnvironment.setup(testTmpDir);
  });

  afterEach(async () => {
    await testEnvironment.cleanup(testTmpDir);
  });

  test('Issue #5284: 報告された具体的な重複メッセージが防止されることを確認', async () => {
    // Issue #5284で報告されたのと同じ形式のメッセージでテスト
    const testResult = await runDuplicatePreventionTest({
      testName: 'issue-5284-duplicate-prevention',
      testTmpDir,
      testMessage: "Starting strategy-runner container with enhanced error handling (container: 5cb8f02976da, pid: 1)",
      callCount: 3,
      expectedOutputCount: 1,
      scriptOptions: {
        containerId: '5cb8f02976da',
        pid: '1',
        enableProcessInternal: true,
        enableFilelock: true
      }
    });

    // 動作検証（実装詳細ではなく）
    behaviorValidation.validateDuplicatePrevention(testResult, 1);
    
    // Issue #5284で報告されたコンテナIDとPIDが含まれることを確認
    expect(testResult.messages[0]).toContain('container: 5cb8f02976da');
    expect(testResult.messages[0]).toContain('pid: 1');

    console.log('Issue #5284 resolution verified - Message count:', testResult.messageCount);
  });

  test('Issue #5284: entrypoint.shの基本機能が正しく動作していることを確認', () => {
    // 実装詳細ではなく基本的な動作を確認
    behaviorValidation.validateEntrypointBasicFunctionality(entrypointPath);
  });

  test('Issue #5284: コンテナ再起動時のメッセージ出力が正しく動作することを確認', async () => {
    // 初回起動のテスト
    const firstStartupResult = await runDuplicatePreventionTest({
      testName: 'issue-5284-first-startup',
      testTmpDir,
      testMessage: "Starting strategy-runner container with enhanced error handling (container: simulated-restart, pid: $$)",
      callCount: 1,
      expectedOutputCount: 1
    });
    
    behaviorValidation.validateDuplicatePrevention(firstStartupResult, 1);

    // 再起動後のテスト（環境リセット後）
    await testEnvironment.cleanup(testTmpDir);
    await testEnvironment.setup(testTmpDir);
    
    const secondStartupResult = await runDuplicatePreventionTest({
      testName: 'issue-5284-second-startup',
      testTmpDir,
      testMessage: "Starting strategy-runner container with enhanced error handling (container: simulated-restart, pid: $$)",
      callCount: 1,
      expectedOutputCount: 1
    });
    
    behaviorValidation.validateDuplicatePrevention(secondStartupResult, 1);

    console.log('Restart scenario verified - Both startups produced exactly 1 message each');
  });

  test('Issue #5284: entrypoint.sh構文検証', async () => {
    // 構文エラーがないことを確認
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    await expect(
      execAsync(`bash -n "${entrypointPath}"`, { timeout: 3000 })
    ).resolves.not.toThrow();
  });
});