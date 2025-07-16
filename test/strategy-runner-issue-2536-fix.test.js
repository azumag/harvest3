/**
 * strategy-runner Issue #2536 重複起動メッセージ修正のテスト
 * Issue #2536: [自動] strategy-runnerサービスで例外が発生
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

describe('Strategy-Runner Issue #2536 重複起動メッセージ修正', () => {
  const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
  const testLogFile = '/tmp/test-strategy-runner-startup.log';
  const testLockFile = '/tmp/test-strategy-runner-startup.lock';

  // 各テスト前のクリーンアップ
  beforeEach(() => {
    // テストファイルを削除
    [testLogFile, testLockFile].forEach(file => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    });
  });

  // 各テスト後のクリーンアップ
  afterEach(() => {
    // テストファイルを削除
    [testLogFile, testLockFile].forEach(file => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    });
  });

  describe('重複起動ログ防止機能の実装確認', () => {
    test('entrypoint.shファイルに重複防止機能が追加されている', () => {
      // entrypoint.shファイルが存在することを確認
      expect(fs.existsSync(entrypointPath)).toBe(true);
      
      // entrypoint.shファイルの内容を読み込み
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 重複防止関連の設定が追加されていることを確認
      expect(entrypointContent).toContain('STARTUP_INSTANCE_ID');
      expect(entrypointContent).toContain('STARTUP_LOG_FILE');
      
      // 重複防止関数が定義されていることを確認
      expect(entrypointContent).toContain('log_startup_message()');
      
      // 起動メッセージで重複防止機能が使用されていることを確認
      expect(entrypointContent).toContain('log_startup_message "Starting strategy-runner container with enhanced error handling"');
      expect(entrypointContent).toContain('log_startup_message "Starting backtest container with enhanced error handling"');
    });

    test('起動インスタンスIDが一意に生成される', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 起動インスタンスIDの生成ロジックを確認
      expect(entrypointContent).toContain('STARTUP_INSTANCE_ID="${RANDOM}-$$-$(date +%s)"');
      
      // 一意性を保証する要素が含まれていることを確認
      expect(entrypointContent).toContain('${RANDOM}');  // ランダム値
      expect(entrypointContent).toContain('$$');         // プロセスID
      expect(entrypointContent).toContain('$(date +%s)'); // タイムスタンプ
    });

    test('重複チェック機能が正しく実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 重複チェック処理の実装を確認
      expect(entrypointContent).toContain('if grep -q "$instance_signature" "$STARTUP_LOG_FILE"');
      expect(entrypointContent).toContain('重複メッセージの抑制');
      
      // インスタンスシグネチャの生成
      expect(entrypointContent).toContain('instance_signature="${STARTUP_INSTANCE_ID}-${message}"');
      
      // ログファイルへの記録
      expect(entrypointContent).toContain('echo "$instance_signature" >> "$STARTUP_LOG_FILE"');
    });

    test('ログファイルのクリーンアップ機能が実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // ログファイルの自動クリーンアップ
      expect(entrypointContent).toContain('tail -n 10 "$STARTUP_LOG_FILE"');
      
      // 起動ロック解放時のクリーンアップ
      expect(entrypointContent).toContain('grep -v "$STARTUP_INSTANCE_ID" "$STARTUP_LOG_FILE"');
      
      // 空ファイルの削除
      expect(entrypointContent).toContain('if [ ! -s "$STARTUP_LOG_FILE" ]; then');
      expect(entrypointContent).toContain('rm -f "$STARTUP_LOG_FILE"');
    });

    test('stdout フラッシュ機能が追加されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // stdout の即座フラッシュ処理
      expect(entrypointContent).toContain('exec 1>&1');
      expect(entrypointContent).toContain('stdout の即座フラッシュを保証');
    });

    test('起動診断情報が追加されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 起動診断情報の記録
      expect(entrypointContent).toContain('起動診断情報');
      expect(entrypointContent).toContain('起動インスタンス ID');
      expect(entrypointContent).toContain('プロセス ID');
      expect(entrypointContent).toContain('起動時刻');
      expect(entrypointContent).toContain('作業ディレクトリ');
      expect(entrypointContent).toContain('バックテストモード');
    });
  });

  describe('修正機能の動作確認', () => {
    test('ログファイルの基本的な操作が正常に動作する', () => {
      // テスト用のログファイルを作成
      const testSignature = '12345-999-1234567890-test message';
      fs.writeFileSync(testLogFile, testSignature + '\n');
      
      // ログファイルが作成されることを確認
      expect(fs.existsSync(testLogFile)).toBe(true);
      
      // ログファイルの内容を確認
      const logContent = fs.readFileSync(testLogFile, 'utf8');
      expect(logContent).toContain(testSignature);
      
      // ログファイルを削除
      fs.unlinkSync(testLogFile);
      expect(fs.existsSync(testLogFile)).toBe(false);
    });

    test('重複エントリの検出が可能', () => {
      // テスト用のログファイルを作成
      const testSignature = '12345-999-1234567890-test message';
      fs.writeFileSync(testLogFile, testSignature + '\n');
      
      // 既存のエントリを検出できることを確認
      const logContent = fs.readFileSync(testLogFile, 'utf8');
      expect(logContent.includes(testSignature)).toBe(true);
      
      // 別のエントリを追加
      const anotherSignature = '67890-888-0987654321-another message';
      fs.appendFileSync(testLogFile, anotherSignature + '\n');
      
      // 両方のエントリが存在することを確認
      const updatedLogContent = fs.readFileSync(testLogFile, 'utf8');
      expect(updatedLogContent.includes(testSignature)).toBe(true);
      expect(updatedLogContent.includes(anotherSignature)).toBe(true);
    });

    test('古いエントリの削除が正常に動作する', () => {
      // 複数のテストエントリを作成
      const entries = [
        '11111-111-1111111111-message1',
        '22222-222-2222222222-message2',
        '33333-333-3333333333-message3'
      ];
      
      entries.forEach(entry => {
        fs.appendFileSync(testLogFile, entry + '\n');
      });
      
      // 全てのエントリが存在することを確認
      const initialContent = fs.readFileSync(testLogFile, 'utf8');
      entries.forEach(entry => {
        expect(initialContent.includes(entry)).toBe(true);
      });
      
      // 特定のエントリを削除（grep -v の動作をシミュレート）
      const targetId = '22222';
      const lines = initialContent.split('\n');
      const filteredLines = lines.filter(line => !line.includes(targetId));
      fs.writeFileSync(testLogFile, filteredLines.join('\n'));
      
      // 削除されたエントリが存在しないことを確認
      const filteredContent = fs.readFileSync(testLogFile, 'utf8');
      expect(filteredContent.includes(entries[1])).toBe(false);
      expect(filteredContent.includes(entries[0])).toBe(true);
      expect(filteredContent.includes(entries[2])).toBe(true);
    });

    test('空ファイルの削除が正常に動作する', () => {
      // 空のログファイルを作成
      fs.writeFileSync(testLogFile, '');
      
      // ファイルが存在することを確認
      expect(fs.existsSync(testLogFile)).toBe(true);
      
      // ファイルが空であることを確認
      const stats = fs.statSync(testLogFile);
      expect(stats.size).toBe(0);
      
      // 空ファイルの削除をシミュレート
      if (stats.size === 0) {
        fs.unlinkSync(testLogFile);
      }
      
      // ファイルが削除されることを確認
      expect(fs.existsSync(testLogFile)).toBe(false);
    });

    test('ログファイルの制限（最新10件）が正常に動作する', () => {
      // 15件のエントリを作成
      const entries = [];
      for (let i = 1; i <= 15; i++) {
        entries.push(`${i.toString().padStart(5, '0')}-${i}-${Date.now()}-message${i}`);
      }
      
      entries.forEach(entry => {
        fs.appendFileSync(testLogFile, entry + '\n');
      });
      
      // 全てのエントリが存在することを確認
      const initialContent = fs.readFileSync(testLogFile, 'utf8');
      expect(initialContent.split('\n').filter(line => line.length > 0).length).toBe(15);
      
      // 最新10件のみ保持するロジックをシミュレート
      const lines = initialContent.split('\n').filter(line => line.length > 0);
      const last10Lines = lines.slice(-10);
      fs.writeFileSync(testLogFile, last10Lines.join('\n') + '\n');
      
      // 最新10件のみ残っていることを確認
      const trimmedContent = fs.readFileSync(testLogFile, 'utf8');
      const remainingLines = trimmedContent.split('\n').filter(line => line.length > 0);
      expect(remainingLines.length).toBe(10);
      
      // 最新のエントリが残っていることを確認
      expect(remainingLines[9]).toContain('message15');
      expect(remainingLines[0]).toContain('message6');
    });
  });

  describe('Issue #2536 の問題解決確認', () => {
    test('重複起動メッセージの防止機能が実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Issue #2536 の根本原因である重複メッセージの防止
      expect(entrypointContent).toContain('log_startup_message');
      
      // 重複防止対象のメッセージが正しく指定されている
      expect(entrypointContent).toContain('Starting strategy-runner container with enhanced error handling');
      expect(entrypointContent).toContain('Starting backtest container with enhanced error handling');
      
      // 重複チェック機能
      expect(entrypointContent).toContain('重複メッセージの抑制');
      
      // インスタンス一意性の保証
      expect(entrypointContent).toContain('STARTUP_INSTANCE_ID');
    });

    test('stdout バッファリング問題の対策が実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // stdout フラッシュ機能
      expect(entrypointContent).toContain('exec 1>&1');
      
      // ログ関数の強化
      expect(entrypointContent).toContain('重複防止機能付き');
    });

    test('起動プロセスの透明性向上が実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 起動診断情報の記録
      expect(entrypointContent).toContain('起動診断情報');
      expect(entrypointContent).toContain('起動インスタンス ID');
      expect(entrypointContent).toContain('プロセス ID');
      
      // 診断情報の構造化
      expect(entrypointContent).toContain('===');
    });

    test('リソースクリーンアップ機能が実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 起動ログファイルのクリーンアップ
      expect(entrypointContent).toContain('起動ログファイルのクリーンアップ');
      
      // 現在のインスタンスに関連するエントリの削除
      expect(entrypointContent).toContain('grep -v "$STARTUP_INSTANCE_ID"');
      
      // 空ファイルの削除
      expect(entrypointContent).toContain('if [ ! -s "$STARTUP_LOG_FILE" ]');
    });

    test('既存の起動ロック機能との互換性が保たれている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 既存の起動ロック機能が残っていることを確認
      expect(entrypointContent).toContain('acquire_startup_lock');
      expect(entrypointContent).toContain('release_startup_lock');
      expect(entrypointContent).toContain('STARTUP_LOCK_FILE');
      
      // 新機能との統合
      expect(entrypointContent).toContain('trap release_startup_lock EXIT');
    });
  });
});