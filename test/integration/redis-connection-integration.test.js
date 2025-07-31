/**
 * Issue #5755: Redis接続チェックテストの統合テスト（簡素化版）
 * 既存の動作するunit testパターンを使用した安定版
 */

// Jest テストフレームワークを使用（Working unit testと同じパターン）
jest.unmock('../../src/database/manager');

describe('Issue #5755: Redis接続チェック統合テスト（簡素化版）', () => {
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

  describe('Redis接続機能の基本テスト', () => {
    test('正常なRedis接続でvalidateRedisClientConnectionが成功する', async () => {
      // 正常なRedisクライアントモック
      const mockRedisClient = {
        isReady: true,
        isOpen: true,
        status: 'ready',
        serverInfo: { version: '6.2.0' },
        constructor: { name: 'RedisClient' }
      };
      
      const result = await validateRedisClientConnection(mockRedisClient, 'テスト接続', mockLogger);
      
      expect(result).toEqual({
        clientReady: true,
        clientOpen: true
      });
      
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    test('無効なクライアントオブジェクトでエラーが正しく処理される', async () => {
      await expect(
        validateRedisClientConnection(null, 'null クライアントテスト', mockLogger)
      ).rejects.toThrow('Redis Commit失敗: null クライアントテスト時にクライアントが存在しません');
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        '[Redis Transaction] null クライアントテスト失敗: クライアントオブジェクトがnull/undefined'
      );
    });

    test('undefined プロパティを持つクライアントモックでエラーハンドリングが動作する', async () => {
      const mockRedisClient = {
        isReady: undefined,
        isOpen: undefined,
        status: 'connecting',
        constructor: { name: 'RedisClient' }
      };
      
      await expect(
        validateRedisClientConnection(mockRedisClient, 'undefined プロパティテスト', mockLogger)
      ).rejects.toThrow(/Redis Commit失敗/);
      
      // undefined値検出の警告ログが出力されることを確認
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('undefined プロパティテスト失敗: ready=undefined, open=undefined, status=connecting')
      );
    });

    test('接続状態チェック機能が適切に動作する', async () => {
      const mockRedisClient = {
        isReady: false,
        isOpen: false,
        status: 'disconnected',
        constructor: { name: 'RedisClient' }
      };
      
      await expect(
        validateRedisClientConnection(mockRedisClient, '切断状態テスト', mockLogger)
      ).rejects.toThrow(/Redis Commit失敗/);
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('切断状態テスト失敗: ready=false, open=false, status=disconnected')
      );
    });
  });
});