/**
 * Issue #5702: strategy-runnerサービスでのRedis接続例外に対するテスト
 * Redis v4.x でのisReady/isOpenプロパティがundefinedになる問題のテスト
 */

// Jest テストフレームワークを使用
jest.unmock('../../../src/database/manager');

describe('Issue #5702: Redis接続状態undefinedエラーのテスト', () => {
  let mockRedisClient;
  let mockRedisDatabase;
  let mockLogger;
  let databaseManager;

  beforeEach(() => {
    // Jest のモックキャッシュをクリア
    jest.resetModules();
    
    // モックロガーの初期化
    mockLogger = {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn()
    };

    // Redis v4.x でisReady/isOpenがundefinedになるクライアントモック
    mockRedisClient = {
      multi: jest.fn(),
      isReady: undefined,
      isOpen: undefined,
      status: 'connecting',
      ping: jest.fn().mockResolvedValue('PONG'),
      constructor: { name: 'Redis' }
    };

    // redisDatabase モック
    mockRedisDatabase = {
      getClient: jest.fn().mockReturnValue(mockRedisClient),
      isConnectedToRedis: jest.fn().mockReturnValue(true),
      connectToRedis: jest.fn().mockResolvedValue(true)
    };

    // DatabaseManager のロード
    const originalDatabaseManager = require('../../../src/database/manager');
    databaseManager = {
      ...originalDatabaseManager,
      __getValidateRedisClientConnectionForTesting: jest.fn(() => originalDatabaseManager.__getValidateRedisClientConnectionForTesting())
    };
  });

  describe('Redis v4.x undefined プロパティの処理', () => {
    test('isReady, isOpenプロパティがundefinedの場合の診断情報が適切に記録される', async () => {
      const validateRedisClientConnection = databaseManager.__getValidateRedisClientConnectionForTesting();
      
      try {
        await validateRedisClientConnection(mockRedisClient, 'テスト接続チェック', mockLogger);
      } catch (error) {
        // エラーは期待される
      }

      // 診断情報がデバッグログに出力されることを確認
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringMatching(/テスト接続チェック: クライアント診断.*hasClient.*hasIsReadyProperty.*hasIsOpenProperty/)
      );
    });

    test('statusプロパティが有効な場合、接続チェックを通過する', async () => {
      // statusが有効なクライアント
      const validStatusClient = {
        isReady: undefined,
        isOpen: undefined,
        status: 'ready',
        ping: jest.fn().mockResolvedValue('PONG'),
        constructor: { name: 'Redis' }
      };

      const validateRedisClientConnection = databaseManager.__getValidateRedisClientConnectionForTesting();
      
      const result = await validateRedisClientConnection(validStatusClient, 'テスト接続チェック', mockLogger);
      
      // 接続が有効と判定されることを確認
      expect(result.clientReady).toBe(true);
      expect(result.clientOpen).toBe(true);
    });

    test('全てのプロパティが無効な場合、適切なエラーメッセージを出力する', async () => {
      // 全て無効なクライアント
      const invalidClient = {
        isReady: undefined,
        isOpen: undefined,
        status: undefined,
        ping: jest.fn().mockRejectedValue(new Error('Connection lost')),
        constructor: { name: 'Redis' }
      };

      const validateRedisClientConnection = databaseManager.__getValidateRedisClientConnectionForTesting();
      
      await expect(
        validateRedisClientConnection(invalidClient, 'テスト接続チェック', mockLogger)
      ).rejects.toThrow();

      // 適切なエラーログが出力されることを確認（formatConnectionStatusの結果）
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringMatching(/テスト接続チェック失敗.*ready=.*open=/)
      );
    });
  });

  describe('エラーメッセージの一貫性テスト', () => {
    test('Issue #5702で報告されたエラー形式と一致する診断情報が出力される', async () => {
      const undefinedClient = {
        isReady: undefined,
        isOpen: undefined,
        status: undefined,
        constructor: { name: 'Redis' }
      };

      const validateRedisClientConnection = databaseManager.__getValidateRedisClientConnectionForTesting();
      
      try {
        await validateRedisClientConnection(undefinedClient, 'テスト接続チェック', mockLogger);
      } catch (error) {
        // エラーは期待される
      }

      // Issue #5702で追加された診断情報が適切に記録されることを確認
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringMatching(/テスト接続チェック: クライアント診断.*hasClient.*hasIsReadyProperty.*hasIsOpenProperty/)
      );
    });
  });
});