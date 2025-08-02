/**
 * Issue #5687: strategy-runnerサービスでRedis接続undefined値表示修正テスト
 * formatConnectionStatus関数でのundefined値の安全な表示修正テスト
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

jest.mock('axios', () => ({
  post: jest.fn(),
  get: jest.fn()
}));

const Logger = require('../../../src/hft/utils/Logger');
const { __getValidateRedisClientConnectionForTesting } = require('../../../src/database/manager');

describe('Issue #5687: Redis接続undefined値表示修正テスト', () => {
  let logger;
  let validateRedisClientConnection;

  beforeEach(() => {
    jest.clearAllMocks();
    logger = new Logger();
    validateRedisClientConnection = __getValidateRedisClientConnectionForTesting();
  });

  describe('validateRedisClientConnection - undefined値の安全な表示', () => {
    test('isReadyがundefinedの場合、(undefined value)として表示される', async () => {
      // undefined値を持つクライアントをモック
      const mockClient = {
        isReady: undefined,
        isOpen: true,
        status: 'connecting'
      };
      
      try {
        await validateRedisClientConnection(mockClient, 'テスト接続チェック', logger);
        throw new Error('エラーが発生すべき');
      } catch (error) {
        // logger.errorが適切な形式で呼ばれることを確認
        expect(logger.error).toHaveBeenCalledWith(
          expect.stringContaining('ready=(undefined value)')
        );
        expect(logger.error).toHaveBeenCalledWith(
          expect.stringContaining('open=true')
        );
      }
    });

    test('isOpenがundefinedの場合、(undefined value)として表示される', async () => {
      // undefined値を持つクライアントをモック
      const mockClient = {
        isReady: true,
        isOpen: undefined,
        status: 'connecting'
      };
      
      try {
        await validateRedisClientConnection(mockClient, 'テスト接続チェック', logger);
        throw new Error('エラーが発生すべき');
      } catch (error) {
        // logger.errorが適切な形式で呼ばれることを確認
        expect(logger.error).toHaveBeenCalledWith(
          expect.stringContaining('ready=true')
        );
        expect(logger.error).toHaveBeenCalledWith(
          expect.stringContaining('open=(undefined value)')
        );
      }
    });

    test('両方がundefinedの場合、両方とも(undefined value)として表示される', async () => {
      // 両方がundefinedのクライアントをモック
      const mockClient = {
        isReady: undefined,
        isOpen: undefined,
        status: 'connecting'
      };
      
      try {
        await validateRedisClientConnection(mockClient, 'テスト接続チェック', logger);
        throw new Error('エラーが発生すべき');
      } catch (error) {
        // logger.errorまたはlogger.warnが適切な形式で呼ばれることを確認
        const logCalls = [...logger.error.mock.calls, ...logger.warn.mock.calls];
        const hasCorrectReadyLog = logCalls.some(call => 
          call.some(arg => typeof arg === 'string' && arg.includes('ready=(undefined value)'))
        );
        const hasCorrectOpenLog = logCalls.some(call => 
          call.some(arg => typeof arg === 'string' && arg.includes('open=(undefined value)'))
        );
        
        expect(hasCorrectReadyLog).toBe(true);
        expect(hasCorrectOpenLog).toBe(true);
      }
    });

    test('プロパティが存在しない場合、(undefined property)として表示される', async () => {
      // プロパティが存在しないクライアントをモック
      const mockClient = {
        status: 'connecting'
      };
      
      try {
        await validateRedisClientConnection(mockClient, 'テスト接続チェック', logger);
        throw new Error('エラーが発生すべき');
      } catch (error) {
        // logger.errorまたはlogger.warnが適切な形式で呼ばれることを確認
        const logCalls = [...logger.error.mock.calls, ...logger.warn.mock.calls];
        const hasCorrectReadyLog = logCalls.some(call => 
          call.some(arg => typeof arg === 'string' && arg.includes('ready=(undefined property)'))
        );
        const hasCorrectOpenLog = logCalls.some(call => 
          call.some(arg => typeof arg === 'string' && arg.includes('open=(undefined property)'))
        );
        
        expect(hasCorrectReadyLog).toBe(true);
        expect(hasCorrectOpenLog).toBe(true);
      }
    });

    test('正常な値の場合、実際の値が表示される', async () => {
      // 正常な値を持つクライアントをモック
      const mockClient = {
        isReady: true,
        isOpen: true,
        status: 'ready',
        ping: jest.fn().mockResolvedValue('PONG')
      };
      
      const result = await validateRedisClientConnection(mockClient, 'テスト接続チェック', logger);
      
      // 正常な接続状態が返されることを確認
      expect(result.clientReady).toBe(true);
      expect(result.clientOpen).toBe(true);
      
      // エラーログが出力されないことを確認
      expect(logger.error).not.toHaveBeenCalled();
    });
  });
});