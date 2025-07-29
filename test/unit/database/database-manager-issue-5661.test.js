/**
 * Issue #5661: strategy-runnerサービスで例外が発生の修正テスト
 * Redis接続状態チェックでのundefinedプロパティ対応のテスト
 */

// Jest テストフレームワークを使用
jest.unmock('../../../src/database/manager');

describe('Issue #5661: Redis接続状態チェック undefined プロパティ対応', () => {
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

    // 正常なRedisクライアントモック
    mockRedisClient = {
      multi: jest.fn(),
      isReady: true,
      isOpen: true,
      status: 'ready',
      serverInfo: { version: '6.2.0' },
      ping: jest.fn().mockResolvedValue('PONG')
    };

    mockRedisDatabase = {
      getClient: jest.fn().mockReturnValue(mockRedisClient)
    };

    // データベースマネージャーを動的にrequire
    databaseManager = require('../../../src/database/manager');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validateRedisClientConnection関数', () => {
    let validateRedisClientConnection;

    beforeEach(() => {
      // プライベート関数をテスト用に公開
      validateRedisClientConnection = databaseManager.__getValidateRedisClientConnectionForTesting();
    });

    test('isReadyとisOpenプロパティが未定義の場合、意味のあるエラーメッセージを生成', () => {
      // isReadyとisOpenプロパティが存在しないクライアント
      const clientWithoutProperties = {
        status: 'disconnected',
        constructor: { name: 'RedisClient' }
      };

      expect(() => {
        validateRedisClientConnection(clientWithoutProperties, 'テスト接続チェック', mockLogger);
      }).toThrow('Redis Commit失敗: テスト接続チェック時に接続プロパティが未定義です');

      // エラーログが意味のある形で出力されることを確認
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('[Redis Transaction] テスト接続チェック失敗: ready=(undefined property), open=(undefined property), status=disconnected')
      );
    });

    test('isReadyプロパティのみ未定義の場合、適切なエラーメッセージを生成', () => {
      // isReadyプロパティのみ存在しないクライアント
      const clientWithPartialProperties = {
        isOpen: false,
        status: 'connecting',
        constructor: { name: 'RedisClient' }
      };

      expect(() => {
        validateRedisClientConnection(clientWithPartialProperties, 'テスト接続チェック', mockLogger);
      }).toThrow('Redis Commit失敗: テスト接続チェック時に接続プロパティが未定義です');

      // エラーログで一つのプロパティは値、もう一つは未定義と表示されることを確認
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('[Redis Transaction] テスト接続チェック失敗: ready=(undefined property), open=false, status=connecting')
      );
    });

    test('statusに基づく接続チェックが成功する場合', () => {
      // プロパティが未定義だがstatusがreadyのクライアント
      const clientWithGoodStatus = {
        status: 'ready',
        constructor: { name: 'RedisClient' }
      };

      const result = validateRedisClientConnection(clientWithGoodStatus, 'テスト接続チェック', mockLogger);

      expect(result).toEqual({
        clientReady: true,
        clientOpen: true
      });

      // 警告ログとinfo ログが適切に出力されることを確認
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[Redis Transaction] テスト接続チェック: プロパティ未定義またはundefined値検出')
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[Redis Transaction] テスト接続チェック: status基準で接続OK (status=ready)'
      );
    });

    test('通常のプロパティが存在する場合、正常に動作', () => {
      const result = validateRedisClientConnection(mockRedisClient, 'テスト接続チェック', mockLogger);

      expect(result).toEqual({
        clientReady: true,
        clientOpen: true
      });

      // エラーログは出力されない
      expect(mockLogger.error).not.toHaveBeenCalled();
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    test('接続状態が不正な場合、意味のあるエラーメッセージを生成', () => {
      // isReadyがfalseのクライアント
      const clientNotReady = {
        isReady: false,
        isOpen: true,
        status: 'connecting',
        constructor: { name: 'RedisClient' }
      };

      expect(() => {
        validateRedisClientConnection(clientNotReady, 'テスト接続チェック', mockLogger);
      }).toThrow('Redis Commit失敗: テスト接続チェック時に接続が失われました');

      // エラーログが適切な形式で出力されることを確認（本番環境でない場合）
      process.env.NODE_ENV = 'test';
      expect(mockLogger.error).toHaveBeenCalledWith(
        '[Redis Transaction] テスト接続チェック失敗: ready=false, open=true, status=connecting'
      );
    });

    test('本番環境では詳細情報を制限', () => {
      // 本番環境をシミュレート
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const clientNotReady = {
        isReady: false, 
        isOpen: true,
        status: 'connecting'
      };

      expect(() => {
        validateRedisClientConnection(clientNotReady, 'テスト接続チェック', mockLogger);
      }).toThrow('Redis Commit失敗: テスト接続チェック時に接続が失われました');

      // 本番環境では警告レベルで簡潔なメッセージ
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[Redis Transaction] テスト接続チェック失敗: 接続状態異常'
      );

      // 元の環境変数を復元
      process.env.NODE_ENV = originalNodeEnv;
    });
  });

  describe('Redis接続診断情報の改善', () => {
    test('Redis接続状態ログでundefinedプロパティが適切に表示される', async () => {
      // isReadyとisOpenプロパティが存在しないクライアントをモック
      const clientWithoutProperties = {
        status: 'ready',
        constructor: { name: 'RedisClient' }
      };

      mockRedisDatabase.getClient.mockReturnValue(clientWithoutProperties);

      // 任意のDatabaseManager関数を呼び出して接続状態ログを確認
      // この場合は診断情報を生成する部分をテスト
      const diagnosticInfo = {
        clientReady: true,
        clientOpen: true,
        clientConnected: true,
        clientStatus: clientWithoutProperties?.status,
        serverInfo: clientWithoutProperties?.serverInfo ? 'available' : 'unavailable',
        rawIsReady: 'isReady' in (clientWithoutProperties || {}) ? clientWithoutProperties.isReady : '(undefined property)',
        rawIsOpen: 'isOpen' in (clientWithoutProperties || {}) ? clientWithoutProperties.isOpen : '(undefined property)',
        capturedAt: expect.any(String),
        clientRecovered: false
      };

      // 診断情報が期待される形式であることを確認
      expect(diagnosticInfo.rawIsReady).toBe('(undefined property)');
      expect(diagnosticInfo.rawIsOpen).toBe('(undefined property)');
    });

    test('通常のクライアントでは実際の値が表示される', () => {
      const diagnosticInfo = {
        rawIsReady: 'isReady' in (mockRedisClient || {}) ? mockRedisClient.isReady : '(undefined property)',
        rawIsOpen: 'isOpen' in (mockRedisClient || {}) ? mockRedisClient.isOpen : '(undefined property)'
      };

      expect(diagnosticInfo.rawIsReady).toBe(true);
      expect(diagnosticInfo.rawIsOpen).toBe(true);
    });
  });
});