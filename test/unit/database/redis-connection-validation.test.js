/**
 * Issue #5755: Redis接続チェック統合テスト（統合版）
 * YAGNI/DRY/KISS原則に準拠した統合テストファイル
 * 旧ファイル統合: redis-connection-integration.test.js, redis-validation-integration.test.js,
 * database-manager-issue-5722-improved.test.js, database-manager-redis-integration.test.js
 */

// 必要最小限の外部依存関係をモック
jest.mock('../../../src/database/redisDatabase', () => ({
  getClient: jest.fn()
}));

jest.mock('../../../src/database/mongoDatabase', () => ({
  connectDB: jest.fn(),
  tradesCollection: {
    findOne: jest.fn(),
    updateOne: jest.fn(),
    insertOne: jest.fn()
  },
  getMongoClient: jest.fn(),
  getClient: jest.fn(),
  addTradeMongoDB: jest.fn()
}));

jest.mock('../../../src/hft/utils/Logger', () => jest.fn().mockImplementation(() => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
})));

jest.mock('../../../src/common/const', () => ({
  MONITORING_SETTINGS: {
    REDIS_TRANSACTION_TIMEOUT: 45000,
    REDIS_CONNECTION_TIMEOUT: 10000
  },
  NOTIFICATION_SETTINGS: {
    RATE_LIMIT_WINDOW_MS: 30000
  },
  EXCHANGE_SETTINGS: {},
  TRADING_EXECUTION_CONSTANTS: {}
}));

jest.mock('../../../src/common/apiCoordinator', () => ({
  apiCoordinator: {}
}));

jest.mock('../../../src/database/redisClient', () => ({
  isCircuitBreakerOpen: jest.fn().mockReturnValue(false),
  updateCircuitBreakerOnFailure: jest.fn(),
  updateCircuitBreakerOnSuccess: jest.fn(),
  getCircuitBreakerStatus: jest.fn().mockReturnValue({
    isOpen: false,
    timeSinceLastFailure: 0
  })
}));

jest.mock('../../../src/common/notifications', () => ({
  sendDiscordAlert: jest.fn(),
  sendDiscordMessage: jest.fn(),  
  sendLineMessage: jest.fn()
}));

// Mock axios like other working tests
jest.mock('axios');

// 共通モックヘルパーの利用
const {
  createMockRedisClient,
  createMockLogger,
  createDisconnectedRedisClient,
  createUndefinedPropertiesRedisClient
} = require('../../helpers/redis-test-mocks');

// テスト対象モジュールのみ unmock
jest.unmock('../../../src/database/manager');

describe('Issue #5755: Redis接続バリデーション統合テスト', () => {
  let mockLogger;
  let databaseManager;
  let validateRedisClientConnection;

  beforeEach(() => {
    // Jest のモックキャッシュをクリア
    jest.resetModules();
    
    // 共通モックの初期化
    mockLogger = createMockLogger();

    // データベースマネージャーを動的にrequire
    databaseManager = require('../../../src/database/manager');
    
    // プライベート関数をテスト用に公開
    validateRedisClientConnection = databaseManager.__getValidateRedisClientConnectionForTesting();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('基本機能存在確認', () => {
    test('executeRedisTransactionWithTimeout関数が正常に読み込まれる', () => {
      expect(typeof databaseManager.executeRedisTransactionWithTimeout).toBe('function');
    });

    test('Redis接続チェック関数が正常にエクスポートされる', () => {
      expect(databaseManager.__getValidateRedisClientConnectionForTesting).toBeDefined();
      expect(typeof databaseManager.__getValidateRedisClientConnectionForTesting).toBe('function');
      expect(typeof validateRedisClientConnection).toBe('function');
    });
  });

  describe('Redis接続バリデーション機能', () => {
    test('正常なRedis接続で成功する', async () => {
      const mockRedisClient = createMockRedisClient();
      
      const result = await validateRedisClientConnection(mockRedisClient, 'テスト接続', mockLogger);
      
      expect(result).toEqual({
        clientReady: true,
        clientOpen: true
      });
      
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    test('nullクライアントで適切なエラーを発生させる', async () => {
      await expect(
        validateRedisClientConnection(null, 'null接続テスト', mockLogger)
      ).rejects.toThrow('Redis Commit失敗: null接続テスト時にクライアントが存在しません');
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        '[Redis Transaction] null接続テスト失敗: クライアントオブジェクトがnull/undefined'
      );
    });

    test('接続失敗状態で適切なエラーを発生させる', async () => {
      const mockRedisClient = createDisconnectedRedisClient();
      
      await expect(
        validateRedisClientConnection(mockRedisClient, '切断状態テスト', mockLogger)
      ).rejects.toThrow(/Redis Commit失敗/);
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('切断状態テスト失敗: ready=false, open=false, status=disconnected')
      );
    });

    test('undefined プロパティで適切なエラー処理を行う', async () => {
      const mockRedisClient = createUndefinedPropertiesRedisClient();
      
      await expect(
        validateRedisClientConnection(mockRedisClient, 'undefined テスト', mockLogger)
      ).rejects.toThrow(/Redis Commit失敗/);
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('undefined テスト失敗: ready=undefined, open=undefined, status=connecting')
      );
    });
  });

  describe('エッジケース対応', () => {
    test('プロパティが完全に存在しない場合の処理', async () => {
      const clientWithoutProperties = {
        status: 'unknown',
        constructor: { name: 'RedisClient' }
      };

      await expect(
        validateRedisClientConnection(clientWithoutProperties, 'プロパティなしテスト', mockLogger)
      ).rejects.toThrow('Redis Commit失敗: プロパティなしテスト時に接続プロパティが未定義です');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('プロパティなしテスト失敗: ready=(undefined property), open=(undefined property), status=unknown')
      );
    });

    test('部分的に有効なプロパティを持つクライアントの処理', async () => {
      const mockRedisClient = createMockRedisClient({
        isReady: true,
        isOpen: false,  // 部分的な接続失敗
        status: 'connecting'
      });
      
      await expect(
        validateRedisClientConnection(mockRedisClient, '部分接続テスト', mockLogger)
      ).rejects.toThrow(/Redis Commit失敗/);
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('部分接続テスト失敗: ready=true, open=false, status=connecting')
      );
    });
  });
});