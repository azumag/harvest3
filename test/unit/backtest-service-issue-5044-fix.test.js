/**
 * @fileoverview Issue #5044 - backtestサービスでのDiscord Webhook URL未設定例外修正のテスト
 * webhookUtils.jsにLogger統合を追加し、タイムスタンプ付きログメッセージの出力確認
 * 
 * 根本原因: webhookUtils.jsのlogWebhookNotSet関数が生のconsole.error/console.warnを使用
 * 修正内容: Loggerシステムを導入し、適切なタイムスタンプと接頭辞付きログ出力を実現
 */

const { logWebhookNotSet, checkWebhookUrl } = require('../../src/common/webhookUtils');

describe('Backtest Service Issue #5044 Fix - Logger Integration', () => {
  let originalEnv;
  let consoleSpy;

  beforeEach(() => {
    originalEnv = process.env.BACKTEST_MODE;
    
    // コンソールスパイ設定
    consoleSpy = {
      warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
      error: jest.spyOn(console, 'error').mockImplementation(() => {}),
      log: jest.spyOn(console, 'log').mockImplementation(() => {})
    };

    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env.BACKTEST_MODE = originalEnv;
    // スパイを復元
    Object.values(consoleSpy).forEach(spy => spy.mockRestore());
    jest.restoreAllMocks();
  });

  describe('logWebhookNotSet with Logger integration', () => {
    test('should use Logger.error (console.error) in non-backtest mode', () => {
      process.env.BACKTEST_MODE = 'false';
      
      logWebhookNotSet();
      
      // Logger.errorがconsole.errorを呼び出す（タイムスタンプ付きで）
      expect(consoleSpy.error).toHaveBeenCalled();
      expect(consoleSpy.warn).not.toHaveBeenCalled();
      
      // メッセージがタイムスタンプと[WebhookUtils]コンテキスト付きで出力されることを確認
      const callArgs = consoleSpy.error.mock.calls[0][0];
      expect(callArgs).toContain('[WebhookUtils]');
      expect(callArgs).toContain('Discord Webhook URLが設定されていません');
    });

    test('should use Logger.warn (console.warn) in backtest mode', () => {
      process.env.BACKTEST_MODE = 'true';
      
      logWebhookNotSet();
      
      // Logger.warnがconsole.warnを呼び出す（タイムスタンプ付きで）
      expect(consoleSpy.warn).toHaveBeenCalled();
      expect(consoleSpy.error).not.toHaveBeenCalled();
      
      // メッセージがタイムスタンプと[WebhookUtils]コンテキスト付きで出力されることを確認
      const callArgs = consoleSpy.warn.mock.calls[0][0];
      expect(callArgs).toContain('[WebhookUtils]');
      expect(callArgs).toContain('Discord Webhook URLが設定されていません');
      expect(callArgs).toContain('バックテストモードのため通知をスキップ');
    });

    test('should include context in Logger output', () => {
      process.env.BACKTEST_MODE = 'false';
      
      logWebhookNotSet('Order');
      
      expect(consoleSpy.error).toHaveBeenCalled();
      
      const callArgs = consoleSpy.error.mock.calls[0][0];
      expect(callArgs).toContain('[WebhookUtils]');
      expect(callArgs).toContain('Discord Order Webhook URLが設定されていません');
    });
  });

  describe('checkWebhookUrl integration', () => {
    test('should return false and log via Logger when webhook URL is not set', () => {
      process.env.BACKTEST_MODE = 'false';

      const result = checkWebhookUrl(null);

      expect(result).toBe(false);
      expect(consoleSpy.error).toHaveBeenCalled();
      
      const callArgs = consoleSpy.error.mock.calls[0][0];
      expect(callArgs).toContain('[WebhookUtils]');
    });

    test('should return true and not log when webhook URL is set', () => {
      const result = checkWebhookUrl('https://discord.com/api/webhooks/123');

      expect(result).toBe(true);
      expect(consoleSpy.log).not.toHaveBeenCalled();
      expect(consoleSpy.error).not.toHaveBeenCalled();
      expect(consoleSpy.warn).not.toHaveBeenCalled();
    });
  });

  describe('Issue #5044 fix verification', () => {
    test('should resolve the original issue: add timestamps and context to log messages', () => {
      // 元の問題：「Discord Webhook URLが設定されていません」がタイムスタンプなしで出力
      // 修正後：Logger統合により適切なフォーマットで出力される
      process.env.BACKTEST_MODE = 'true';

      logWebhookNotSet();

      // Logger統合により、console.warnが呼ばれる（タイムスタンプ付き）
      expect(consoleSpy.warn).toHaveBeenCalled();
      
      const callArgs = consoleSpy.warn.mock.calls[0][0];
      expect(callArgs).toContain('[WebhookUtils]');
      // タイムスタンプ形式を確認（HH:MM:SS）
      expect(callArgs).toMatch(/\d{2}:\d{2}:\d{2}/);
    });

    test('should maintain message content while improving format', () => {
      // メッセージ内容は変更せず、出力フォーマットのみ改善
      process.env.BACKTEST_MODE = 'false';

      logWebhookNotSet('Test');

      expect(consoleSpy.error).toHaveBeenCalled();
      
      const callArgs = consoleSpy.error.mock.calls[0][0];
      expect(callArgs).toContain('[WebhookUtils]');
      expect(callArgs).toContain('Discord Test Webhook URLが設定されていません');
    });

    test('should work consistently in backtest and non-backtest modes', () => {
      // バックテストモード
      process.env.BACKTEST_MODE = 'true';
      logWebhookNotSet();
      expect(consoleSpy.warn).toHaveBeenCalled();

      jest.clearAllMocks();

      // 通常モード
      process.env.BACKTEST_MODE = 'false';
      logWebhookNotSet();
      expect(consoleSpy.error).toHaveBeenCalled();
    });
  });
});