/**
 * Issue #5173: backtestサービスで例外が発生 - 修正確認テスト
 * 
 * 重複メッセージ "Executing backtest command with enhanced error handling..." の修正テスト
 * - entrypoint.sh line 1206 で log_backtest_startup_message 関数を使用することを確認
 * - 重複防止機構が正しく動作することを確認
 */

const fs = require('fs');
const path = require('path');

describe('Issue #5173: backtestサービス重複メッセージ修正', () => {
  const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');

  test('Issue #5173修正がentrypoint.shに適用されていることを確認', () => {
    expect(fs.existsSync(entrypointPath)).toBe(true);
    
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5173修正の確認: log_backtest_startup_message関数の使用
    expect(entrypointContent).toContain('log_backtest_startup_message "Executing backtest command with enhanced error handling..."');
    
    // 修正前の問題のあるコード（直接log呼び出し）が残っていないことを確認
    const lines = entrypointContent.split('\n');
    const problematicLines = lines.filter(line => 
      line.includes('log "Executing backtest command with enhanced error handling..."') &&
      !line.includes('log_backtest_startup_message')
    );
    
    expect(problematicLines).toHaveLength(0);
  });

  test('log_backtest_startup_message関数が存在することを確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // log_backtest_startup_message関数の定義が存在することを確認
    expect(entrypointContent).toContain('log_backtest_startup_message() {');
    
    // 重複防止機構の要素が含まれていることを確認
    expect(entrypointContent).toContain('BACKTEST_STARTUP_LOCK_TIMEOUT');
    expect(entrypointContent).toContain('container restart detection');
    expect(entrypointContent).toContain('instance_id');
  });

  test('修正により重複メッセージが防止されることを確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5173の修正内容を確認
    expect(entrypointContent).toContain('Issue #5127対策: exec実行前のファイナルチェックとエラーハンドリング強化');
    
    // 修正された行を確認
    const lines = entrypointContent.split('\n');
    const targetLineIndex = lines.findIndex(line => 
      line.includes('log_backtest_startup_message "Executing backtest command with enhanced error handling..."')
    );
    
    expect(targetLineIndex).toBeGreaterThan(-1);
    
    // 前後の行も確認して文脈が正しいことを検証
    const previousLine = lines[targetLineIndex - 1];
    expect(previousLine).toContain('Issue #5127対策: exec実行前のファイナルチェックとエラーハンドリング強化');
  });
});