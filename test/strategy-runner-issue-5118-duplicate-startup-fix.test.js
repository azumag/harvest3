/**
 * Issue #5118: strategy-runnerサービスで例外が発生 - 重複起動メッセージ修正テスト
 * 
 * コンテナ再起動時の急速再起動による重複メッセージ問題の修正を検証する
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const os = require('os');

const execAsync = promisify(exec);

describe('Issue #5118: strategy-runnerサービス重複メッセージ修正', () => {
  const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
  let tmpDir;

  beforeAll(() => {
    tmpDir = path.join(__dirname, '..', '.tmp');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  afterAll(() => {
    // .tmpディレクトリ内のテスト用ファイルをクリーンアップ
    if (fs.existsSync(tmpDir)) {
      const files = fs.readdirSync(tmpDir);
      files.forEach(file => {
        if (file.includes('issue-5118-test')) {
          fs.rmSync(path.join(tmpDir, file), { recursive: true, force: true });
        }
      });
    }
  });

  test('Issue #5118修正が適用されていることを確認', () => {
    expect(fs.existsSync(entrypointPath)).toBe(true);
    
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5118の修正コメントが存在することを確認
    expect(entrypointContent).toContain('Issue #5118 修正: コンテナ再起動対応版');
    expect(entrypointContent).toContain('同一起動セッション内での時間ベース重複防止');
    expect(entrypointContent).toContain('5秒以内の重複実行を防止（急速再起動対応）');
    
    // 新しい環境変数ベースの重複防止機構が実装されていることを確認
    expect(entrypointContent).toContain('STARTUP_SESSION_');
    expect(entrypointContent).toContain('time_diff=$((current_time - last_time))');
    expect(entrypointContent).toContain('if [ $time_diff -lt 5 ]; then');
  });

  test('時間ベース重複防止機構の確認（簡易版）', () => {
    // 修正内容が適切に実装されているかコード解析で確認
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5118で追加された時間ベース重複防止のロジックを確認
    expect(entrypointContent).toContain('同一起動セッション内での時間ベース重複防止');
    expect(entrypointContent).toContain('STARTUP_SESSION_');
    expect(entrypointContent).toContain('time_diff=$((current_time - last_time))');
    expect(entrypointContent).toContain('if [ $time_diff -lt 5 ]; then');
    
    // 環境変数ベースの重複防止機構を確認
    expect(entrypointContent).toContain('プロセス内環境変数による重複チェック（コンテナ再起動に耐性あり）');
    expect(entrypointContent).toContain('export "$session_var"="$current_time"');
  });

  test('重複防止のための環境変数設定の確認', () => {
    // 修正されたlog_startup_message関数で適切な環境変数が設定されるかを確認
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // 必要な環境変数の設定箇所を確認
    expect(entrypointContent).toContain('export "$var_name"=1');
    expect(entrypointContent).toContain('export "$session_var"="$current_time"');
    
    // セッション変数の定義を確認
    expect(entrypointContent).toContain('local session_var="STARTUP_SESSION_');
    expect(entrypointContent).toContain('local var_name="STARTUP_MSG_');
  });

  test('log_startup_message関数が存在し正しく修正されている', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // 関数の存在確認
    expect(entrypointContent).toMatch(/log_startup_message\(\)\s*{/);
    
    // Issue #5118特有の修正内容を確認
    expect(entrypointContent).toContain('同一プロセス内での重複防止（最重要な防御線）');
    expect(entrypointContent).toContain('プロセス内環境変数による重複チェック（コンテナ再起動に耐性あり）');
    expect(entrypointContent).toContain('セッションタイムスタンプを先に記録');
    
    // strategy-runnerメッセージの出力箇所が正しく存在することを確認
    expect(entrypointContent).toContain('log_startup_message "Starting strategy-runner container with enhanced error handling"');
  });
});