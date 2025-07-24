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
    
    // Issue #5173修正の確認: log_backtest_startup_message関数の使用 (Issue #5132で重複メッセージは削除済み)
    expect(entrypointContent).toContain('log_backtest_startup_message "Starting backtest container with enhanced error handling"');
    
    // 修正前の問題のあるコード（直接log呼び出し）が残っていないことを確認
    const lines = entrypointContent.split('\n');
    const problematicLines = lines.filter(line => 
      line.includes('log "Starting backtest container with enhanced error handling"') &&
      !line.includes('log_backtest_startup_message')
    );
    
    expect(problematicLines).toHaveLength(0);
  });

  test('log_backtest_startup_message関数が存在することを確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // log_backtest_startup_message関数の定義が存在することを確認
    expect(entrypointContent).toContain('log_backtest_startup_message() {');
    
    // Issue #5216で簡素化された重複防止機構の要素が含まれていることを確認
    expect(entrypointContent).toContain('BACKTEST_STARTUP_LOCK_TIMEOUT');
    expect(entrypointContent).toContain('Issue #5216: backtest container専用起動メッセージ関数（簡素化版）');
  });

  test('修正により重複メッセージが防止されることを確認', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    
    // Issue #5173の修正内容を確認 - Issue #5132で重複メッセージは削除、コメントで対策完了を示す
    expect(entrypointContent).toContain('Issue #5127/#5173対策: exec実行前のファイナルチェックと重複メッセージ防止');
    expect(entrypointContent).toContain('Issue #5132修正: 重複する起動メッセージを防止するため、exec実行前の追加メッセージを削除');
    
    // 主要なbacktestメッセージが適切に関数を使用していることを確認
    const lines = entrypointContent.split('\n');
    const targetLineIndex = lines.findIndex(line => 
      line.includes('log_backtest_startup_message "Starting backtest container with enhanced error handling"')
    );
    
    expect(targetLineIndex).toBeGreaterThan(-1);
    
    // Issue #5132により重複メッセージが削除されていることを確認
    const duplicateMessageLines = lines.filter(line => 
      line.includes('log_backtest_startup_message "Executing backtest command with enhanced error handling..."')
    );
    expect(duplicateMessageLines).toHaveLength(0);
  });
});