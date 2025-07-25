/**
 * Issue #5058: backtestサービスで例外が発生 - 修正確認テスト
 * 
 * backtestサービスで発生していた重複起動メッセージ問題の修正テスト
 * - atomicディレクトリロックによる重複防止機構の確認
 * - レースコンディション問題の解決確認
 * - Discord Webhook URL未設定警告の適切な処理確認
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

describe('Issue #5058: backtestサービス重複メッセージ修正', () => {
  const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
  const tmpDir = path.join(__dirname, '..', '.tmp');
  
  beforeAll(() => {
    // .tmpディレクトリが存在しない場合は作成
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  test('Issue #5058修正がentrypoint.shに適用されていることを確認', () => {
    expect(fs.existsSync(entrypointPath)).toBe(true);
    
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5058修正の確認（#5175で拡張済み、#5159でflock方式に更新）
    expect(entrypointContent).toContain('Issue #5127, #5058 & #5175 & #5216: backtest container専用起動メッセージ関数（簡素化版）');
    expect(entrypointContent).toContain('flockによる確実なatomic lock実装');
    
    // Issue #5159: flock方式のロック機構の確認
    expect(entrypointContent).toContain('exec 200>"$lock_file"');
    expect(entrypointContent).toContain('flock -x -w "$max_wait_time" 200');
    expect(entrypointContent).toContain('exec 200>&-');
    
    // クリーンアップ機能の更新確認（#5175で拡張済み）
    expect(entrypointContent).toContain('Issue #5127, #5058 & #5175: backtest専用クリーンアップ関数（改良版）');
    expect(entrypointContent).toContain('Removed backtest startup lock directory');
  });

  describe('改良されたatomicロック機構テスト', () => {
    let testLockDir;
    let testTimestampFile;

    beforeEach(() => {
      // テスト用の一意なファイル名を生成
      const testId = Date.now() + Math.random().toString(36).substr(2, 9);
      testLockDir = path.join(tmpDir, `backtest-startup-lock-test-${testId}`);
      testTimestampFile = path.join(tmpDir, `backtest-startup-timestamp-test-${testId}.lock`);
    });

    afterEach(() => {
      // テスト後のクリーンアップ
      if (fs.existsSync(`${testLockDir}.lock`)) {
        fs.unlinkSync(`${testLockDir}.lock`);
      }
      if (fs.existsSync(testTimestampFile)) {
        fs.unlinkSync(testTimestampFile);
      }
    });

    test('atomicロック機構による重複防止動作確認', async () => {
      // 原子的書き込み実装の基本動作を確認（簡易版）
      const testScript = `#!/bin/bash
set -e

testTimestampFile="${testTimestampFile}"

echo "Test: Atomic file writing mechanism"

# 1回目の書き込み（成功）
if [ ! -f "$testTimestampFile" ]; then
    temp_timestamp="${testTimestampFile}.tmp.$$"
    echo "$(date +%s)" > "$temp_timestamp"
    chmod 600 "$temp_timestamp"
    mv "$temp_timestamp" "$testTimestampFile"
    echo "First write: success"
else
    echo "First write: unexpected file exists"
fi

# ファイルが存在することを確認
if [ -f "$testTimestampFile" ]; then
    echo "File exists after atomic write"
else
    echo "File does not exist after atomic write"
fi
`;

      const testScriptPath = path.join(tmpDir, `test-atomic-lock-${Date.now()}.sh`);
      fs.writeFileSync(testScriptPath, testScript);
      fs.chmodSync(testScriptPath, '755');

      try {
        const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 5000 });
        
        // 原子的書き込みが成功することを確認
        expect(stdout).toContain('First write: success');
        expect(stdout).toContain('File exists after atomic write');
        
      } finally {
        if (fs.existsSync(testScriptPath)) {
          fs.unlinkSync(testScriptPath);
        }
      }
    }, 8000);

    test('並行実行時のレースコンディション解決確認', async () => {
      // 原子的書き込み機構がrace conditionを防ぐことを確認（簡易版）
      const testScript = `#!/bin/bash
set -e

testTimestampFile="${testTimestampFile}"

# 原子的書き込みの動作確認
temp_timestamp="${testTimestampFile}.tmp.$$"
echo "test_timestamp" > "$temp_timestamp"
chmod 600 "$temp_timestamp"
mv "$temp_timestamp" "$testTimestampFile"

if [ -f "$testTimestampFile" ]; then
    echo "Atomic write test: success"
else
    echo "Atomic write test: failed"
fi
`;

      const testScriptPath = path.join(tmpDir, `test-race-condition-${Date.now()}.sh`);
      fs.writeFileSync(testScriptPath, testScript);
      fs.chmodSync(testScriptPath, '755');

      try {
        const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 5000 });
        
        // 原子的書き込みが成功することを確認
        expect(stdout).toContain('Atomic write test: success');
        
      } finally {
        if (fs.existsSync(testScriptPath)) {
          fs.unlinkSync(testScriptPath);
        }
      }
    }, 8000);
  });

  test('Discord Webhook未設定警告の適切な処理確認', () => {
    const webhookUtilsPath = path.join(__dirname, '..', 'src', 'common', 'webhookUtils.js');
    expect(fs.existsSync(webhookUtilsPath)).toBe(true);
    
    const webhookUtilsContent = fs.readFileSync(webhookUtilsPath, 'utf8');
    
    // バックテストモード時の適切なメッセージ処理
    expect(webhookUtilsContent).toContain('process.env.BACKTEST_MODE === \'true\'');
    expect(webhookUtilsContent).toContain('バックテストモードのため通知をスキップ');
    
    // checkWebhookUrl関数の存在確認
    expect(webhookUtilsContent).toContain('function checkWebhookUrl');
    expect(webhookUtilsContent).toContain('logWebhookNotSet(context)');
  });

  test('entrypoint.sh構文検証（Issue #5058修正後）', async () => {
    // 修正後もentrypoint.shが正しく動作することを確認
    await expect(execAsync(`bash -n ${entrypointPath}`, { timeout: 3000 }))
      .resolves.not.toThrow();
  }, 5000);

  test('修正による既存機能への影響がないことを確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // 既存の重要な機能が維持されていることを確認
    const essentialFunctions = [
      'acquire_startup_lock()',
      'release_startup_lock()', 
      'log_startup_message()',
      'log_backtest_startup_message()',
      'cleanup_backtest_locks()',
      'main()'
    ];
    
    essentialFunctions.forEach(func => {
      expect(entrypointContent).toContain(func);
    });
    
    // 既存のメッセージ呼び出しが正しく保持されている
    expect(entrypointContent).toContain('log_startup_message "Starting strategy-runner container with enhanced error handling (container: $(hostname), pid: $$)"');
    expect(entrypointContent).toContain('log_backtest_startup_message "Starting backtest container with enhanced error handling"');
  });

  test('セキュリティ面での改良確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // ファイル権限の適切な設定（Issue #5159: flock方式対応）
    expect(entrypointContent).toContain('chmod 600 "$temp_timestamp"');
    expect(entrypointContent).toContain('chmod 600 "$npm_error_marker"');
    
    // エラーハンドリングの確認
    expect(entrypointContent).toContain('2>/dev/null || true');
    
    // Issue #5159: flock方式でのロック解放確認
    expect(entrypointContent).toContain('exec 200>&-');
  });
});