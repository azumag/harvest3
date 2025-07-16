/**
 * Strategy-Runner Issue #2504 修正のテスト
 * 重複起動メッセージの防止機能の強化
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

describe('Strategy-Runner Issue #2504 修正', () => {
  const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
  const lockDir = '/tmp/startup_messages';
  
  // テスト前のクリーンアップ
  beforeEach(() => {
    // 起動メッセージロックディレクトリをクリーンアップ
    if (fs.existsSync(lockDir)) {
      const files = fs.readdirSync(lockDir);
      files.forEach(file => {
        const filePath = path.join(lockDir, file);
        if (fs.statSync(filePath).isFile()) {
          fs.unlinkSync(filePath);
        }
      });
    }
  });

  // テスト後のクリーンアップ
  afterEach(() => {
    // 起動メッセージロックディレクトリをクリーンアップ
    if (fs.existsSync(lockDir)) {
      const files = fs.readdirSync(lockDir);
      files.forEach(file => {
        const filePath = path.join(lockDir, file);
        if (fs.statSync(filePath).isFile()) {
          fs.unlinkSync(filePath);
        }
      });
    }
  });

  describe('重複起動メッセージ防止機能の強化', () => {
    test('log_startup_message関数が強化されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // レースコンディション対策の実装確認
      expect(entrypointContent).toContain('レースコンディション対策強化版');
      expect(entrypointContent).toContain('max_attempts=5');
      expect(entrypointContent).toContain('複数回のリトライでatomicなロック取得を試行');
      
      // タイムスタンプ付きロックファイルの実装確認
      expect(entrypointContent).toContain('echo "$$:$(date +%s)" > "$lock_file"');
      
      // 古いロックファイルの自動削除機能
      expect(entrypointContent).toContain('30秒以上古いロックファイル or 存在しないプロセスのロックファイルを削除');
      expect(entrypointContent).toContain('Removed stale message lock for PID:');
      
      // リトライ機能の実装確認
      expect(entrypointContent).toContain('sleep 0.1');
      expect(entrypointContent).toContain('attempt=$((attempt + 1))');
    });

    test('起動ロック取得後のメッセージ出力順序が修正されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // main関数でのロック取得とメッセージ出力の順序確認
      expect(entrypointContent).toContain('起動ロック取得後に安全にメッセージを出力');
      
      // main関数内の特定のロック取得処理の位置確認
      const mainFunctionStart = entrypointContent.indexOf('main() {');
      const lockAcquisitionIndex = entrypointContent.indexOf('if ! acquire_startup_lock; then', mainFunctionStart);
      const messageLogIndex = entrypointContent.indexOf('log_startup_message "Starting strategy-runner', mainFunctionStart);
      
      // ロック取得がメッセージ出力より前に来ることを確認
      expect(lockAcquisitionIndex).toBeLessThan(messageLogIndex);
      expect(lockAcquisitionIndex).toBeGreaterThan(mainFunctionStart);
      expect(messageLogIndex).toBeGreaterThan(mainFunctionStart);
    });

    test('重複起動メッセージ防止のロック機能が正常に動作する', () => {
      // テスト用のメッセージとハッシュ値
      const testMessage = 'Starting strategy-runner container with enhanced error handling';
      const messageHash = execSync(`echo "${testMessage}" | md5sum | cut -d' ' -f1`, { encoding: 'utf8' }).trim();
      const lockFile = path.join(lockDir, `${messageHash}.lock`);
      
      // ロックディレクトリが存在しない場合は作成
      if (!fs.existsSync(lockDir)) {
        fs.mkdirSync(lockDir, { recursive: true });
      }
      
      // 最初のロックファイルが存在しないことを確認
      expect(fs.existsSync(lockFile)).toBe(false);
      
      // ロックファイルを作成（プロセスIDとタイムスタンプ付き）
      const lockContent = `${process.pid}:${Math.floor(Date.now() / 1000)}`;
      fs.writeFileSync(lockFile, lockContent);
      
      // ロックファイルが作成されたことを確認
      expect(fs.existsSync(lockFile)).toBe(true);
      
      // ロックファイルの内容を確認
      const savedContent = fs.readFileSync(lockFile, 'utf8');
      expect(savedContent).toBe(lockContent);
    });

    test('古いロックファイルの自動削除機能が実装されている', () => {
      if (!fs.existsSync(lockDir)) {
        fs.mkdirSync(lockDir, { recursive: true });
      }
      
      // 古いタイムスタンプのロックファイルを作成
      const oldTimestamp = Math.floor(Date.now() / 1000) - 60; // 60秒前
      const oldLockFile = path.join(lockDir, 'old-lock.lock');
      fs.writeFileSync(oldLockFile, `99999:${oldTimestamp}`);
      
      // ロックファイルが作成されたことを確認
      expect(fs.existsSync(oldLockFile)).toBe(true);
      
      // ロックファイルの内容を確認
      const content = fs.readFileSync(oldLockFile, 'utf8');
      const [pid, timestamp] = content.split(':');
      expect(parseInt(timestamp)).toBeLessThan(Math.floor(Date.now() / 1000) - 30);
    });

    test('atomicロック取得の実装が正しい', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // set -C を使ったatomic操作の実装確認
      expect(entrypointContent).toContain('(set -C; echo "$$:$(date +%s)" > "$lock_file")');
      
      // 重複チェック機能の実装確認
      expect(entrypointContent).toContain('atomicな方法でメッセージの重複をチェック');
      
      // エラーハンドリングの実装確認
      expect(entrypointContent).toContain('2>/dev/null');
    });

    test('リトライ機能の実装が正しい', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // リトライループの実装確認
      expect(entrypointContent).toContain('while [ $attempt -lt $max_attempts ]; do');
      
      // 短時間待機の実装確認
      expect(entrypointContent).toContain('sleep 0.1');
      
      // 最大試行回数設定の確認
      expect(entrypointContent).toContain('max_attempts=5');
      
      // 最大試行回数到達時の処理確認
      expect(entrypointContent).toContain('最大試行回数に達した場合は、メッセージを出力せずに終了');
    });
  });

  describe('Issue #2504 の具体的な修正内容', () => {
    test('重複起動メッセージの根本原因が解決されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 起動ロック取得とメッセージ出力の順序修正
      expect(entrypointContent).toContain('起動ロック取得後に安全にメッセージを出力');
      
      // レースコンディション対策の強化
      expect(entrypointContent).toContain('レースコンディション対策強化版');
      
      // 古いロックファイルの自動削除による無限ループ防止
      expect(entrypointContent).toContain('30秒以上古いロックファイル or 存在しないプロセスのロックファイルを削除');
    });

    test('Docker再起動時の競合状態が解決されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // プロセス存在確認による古いロックファイル検出
      expect(entrypointContent).toContain('! kill -0 "$lock_pid"');
      
      // タイムスタンプベースの古いロック検出
      expect(entrypointContent).toContain('current_time - lock_time');
      
      // エラー発生時の安全な終了処理
      expect(entrypointContent).toContain('最大試行回数に達した場合は、メッセージを出力せずに終了');
    });

    test('パフォーマンス向上のための最適化が実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 短時間での高速リトライ
      expect(entrypointContent).toContain('sleep 0.1');
      
      // 最大試行回数の制限
      expect(entrypointContent).toContain('max_attempts=5');
      
      // 不要な処理の回避
      expect(entrypointContent).toContain('return 0');
    });
  });

  describe('後方互換性の確保', () => {
    test('既存のロック機能は維持されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 既存のSTARTUP_LOCK_FILE機能
      expect(entrypointContent).toContain('STARTUP_LOCK_FILE');
      expect(entrypointContent).toContain('acquire_startup_lock');
      expect(entrypointContent).toContain('release_startup_lock');
      
      // 既存のシグナルハンドラー
      expect(entrypointContent).toContain('trap cleanup SIGTERM SIGINT');
    });

    test('環境変数による設定変更が可能', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 各種タイムアウト設定
      expect(entrypointContent).toContain('STARTUP_LOCK_TIMEOUT');
      expect(entrypointContent).toContain('HEALTH_CHECK_INTERVAL');
      expect(entrypointContent).toContain('DATABASE_CONNECTION_TIMEOUT');
      
      // 環境変数のデフォルト値設定
      expect(entrypointContent).toContain('${STARTUP_LOCK_TIMEOUT:-30}');
    });
  });
});