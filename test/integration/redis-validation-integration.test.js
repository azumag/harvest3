/**
 * Issue #5755: Redis接続チェック統合テストの簡素化版
 * 既存の動作するunit testパターンを使用した安定版
 */

// Jest テストフレームワークを使用（Working unit testと同じパターン）
jest.unmock('../../src/database/manager');

describe('Issue #5755: Redis接続バリデーション統合テスト（簡素化版）', () => {
  let mockRedisClient;
  let mockLogger;
  let databaseManager;
  let validateRedisClientConnection;

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

    // データベースマネージャーを動的にrequire
    databaseManager = require('../../src/database/manager');
    
    // プライベート関数をテスト用に公開
    validateRedisClientConnection = databaseManager.__getValidateRedisClientConnectionForTesting();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('基本的なRedis接続バリデーション機能', () => {
    test('正常なRedisクライアントでvalidationが成功する', async () => {
      // 正常なRedisクライアントモック
      const mockRedisClient = {
        isReady: true,
        isOpen: true,
        status: 'ready',
        serverInfo: { version: '6.2.0' },
        constructor: { name: 'RedisClient' }
      };

      const result = await validateRedisClientConnection(mockRedisClient, 'テスト接続チェック', mockLogger);

      expect(result).toEqual({
        clientReady: true,
        clientOpen: true
      });

      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    test('プロパティが未定義の場合、適切なエラーメッセージを生成', async () => {
      // isReadyとisOpenプロパティが存在しないクライアント
      const clientWithoutProperties = {
        status: 'disconnected',
        constructor: { name: 'RedisClient' }
      };

      await expect(validateRedisClientConnection(clientWithoutProperties, 'テスト接続チェック', mockLogger))
        .rejects.toThrow('Redis Commit失敗: テスト接続チェック時に接続プロパティが未定義です');

      // エラーログが意味のある形で出力されることを確認
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('[Redis Transaction] テスト接続チェック失敗: ready=(undefined property), open=(undefined property), status=disconnected')
      );
    });

    test('nullクライアントでの適切なエラー処理', async () => {
      await expect(
        validateRedisClientConnection(null, 'nullテスト', mockLogger)
      ).rejects.toThrow('Redis Commit失敗: nullテスト時にクライアントが存在しません');

      expect(mockLogger.error).toHaveBeenCalledWith(
        '[Redis Transaction] nullテスト失敗: クライアントオブジェクトがnull/undefined'
      );
    });

    test('接続失敗時の詳細ログ出力', async () => {
      const mockRedisClient = {
        isReady: false,
        isOpen: false,
        status: 'disconnected',
        constructor: { name: 'RedisClient' }
      };

      await expect(
        validateRedisClientConnection(mockRedisClient, '接続失敗テスト', mockLogger)
      ).rejects.toThrow(/Redis Commit失敗/);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('接続失敗テスト失敗: ready=false, open=false, status=disconnected')
      );
    });
  });
});