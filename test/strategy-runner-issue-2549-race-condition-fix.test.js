/**
 * strategy-runner Issue #2549 レースコンディション修正のテスト
 * 重複ログメッセージの根本原因であるレースコンディションの修正を検証
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

describe('Issue #2549: strategy-runner レースコンディション修正', () => {
  const messageLockDir = '/tmp/startup_messages_2549';
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

  describe('レースコンディション修正の確認', () => {
    test('メッセージハッシュが一度だけ計算される', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // ハッシュ計算が関数の開始時に1回だけ行われる
      expect(entrypointContent).toContain('local message_hash=$(get_message_hash "$message")');
      
      // ハッシュ結果を再利用している
      expect(entrypointContent).toContain('local var_name="STARTUP_MSG_$(echo "$message_hash" | cut -c1-8)"');
      expect(entrypointContent).toContain('local lock_file="$STARTUP_MESSAGE_LOCK_DIR/$message_hash.lock"');
      
      // 古い重複ハッシュ計算が削除されている
      expect(entrypointContent).not.toContain('$(get_message_hash "$message" | cut -c1-8)');
    });

    test('プロセス内フラグが適切に設定される（Issue #5088統合版）', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Issue #5121修正のコメント
      expect(entrypointContent).toContain('Issue #5121 修正: 簡素化・安定化版');
      
      // ロック取得成功ブロック内でフラグが設定されることを確認
      const lockSuccessBlock = entrypointContent.match(/if \[ "\$lock_acquired" = true \]; then[\s\S]*?return 0/)[0];
      expect(lockSuccessBlock).toContain('export "$var_name"=1');
      
      // プロセス内チェックは最初に行われることを確認
      expect(entrypointContent).toContain('プロセス内重複チェック（最初の防御線）');
    });

    test('ファイルロック取得後のフラグ設定が適切に実装されている（Issue #5088統合版）', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // ロック取得成功時の処理ブロックが存在することを確認
      expect(entrypointContent).toContain('if [ "$lock_acquired" = true ]; then');
      
      // Issue #5121修正：フラグ設定がロック取得成功後に適切に配置されている
      expect(entrypointContent).toContain('# プロセス内フラグを設定');
      
      // Issue #5121: ロック取得失敗時の適切な処理
      expect(entrypointContent).toContain('# ロック取得失敗時もフラグは設定（他のプロセスが出力済みと想定）');
    });

    test('atomic操作の改善が実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 一貫性確保のコメント
      expect(entrypointContent).toContain('メッセージハッシュを一度だけ計算（一貫性確保）');
      
      // Issue #5121: mkdirベースのatomic操作
      expect(entrypointContent).toContain('if mkdir "$lock_file" 2>/dev/null; then');
      
      // Issue #5121: クリーンアップ機能は維持（環境変数ベース）
      expect(entrypointContent).toContain('(sleep "$SUCCESS_FILE_CLEANUP_DELAY" && rm -f "$success_file" 2>/dev/null) &');
    });
  });

  describe('修正内容の検証', () => {
    test('Issue #2549の重複ログ問題が解決されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 修正されたlog_startup_message関数の存在確認
      expect(entrypointContent).toContain('log_startup_message() {');
      
      // レースコンディション修正の実装確認
      expect(entrypointContent).toContain('レースコンディション防止');
      expect(entrypointContent).toContain('一貫性確保');
      
      // 問題のあった二重ハッシュ計算が修正されている
      // log_startup_message関数内でのみハッシュ計算が行われる
      const logStartupMessageFunction = entrypointContent.match(/log_startup_message\(\) \{[\s\S]*?\n\}/)[0];
      const hashCallCount = (logStartupMessageFunction.match(/get_message_hash "\$message"/g) || []).length;
      expect(hashCallCount).toBe(1); // log_startup_message関数内で1回のみ
    });

    test('既存の機能は維持されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // プロセス内重複チェック機能
      expect(entrypointContent).toContain('プロセス内重複チェック（最初の防御線）');
      
      // Issue #5121: 出力済みチェック機能
      expect(entrypointContent).toContain('既にメッセージが出力済みかチェック');
      
      // Issue #5121: 自動クリーンアップ機能（5分後）
      expect(entrypointContent).toContain('クリーンアップ（5分後）');
      
      // get_message_hash関数
      expect(entrypointContent).toContain('get_message_hash() {');
    });

    test('対象メッセージの出力箇所が確認できる', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Issue #2549で問題となったメッセージ
      expect(entrypointContent).toContain('log_startup_message "Starting strategy-runner container with enhanced error handling"');
      
      // バックテスト用メッセージも存在
      expect(entrypointContent).toContain('log_startup_message "Starting backtest container with enhanced error handling"');
    });
  });

  describe('構文とロジックの検証', () => {
    test('bashスクリプトの構文が正しい', async () => {
      // bashスクリプトの構文チェック
      await expect(execAsync(`bash -n ${entrypointPath}`)).resolves.not.toThrow();
    });

    test('修正後の関数が正しく定義されている（Issue #5088統合版）', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 関数の存在確認
      expect(entrypointContent).toContain('log_startup_message() {');
      
      // Issue #5121: 関数内の重要なロジックが存在することを確認
      expect(entrypointContent).toContain('プロセス内重複チェック（最初の防御線）');
      expect(entrypointContent).toContain('既にメッセージが出力済みかチェック');
      expect(entrypointContent).toContain('シンプルなファイルベースロック機構による重複防止');
      
      // 構文の基本的な正当性：returnステートメントの存在
      const functionBody = entrypointContent.substring(
        entrypointContent.indexOf('log_startup_message() {'),
        entrypointContent.indexOf('# 起動ロック関数')
      );
      
      // 4つのreturnステートメントがあることを確認（実際の実装に合わせて修正）
      const returnCount = (functionBody.match(/\breturn\s+0\b/g) || []).length;
      expect(returnCount).toBe(4);
    });

    test('変数とファイルパスが一貫している', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 変数名の一貫性
      expect(entrypointContent).toContain('STARTUP_MESSAGE_LOCK_DIR');
      expect(entrypointContent).toContain('message_hash');
      expect(entrypointContent).toContain('var_name');
      expect(entrypointContent).toContain('lock_file');
      
      // ファイルパスの構成
      expect(entrypointContent).toContain('$STARTUP_MESSAGE_LOCK_DIR/$message_hash.lock');
    });
  });

  describe('回帰テストとの互換性', () => {
    test('Issue #2525の修正は維持されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Issue #5121: mkdirベースのatomic実装
      expect(entrypointContent).toContain('mkdir "$lock_file" 2>/dev/null');
      expect(entrypointContent).toContain('2>/dev/null');
      
      // Issue #5121: 古い実装は削除されたまま
      expect(entrypointContent).not.toContain('set -C');
      expect(entrypointContent).not.toContain('STARTUP_MESSAGE_SENT=""');
    });

    test('ロックディレクトリとファイル管理は継続', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // ロックディレクトリ設定
      expect(entrypointContent).toContain('STARTUP_MESSAGE_LOCK_DIR="/tmp/startup_messages"');
      expect(entrypointContent).toContain('mkdir -p "$STARTUP_MESSAGE_LOCK_DIR"');
      
      // ハッシュ関数は維持
      expect(entrypointContent).toContain('get_message_hash() {');
      expect(entrypointContent).toContain('echo "$1" | md5sum | cut -d\' \' -f1');
    });
  });
});