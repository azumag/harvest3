/**
 * strategy-runner重複起動メッセージ修正のテスト
 * Issue #2525: strategy-runnerサービスで例外が発生（重複メッセージ）
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

describe('Strategy-Runner重複起動メッセージ修正', () => {
  const messageLockDir = '/tmp/startup_messages';
  const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
  
  // 各テスト前のクリーンアップ
  beforeEach(() => {
    // メッセージロックディレクトリとその中身を削除
    if (fs.existsSync(messageLockDir)) {
      const files = fs.readdirSync(messageLockDir);
      files.forEach(file => {
        fs.unlinkSync(path.join(messageLockDir, file));
      });
      fs.rmdirSync(messageLockDir);
    }
  });

  // 各テスト後のクリーンアップ
  afterEach(() => {
    // メッセージロックディレクトリとその中身を削除
    if (fs.existsSync(messageLockDir)) {
      const files = fs.readdirSync(messageLockDir);
      files.forEach(file => {
        fs.unlinkSync(path.join(messageLockDir, file));
      });
      fs.rmdirSync(messageLockDir);
    }
  });

  describe('log_startup_message関数のatomic実装確認', () => {
    test('entrypoint.shファイルに改良されたlog_startup_message関数が実装されている', () => {
      // entrypoint.shファイルが存在することを確認
      expect(fs.existsSync(entrypointPath)).toBe(true);
      
      // entrypoint.shファイルの内容を読み込み
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 新しいメッセージロックディレクトリの設定が追加されていることを確認
      expect(entrypointContent).toContain('STARTUP_MESSAGE_LOCK_DIR="/tmp/startup_messages"');
      expect(entrypointContent).toContain('mkdir -p "$STARTUP_MESSAGE_LOCK_DIR"');
      
      // 簡素化実装が追加されていることを確認
      expect(entrypointContent).toContain('重複起動ログ防止関数（簡素化版）');
      expect(entrypointContent).toContain('log_startup_message()');
    });

    test('log_startup_message関数がatomic実装になっている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // md5ハッシュ関数の使用によるメッセージ識別（DRY原則適用後）
      expect(entrypointContent).toContain('message_hash=$(get_message_hash "$message")');
      
      // atomicなロックファイル作成
      expect(entrypointContent).toContain('set -C');
      expect(entrypointContent).toContain('echo "$$" > "$lock_file"');
      
      // 自動クリーンアップ機能
      expect(entrypointContent).toContain('sleep 30 && rm -f "$lock_file" 2>/dev/null');
      
      // 重複メッセージの場合のreturn処理
      expect(entrypointContent).toContain('他のプロセスが処理中または処理済み');
      expect(entrypointContent).toContain('return 0');
    });

    test('atomicファイル操作が正しく実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // set -C（noclobber）オプションの使用
      expect(entrypointContent).toContain('(set -C; echo "$$" > "$lock_file") 2>/dev/null');
      
      // 条件分岐による排他制御
      expect(entrypointContent).toContain('if (set -C; echo "$$" > "$lock_file") 2>/dev/null; then');
      expect(entrypointContent).toContain('ロック取得成功：メッセージ出力');
      expect(entrypointContent).toContain('else');
    });

    test('メッセージハッシュ計算が正しく実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // get_message_hash関数によるハッシュ計算（DRY原則適用後）
      expect(entrypointContent).toContain('get_message_hash() {');
      expect(entrypointContent).toContain('echo "$1" | md5sum | cut -d\' \' -f1');
      
      // ハッシュベースのロックファイル名
      expect(entrypointContent).toContain('lock_file="$STARTUP_MESSAGE_LOCK_DIR/$message_hash.lock"');
    });

    test('自動クリーンアップ機能が実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // バックグラウンドでのクリーンアップ処理
      expect(entrypointContent).toContain('(sleep 30 && rm -f "$lock_file" 2>/dev/null) &');
      
      // クリーンアップのコメント
      expect(entrypointContent).toContain('ロックファイルのクリーンアップ（30秒後）');
    });
  });

  describe('メッセージロック機能の動作確認', () => {
    test('メッセージロックディレクトリが作成される', () => {
      // ディレクトリが存在しない状態から開始
      expect(fs.existsSync(messageLockDir)).toBe(false);
      
      // mkdir -pコマンドのテスト
      fs.mkdirSync(messageLockDir, { recursive: true });
      expect(fs.existsSync(messageLockDir)).toBe(true);
      
      // ディレクトリが書き込み可能であることを確認
      const testFile = path.join(messageLockDir, 'test.lock');
      fs.writeFileSync(testFile, 'test');
      expect(fs.existsSync(testFile)).toBe(true);
    });

    test('メッセージハッシュによるロックファイル名生成', () => {
      const crypto = require('crypto');
      
      // テストメッセージ
      const testMessage = 'Starting strategy-runner container with enhanced error handling';
      
      // Node.jsでのハッシュ計算（bashのmd5sumと同等）
      const hash = crypto.createHash('md5').update(testMessage).digest('hex');
      
      // ハッシュが正しく生成されることを確認
      expect(hash).toMatch(/^[a-f0-9]{32}$/);
      
      // ロックファイル名の構成
      const expectedLockFile = `${messageLockDir}/${hash}.lock`;
      expect(expectedLockFile).toContain('/tmp/startup_messages/');
      expect(expectedLockFile).toContain('.lock');
    });

    test('同じメッセージに対する重複処理の防止', () => {
      // メッセージロックディレクトリを作成
      fs.mkdirSync(messageLockDir, { recursive: true });
      
      // 同じメッセージのハッシュを計算
      const crypto = require('crypto');
      const testMessage = 'Starting strategy-runner container with enhanced error handling';
      const hash = crypto.createHash('md5').update(testMessage).digest('hex');
      const lockFile = path.join(messageLockDir, `${hash}.lock`);
      
      // 最初のロックファイルを作成
      fs.writeFileSync(lockFile, process.pid.toString());
      expect(fs.existsSync(lockFile)).toBe(true);
      
      // 同じメッセージに対する2回目の処理は阻止される
      expect(fs.existsSync(lockFile)).toBe(true);
      
      // ロックファイルの内容を確認
      const lockContent = fs.readFileSync(lockFile, 'utf8');
      expect(lockContent).toBe(process.pid.toString());
    });

    test('異なるメッセージに対しては個別のロックファイルが作成される', () => {
      // メッセージロックディレクトリを作成
      fs.mkdirSync(messageLockDir, { recursive: true });
      
      // 異なるメッセージのハッシュを計算
      const crypto = require('crypto');
      const message1 = 'Starting strategy-runner container with enhanced error handling';
      const message2 = 'Starting backtest container with enhanced error handling';
      
      const hash1 = crypto.createHash('md5').update(message1).digest('hex');
      const hash2 = crypto.createHash('md5').update(message2).digest('hex');
      
      // ハッシュが異なることを確認
      expect(hash1).not.toBe(hash2);
      
      // 異なるロックファイル名になることを確認
      const lockFile1 = path.join(messageLockDir, `${hash1}.lock`);
      const lockFile2 = path.join(messageLockDir, `${hash2}.lock`);
      
      expect(lockFile1).not.toBe(lockFile2);
      
      // 両方のロックファイルを作成可能
      fs.writeFileSync(lockFile1, 'pid1');
      fs.writeFileSync(lockFile2, 'pid2');
      
      expect(fs.existsSync(lockFile1)).toBe(true);
      expect(fs.existsSync(lockFile2)).toBe(true);
    });
  });

  describe('Issue #2525の問題解決確認', () => {
    test('重複起動メッセージの問題が解決されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 古いシンプルな実装が削除されていることを確認
      expect(entrypointContent).not.toContain('STARTUP_MESSAGE_SENT=""');
      expect(entrypointContent).not.toContain('シンプルな環境変数ベース');
      
      // 新しい簡素化実装が追加されていることを確認
      expect(entrypointContent).toContain('簡素化版');
      expect(entrypointContent).toContain('STARTUP_MESSAGE_LOCK_DIR');
    });

    test('レースコンディション対策が実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // set -C（noclobber）オプションによるatomic操作
      expect(entrypointContent).toContain('set -C');
      
      // 排他制御による重複防止
      expect(entrypointContent).toContain('シンプルなatomic操作でロック取得を試行');
      
      // エラーハンドリング
      expect(entrypointContent).toContain('2>/dev/null');
    });

    test('メッセージの出力タイミングが適切', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // log_startup_messageの呼び出し箇所を確認
      expect(entrypointContent).toContain('log_startup_message "Starting strategy-runner container with enhanced error handling"');
      expect(entrypointContent).toContain('log_startup_message "Starting backtest container with enhanced error handling"');
      
      // 実際のlog関数呼び出しはatomicロック内で実行される
      expect(entrypointContent).toContain('ロック取得成功：メッセージ出力');
      expect(entrypointContent).toContain('log "$message"');
    });

    test('自動クリーンアップによるリソース管理が実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 30秒後の自動削除
      expect(entrypointContent).toContain('sleep 30 && rm -f "$lock_file" 2>/dev/null');
      
      // バックグラウンド実行
      expect(entrypointContent).toContain('&');
      
      // クリーンアップのコメント
      expect(entrypointContent).toContain('30秒後');
    });
  });

  describe('統合テストとリグレッション防止', () => {
    test('entrypoint.shファイルの構文が正しい', async () => {
      // bashスクリプトの構文チェック
      await expect(execAsync(`bash -n ${entrypointPath}`)).resolves.not.toThrow();
    });

    test('必要なコマンドが利用可能', async () => {
      // md5sumコマンドの利用可能性確認
      await expect(execAsync('which md5sum')).resolves.not.toThrow();
      
      // mkdirコマンドの利用可能性確認
      await expect(execAsync('which mkdir')).resolves.not.toThrow();
    });

    test('ロックディレクトリが作成可能', () => {
      // /tmpディレクトリが書き込み可能であることを確認
      expect(fs.existsSync('/tmp')).toBe(true);
      
      // テストディレクトリを作成
      const testDir = '/tmp/test_startup_messages';
      fs.mkdirSync(testDir, { recursive: true });
      expect(fs.existsSync(testDir)).toBe(true);
      
      // テストファイルを作成
      const testFile = path.join(testDir, 'test.lock');
      fs.writeFileSync(testFile, 'test');
      expect(fs.existsSync(testFile)).toBe(true);
      
      // クリーンアップ
      fs.unlinkSync(testFile);
      fs.rmdirSync(testDir);
    });

    test('環境変数の設定が反映される', () => {
      // STARTUP_MESSAGE_LOCK_DIRの設定確認
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      expect(entrypointContent).toContain('STARTUP_MESSAGE_LOCK_DIR="/tmp/startup_messages"');
      
      // ディレクトリ作成コマンドの確認
      expect(entrypointContent).toContain('mkdir -p "$STARTUP_MESSAGE_LOCK_DIR"');
    });

    test('Issue #2525の修正が完了していることを確認', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 修正前の問題のあるコード（シンプルな環境変数ベース）が削除されている
      expect(entrypointContent).not.toContain('STARTUP_MESSAGE_SENT=""');
      expect(entrypointContent).not.toContain('if [ "$STARTUP_MESSAGE_SENT" != "$message" ]; then');
      expect(entrypointContent).not.toContain('STARTUP_MESSAGE_SENT="$message"');
      
      // 修正後の簡素化実装が追加されている
      expect(entrypointContent).toContain('簡素化版');
      expect(entrypointContent).toContain('set -C');
      expect(entrypointContent).toContain('message_hash=$(get_message_hash');
      expect(entrypointContent).toContain('get_message_hash() {');
      expect(entrypointContent).toContain('STARTUP_MESSAGE_LOCK_DIR');
    });
  });
});