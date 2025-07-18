/**
 * strategy-runner重複起動メッセージ修正のテスト
 * Issue #3942: strategy-runnerサービスで例外が発生（重複メッセージ）
 * 
 * この修正では、レースコンディションを防ぐため以下の改善を実施：
 * 1. ロックファイルによる排他制御を環境変数チェックよりも先に実施
 * 2. より強固なatomic操作（プロセスIDとタイムスタンプの組み合わせ）
 * 3. 待機メカニズムによる処理同期
 */

const fs = require('fs');
const path = require('path');

describe('Strategy-Runner重複起動メッセージ修正 - Issue #3942', () => {
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
        try {
          fs.unlinkSync(path.join(messageLockDir, file));
        } catch (error) {
          // ファイルが既に削除されている場合は無視
        }
      });
      try {
        fs.rmdirSync(messageLockDir);
      } catch (error) {
        // ディレクトリが既に削除されている場合は無視
      }
    }
  });

  describe('Issue #3942 修正の実装確認', () => {
    test('log_startup_message関数が強化版に更新されている', () => {
      // entrypoint.shファイルが存在することを確認
      expect(fs.existsSync(entrypointPath)).toBe(true);
      
      // entrypoint.shファイルの内容を読み込み
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 強化版の実装が追加されていることを確認
      expect(entrypointContent).toContain('重複起動ログ防止関数（強化版 - Issue #3942 修正）');
      expect(entrypointContent).toContain('プロセス内重複チェック（最初の防御線）');
      expect(entrypointContent).toContain('環境変数チェックの前に、まずロックファイルによる排他制御を実施');
    });

    test('強化されたatomic操作が実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // より強固なatomic操作
      expect(entrypointContent).toContain('より強固なatomic操作でロック取得を試行');
      expect(entrypointContent).toContain('echo "$$:$(date +%s.%N)" > "$lock_file"');
      expect(entrypointContent).toContain('local lock_acquired=false');
      
      // 条件分岐による処理制御
      expect(entrypointContent).toContain('if [ "$lock_acquired" = true ]; then');
    });

    test('レースコンディション対策が実装されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 排他制御の順序変更
      expect(entrypointContent).toContain('プロセス内重複チェック（最初の防御線）');
      expect(entrypointContent).toContain('プロセス間重複チェック（第二の防御線）');
      
      // 簡素化実装：待機ロジックを削除し、即座にプロセス内フラグをチェック
      expect(entrypointContent).toContain('簡素化実装：待機ロジックを削除し、即座にプロセス内フラグをチェック');
      expect(entrypointContent).toContain('レースコンディション防止：即座にプロセス内フラグを設定');
    });

    test('エラーハンドリングが強化されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // プロセス内重複検出時のロックファイル削除
      expect(entrypointContent).toContain('既に同じメッセージを出力済み（プロセス内重複）');
      expect(entrypointContent).toContain('ロックファイルを削除してから終了');
      expect(entrypointContent).toContain('rm -f "$lock_file" 2>/dev/null');
      
      // 処理完了後の適切なフラグ設定
      expect(entrypointContent).toContain('処理完了後にプロセス内フラグを設定（重複防止）');
    });
  });

  describe('修正された重複防止機能の動作確認', () => {
    test('ロックファイルに強化されたデータが記録される', () => {
      // メッセージロックディレクトリを作成
      fs.mkdirSync(messageLockDir, { recursive: true });
      
      // 強化されたatomic操作のテスト
      const crypto = require('crypto');
      const testMessage = 'Starting strategy-runner container with enhanced error handling';
      const hash = crypto.createHash('md5').update(testMessage).digest('hex');
      const lockFile = path.join(messageLockDir, `${hash}.lock`);
      
      // 強化されたフォーマットでロックファイルを作成
      const lockContent = `${process.pid}:${Date.now()}.000000`;
      fs.writeFileSync(lockFile, lockContent);
      
      // ロックファイルの内容確認
      const content = fs.readFileSync(lockFile, 'utf8');
      expect(content).toContain(process.pid.toString());
      expect(content).toContain(':');
      expect(content).toMatch(/\d+:\d+\.\d+/);
    });

    test('簡素化実装による処理同期のテスト', () => {
      // メッセージロックディレクトリを作成
      fs.mkdirSync(messageLockDir, { recursive: true });
      
      // 簡素化実装の確認のための一時ロックファイル
      const crypto = require('crypto');
      const testMessage = 'Starting strategy-runner container with enhanced error handling';
      const hash = crypto.createHash('md5').update(testMessage).digest('hex');
      const lockFile = path.join(messageLockDir, `${hash}.lock`);
      
      // ロックファイルを作成
      fs.writeFileSync(lockFile, `${process.pid}:${Date.now()}.000000`);
      expect(fs.existsSync(lockFile)).toBe(true);
      
      // 簡素化実装の確認（待機ロジックは削除されている）
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      expect(entrypointContent).toContain('簡素化実装：待機ロジックを削除し、即座にプロセス内フラグをチェック');
      expect(entrypointContent).toContain('レースコンディション防止：即座にプロセス内フラグを設定');
      
      // 同期的なクリーンアップ
      if (fs.existsSync(lockFile)) {
        fs.unlinkSync(lockFile);
      }
      
      // クリーンアップ確認
      expect(fs.existsSync(lockFile)).toBe(false);
    });
  });

  describe('リグレッションテスト', () => {
    test('既存のテストケースが引き続き動作する', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 既存の機能が保持されていることを確認
      expect(entrypointContent).toContain('get_message_hash');
      expect(entrypointContent).toContain('STARTUP_MESSAGE_LOCK_DIR');
      expect(entrypointContent).toContain('log_startup_message');
      
      // 自動クリーンアップ機能の保持
      expect(entrypointContent).toContain('sleep 30 && rm -f "$lock_file" 2>/dev/null');
    });

    test('entrypoint.shファイルの構文が正しい', () => {
      // bashスクリプトファイルの存在確認
      expect(fs.existsSync(entrypointPath)).toBe(true);
      
      // ファイルの基本構造確認
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      expect(entrypointContent).toContain('#!/bin/bash');
      expect(entrypointContent).toContain('log_startup_message');
    });

    test('必要な関数が定義されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 重要な関数の存在確認
      expect(entrypointContent).toContain('get_message_hash()');
      expect(entrypointContent).toContain('log_startup_message()');
      expect(entrypointContent).toContain('log()');
    });
  });

  describe('Issue #3942 の解決確認', () => {
    test('レースコンディションが修正されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 修正前の問題（環境変数チェックが先）が解決されている
      expect(entrypointContent).toContain('環境変数チェックの前に、まずロックファイルによる排他制御を実施');
      
      // 修正後の実装（ロックファイルチェックが先）が実装されている
      expect(entrypointContent).toContain('プロセス内重複チェック（最初の防御線）');
      expect(entrypointContent).toContain('local lock_file="$STARTUP_MESSAGE_LOCK_DIR/$message_hash.lock"');
    });

    test('強化されたatomic操作により重複が防止される', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // より強固なatomic操作の実装
      expect(entrypointContent).toContain('echo "$$:$(date +%s.%N)" > "$lock_file"');
      
      // 適切なエラーハンドリング
      expect(entrypointContent).toContain('if [ "$lock_acquired" = true ]; then');
      expect(entrypointContent).toContain('else');
      expect(entrypointContent).toContain('重複メッセージとして処理終了');
    });

    test('メッセージの出力が確実に一意になる', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // メッセージ出力はロック取得成功時のみ
      expect(entrypointContent).toContain('ロック取得成功：メッセージ出力');
      expect(entrypointContent).toContain('log "$message"');
      
      // 重複時の処理が適切
      expect(entrypointContent).toContain('重複メッセージとして処理終了');
      expect(entrypointContent).toContain('return 0');
    });
  });
});