/**
 * Jest setup file for handling Redis connections in test environment
 */

// Mock Redis client for tests
jest.mock('./src/database/redisClient', () => {
  const mockClient = {
    keys: jest.fn().mockResolvedValue([]),
    del: jest.fn().mockResolvedValue(1),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    hget: jest.fn().mockResolvedValue(null),
    hset: jest.fn().mockResolvedValue(1),
    hdel: jest.fn().mockResolvedValue(1),
    hgetall: jest.fn().mockResolvedValue({}),
    exists: jest.fn().mockResolvedValue(0),
    quit: jest.fn().mockResolvedValue('OK'),
    isOpen: true
  };

  return {
    initRedisClient: jest.fn().mockResolvedValue(true),
    getClient: jest.fn().mockReturnValue(mockClient),
    closeRedisClient: jest.fn().mockResolvedValue(true)
  };
});

// Mock Redis database functions with stateful behavior for testing
jest.mock('./src/database/redisDatabase', () => {
  // In-memory storage for test data (inside mock scope)
  const mockTestPositionStore = new Map();
  const mockTestPnLStore = new Map();

  const originalModule = jest.requireActual('./src/database/redisDatabase');

  return {
    ...originalModule,
    clearAllPositionsRedis: jest.fn().mockImplementation(() => {
      mockTestPositionStore.clear();
      return Promise.resolve(true);
    }),
    clearAllPnLRedis: jest.fn().mockImplementation(() => {
      mockTestPnLStore.clear();
      return Promise.resolve(true);
    }),
    savePositionRedis: jest.fn().mockImplementation((key, data) => {
      mockTestPositionStore.set(key, data);
      return Promise.resolve(true);
    }),
    getPositionRedis: jest.fn().mockImplementation((key) => {
      return Promise.resolve(mockTestPositionStore.get(key) || null);
    }),
    getStrategyPositionsRedis: jest.fn().mockImplementation((exchangeId, symbol, strategyKey) => {
      const positions = [];
       
      for (const [_key, position] of mockTestPositionStore.entries()) {
        if (position.exchangeId === exchangeId &&
            position.symbol === symbol &&
            position.strategyKey === strategyKey) {
          positions.push(position);
        }
      }
      return Promise.resolve(positions);
    }),
    deletePositionRedis: jest.fn().mockImplementation((key) => {
      mockTestPositionStore.delete(key);
      return Promise.resolve(true);
    }),
    recordPnLRedis: jest.fn().mockImplementation((exchangeId, strategyKey, pnl) => {
      const key = `${exchangeId}:${strategyKey}`;
      const current = mockTestPnLStore.get(key) || 0;
      mockTestPnLStore.set(key, current + pnl);
      return Promise.resolve(true);
    }),
    calculatePeriodPnLRedis: jest.fn().mockResolvedValue({ totalPnL: 0, trades: 0 }),
    clearPnLRedis: jest.fn().mockImplementation((exchangeId, strategyKey) => {
      const key = `${exchangeId}:${strategyKey}`;
      mockTestPnLStore.delete(key);
      return Promise.resolve(true);
    }),
    // Store references for test setup
    __mockTestPositionStore: mockTestPositionStore,
    __mockTestPnLStore: mockTestPnLStore
  };
});

// Mock MongoDB modules to prevent connection attempts during tests
jest.mock('./src/database/mongoDatabase');
// Database manager is mocked via __mocks__/database/manager.js
jest.mock('./src/database/manager');

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.MONGO_URL = process.env.MONGO_URL || 'mongodb://harvest3-mongodb:27017';
process.env.MONGODB_DB_NAME = 'test';

// CI環境でのコンソール出力抑制を無効化（EPIPEエラー防止のため）
// console mockingがworker間通信でEPIPEエラーを引き起こすため、CI環境では使用しない
// 代わりにJest設定でsilent:falseを使用してログを制御
if (process.env.CI) {
  // CI環境では console mocking を完全に無効化してワーカー通信エラーを防止
  // テストログは jest.config.js の silent 設定で制御
}

// 安全なクリーンアップ処理 - ワーカープロセスクラッシュを防止
afterAll(async () => {
  // CI環境では最小限のクリーンアップのみ実行してワーカー通信エラーを防止
  if (process.env.CI) {
    // CI環境では基本的なクリーンアップのみ（EPIPE/ワーカークラッシュ防止）
    jest.clearAllTimers();
    return; // 早期リターンで複雑なクリーンアップを避ける
  }
  
  // 非CI環境では通常のクリーンアップを実行
  jest.clearAllTimers();
  jest.clearAllMocks();
  
  // 詳細なクリーンアップを実行（非CI環境のみ）
  if (process._getActiveHandles) {
    const activeHandles = process._getActiveHandles();
    if (activeHandles && activeHandles.length > 0) {
      activeHandles.forEach(handle => {
        if (handle && typeof handle.unref === 'function') {
          try {
            handle.unref();
          } catch (error) {
            // ハンドルのクリーンアップエラーを無視
          }
        }
      });
    }
  }
  
  // タイマーの強制クリア（非CI環境のみ）
  if (process._getActiveRequests) {
    const activeRequests = process._getActiveRequests();
    if (activeRequests && activeRequests.length > 0) {
      activeRequests.forEach(request => {
        if (request && typeof request.abort === 'function') {
          try {
            request.abort();
          } catch (error) {
            // リクエストのキャンセルエラーを無視
          }
        }
      });
    }
  }
});

// 各テストスイート後のクリーンアップ
afterEach(() => {
  // モックコールをクリア
  jest.clearAllMocks();
  // タイマーをクリア
  jest.clearAllTimers();
});