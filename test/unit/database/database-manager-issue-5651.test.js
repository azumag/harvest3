/**
 * Issue #5651: strategy-runnerサービスでRedis接続例外が発生する問題のテスト
 * Redis v4.x接続回復中のundefined状態を適切に処理するロジックの検証
 */

// jest環境で統一
jest.unmock('../../../src/database/manager');

// モジュールのパス調整
const databaseManager = require('../../../src/database/manager');

describe('Issue #5651: Redis接続undefinedプロパティ処理', () => {
  let mockLogger;
  let mockClient;
  let mockRedisDatabase;
  let validateRedisClientConnection;

  beforeEach(() => {
    // ログモック
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };

    // validateRedisClientConnection関数を取得（テスト用エクスポート）
    validateRedisClientConnection = databaseManager.__getValidateRedisClientConnectionForTesting();

    // Redisクライアントモック
    mockClient = {
      isReady: undefined,
      isOpen: undefined,
      status: 'ready',
      ping: jest.fn().mockResolvedValue('PONG')
    };

    // redisDatabase モック
    mockRedisDatabase = {
      getClient: jest.fn().mockReturnValue(mockClient)
    };

    // require のモック（jestスタイル）
    jest.doMock('../../../src/database/redisDatabase', () => mockRedisDatabase);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('undefinedプロパティの処理', () => {
    // requireモック関数を直接作成
    const mockRequire = jest.fn();
    
    beforeEach(() => {
      mockRequire.mockImplementation((path) => {
        if (path === './redisDatabase') {
          return mockRedisDatabase;
        }
        return jest.requireActual(path);
      });
    });
    it('isReady/isOpenがundefinedでPINGテスト成功時、接続有効と判定すること', async () => {
      // Arrange
      mockClient.isReady = undefined;
      mockClient.isOpen = undefined;
      mockClient.ping.mockResolvedValue('PONG');

      // Act
      const result = await validateRedisClientConnection(mockClient, 'テスト接続チェック', mockLogger);

      // Assert
      expect(result).toEqual({ clientReady: true, clientOpen: true });
      expect(mockClient.ping).toHaveBeenCalledTimes(1);
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('PINGテスト成功'));
    });

    it('PINGテスト失敗時、フォールバッククライアントを試行すること', async () => {
      // Arrange
      mockClient.isReady = undefined;
      mockClient.isOpen = undefined;
      mockClient.ping.mockRejectedValue(new Error('PING失敗'));

      const fallbackClient = {
        isReady: true,
        isOpen: true,
        ping: jest.fn().mockResolvedValue('PONG')
      };
      mockRedisDatabase.getClient.mockReturnValue(fallbackClient);

      // Act & Assert
      try {
        await validateRedisClientConnection(mockClient, 'テスト接続チェック', mockLogger);
        throw new Error('エラーがスローされるべき');
      } catch (error) {
        expect(error.message).toContain('FALLBACK_CLIENT_AVAILABLE');
        expect(fallbackClient.ping).toHaveBeenCalledTimes(1);
        expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('フォールバッククライアントでPINGテスト成功'));
      }
    });

    it('PINGテストタイムアウト時、適切に処理すること', async () => {
      // Arrange
      mockClient.isReady = undefined;
      mockClient.isOpen = undefined;
      
      // PINGが2秒以上かかる設定
      mockClient.ping.mockImplementation(() => new Promise((resolve) => {
        setTimeout(() => resolve('PONG'), 3000);
      }));

      // フォールバッククライアントも無効
      mockRedisDatabase.getClient.mockReturnValue(null);

      // Act & Assert
      try {
        await validateRedisClientConnection(mockClient, 'テスト接続チェック', mockLogger);
        throw new Error('エラーがスローされるべき');
      } catch (error) {
        expect(error.message).toContain('PINGテストも失敗しました');
        expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('PING timeout'));
      }
    });

    it('フォールバッククライアントのPINGテストタイムアウト時、適切に処理すること', async () => {
      // Arrange
      mockClient.isReady = undefined;
      mockClient.isOpen = undefined;
      mockClient.ping.mockRejectedValue(new Error('元クライアントPING失敗'));

      const fallbackClient = {
        isReady: undefined,
        isOpen: undefined,
        ping: jest.fn().mockImplementation(() => new Promise((resolve) => {
          setTimeout(() => resolve('PONG'), 3000);
        }))
      };
      mockRedisDatabase.getClient.mockReturnValue(fallbackClient);

      // Act & Assert
      try {
        await validateRedisClientConnection(mockClient, 'テスト接続チェック', mockLogger);
        throw new Error('エラーがスローされるべき');
      } catch (error) {
        expect(error.message).toContain('PINGテストも失敗しました');
        expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Fallback PING timeout'));
      }
    });

    it('PING応答が異常な場合、フォールバックを試行すること', async () => {
      // Arrange
      mockClient.isReady = undefined;
      mockClient.isOpen = undefined;
      mockClient.ping.mockResolvedValue('INVALID_RESPONSE');

      const fallbackClient = {
        isReady: true,
        isOpen: true,
        ping: jest.fn().mockResolvedValue('PONG')
      };
      mockRedisDatabase.getClient.mockReturnValue(fallbackClient);

      // Act & Assert
      try {
        await validateRedisClientConnection(mockClient, 'テスト接続チェック', mockLogger);
        throw new Error('エラーがスローされるべき');
      } catch (error) {
        expect(error.message).toContain('FALLBACK_CLIENT_AVAILABLE');
        expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('PINGテスト応答異常'));
        expect(fallbackClient.ping).toHaveBeenCalledTimes(1);
      }
    });

    it('フォールバッククライアントが同一オブジェクトの場合、無視すること', async () => {
      // Arrange
      mockClient.isReady = undefined;
      mockClient.isOpen = undefined;
      mockClient.ping.mockRejectedValue(new Error('PING失敗'));
      
      // 同一オブジェクトを返す
      mockRedisDatabase.getClient.mockReturnValue(mockClient);

      // Act & Assert
      try {
        await validateRedisClientConnection(mockClient, 'テスト接続チェック', mockLogger);
        throw new Error('エラーがスローされるべき');
      } catch (error) {
        expect(error.message).toContain('PINGテストも失敗しました');
        expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('フォールバッククライアントが利用できません'));
      }
    });
  });

  describe('プロパティが完全に存在する場合', () => {
    it('isReady=true, isOpen=trueの場合、成功すること', async () => {
      // Arrange
      mockClient.isReady = true;
      mockClient.isOpen = true;

      // Act
      const result = await validateRedisClientConnection(mockClient, 'テスト接続チェック', mockLogger);

      // Assert
      expect(result).toEqual({ clientReady: true, clientOpen: true });
      expect(mockClient.ping).not.toHaveBeenCalled(); // PINGテストは実行されない
    });

    it('isReady=false, isOpen=falseの場合、エラーになること', async () => {
      // Arrange
      mockClient.isReady = false;
      mockClient.isOpen = false;

      // Act & Assert
      try {
        await validateRedisClientConnection(mockClient, 'テスト接続チェック', mockLogger);
        throw new Error('エラーがスローされるべき');
      } catch (error) {
        expect(error.message).toContain('接続が失われました');
        expect(mockLogger.error).toHaveBeenCalled();
      }
    });
  });

  describe('statusベースの判定', () => {
    it('プロパティが存在せず、status=readyの場合、成功すること', async () => {
      // Arrange
      delete mockClient.isReady;
      delete mockClient.isOpen;
      mockClient.status = 'ready';

      // Act
      const result = await validateRedisClientConnection(mockClient, 'テスト接続チェック', mockLogger);

      // Assert
      expect(result).toEqual({ clientReady: true, clientOpen: true });
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('status基準で接続OK'));
    });

    it('プロパティが存在せず、status=connectedの場合、成功すること', async () => {
      // Arrange
      delete mockClient.isReady;
      delete mockClient.isOpen;
      mockClient.status = 'connected';

      // Act
      const result = await validateRedisClientConnection(mockClient, 'テスト接続チェック', mockLogger);

      // Assert
      expect(result).toEqual({ clientReady: true, clientOpen: true });
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('status基準で接続OK'));
    });

    it('プロパティが存在せず、status=disconnectedの場合、エラーになること', async () => {
      // Arrange
      delete mockClient.isReady;
      delete mockClient.isOpen;
      mockClient.status = 'disconnected';

      // Act & Assert
      try {
        await validateRedisClientConnection(mockClient, 'テスト接続チェック', mockLogger);
        throw new Error('エラーがスローされるべき');
      } catch (error) {
        expect(error.message).toContain('接続プロパティが未定義です');
        expect(mockLogger.error).toHaveBeenCalled();
      }
    });
  });

  describe('本番環境での動作', () => {
    let originalNodeEnv;

    beforeEach(() => {
      originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
    });

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
    });

    it('本番環境では詳細な接続情報をログに出力しないこと', async () => {
      // Arrange
      mockClient.isReady = false;
      mockClient.isOpen = false;

      // Act & Assert
      try {
        await validateRedisClientConnection(mockClient, 'テスト接続チェック', mockLogger);
        throw new Error('エラーがスローされるべき');
      } catch (error) {
        expect(error.message).toContain('接続が失われました');
        expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('接続状態異常'));
        expect(mockLogger.warn).not.toHaveBeenCalledWith(expect.stringMatching(/ready=/));
      }
    });
  });
});