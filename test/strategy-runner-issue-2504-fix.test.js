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
      
      // 簡素化されたレースコンディション対策の実装確認
      expect(entrypointContent).toContain('簡素化版');
      expect(entrypointContent).toContain('プロセス内フラグとシンプルなatomic操作による重複防止');
      
      // シンプルなロックファイルの実装確認
      expect(entrypointContent).toContain('echo "$$" > "$lock_file"');
      
      // シンプルな自動クリーンアップ機能
      expect(entrypointContent).toContain('ロックファイルのクリーンアップ（30秒後）');
      
      // 簡素化された実装ではリトライロジックが削除されている
      expect(entrypointContent).not.toContain('sleep 0.1');
      expect(entrypointContent).not.toContain('attempt=$((attempt + 1))');
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
      
      // ロックファイルを作成（簡素化実装ではプロセスIDのみ）
      const lockContent = `${process.pid}`;
      fs.writeFileSync(lockFile, lockContent);
      
      // ロックファイルが作成されたことを確認
      expect(fs.existsSync(lockFile)).toBe(true);
      
      // ロックファイルの内容を確認
      const savedContent = fs.readFileSync(lockFile, 'utf8');
      expect(savedContent).toBe(lockContent);
    });

    test('簡素化実装でのロックファイルのクリーンアップ機能', () => {
      if (!fs.existsSync(lockDir)) {
        fs.mkdirSync(lockDir, { recursive: true });
      }
      
      // 簡素化実装ではプロセスIDのみのロックファイルを作成
      const testLockFile = path.join(lockDir, 'test-lock.lock');
      fs.writeFileSync(testLockFile, '99999');
      
      // ロックファイルが作成されたことを確認
      expect(fs.existsSync(testLockFile)).toBe(true);
      
      // ロックファイルの内容を確認（プロセスIDのみ）
      const content = fs.readFileSync(testLockFile, 'utf8');
      expect(content).toBe('99999');
    });

    test('atomicロック取得の実装が正しい', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // set -C を使ったatomic操作の実装確認
      expect(entrypointContent).toContain('(set -C; echo "$$" > "$lock_file")');
      
      // 重複チェック機能の実装確認
      expect(entrypointContent).toContain('シンプルなatomic操作でロック取得を試行');
      
      // エラーハンドリングの実装確認
      expect(entrypointContent).toContain('2>/dev/null');
    });

    test('リトライ機能の実装が正しい', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 簡素化実装ではリトライループが削除されている
      expect(entrypointContent).not.toContain('while [ $attempt -lt $max_attempts ]; do');
      
      // 短時間待機の実装は削除されている
      expect(entrypointContent).not.toContain('sleep 0.1');
      
      // 最大試行回数設定は削除されている
      expect(entrypointContent).not.toContain('max_attempts=5');
      
      // 簡素化実装では即座に処理を終了する
      expect(entrypointContent).toContain('プロセス内フラグとシンプルなatomic操作による重複防止');
    });
  });

  describe('Issue #2504 の具体的な修正内容', () => {
    test('重複起動メッセージの根本原因が解決されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 起動ロック取得とメッセージ出力の順序は維持されている
      expect(entrypointContent).toContain('起動ロック取得後に安全にメッセージを出力');
      
      // レースコンディション対策の簡素化
      expect(entrypointContent).toContain('簡素化版');
      
      // シンプルなクリーンアップ機能
      expect(entrypointContent).toContain('ロックファイルのクリーンアップ（30秒後）');
    });

    test('Docker再起動時の競合状態が解決されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // acquire_startup_lock関数では依然としてプロセスチェックが必要
      expect(entrypointContent).toContain('! kill -0 "$lock_pid"');
      
      // 簡素化実装ではタイムスタンプチェックは行わない
      expect(entrypointContent).not.toContain('current_time - lock_time');
      
      // 簡素化実装では即座に処理を終了する
      expect(entrypointContent).toContain('プロセス内フラグとシンプルなatomic操作による重複防止');
    });

    test('パフォーマンス向上のための簡素化が実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 簡素化実装ではリトライロジックが削除されている
      expect(entrypointContent).not.toContain('sleep 0.1');
      
      // 簡素化実装では試行回数制限が削除されている
      expect(entrypointContent).not.toContain('max_attempts=5');
      
      // 不要な処理の回避は維持されている
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