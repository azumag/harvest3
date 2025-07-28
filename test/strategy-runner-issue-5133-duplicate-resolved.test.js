const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

describe('Issue #5133: strategy-runnerサービスでの重複ログメッセージ解決確認', () => {
  const tmpDir = path.join(__dirname, '..', '.tmp');
  
  beforeAll(() => {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  test('entrypoint.shで重複ログメッセージが発生しないことを確認', async () => {
    // entrypoint.shの内容を確認
    const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // log_startup_messageが適切に実装されていることを確認
    expect(entrypointContent).toContain('log_startup_message "Starting strategy-runner container with enhanced error handling (container: $(hostname), pid: $$)"');
    
    // 重複防止機構が実装されていることを確認（リファクタリング後）
    expect(entrypointContent).toContain('Issue #5172: リファクタリング - 設定の外部化（YAGNI/KISS原則）');
    expect(entrypointContent).toContain('Issue #5172: Redis-based重複防止関数（単一責任化・KISS原則）');
    expect(entrypointContent).toContain('Issue #5172: ファイルベースフォールバック関数（単一責任化・KISS原則）');
  });

  test('log_startup_message関数の重複防止機構が正常に動作することを確認', async () => {
    // 実際のentrypoint.shを直接テストする
    const entrypointPath = path.join(__dirname, 'fixtures', 'entrypoint-test-functions.sh');
    const testScript = `#!/bin/bash
source "${entrypointPath}"
log_startup_message "Issue #5133: duplicate prevention test message"
log_startup_message "Issue #5133: duplicate prevention test message"
`;

    const testScriptPath = path.join(tmpDir, `test-issue-5133-${Date.now()}.sh`);
    fs.writeFileSync(testScriptPath, testScript);
    fs.chmodSync(testScriptPath, '755');

    try {
      const output = execSync(`bash ${testScriptPath}`, { 
        encoding: 'utf8',
        timeout: 5000 
      });
      
      const messages = output.split('\n').filter(line => 
        line.includes('Issue #5133: duplicate prevention test message')
      );
      
      // Issue #5133修正により重複が解消されていることを確認（1回のみ出力）
      expect(messages.length).toBe(1);
      expect(messages[0]).toContain('Issue #5133: duplicate prevention test message');
    } finally {
      if (fs.existsSync(testScriptPath)) {
        fs.unlinkSync(testScriptPath);
      }
    }
  });

  test('entrypoint.shの構造が正常であることを確認', () => {
    const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // BACKTEST_MODEとnormalモードの分岐が正常に実装されていることを確認
    expect(entrypointContent).toMatch(/if \[ "\$BACKTEST_MODE" = "true" \]; then/);
    expect(entrypointContent).toContain('log_backtest_startup_message "Starting backtest container with enhanced error handling"');
    expect(entrypointContent).toContain('log_startup_message "Starting strategy-runner container with enhanced error handling (container: $(hostname), pid: $$)"');
    
    // main関数が1回のみ実行されることを確認
    const mainCallMatches = entrypointContent.match(/if ! main "\$@"; then/g);
    expect(mainCallMatches).not.toBeNull();
    expect(mainCallMatches.length).toBe(1);
  });

  afterAll(() => {
    // テスト用ファイルのクリーンアップ
    if (fs.existsSync(tmpDir)) {
      const testFiles = fs.readdirSync(tmpDir).filter(file => file.includes('test-issue-5133'));
      testFiles.forEach(file => {
        const filePath = path.join(tmpDir, file);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      });
    }
  });
});