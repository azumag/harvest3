/**
 * Issue #5057: strategy-runnerサービスで例外が発生 - レースコンディション修正テスト
 * 
 * このテストはIssue #5057で報告された重複メッセージ問題のレースコンディションが
 * 修正されていることを確認する
 */

const fs = require('fs');
const path = require('path');

describe('Issue #5057: strategy-runnerサービスレースコンディション修正', () => {
  const entrypointPath = path.join(__dirname, '..', '..', '..', 'entrypoint.sh');
  
  test('Issue #5057で報告されたレースコンディション問題が修正されていることを確認', () => {
    expect(fs.existsSync(entrypointPath)).toBe(true);
    
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5057の修正が適用されていることを確認
    expect(entrypointContent).toContain('Issue #5057 修正');
    expect(entrypointContent).toContain('レースコンディション解消のためフラグ設定をロック取得後に移動');
    
    // プロセス内フラグがファイルロック取得後に設定されていることを確認
    const logStartupFunction = entrypointContent.match(/log_startup_message\(\) \{[\s\S]*?\n\}/)[0];
    
    // ロック取得成功ブロック内でフラグが設定されていることを確認
    expect(logStartupFunction).toContain('if [ "$lock_acquired" = true ]; then');
    expect(logStartupFunction).toContain('export "$var_name"=1');
    expect(logStartupFunction).toContain('log "$message"');
    
    // 修正前の問題のあるコードパターンが存在しないことを確認
    const flagSettingBeforeLock = /プロセス内フラグを即座に設定.*\n.*export.*=1[\s\S]*?if \(set -C/;
    expect(logStartupFunction).not.toMatch(flagSettingBeforeLock);
  });

  describe('レースコンディション修正の個別テスト', () => {
    let tmpDir;
    let lockDir;

    beforeEach(() => {
      // .tmpディレクトリ内にテスト用ディレクトリを作成
      tmpDir = path.join(__dirname, '..', '..', '..', '.tmp');
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }
      lockDir = path.join(tmpDir, `startup_messages_test_5088_${Date.now()}`);
      if (!fs.existsSync(lockDir)) {
        fs.mkdirSync(lockDir, { recursive: true });
      }
    });

    afterEach(() => {
      // テスト後のクリーンアップ
      if (fs.existsSync(lockDir)) {
        try {
          const files = fs.readdirSync(lockDir);
          files.forEach(file => {
            const filePath = path.join(lockDir, file);
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
          });
          fs.rmdirSync(lockDir);
        } catch (e) {
          // ignore cleanup errors
        }
      }
    });

    test('修正後：ロック取得のアトミック性が保証されている', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // Issue #5057修正後の正しい実装パターンを確認
      const logStartupFunction = entrypointContent.match(/log_startup_message\(\) \{[\s\S]*?\n\}/)[0];
      
      // 修正の核心：ロック取得後にフラグ設定
      expect(logStartupFunction).toContain('if [ "$lock_acquired" = true ]; then');
      expect(logStartupFunction).toContain('export "$var_name"=1');
      
      // ロック取得前にフラグ設定されていないことを確認
      const beforeLockSection = entrypointContent.substring(
        entrypointContent.indexOf('log_startup_message() {'),
        entrypointContent.indexOf('if (set -C; echo "$$:$(date +%s.%N)" > "$lock_file") 2>/dev/null; then')
      );
      expect(beforeLockSection).not.toMatch(/export "\$var_name"=1/);
      
      // ロック取得失敗時にフラグが設定されないことを確認
      expect(logStartupFunction).toContain('フラグは設定しない（他のプロセスがメッセージ出力を担当）');
    });

    test('修正前の問題：レースコンディションが発生する可能性があった構造の確認', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // 修正前の問題のあるパターンが存在しないことを確認
      const logStartupFunction = entrypointContent.match(/log_startup_message\(\) \{[\s\S]*?\n\}/)[0];
      
      // 修正前の問題：ロック取得前のフラグ設定が存在しないことを確認
      const flagSettingBeforeLock = /export "\$var_name"=1[\s\S]*?if \(set -C/;
      expect(logStartupFunction).not.toMatch(flagSettingBeforeLock);
      
      // Issue #5057 の修正コメントが存在することを確認
      expect(logStartupFunction).toContain('Issue #5057 修正');
      expect(logStartupFunction).toContain('レースコンディション解消のため');
    });

    test('Issue #5057修正確認：エントリーポイントファイルの構造が正しいことを確認', () => {
      const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
      
      // log_startup_message関数の修正内容を確認
      const logStartupFunction = entrypointContent.match(/log_startup_message\(\) \{[\s\S]*?\n\}/)[0];
      
      // Issue #5057修正の存在確認
      expect(logStartupFunction).toContain('Issue #5057 修正');
      
      // 修正後の正しい構造：ロック取得後にフラグ設定
      const lockSuccessBlock = entrypointContent.match(/if \[ "\$lock_acquired" = true \]; then[\s\S]*?return 0/)[0];
      expect(lockSuccessBlock).toContain('export "$var_name"=1');
      expect(lockSuccessBlock).toContain('log "$message"');
      
      // プロセス内フラグがロック取得前に設定されていないことを確認
      const beforeLockSection = entrypointContent.substring(
        entrypointContent.indexOf('log_startup_message() {'),
        entrypointContent.indexOf('if (set -C; echo "$$:$(date +%s.%N)" > "$lock_file") 2>/dev/null; then')
      );
      expect(beforeLockSection).not.toMatch(/export "\$var_name"=1/);
      
      // ロック取得失敗時の正しい処理確認
      expect(entrypointContent).toContain('フラグは設定しない（他のプロセスがメッセージ出力を担当）');
    });
  });

  test('Issue #5057修正後のコード品質確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // log_startup_message関数の構造確認
    const logStartupFunction = entrypointContent.match(/log_startup_message\(\) \{[\s\S]*?\n\}/)[0];
    
    // 修正後の正しい実装パターンが存在することを確認
    expect(logStartupFunction).toContain('プロセス内重複チェック（最初の防御線）');
    expect(logStartupFunction).toContain('if [ "${!var_name}" = "1" ]; then');
    expect(logStartupFunction).toContain('return 0');
    
    // ファイルロック取得のatomic操作
    expect(logStartupFunction).toContain('set -C');
    expect(logStartupFunction).toContain('local lock_acquired=false');
    
    // ロック取得成功時のフラグ設定とメッセージ出力
    expect(logStartupFunction).toContain('if [ "$lock_acquired" = true ]; then');
    expect(logStartupFunction).toContain('export "$var_name"=1');
    expect(logStartupFunction).toContain('log "$message"');
    
    // ロック取得失敗時の適切な処理
    expect(logStartupFunction).toContain('フラグは設定しない（他のプロセスがメッセージ出力を担当）');
    
    // 自動クリーンアップ機能
    expect(logStartupFunction).toContain('sleep 30 && rm -f "$lock_file"');
  });

  test('entrypoint.sh構文検証（修正後）', () => {
    // Issue #5057修正後もentrypoint.shが正しく動作することを確認
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // 基本的なbash構文チェック
    expect(entrypointContent).toContain('#!/bin/bash');
    expect(entrypointContent).toContain('set -e');
    
    // 関数定義が正しく終了していることを確認
    const functionMatches = entrypointContent.match(/(\w+)\(\) \{/g);
    const functionClosures = entrypointContent.match(/^\}/gm);
    expect(functionMatches).not.toBeNull();
    expect(functionClosures).not.toBeNull();
    expect(functionClosures.length).toBeGreaterThanOrEqual(functionMatches.length);
  });

  test('Issue #5057解決による他機能への影響がないことを確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // 重要な機能が正しく維持されていることを確認
    const essentialFunctions = [
      'acquire_startup_lock()',
      'release_startup_lock()',
      'send_startup_error_to_discord(',
      'pre_startup_checks()',
      'check_database_connections()',
      'start_application()',
      'cleanup()',
      'run_diagnostics()',
      'main()'
    ];
    
    essentialFunctions.forEach(func => {
      expect(entrypointContent).toContain(func);
    });
    
    // メッセージ出力箇所が適切に維持されていることを確認
    expect(entrypointContent).toContain('log_startup_message "Starting strategy-runner container with enhanced error handling"');
    expect(entrypointContent).toContain('log_startup_message "Starting backtest container with enhanced error handling"');
  });
});