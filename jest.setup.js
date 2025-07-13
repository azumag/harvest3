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
process.env.MONGO_DB_NAME = 'test';

// Suppress console outputs in CI environment to prevent false test failures
// Tests legitimately use console.log/warn/error outputs which CI treats as failures
if (process.env.CI) {
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  const originalConsoleLog = console.log;

  console.error = jest.fn().mockImplementation((...args) => {
    // Still log to stderr for debugging if needed
    if (process.env.DEBUG_CI_ERRORS) {
      originalConsoleError.apply(console, args);
    }
  });

  console.warn = jest.fn().mockImplementation((...args) => {
    // Still log to stderr for debugging if needed
    if (process.env.DEBUG_CI_ERRORS) {
      originalConsoleWarn.apply(console, args);
    }
  });

  console.log = jest.fn().mockImplementation((...args) => {
    // Still log to stdout for debugging if needed
    if (process.env.DEBUG_CI_ERRORS) {
      originalConsoleLog.apply(console, args);
    }
  });
}

if (!process.env.CI) {
  // Jest setup completed - Redis mocked with stateful behavior for test environment (verbose logging disabled for performance)
}