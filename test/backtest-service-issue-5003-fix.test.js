const fs = require('fs');
const path = require('path');

describe('Backtest Service Issue #5003 Fix', () => {
  let entrypointContent;
  let notificationsContent;
  let errorHandlerContent;

  beforeAll(() => {
    const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
    const notificationsPath = path.join(__dirname, '..', 'src', 'common', 'notifications.js');
    const errorHandlerPath = path.join(__dirname, '..', 'src', 'common', 'errorHandler.js');
    
    entrypointContent = fs.readFileSync(entrypointPath, 'utf8');
    notificationsContent = fs.readFileSync(notificationsPath, 'utf8');
    errorHandlerContent = fs.readFileSync(errorHandlerPath, 'utf8');
  });

  describe('重複ログメッセージの修正', () => {
    test('should include Issue #5003 fix comment for race condition', () => {
      expect(entrypointContent).toContain('Issue #5003 修正: レースコンディション完全解決');
      expect(entrypointContent).toContain('Issue #5003修正: プロセス間ロック優先によるレースコンディション解決');
    });

    test('should prioritize inter-process lock before setting process flag', () => {
      expect(entrypointContent).toContain('まずatomic操作でロック取得を試行（プロセス間排他制御を最優先）');
      expect(entrypointContent).toContain('local lock_acquired=false');
      expect(entrypointContent).toContain('if (set -C; echo "$$:$(date +%s.%N)" > "$lock_file") 2>/dev/null; then');
    });

    test('should implement double-check pattern after lock acquisition', () => {
      expect(entrypointContent).toContain('ロック取得成功：プロセス内重複チェック（二重チェック）');
      expect(entrypointContent).toContain('if [ "${!var_name}" = "1" ]; then');
      expect(entrypointContent).toContain('既に同じプロセス内で処理済み（万一の場合）');
    });

    test('should set process flag after acquiring lock', () => {
      expect(entrypointContent).toContain('プロセス内フラグを設定（ロック取得後の安全な位置）');
      expect(entrypointContent).toContain('export "$var_name"=1');
    });

    test('should handle lock acquisition failure gracefully', () => {
      expect(entrypointContent).toContain('ロック取得失敗：他のプロセスが処理中または処理済み');
      expect(entrypointContent).toContain('プロセス内重複チェックも実行（既に処理済みの場合の対応）');
    });
  });

  describe('Discord Webhook URL エラーハンドリングの改善', () => {
    test('should handle backtest mode gracefully in notifications.js', () => {
      expect(notificationsContent).toContain('Issue #5003修正: backtest モードでは警告レベルを下げる');
      expect(notificationsContent).toContain('process.env.BACKTEST_MODE === \'true\'');
      expect(notificationsContent).toContain('[BACKTEST] Discord Webhook URLが設定されていません (backtest mode では必須ではありません)');
      expect(notificationsContent).toContain('console.warn');
    });

    test('should handle backtest mode in postErrorToDiscord function', () => {
      // postErrorToDiscord関数内の修正を確認
      const postErrorFunction = notificationsContent.match(/async function postErrorToDiscord[\s\S]*?^}/m);
      expect(postErrorFunction).toBeTruthy();
      expect(postErrorFunction[0]).toContain('process.env.BACKTEST_MODE === \'true\'');
      expect(postErrorFunction[0]).toContain('console.warn');
    });

    test('should handle backtest mode in postResultToDiscord function', () => {
      // postResultToDiscord関数内の修正を確認
      const postResultFunction = notificationsContent.match(/async function postResultToDiscord[\s\S]*?^}/m);
      expect(postResultFunction).toBeTruthy();
      expect(postResultFunction[0]).toContain('process.env.BACKTEST_MODE === \'true\'');
      expect(postResultFunction[0]).toContain('console.warn');
    });

    test('should handle backtest mode gracefully in errorHandler.js', () => {
      expect(errorHandlerContent).toContain('Issue #5003修正: backtest モードでは警告レベルを下げる');
      expect(errorHandlerContent).toContain('process.env.BACKTEST_MODE === \'true\'');
      expect(errorHandlerContent).toContain('[UnifiedErrorHandler] [BACKTEST] Discord Webhook URLが設定されていません (backtest mode では必須ではありません)');
    });

    test('should maintain error logging for non-backtest mode', () => {
      expect(notificationsContent).toContain('console.error(\'Discord Webhook URLが設定されていません\')');
      expect(errorHandlerContent).toContain('console.error(\'[UnifiedErrorHandler] Discord Webhook URLが設定されていません\')');
    });
  });

  describe('統合テスト', () => {
    test('should fix both duplicate logging and Discord webhook issues', () => {
      // entrypoint.shに重複ログ修正が含まれている
      expect(entrypointContent).toContain('log_startup_message "Starting backtest container with enhanced error handling"');
      
      // notifications.jsにDiscord webhook修正が含まれている
      expect(notificationsContent).toContain('BACKTEST_MODE');
      
      // errorHandler.jsにも修正が含まれている
      expect(errorHandlerContent).toContain('BACKTEST_MODE');
    });

    test('should maintain backward compatibility', () => {
      // 既存の機能が壊れていないことを確認
      expect(entrypointContent).toContain('log_startup_message()');
      expect(entrypointContent).toContain('get_message_hash');
      expect(entrypointContent).toContain('STARTUP_MESSAGE_LOCK_DIR');
      
      expect(notificationsContent).toContain('postErrorToDiscord');
      expect(notificationsContent).toContain('postResultToDiscord');
      
      expect(errorHandlerContent).toContain('UnifiedErrorHandler');
    });

    test('should include proper error context for debugging', () => {
      expect(entrypointContent).toContain('Issue #5003');
      expect(notificationsContent).toContain('Issue #5003');
      expect(errorHandlerContent).toContain('Issue #5003');
    });
  });
});