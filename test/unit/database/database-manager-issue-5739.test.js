/**
 * Issue #5739: strategy-runnerサービスで例外が発生の修正テスト
 * Redis接続状態チェックでのundefined/null値プロパティ対応のテスト
 */

// Jest テストフレームワークを使用
jest.unmock('../../../src/database/manager');

describe('Issue #5739: Redis接続状態チェック undefined/null値プロパティ対応', () => {
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

    test('isReadyとisOpenプロパティがundefinedの場合、status基準で判定される', () => {
      // プロパティは存在するがundefined値のクライアント
      const clientWithUndefinedProperties = {
        isReady: undefined,
        isOpen: undefined,
        status: 'ready',
        constructor: { name: 'RedisClient' }
      };

      const result = validateRedisClientConnection(clientWithUndefinedProperties, 'テスト接続チェック', mockLogger);

      // status基準で成功することを確認
      expect(result).toEqual({ clientReady: true, clientOpen: true });
      
      // 警告ログが出力されることを確認
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[Redis Transaction] テスト接続チェック: プロパティ未定義検出')
      );
      
      // info ログでstatus基準での接続OKが出力されることを確認
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[Redis Transaction] テスト接続チェック: status基準で接続OK (status=ready)'
      );
    });

    test('isReadyとisOpenプロパティがnullの場合、status基準で判定される', () => {
      // プロパティは存在するがnull値のクライアント
      const clientWithNullProperties = {
        isReady: null,
        isOpen: null,
        status: 'connected',
        constructor: { name: 'RedisClient' }
      };

      const result = validateRedisClientConnection(clientWithNullProperties, 'テスト接続チェック', mockLogger);

      // status基準で成功することを確認
      expect(result).toEqual({ clientReady: true, clientOpen: true });
      
      // 警告ログが出力されることを確認
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[Redis Transaction] テスト接続チェック: プロパティ未定義検出')
      );
    });

    test('isReadyプロパティのみundefinedの場合、status基準で判定される', () => {
      // isReadyプロパティのみundefined値のクライアント
      const clientWithPartialUndefinedProperties = {
        isReady: undefined,
        isOpen: true,
        status: 'ready',
        constructor: { name: 'RedisClient' }
      };

      const result = validateRedisClientConnection(clientWithPartialUndefinedProperties, 'テスト接続チェック', mockLogger);

      // status基準で成功することを確認
      expect(result).toEqual({ clientReady: true, clientOpen: true });
      
      // 警告ログが出力されることを確認
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[Redis Transaction] テスト接続チェック: プロパティ未定義検出')
      );
    });

    test('undefined/null値プロパティでstatusも不正な場合、適切なエラーメッセージを生成', () => {
      // プロパティは存在するがundefined値、かつstatusも不正なクライアント
      const clientWithBadStatus = {
        isReady: undefined,
        isOpen: undefined,
        status: 'disconnected',
        constructor: { name: 'RedisClient' }
      };

      expect(() => {
        validateRedisClientConnection(clientWithBadStatus, 'テスト接続チェック', mockLogger);
      }).toThrow('Redis Commit失敗: テスト接続チェック時に接続プロパティが未定義です');

      // エラーログが適切に出力されることを確認
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('[Redis Transaction] テスト接続チェック失敗: ready=undefined, open=undefined, status=disconnected')
      );
    });

    test('プロパティが使用可能な場合、正常な判定が行われる', () => {
      // プロパティが使用可能なクライアント
      const normalClient = {
        isReady: true,
        isOpen: true,
        status: 'ready',
        constructor: { name: 'RedisClient' }
      };

      const result = validateRedisClientConnection(normalClient, 'テスト接続チェック', mockLogger);

      // 正常な結果が返されることを確認
      expect(result).toEqual({ clientReady: true, clientOpen: true });
      
      // 警告やエラーログが出力されないことを確認
      expect(mockLogger.warn).not.toHaveBeenCalled();
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    test('プロパティが使用可能だが値がfalseの場合、エラーが発生する', () => {
      // プロパティが使用可能だが接続していないクライアント
      const disconnectedClient = {
        isReady: false,
        isOpen: false,
        status: 'ready',
        constructor: { name: 'RedisClient' }
      };

      expect(() => {
        validateRedisClientConnection(disconnectedClient, 'テスト接続チェック', mockLogger);
      }).toThrow('Redis Commit失敗: テスト接続チェック時に接続が失われました');

      // エラーログが適切に出力されることを確認
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('[Redis Transaction] テスト接続チェック失敗: ready=false, open=false, status=ready')
      );
    });

    test('診断情報が適切に記録される', () => {
      // プロパティは存在するがundefined値のクライアント
      const clientWithUndefinedProperties = {
        isReady: undefined,
        isOpen: undefined,
        status: 'ready',
        constructor: { name: 'TestRedisClient' }
      };

      validateRedisClientConnection(clientWithUndefinedProperties, 'テスト接続チェック', mockLogger);

      // 診断情報を含む警告ログが出力されることを確認
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/\[Redis Transaction\] テスト接続チェック: プロパティ未定義検出 - \{.*"hasReadyProperty":true.*"hasOpenProperty":true.*"hasUsableReadyProperty":false.*"hasUsableOpenProperty":false.*"clientStatus":"ready".*"clientConstructor":"TestRedisClient".*\}/)
      );
    });
  });
});