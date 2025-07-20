const { getWebhookNotSetMessage, logWebhookNotSet, checkWebhookUrl } = require('../../../src/common/webhookUtils');

describe('webhookUtils', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = process.env.BACKTEST_MODE;
    jest.clearAllMocks();
    // スパイを設定
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.BACKTEST_MODE = originalEnv;
    jest.restoreAllMocks();
  });

  describe('getWebhookNotSetMessage', () => {
    it('should return basic message when context is empty and not in backtest mode', () => {
      process.env.BACKTEST_MODE = 'false';
      const result = getWebhookNotSetMessage();
      expect(result).toBe('Discord Webhook URLが設定されていません');
    });

    it('should return basic message with context when not in backtest mode', () => {
      process.env.BACKTEST_MODE = 'false';
      const result = getWebhookNotSetMessage('Order');
      expect(result).toBe('Discord Order Webhook URLが設定されていません');
    });

    it('should return backtest message when context is empty and in backtest mode', () => {
      process.env.BACKTEST_MODE = 'true';
      const result = getWebhookNotSetMessage();
      expect(result).toBe('Discord Webhook URLが設定されていません (バックテストモードのため通知をスキップ)');
    });

    it('should return backtest message with context when in backtest mode', () => {
      process.env.BACKTEST_MODE = 'true';
      const result = getWebhookNotSetMessage('Result');
      expect(result).toBe('Discord Result Webhook URLが設定されていません (バックテストモードのため通知をスキップ)');
    });

    it('should handle different context values', () => {
      process.env.BACKTEST_MODE = 'true';
      
      expect(getWebhookNotSetMessage('Order'))
        .toBe('Discord Order Webhook URLが設定されていません (バックテストモードのため通知をスキップ)');
      
      expect(getWebhookNotSetMessage('Result'))
        .toBe('Discord Result Webhook URLが設定されていません (バックテストモードのため通知をスキップ)');
      
      expect(getWebhookNotSetMessage('Error'))
        .toBe('Discord Error Webhook URLが設定されていません (バックテストモードのため通知をスキップ)');
    });

    it('should handle undefined BACKTEST_MODE', () => {
      delete process.env.BACKTEST_MODE;
      const result = getWebhookNotSetMessage('Test');
      expect(result).toBe('Discord Test Webhook URLが設定されていません');
    });
  });

  describe('logWebhookNotSet', () => {
    it('should log error when not in backtest mode', () => {
      process.env.BACKTEST_MODE = 'false';
      logWebhookNotSet();
      
      expect(console.error).toHaveBeenCalledWith('Discord Webhook URLが設定されていません');
      expect(console.warn).not.toHaveBeenCalled();
    });

    it('should log warning when in backtest mode', () => {
      process.env.BACKTEST_MODE = 'true';
      logWebhookNotSet();
      
      expect(console.warn).toHaveBeenCalledWith('Discord Webhook URLが設定されていません (バックテストモードのため通知をスキップ)');
      expect(console.error).not.toHaveBeenCalled();
    });

    it('should log error with context when not in backtest mode', () => {
      process.env.BACKTEST_MODE = 'false';
      logWebhookNotSet('Order');
      
      expect(console.error).toHaveBeenCalledWith('Discord Order Webhook URLが設定されていません');
      expect(console.warn).not.toHaveBeenCalled();
    });

    it('should log warning with context when in backtest mode', () => {
      process.env.BACKTEST_MODE = 'true';
      logWebhookNotSet('Result');
      
      expect(console.warn).toHaveBeenCalledWith('Discord Result Webhook URLが設定されていません (バックテストモードのため通知をスキップ)');
      expect(console.error).not.toHaveBeenCalled();
    });

    it('should handle undefined BACKTEST_MODE as non-backtest', () => {
      delete process.env.BACKTEST_MODE;
      logWebhookNotSet('Test');
      
      expect(console.error).toHaveBeenCalledWith('Discord Test Webhook URLが設定されていません');
      expect(console.warn).not.toHaveBeenCalled();
    });
  });

  describe('checkWebhookUrl', () => {
    it('should return true when webhook URL is provided', () => {
      const result = checkWebhookUrl('https://discord.com/api/webhooks/test');
      expect(result).toBe(true);
      expect(console.warn).not.toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalled();
    });

    it('should return false and log error when webhook URL is null and not in backtest mode', () => {
      process.env.BACKTEST_MODE = 'false';
      const result = checkWebhookUrl(null);
      
      expect(result).toBe(false);
      expect(console.error).toHaveBeenCalledWith('Discord Webhook URLが設定されていません');
      expect(console.warn).not.toHaveBeenCalled();
    });

    it('should return false and log warning when webhook URL is null and in backtest mode', () => {
      process.env.BACKTEST_MODE = 'true';
      const result = checkWebhookUrl(null);
      
      expect(result).toBe(false);
      expect(console.warn).toHaveBeenCalledWith('Discord Webhook URLが設定されていません (バックテストモードのため通知をスキップ)');
      expect(console.error).not.toHaveBeenCalled();
    });

    it('should return false and log error when webhook URL is undefined and not in backtest mode', () => {
      process.env.BACKTEST_MODE = 'false';
      const result = checkWebhookUrl(undefined);
      
      expect(result).toBe(false);
      expect(console.error).toHaveBeenCalledWith('Discord Webhook URLが設定されていません');
    });

    it('should return false and log warning when webhook URL is undefined and in backtest mode', () => {
      process.env.BACKTEST_MODE = 'true';
      const result = checkWebhookUrl(undefined);
      
      expect(result).toBe(false);
      expect(console.warn).toHaveBeenCalledWith('Discord Webhook URLが設定されていません (バックテストモードのため通知をスキップ)');
    });

    it('should return false and log error when webhook URL is empty string and not in backtest mode', () => {
      process.env.BACKTEST_MODE = 'false';
      const result = checkWebhookUrl('');
      
      expect(result).toBe(false);
      expect(console.error).toHaveBeenCalledWith('Discord Webhook URLが設定されていません');
    });

    it('should return false and log warning when webhook URL is empty string and in backtest mode', () => {
      process.env.BACKTEST_MODE = 'true';
      const result = checkWebhookUrl('');
      
      expect(result).toBe(false);
      expect(console.warn).toHaveBeenCalledWith('Discord Webhook URLが設定されていません (バックテストモードのため通知をスキップ)');
    });

    it('should handle context parameter correctly when not in backtest mode', () => {
      process.env.BACKTEST_MODE = 'false';
      checkWebhookUrl(null, 'Order');
      
      expect(console.error).toHaveBeenCalledWith('Discord Order Webhook URLが設定されていません');
    });

    it('should handle context parameter correctly when in backtest mode', () => {
      process.env.BACKTEST_MODE = 'true';
      checkWebhookUrl(null, 'Result');
      
      expect(console.warn).toHaveBeenCalledWith('Discord Result Webhook URLが設定されていません (バックテストモードのため通知をスキップ)');
    });
  });

  describe('edge cases', () => {
    it('should handle empty context string', () => {
      process.env.BACKTEST_MODE = 'true';
      const result = getWebhookNotSetMessage('');
      expect(result).toBe('Discord Webhook URLが設定されていません (バックテストモードのため通知をスキップ)');
    });

    it('should handle whitespace context', () => {
      process.env.BACKTEST_MODE = 'true';
      const result = getWebhookNotSetMessage('  ');
      expect(result).toBe('Discord    Webhook URLが設定されていません (バックテストモードのため通知をスキップ)');
    });

    it('should handle non-string BACKTEST_MODE values', () => {
      process.env.BACKTEST_MODE = '1';
      const result = getWebhookNotSetMessage();
      expect(result).toBe('Discord Webhook URLが設定されていません');
    });

    it('should handle case sensitivity in BACKTEST_MODE', () => {
      process.env.BACKTEST_MODE = 'TRUE';
      const result = getWebhookNotSetMessage();
      expect(result).toBe('Discord Webhook URLが設定されていません');
    });
  });
});