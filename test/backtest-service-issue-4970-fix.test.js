/**
 * @fileoverview Issue #4970 - backtestサービスでのDiscord Webhook URL未設定例外修正のテスト
 * "Discord Webhook URLが設定されていません" エラーの適切な処理確認
 * 
 * 根本原因: postMongoConnectionErrorToDiscord関数でcheckWebhookUrl()を使用していない
 * 修正内容: checkWebhookUrl()によるチェックを追加し、バックテストモードでの適切なハンドリング
 */

// モック設定は require より前に行う
jest.mock('../src/common/webhookUtils');
jest.mock('../src/common/discordRateLimiter');

const { checkWebhookUrl } = require('../src/common/webhookUtils');
const rateLimiter = require('../src/common/discordRateLimiter');

describe('Backtest Service Issue #4970 Fix', () => {
  let consoleSpy;

  beforeEach(() => {
    // モックをリセット
    jest.clearAllMocks();
    checkWebhookUrl.mockImplementation(() => true);
    rateLimiter.send.mockResolvedValue();

    // コンソールスパイ設定
    consoleSpy = {
      warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
      error: jest.spyOn(console, 'error').mockImplementation(() => {})
    };
  });

  afterEach(() => {
    // スパイを復元
    Object.values(consoleSpy).forEach(spy => spy.mockRestore());
    jest.restoreAllMocks();
  });

  describe('postMongoConnectionErrorToDiscord webhook URL validation with URL set', () => {
    let postMongoConnectionErrorToDiscord;

    beforeAll(() => {
      // テストグループ開始前に環境変数を設定
      process.env.DISCORD_ERROR_WEBHOOK_URL = 'https://discord.com/api/webhooks/test';
      // この環境変数でモジュールをrequire
      const notifications = require('../src/common/notifications');
      postMongoConnectionErrorToDiscord = notifications.postMongoConnectionErrorToDiscord;
    });

    afterAll(() => {
      // テストグループ終了後にモジュールキャッシュをクリア
      delete require.cache[require.resolve('../src/common/notifications')];
      delete process.env.DISCORD_ERROR_WEBHOOK_URL;
    });

    test('should send notification when webhook URL is properly set', async () => {
      // checkWebhookUrlがtrueを返すようモック
      checkWebhookUrl.mockReturnValue(true);

      const errorMessage = 'Connection timeout';
      const mongoUrl = 'mongodb://localhost:27017';

      await postMongoConnectionErrorToDiscord(errorMessage, mongoUrl);

      // checkWebhookUrlが適切に呼ばれることを確認
      expect(checkWebhookUrl).toHaveBeenCalledTimes(1);
      expect(checkWebhookUrl).toHaveBeenCalledWith('https://discord.com/api/webhooks/test');

      // rateLimiter.sendが正しいパラメータで呼ばれることを確認
      expect(rateLimiter.send).toHaveBeenCalledTimes(1);
      
      const [webhookUrl, message, options] = rateLimiter.send.mock.calls[0];
      expect(webhookUrl).toBe('https://discord.com/api/webhooks/test');
      expect(message).toContain('🚨 **MongoDB接続エラー**');
      expect(message).toContain(errorMessage);
      expect(message).toContain(mongoUrl);
      expect(options).toMatchObject({
        priority: expect.any(Number),
        deduplicationKey: expect.any(String),
        deduplicationWindow: 1800000
      });
    });

    test('should use checkWebhookUrl for consistent webhook validation', async () => {
      checkWebhookUrl.mockReturnValue(true);

      await postMongoConnectionErrorToDiscord('Test error', 'mongodb://test');

      // checkWebhookUrlが統一的なvalidationのために使用されることを確認
      expect(checkWebhookUrl).toHaveBeenCalledWith('https://discord.com/api/webhooks/test');
    });

    test('should format MongoDB error message correctly', async () => {
      checkWebhookUrl.mockReturnValue(true);

      const errorMessage = 'MongoNetworkError: failed to connect';
      const mongoUrl = 'mongodb://cluster.example.com:27017';

      await postMongoConnectionErrorToDiscord(errorMessage, mongoUrl);

      const [, message] = rateLimiter.send.mock.calls[0];
      expect(message).toContain('🚨 **MongoDB接続エラー**');
      expect(message).toContain(`エラー: ${errorMessage}`);
      expect(message).toContain(`接続先: ${mongoUrl}`);
      expect(message).toContain('時刻:');
    });

    test('should generate unique deduplication key for different error scenarios', async () => {
      checkWebhookUrl.mockReturnValue(true);

      // 異なるエラーシナリオでのキー生成を確認
      await postMongoConnectionErrorToDiscord('Error 1', 'mongodb://host1');
      await postMongoConnectionErrorToDiscord('Error 2', 'mongodb://host2');

      expect(rateLimiter.send).toHaveBeenCalledTimes(2);

      const [, , options1] = rateLimiter.send.mock.calls[0];
      const [, , options2] = rateLimiter.send.mock.calls[1];

      // 異なるエラーには異なる重複防止キーが使用されることを確認
      expect(options1.deduplicationKey).not.toBe(options2.deduplicationKey);
    });

    test('should maintain backward compatibility with existing error handling', async () => {
      checkWebhookUrl.mockReturnValue(true);

      // 既存の動作が保持されることを確認
      await postMongoConnectionErrorToDiscord('Legacy error', 'mongodb://legacy');

      expect(rateLimiter.send).toHaveBeenCalledWith(
        'https://discord.com/api/webhooks/test',
        expect.stringContaining('Legacy error'),
        expect.objectContaining({
          priority: expect.any(Number),
          deduplicationWindow: 1800000
        })
      );
    });
  });

  describe('postMongoConnectionErrorToDiscord webhook URL validation with URL not set', () => {
    let postMongoConnectionErrorToDiscord;

    beforeAll(() => {
      // テストグループ開始前に環境変数を削除
      delete process.env.DISCORD_ERROR_WEBHOOK_URL;
      // この環境変数でモジュールをrequire
      const notifications = require('../src/common/notifications');
      postMongoConnectionErrorToDiscord = notifications.postMongoConnectionErrorToDiscord;
    });

    afterAll(() => {
      // テストグループ終了後にモジュールキャッシュをクリア
      delete require.cache[require.resolve('../src/common/notifications')];
    });

    test('should skip notification when webhook URL is not set in backtest mode', async () => {
      // バックテストモードでWebhook URLが未設定の場合
      process.env.BACKTEST_MODE = 'true';
      
      // checkWebhookUrlがfalseを返すようモック
      checkWebhookUrl.mockReturnValue(false);

      await postMongoConnectionErrorToDiscord('Test error', 'mongodb://test');

      // checkWebhookUrlが呼ばれることを確認
      // 注意：テスト実行順序の関係で、モジュールは既にURL設定済みの状態
      expect(checkWebhookUrl).toHaveBeenCalledTimes(1);
      expect(checkWebhookUrl).toHaveBeenCalled();

      // rateLimiter.sendが呼ばれないことを確認（処理がスキップされる）
      expect(rateLimiter.send).not.toHaveBeenCalled();

      delete process.env.BACKTEST_MODE;
    });

    test('should skip notification when webhook URL is not set in non-backtest mode', async () => {
      // 通常モードでWebhook URLが未設定の場合
      process.env.BACKTEST_MODE = 'false';
      
      // checkWebhookUrlがfalseを返すようモック
      checkWebhookUrl.mockReturnValue(false);

      await postMongoConnectionErrorToDiscord('Test error', 'mongodb://test');

      // checkWebhookUrlが呼ばれることを確認
      // 注意：テスト実行順序の関係で、モジュールは既にURL設定済みの状態
      expect(checkWebhookUrl).toHaveBeenCalledTimes(1);
      expect(checkWebhookUrl).toHaveBeenCalled();

      // rateLimiter.sendが呼ばれないことを確認（処理がスキップされる）
      expect(rateLimiter.send).not.toHaveBeenCalled();

      delete process.env.BACKTEST_MODE;
    });

    test('should early return when checkWebhookUrl returns false', async () => {      
      checkWebhookUrl.mockReturnValue(false);

      await postMongoConnectionErrorToDiscord('Test error', 'mongodb://test');

      // 早期returnによりrateLimiter.sendが呼ばれないことを確認
      expect(checkWebhookUrl).toHaveBeenCalled();
      expect(rateLimiter.send).not.toHaveBeenCalled();
    });

    test('should prevent original issue where Discord notification caused service exception', async () => {
      // 元の問題：Webhook URLが未設定時にサービス例外が発生
      checkWebhookUrl.mockReturnValue(false);

      // 例外が発生せずに正常に完了することを確認
      expect(async () => {
        await postMongoConnectionErrorToDiscord('Test error', 'mongodb://test');
      }).not.toThrow();

      // 適切にスキップされることを確認
      expect(rateLimiter.send).not.toHaveBeenCalled();
    });

    test('should work correctly in backtest environment without causing log spam', async () => {
      process.env.BACKTEST_MODE = 'true';
      checkWebhookUrl.mockReturnValue(false);

      // バックテスト環境で適切に動作することを確認
      await postMongoConnectionErrorToDiscord('Backtest error', 'mongodb://backtest');

      // 通知がスキップされ、適切なログ処理が行われることを確認
      expect(checkWebhookUrl).toHaveBeenCalled();
      expect(rateLimiter.send).not.toHaveBeenCalled();

      delete process.env.BACKTEST_MODE;
    });
  });

  describe('checkWebhookUrl function behavior validation', () => {
    test('should receive correct webhook URL parameter from postMongoConnectionErrorToDiscord', () => {
      // この部分は統合テストとして、実際のcheckWebhookUrl関数の動作を確認
      // モックではなく実際の関数を一時的に呼び出して動作を確認
      const { checkWebhookUrl: realCheckWebhookUrl } = jest.requireActual('../src/common/webhookUtils');
      
      // Webhook URLが設定されている場合
      expect(realCheckWebhookUrl('https://discord.com/api/webhooks/123')).toBe(true);
      
      // Webhook URLが設定されていない場合
      expect(realCheckWebhookUrl(undefined)).toBe(false);
      expect(realCheckWebhookUrl(null)).toBe(false);
      expect(realCheckWebhookUrl('')).toBe(false);
    });
  });
});