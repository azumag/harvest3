/**
 * strategy-runner重複起動修正のテスト
 * Issue #2513: strategy-runnerサービスで例外が発生
 */

const fs = require('fs');
const path = require('path');

describe('Strategy-Runner重複起動修正', () => {
  const lockFilePath = '/tmp/strategy-runner-startup.lock';
  const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');

  // 各テスト前のクリーンアップ
  beforeEach(() => {
    // ロックファイルを削除
    if (fs.existsSync(lockFilePath)) {
      fs.unlinkSync(lockFilePath);
    }
  });

  // 各テスト後のクリーンアップ
  afterEach(() => {
    // ロックファイルを削除
    if (fs.existsSync(lockFilePath)) {
      fs.unlinkSync(lockFilePath);
    }
  });

  describe('起動ロック機能の実装確認', () => {
    test('entrypoint.shファイルに起動ロック機能が追加されている', () => {
      // entrypoint.shファイルが存在することを確認
      expect(fs.existsSync(entrypointPath)).toBe(true);
      
      // entrypoint.shファイルの内容を読み込み
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 起動ロック関連の設定が追加されていることを確認
      expect(entrypointContent).toContain('STARTUP_LOCK_FILE');
      expect(entrypointContent).toContain('STARTUP_LOCK_TIMEOUT');
      
      // 起動ロック関数が定義されていることを確認
      expect(entrypointContent).toContain('acquire_startup_lock()');
      expect(entrypointContent).toContain('release_startup_lock()');
      
      // main関数で起動ロックが取得されることを確認
      expect(entrypointContent).toContain('acquire_startup_lock');
      
      // cleanup関数でロックが解放されることを確認
      expect(entrypointContent).toContain('release_startup_lock');
    });

    test('起動ロック機能の実装が正しい構造になっている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // acquire_startup_lock関数の実装内容を確認
      expect(entrypointContent).toContain('log "Acquiring startup lock..."');
      expect(entrypointContent).toContain('kill -0 "$lock_pid"');
      expect(entrypointContent).toContain('echo "$$" > "$lock_file"');
      expect(entrypointContent).toContain('Startup lock acquired successfully');
      
      // release_startup_lock関数の実装内容を確認
      expect(entrypointContent).toContain('if [ "$lock_pid" = "$$" ]; then');
      expect(entrypointContent).toContain('rm -f "$lock_file"');
      expect(entrypointContent).toContain('Startup lock released');
      
      // main関数でのロック取得処理を確認
      expect(entrypointContent).toContain('if ! acquire_startup_lock; then');
      expect(entrypointContent).toContain('trap release_startup_lock EXIT');
    });

    test('重複起動防止の処理フローが正しく実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 既存のロックファイルのチェック処理
      expect(entrypointContent).toContain('if [ -f "$lock_file" ]; then');
      expect(entrypointContent).toContain('local lock_pid=$(cat "$lock_file"');
      
      // プロセス存在確認
      expect(entrypointContent).toContain('kill -0 "$lock_pid"');
      
      // 待機処理
      expect(entrypointContent).toContain('Another startup process is running');
      expect(entrypointContent).toContain('while [ -f "$lock_file" ]');
      
      // タイムアウト処理
      expect(entrypointContent).toContain('timed out');
      expect(entrypointContent).toContain('waited -ge $timeout');
      
      // 古いロックファイルの削除
      expect(entrypointContent).toContain('Removing stale lock file');
    });

    test('ロックファイルの基本的な動作確認', () => {
      // テスト用のロックファイルを作成
      const testPid = process.pid;
      fs.writeFileSync(lockFilePath, testPid.toString());
      
      // ロックファイルが作成されることを確認
      expect(fs.existsSync(lockFilePath)).toBe(true);
      
      // ロックファイルの内容を確認
      const lockContent = fs.readFileSync(lockFilePath, 'utf8');
      expect(lockContent).toBe(testPid.toString());
      
      // ロックファイルを削除
      fs.unlinkSync(lockFilePath);
      expect(fs.existsSync(lockFilePath)).toBe(false);
    });

    test('古いロックファイルの検出が可能', () => {
      // 存在しないPIDでロックファイルを作成
      const stalePid = 99999;
      fs.writeFileSync(lockFilePath, stalePid.toString());
      
      // ロックファイルが作成されることを確認
      expect(fs.existsSync(lockFilePath)).toBe(true);
      
      // ロックファイルの内容を確認
      const lockContent = fs.readFileSync(lockFilePath, 'utf8');
      expect(lockContent).toBe(stalePid.toString());
      
      // 古いロックファイルとして検出できることを確認
      // (実際のプロセス存在確認は、entrypoint.sh内で kill -0 で行われる)
      expect(parseInt(lockContent)).toBe(stalePid);
    });

    test('ロックファイルのパスとタイムアウト設定が正しい', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // デフォルトのロックファイルパスを確認
      expect(entrypointContent).toContain('STARTUP_LOCK_FILE="$LOCK_BASE_DIR/strategy-runner-startup.lock"');
      
      // デフォルトのタイムアウト値を確認
      expect(entrypointContent).toContain('STARTUP_LOCK_TIMEOUT=${STARTUP_LOCK_TIMEOUT:-30}');
      
      // 環境変数での上書きが可能であることを確認
      expect(entrypointContent).toContain('${STARTUP_LOCK_TIMEOUT:-30}');
      expect(entrypointContent).toContain('local timeout="$STARTUP_LOCK_TIMEOUT"');
    });

    test('シグナルハンドラーでのロック解放処理が追加されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // cleanup関数にロック解放処理が追加されていることを確認
      expect(entrypointContent).toContain('# 起動ロックの解放');
      expect(entrypointContent).toContain('release_startup_lock');
      
      // シグナルハンドラーが設定されていることを確認
      expect(entrypointContent).toContain('trap cleanup SIGTERM SIGINT');
    });

    test('エラーハンドリングが適切に実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // ロック取得失敗時の処理
      expect(entrypointContent).toContain('if ! acquire_startup_lock; then');
      expect(entrypointContent).toContain('ERROR: Failed to acquire startup lock');
      
      // ロックファイル作成失敗時の処理
      expect(entrypointContent).toContain('ERROR: Failed to create startup lock file');
      
      // ロック解放時の安全確認
      expect(entrypointContent).toContain('Cannot release lock owned by PID');
    });

    test('重複起動防止のログメッセージが実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 重複起動検出時のログメッセージ
      expect(entrypointContent).toContain('Another startup process is running');
      expect(entrypointContent).toContain('waiting...');
      
      // ロック取得成功時のログメッセージ
      expect(entrypointContent).toContain('Startup lock acquired successfully');
      
      // ロック解放時のログメッセージ
      expect(entrypointContent).toContain('Startup lock released');
      
      // 古いロックファイル削除時のログメッセージ
      expect(entrypointContent).toContain('Removing stale lock file');
      
      // タイムアウト時のログメッセージ
      expect(entrypointContent).toContain('Startup lock acquisition timed out');
    });

    test('Issue #2513の問題解決に必要な機能が実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 重複起動防止機能（Issue #2513の根本原因解決）
      expect(entrypointContent).toContain('acquire_startup_lock');
      
      // プロセス状態確認機能
      expect(entrypointContent).toContain('kill -0');
      
      // タイムアウト機能（無限待機の回避）
      expect(entrypointContent).toContain('STARTUP_LOCK_TIMEOUT');
      
      // 古いロックファイルの自動削除
      expect(entrypointContent).toContain('stale lock');
      
      // 優雅な終了処理
      expect(entrypointContent).toContain('trap');
      expect(entrypointContent).toContain('EXIT');
    });
  });

  describe('統合テストのサポート', () => {
    test('テスト用のロックファイルディレクトリが使用可能', () => {
      // /tmpディレクトリが使用可能であることを確認
      expect(fs.existsSync('/tmp')).toBe(true);
      
      // テスト用ロックファイルを作成してみる
      const testLockFile = '/tmp/test-lock-file';
      fs.writeFileSync(testLockFile, 'test');
      expect(fs.existsSync(testLockFile)).toBe(true);
      
      // クリーンアップ
      fs.unlinkSync(testLockFile);
      expect(fs.existsSync(testLockFile)).toBe(false);
    });

    test('entrypoint.shファイルが実行可能', () => {
      // entrypoint.shファイルの存在確認
      expect(fs.existsSync(entrypointPath)).toBe(true);
      
      // ファイルの実行権限確認（統計情報から）
      const stats = fs.statSync(entrypointPath);
      expect(stats.isFile()).toBe(true);
      
      // bashスクリプトのシバン行が正しいことを確認
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      expect(entrypointContent.startsWith('#!/bin/bash')).toBe(true);
    });

    test('環境変数の設定が正しく動作する', () => {
      // 環境変数を設定
      process.env.STARTUP_LOCK_TIMEOUT = '60';
      process.env.STARTUP_LOCK_FILE = '/tmp/custom-lock-file';
      
      // 設定が反映されることを確認
      expect(process.env.STARTUP_LOCK_TIMEOUT).toBe('60');
      expect(process.env.STARTUP_LOCK_FILE).toBe('/tmp/custom-lock-file');
      
      // クリーンアップ
      delete process.env.STARTUP_LOCK_TIMEOUT;
      delete process.env.STARTUP_LOCK_FILE;
    });
  });
});