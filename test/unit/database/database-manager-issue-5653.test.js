/**
 * Issue #5653: strategy-runnerサービスでRedis接続チェック失敗修正テスト
 * formatConnectionStatus関数でのundefined値表示修正テスト
 */

// Jest テストフレームワークを使用
jest.unmock('../../../src/database/manager');

// 外部依存関係をモック  
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
  NOTIFICATION_SETTINGS: {},
  EXCHANGE_SETTINGS: {},
  TRADING_EXECUTION_CONSTANTS: {}
}));

jest.mock('../../../src/common/apiCoordinator', () => ({
  apiCoordinator: {
    // 必要最小限のモック実装
  }
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
  sendDiscordMessage: jest.fn()
}));

const DatabaseManager = require('../../../src/database/manager');

describe('Issue #5653: Redis接続チェック失敗修正', () => {
  let mockLogger;
  let mockRedisClient;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };

    mockRedisClient = {
      isReady: undefined,
      isOpen: undefined,
      status: 'connecting',
      ping: jest.fn()
    };
  });

  test('formatConnectionStatus: undefined値の場合に適切なメッセージが表示される', async () => {
    // Redis接続のテスト用ヘルパー関数を取得
    const validateRedisClientConnection = DatabaseManager.__getValidateRedisClientConnectionForTesting();
    
    // PINGテストが失敗するようにモック設定
    mockRedisClient.ping.mockRejectedValue(new Error('Connection failed'));
    
    try {
      await validateRedisClientConnection(mockRedisClient, '実行前接続チェック', mockLogger);
      fail('例外が発生すべきでした');
    } catch (error) {
      // エラーメッセージが出力されることを確認
      expect(mockLogger.error).toHaveBeenCalled();
      
      // エラーログの内容を確認
      const errorCall = mockLogger.error.mock.calls.find(call => 
        call[0].includes('実行前接続チェック失敗')
      );
      
      expect(errorCall).toBeDefined();
      // 修正後は "ready=(undefined value)" と表示されることを確認
      expect(errorCall[0]).toContain('ready=(undefined value)');
      expect(errorCall[0]).toContain('open=(undefined value)');
    }
  });

  test('formatConnectionStatus: プロパティが存在しない場合に適切なメッセージが表示される', async () => {
    // isReadyとisOpenプロパティを削除
    const clientWithoutProperties = {
      status: 'connecting',
      ping: jest.fn().mockRejectedValue(new Error('Connection failed'))
    };
    
    const validateRedisClientConnection = DatabaseManager.__getValidateRedisClientConnectionForTesting();
    
    try {
      await validateRedisClientConnection(clientWithoutProperties, '実行前接続チェック', mockLogger);
      fail('例外が発生すべきでした');
    } catch (error) {
      // エラーメッセージが出力されることを確認
      expect(mockLogger.error).toHaveBeenCalled();
      
      // エラーログの内容を確認
      const errorCall = mockLogger.error.mock.calls.find(call => 
        call[0].includes('実行前接続チェック失敗')
      );
      
      expect(errorCall).toBeDefined();
      // プロパティが存在しない場合は "(undefined property)" と表示されることを確認
      expect(errorCall[0]).toContain('ready=(undefined property)');
      expect(errorCall[0]).toContain('open=(undefined property)');
    }
  });

  test('formatConnectionStatus: 正常値の場合に適切なメッセージが表示される', async () => {
    // 正常なRedisクライアント
    const normalClient = {
      isReady: true,
      isOpen: true,
      status: 'ready',
      ping: jest.fn().mockResolvedValue('PONG')
    };
    
    const validateRedisClientConnection = DatabaseManager.__getValidateRedisClientConnectionForTesting();
    
    // 正常な場合は例外が発生しないことを確認
    const result = await validateRedisClientConnection(normalClient, '実行前接続チェック', mockLogger);
    
    expect(result).toEqual({ clientReady: true, clientOpen: true });
    expect(mockLogger.error).not.toHaveBeenCalled();
  });
});