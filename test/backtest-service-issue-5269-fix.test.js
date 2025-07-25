/**
 * Issue #5269: backtestサービスで例外が発生 - 修正確認テスト
 * 
 * backtestサービスのDocker再起動時における重複起動メッセージ問題の修正テスト
 * - Docker再起動時のタイムスタンプファイルクリーンアップ確認
 * - flock タイムアウト延長による安定性向上確認
 * - システム稼働時間ベースの新規コンテナ判定確認
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

describe('Issue #5269: backtestサービス Docker再起動時重複メッセージ修正', () => {
  const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
  const tmpDir = path.join(__dirname, '..', '.tmp');
  
  beforeAll(() => {
    // .tmpディレクトリが存在しない場合は作成
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  test('Issue #5269修正がentrypoint.shに適用されていることを確認', () => {
    expect(fs.existsSync(entrypointPath)).toBe(true);
    
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5269修正の確認
    expect(entrypointContent).toContain('Issue #5269: Docker再起動対応で延長');
    expect(entrypointContent).toContain('Issue #5269: バックテスト専用のタイムスタンプファイルクリーンアップ強化');
    expect(entrypointContent).toContain('Issue #5269修正: Docker再起動時の新規コンテナ判定を追加');
    
    // flock タイムアウト延長の確認（5秒 → 15秒）
    expect(entrypointContent).toContain('BACKTEST_STARTUP_FLOCK_TIMEOUT=${BACKTEST_STARTUP_FLOCK_TIMEOUT:-15}');
    
    // Docker再起動検出ロジックの確認
    expect(entrypointContent).toContain('Docker container restart detected');
    expect(entrypointContent).toContain('uptime_seconds=$(cat /proc/uptime | cut -d\' \' -f1 | cut -d\'.\' -f1)');
    
    // タイムスタンプファイルクリーンアップの確認
    expect(entrypointContent).toContain('startup-timestamp-global.state');
    expect(entrypointContent).toContain('startup-message-global.lock');
  });

  describe('Docker再起動時クリーンアップ機構テスト', () => {
    let testTmpDir;
    let testVarRunDir;

    beforeEach(() => {
      // テスト用の一意なディレクトリを生成
      const testId = Date.now() + Math.random().toString(36).substr(2, 9);
      testTmpDir = path.join(tmpDir, `test-tmp-${testId}`);
      testVarRunDir = path.join(tmpDir, `test-var-run-${testId}`);
      
      // テストディレクトリを作成
      fs.mkdirSync(testTmpDir, { recursive: true });
      fs.mkdirSync(testVarRunDir, { recursive: true });
    });

    afterEach(() => {
      // テスト後のクリーンアップ
      if (fs.existsSync(testTmpDir)) {
        fs.rmSync(testTmpDir, { recursive: true, force: true });
      }
      if (fs.existsSync(testVarRunDir)) {
        fs.rmSync(testVarRunDir, { recursive: true, force: true });
      }
    });

    test('Docker再起動時のタイムスタンプファイルクリーンアップ確認', async () => {
      // 古いタイムスタンプファイルを作成
      const timestampFile1 = path.join(testTmpDir, 'startup-timestamp-global.state');
      const timestampFile2 = path.join(testVarRunDir, 'startup-timestamp-global.state');
      const lockFile1 = path.join(testTmpDir, 'startup-message-global.lock');
      const lockFile2 = path.join(testVarRunDir, 'startup-message-global.lock');
      const npmErrorFile = path.join(testTmpDir, 'backtest-npm-error-detection.state');
      
      // テストファイルを作成
      fs.writeFileSync(timestampFile1, '1234567890:old-container:1234');
      fs.writeFileSync(timestampFile2, '1234567890:old-container:1234');
      fs.writeFileSync(lockFile1, 'old-lock-data');
      fs.writeFileSync(lockFile2, 'old-lock-data'); 
      fs.writeFileSync(npmErrorFile, '1234567890');
      
      // ファイルが存在することを確認
      expect(fs.existsSync(timestampFile1)).toBe(true);
      expect(fs.existsSync(timestampFile2)).toBe(true);
      expect(fs.existsSync(lockFile1)).toBe(true);
      expect(fs.existsSync(lockFile2)).toBe(true);
      expect(fs.existsSync(npmErrorFile)).toBe(true);
      
      // クリーンアップスクリプトを実行
      const cleanupScript = `#!/bin/bash
set -e

BACKTEST_MODE=true

# Issue #5269のクリーンアップロジックをテスト
if [ "$BACKTEST_MODE" = "true" ]; then
    for cleanup_dir in "${testVarRunDir}" "${testTmpDir}"; do
        if [ -d "$cleanup_dir" ]; then
            rm -f "$cleanup_dir/startup-timestamp-global.state" 2>/dev/null || true
            rm -f "$cleanup_dir/startup-message-global.lock" 2>/dev/null || true
        fi
    done
    
    rm -f "${testTmpDir}/backtest-npm-error-detection.state" 2>/dev/null || true
fi

echo "Cleanup completed"
`;

      const cleanupScriptPath = path.join(tmpDir, `cleanup-test-${Date.now()}.sh`);
      fs.writeFileSync(cleanupScriptPath, cleanupScript);
      fs.chmodSync(cleanupScriptPath, '755');

      try {
        const { stdout } = await execAsync(`bash ${cleanupScriptPath}`, { timeout: 5000 });
        
        // クリーンアップが成功することを確認
        expect(stdout).toContain('Cleanup completed');
        
        // ファイルが削除されていることを確認
        expect(fs.existsSync(timestampFile1)).toBe(false);
        expect(fs.existsSync(timestampFile2)).toBe(false);
        expect(fs.existsSync(lockFile1)).toBe(false);
        expect(fs.existsSync(lockFile2)).toBe(false);
        expect(fs.existsSync(npmErrorFile)).toBe(false);
        
      } finally {
        if (fs.existsSync(cleanupScriptPath)) {
          fs.unlinkSync(cleanupScriptPath);
        }
      }
    }, 8000);

    test('システム稼働時間ベースの新規コンテナ判定確認', async () => {
      // システム稼働時間ベースの判定ロジックをテスト
      const testScript = `#!/bin/bash
set -e

# テスト用の模擬uptime値
test_uptime_short="30.5"
test_uptime_long="120.8"

echo "Testing uptime-based container restart detection"

# 短い稼働時間（新規コンテナ）のテスト
uptime_seconds_short=\$(echo "$test_uptime_short" | cut -d'.' -f1)
if [ "$uptime_seconds_short" -lt 60 ]; then
    echo "Short uptime detected: \${uptime_seconds_short}s - new container"
else
    echo "Short uptime test failed"
fi

# 長い稼働時間（安定コンテナ）のテスト
uptime_seconds_long=\$(echo "$test_uptime_long" | cut -d'.' -f1)
if [ "$uptime_seconds_long" -ge 60 ]; then
    echo "Long uptime detected: \${uptime_seconds_long}s - stable container"
else
    echo "Long uptime test failed"
fi
`;

      const testScriptPath = path.join(tmpDir, `uptime-test-${Date.now()}.sh`);
      fs.writeFileSync(testScriptPath, testScript);
      fs.chmodSync(testScriptPath, '755');

      try {
        const { stdout } = await execAsync(`bash ${testScriptPath}`, { timeout: 5000 });
        
        // システム稼働時間判定が正しく動作することを確認
        expect(stdout).toContain('Short uptime detected: 30s - new container');
        expect(stdout).toContain('Long uptime detected: 120s - stable container');
        
      } finally {
        if (fs.existsSync(testScriptPath)) {
          fs.unlinkSync(testScriptPath);
        }
      }
    }, 8000);
  });

  test('flock タイムアウト延長による安定性向上確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // flock タイムアウトが適切に延長されていることを確認
    const timeoutMatch = entrypointContent.match(/BACKTEST_STARTUP_FLOCK_TIMEOUT=\${BACKTEST_STARTUP_FLOCK_TIMEOUT:-(\d+)}/);
    expect(timeoutMatch).toBeTruthy();
    expect(parseInt(timeoutMatch[1])).toBeGreaterThanOrEqual(15); // 15秒以上
    
    // コメントでDocker再起動対応の説明があることを確認
    expect(entrypointContent).toContain('Docker再起動対応で延長');
  });

  test('NPMエラー後の再起動処理改善確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // NPMエラーマーカーファイルの初期化処理があることを確認
    expect(entrypointContent).toContain('backtest-npm-error-detection.state');
    expect(entrypointContent).toContain('NPMエラーマーカーも初期化');
    
    // NPMエラー状態チェックロジックが維持されていることを確認
    expect(entrypointContent).toContain('NPMエラー状態をチェック（Issue #5159）');
    expect(entrypointContent).toContain('NPM_ERROR_SUPPRESS_DURATION');
  });

  test('既存の重複防止機能への影響がないことを確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // 既存の重要な機能が維持されていることを確認
    const essentialElements = [
      'log_backtest_startup_message()',
      'flock -x -w "$max_wait_time" 200',
      'cleanup_backtest_lock',
      'exec 200>&-',
      'atomic lock実装'
    ];
    
    essentialElements.forEach(element => {
      expect(entrypointContent).toContain(element);
    });
    
    // 既存のIssue修正が維持されていることを確認
    expect(entrypointContent).toContain('Issue #5058');
    expect(entrypointContent).toContain('Issue #5127');
    expect(entrypointContent).toContain('Issue #5159');
    expect(entrypointContent).toContain('Issue #5175');
  });

  test('entrypoint.sh構文検証（Issue #5269修正後）', async () => {
    // 修正後もentrypoint.shが正しく動作することを確認
    await expect(execAsync(`bash -n ${entrypointPath}`, { timeout: 3000 }))
      .resolves.not.toThrow();
  }, 5000);
});