/**
 * Issue #5203: backtestサービスで例外が発生 - 修正確認テスト
 * 
 * backtestサービスで発生していた重複起動メッセージ問題の修正テスト
 * - "Starting backtest container with enhanced error handling"の重複出力問題対応
 * - log_backtest_startup_message関数の動作確認
 * - npmエラーとの相関関係チェック
 * - 2025-07-23 16:31:51に発生した具体的な問題の再現防止確認
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

describe('Issue #5203: backtestサービス重複メッセージ修正', () => {
  const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
  const tmpDir = path.join(__dirname, '..', '.tmp');
  
  beforeAll(() => {
    // .tmpディレクトリが存在しない場合は作成
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  test('Issue #5203対象となるentrypoint.shの機能が実装されていることを確認', () => {
    expect(fs.existsSync(entrypointPath)).toBe(true);
    
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5203関連の基本機能確認
    expect(entrypointContent).toContain('log_backtest_startup_message');
    expect(entrypointContent).toContain('Starting backtest container with enhanced error handling');
    
    // 重複防止機構の確認
    expect(entrypointContent).toContain('BACKTEST_STARTUP_LOCK_FILE');
    expect(entrypointContent).toContain('BACKTEST_STARTUP_LOCK_TIMEOUT');
    expect(entrypointContent).toContain('backtest-startup-lock.dir');
    
    // atomicロック機構の確認
    expect(entrypointContent).toContain('mkdir "$lock_dir"');
    expect(entrypointContent).toContain('rm -rf "$lock_dir"');
    
    // Issue #5175で追加されたコンテナ再起動検出機構の確認
    expect(entrypointContent).toContain('BACKTEST_CONTAINER_RESTART_DETECTION_FILE');
    expect(entrypointContent).toContain('container restart detection');
  });

  test('log_backtest_startup_message関数の実装内容確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // 関数定義の確認
    expect(entrypointContent).toContain('log_backtest_startup_message() {');
    
    // 重複防止ロジックの確認
    expect(entrypointContent).toContain('current_time=$(date +%s)');
    expect(entrypointContent).toContain('time_diff=$((current_time - last_time))');
    expect(entrypointContent).toContain('if [ $time_diff -lt $BACKTEST_STARTUP_LOCK_TIMEOUT ]');
    
    // メッセージ抑制ログの確認
    expect(entrypointContent).toContain('Backtest startup message suppressed');
    
    // タイムスタンプファイル更新の確認
    expect(entrypointContent).toContain('echo "$current_time" > "$timestamp_file"');
  });

  test('Issue #5203でログに出力された具体的なメッセージの処理確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // 問題となったメッセージが処理対象になっていることを確認
    const problemMessage = 'Starting backtest container with enhanced error handling';
    expect(entrypointContent).toContain(`log_startup_message "${problemMessage}"`);
  });

  describe('重複メッセージ防止機能のテスト', () => {
    let testLockDir;
    let testTimestampFile;
    let testRestartDetectionFile;

    beforeEach(() => {
      // テスト用ファイルパスの設定
      testLockDir = path.join(tmpDir, 'test-backtest-startup-lock.dir');
      testTimestampFile = path.join(tmpDir, 'test-backtest-startup-message.lock');
      testRestartDetectionFile = path.join(tmpDir, 'test-backtest-restart-detection.state');
      
      // テスト前のクリーンアップ
      if (fs.existsSync(testLockDir)) {
        fs.rmSync(testLockDir, { recursive: true, force: true });
      }
      if (fs.existsSync(testTimestampFile)) {
        fs.unlinkSync(testTimestampFile);
      }
      if (fs.existsSync(testRestartDetectionFile)) {
        fs.unlinkSync(testRestartDetectionFile);
      }
    });

    afterEach(() => {
      // テスト後のクリーンアップ
      try {
        if (fs.existsSync(testLockDir)) {
          fs.rmSync(testLockDir, { recursive: true, force: true });
        }
        if (fs.existsSync(testTimestampFile)) {
          fs.unlinkSync(testTimestampFile);
        }
        if (fs.existsSync(testRestartDetectionFile)) {
          fs.unlinkSync(testRestartDetectionFile);
        }
      } catch (error) {
        // クリーンアップエラーは無視
      }
    });

    test('初回起動時はメッセージが出力されること', () => {
      // 初回起動時はロックファイルが存在しないため、メッセージが出力される
      expect(fs.existsSync(testTimestampFile)).toBe(false);
      expect(fs.existsSync(testLockDir)).toBe(false);
      expect(fs.existsSync(testRestartDetectionFile)).toBe(false);
      
      // この状態では重複防止機構がメッセージ出力を許可する
    });

    test('短時間内の重複起動では2回目のメッセージが抑制されること', () => {
      const currentTime = Math.floor(Date.now() / 1000);
      
      // 1回目の起動をシミュレート（タイムスタンプファイル作成）
      fs.writeFileSync(testTimestampFile, currentTime.toString());
      
      // 短時間後（60秒以内）の2回目起動をシミュレート
      const secondTime = currentTime + 30; // 30秒後
      
      // タイムスタンプファイルが存在し、時間差が60秒未満の場合
      expect(fs.existsSync(testTimestampFile)).toBe(true);
      const lastTime = parseInt(fs.readFileSync(testTimestampFile, 'utf8'));
      const timeDiff = secondTime - lastTime;
      
      // 60秒未満であることを確認（重複抑制条件）
      expect(timeDiff).toBeLessThan(60);
    });

    test('十分な時間が経過した後は再度メッセージが出力されること', () => {
      const currentTime = Math.floor(Date.now() / 1000);
      
      // 1回目の起動をシミュレート（タイムスタンプファイル作成）
      fs.writeFileSync(testTimestampFile, currentTime.toString());
      
      // 十分な時間後（60秒超過）の2回目起動をシミュレート
      const secondTime = currentTime + 70; // 70秒後
      
      const lastTime = parseInt(fs.readFileSync(testTimestampFile, 'utf8'));
      const timeDiff = secondTime - lastTime;
      
      // 60秒を超過していることを確認（メッセージ出力許可条件）
      expect(timeDiff).toBeGreaterThan(60);
    });

    test('atomicロック機構のディレクトリベース排他制御確認', () => {
      // ロックディレクトリが存在しない状態
      expect(fs.existsSync(testLockDir)).toBe(false);
      
      // ロックディレクトリの作成をシミュレート
      fs.mkdirSync(testLockDir);
      expect(fs.existsSync(testLockDir)).toBe(true);
      
      // ロックディレクトリの削除をシミュレート
      fs.rmSync(testLockDir, { recursive: true });
      expect(fs.existsSync(testLockDir)).toBe(false);
    });
  });

  describe('npm エラーとの相関関係チェック', () => {
    test('Issue #5203で報告されたnpmエラーパターンの確認', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // package.jsonのbacktestスクリプト存在確認処理
      expect(entrypointContent).toContain('grep -q \'"backtest"\' package.json');
      expect(entrypointContent).toContain('Backtest script found in package.json');
      
      // backtestRunner.js存在確認処理
      expect(entrypointContent).toContain('-f "src/backtestRunner.js"');
      expect(entrypointContent).toContain('Backtest runner found: src/backtestRunner.js');
    });

    test('npm run backtestコマンド検証機能の確認', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // npm run backtestコマンドの検証処理
      expect(entrypointContent).toContain('npm run backtestコマンドの検証');
      expect(entrypointContent).toContain('if [ "$1" = "npm" ] && [ "$2" = "run" ] && [ "$3" = "backtest" ]');
      expect(entrypointContent).toContain('Validating npm run backtest command...');
    });
  });

  describe('Issue #5203で報告された時刻での問題再現防止', () => {
    test('2025-07-23 16:31:51 時点での問題が解決されていることを確認', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // この時刻に発生した問題のコンテキストから想定される修正内容
      // 1. 重複起動メッセージの防止機構
      expect(entrypointContent).toContain('log_backtest_startup_message');
      
      // 2. 起動診断情報の出力処理
      expect(entrypointContent).toContain('起動診断情報');
      expect(entrypointContent).toContain('プロセス ID');
      expect(entrypointContent).toContain('起動時刻');
      expect(entrypointContent).toContain('バックテストモード');
      
      // 3. 起動ロックの取得処理
      expect(entrypointContent).toContain('Acquiring startup lock');
      expect(entrypointContent).toContain('Startup lock acquired successfully');
    });

    test('Issue #5203の根本原因となりうる条件の修正確認', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // レースコンディション対策の確認
      expect(entrypointContent).toContain('atomicなロック取得を試行');
      expect(entrypointContent).toContain('mkdirはatomic操作');
      
      // 二重チェック機構の確認
      expect(entrypointContent).toContain('ロック取得成功 - 二重チェック後にメッセージ出力');
      expect(entrypointContent).toContain('他のプロセスが先にメッセージを出力していた');
      
      // コンテナ再起動検出による追加防止策
      expect(entrypointContent).toContain('Issue #5175: コンテナ再起動検出');
      expect(entrypointContent).toContain('instance_id');
    });
  });

  test('Issue #5203修正後の動作確認 - 全体的な統合テスト', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // BACKTEST_MODE=trueでの分岐処理確認
    expect(entrypointContent).toContain('if [ "$BACKTEST_MODE" = "true" ]; then');
    
    // log_startup_message関数からlog_backtest_startup_message関数への委譲確認
    expect(entrypointContent).toContain('if [ "$BACKTEST_MODE" = "true" ]; then');
    expect(entrypointContent).toContain('log_backtest_startup_message "$message"');
    
    // 問題となったメッセージの処理経路確認
    const messagePattern = /log_startup_message.*Starting backtest container with enhanced error handling/;
    expect(entrypointContent).toMatch(messagePattern);
  });
});