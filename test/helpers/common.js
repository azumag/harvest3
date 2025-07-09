/**
 * Common Test Helpers
 * 共通テストヘルパー関数
 *
 * Geminiレビュー対応：テスト可読性向上のためのヘルパー関数集
 */

/**
 * Mock setup helpers
 */
const mockHelpers = {
  /**
   * Exchange balance mock setup
   * @param {Object} balance - Balance object to mock
   */
  mockExchangeBalance: (balance) => {
    const { config } = require('../../src/config');
    config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue(balance);
  },

  /**
   * Redis client mock setup
   * @param {Object} responses - Custom responses for Redis methods
   * @returns {Object} Mocked Redis client
   */
  mockRedisClient: (responses = {}) => {
    const defaultResponses = {
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn().mockResolvedValue(null),
      eval: jest.fn().mockResolvedValue(1),
      del: jest.fn().mockResolvedValue(1),
      exists: jest.fn().mockResolvedValue(1)
    };

    const mockClient = { ...defaultResponses, ...responses };
    require('../../src/database/redisDatabase').getClient.mockReturnValue(mockClient);
    return mockClient;
  },

  /**
   * Strategy configuration mock
   * @param {Object} strategies - Strategy configuration
   */
  mockStrategies: (strategies = {}) => {
    const defaultStrategies = {
      MA: { enabled: true, type: 'trend_following' },
      BOLLINGER_BANDS: { enabled: true, type: 'mean_reversion' },
      MULTI_INDICATOR: { enabled: true, type: 'composite' },
      OSCILLATOR: { enabled: true, type: 'mean_reversion' },
      MUTUAL_INFO: { enabled: true, type: 'statistical' }
    };

    const { config } = require('../../src/config');
    config.strategies = { ...defaultStrategies, ...strategies };
  },

  /**
   * Database function mocks
   * @param {Object} overrides - Override specific function implementations
   */
  mockDatabaseFunctions: (overrides = {}) => {
    const { getAllPositionsRedis, getAllTradeSummaries } = require('../../src/database/redisDatabase');
    const { getTradeCurrentPosition } = require('../../src/database/manager');

    const defaults = {
      getAllPositionsRedis: [],
      getAllTradeSummaries: [],
      getTradeCurrentPosition: 0
    };

    const mocks = { ...defaults, ...overrides };

    getAllPositionsRedis.mockResolvedValue(mocks.getAllPositionsRedis);
    getAllTradeSummaries.mockResolvedValue(mocks.getAllTradeSummaries);
    getTradeCurrentPosition.mockResolvedValue(mocks.getTradeCurrentPosition);
  }
};

/**
 * Common test data
 */
const testData = {
  // Sample balance data
  balances: {
    standard: {
      total: { BTC: 1.5, ETH: 10.0, GRT: 0.2626 },
      free: { BTC: 1.0, ETH: 8.0, GRT: 0.2626 },
      used: { BTC: 0.5, ETH: 2.0, GRT: 0.0 }
    },
    empty: {
      total: {},
      free: {},
      used: {}
    },
    imbalanced: {
      total: { BTC: 2.0, ETH: 5.0 },
      free: { BTC: 2.0, ETH: 5.0 },
      used: { BTC: 0, ETH: 0 }
    }
  },

  // Sample position data
  positions: {
    standard: {
      exchange: 'bitbank',
      symbol: 'BTC/JPY',
      side: 'buy',
      amount: 1.5,
      status: 'open'
    },
    multi: [
      { exchange: 'bitbank', symbol: 'BTC/JPY', side: 'buy', amount: 1.0, status: 'open' },
      { exchange: 'bitbank', symbol: 'ETH/JPY', side: 'buy', amount: 5.0, status: 'open' }
    ]
  },

  // Sample trade summary data
  tradeSummaries: {
    profitable: {
      exchange: 'bitbank',
      symbol: 'BTC/JPY',
      netPosition: 1.5,
      totalProfit: 1000,
      totalLoss: 500
    },
    loss: {
      exchange: 'bitbank',
      symbol: 'ETH/JPY',
      netPosition: 0.5,
      totalProfit: 200,
      totalLoss: 800
    }
  },

  // Error scenarios
  errors: {
    networkTimeout: new Error('Network timeout'),
    apiError: new Error('API Error'),
    redisConnectionFailed: new Error('Redis connection failed'),
    mongoConnectionError: new Error('MongoDB connection error'),
    dataCorrupted: new Error('Data corrupted')
  }
};

/**
 * Enhanced assertion helpers
 */
const assertions = {
  /**
   * Assert balance objects match
   * @param {Object} actual - Actual balance result
   * @param {Object} expected - Expected balance values
   */
  expectBalanceMatch: (actual, expected) => {
    Object.keys(expected).forEach(currency => {
      expect(actual[currency]).toBe(expected[currency]);
    });
  },

  /**
   * Assert balance comparison result structure
   * @param {Object} result - Balance comparison result
   * @param {boolean} hasDiscrepancies - Expected discrepancy status
   */
  expectComparisonResult: (result, hasDiscrepancies = false) => {
    expect(result).toHaveProperty('hasDiscrepancies', hasDiscrepancies);
    expect(result).toHaveProperty('exchangeBalance');
    expect(result).toHaveProperty('botBalance');
    expect(result).toHaveProperty('timestamp');

    if (hasDiscrepancies) {
      expect(result).toHaveProperty('discrepancies');
      expect(typeof result.discrepancies).toBe('object');
    }
  },

  /**
   * Assert error handling behavior
   * @param {Function} asyncFn - Async function to test
   * @param {string|RegExp} errorMessage - Expected error message
   */
  expectAsyncError: async (asyncFn, errorMessage) => {
    await expect(asyncFn()).rejects.toThrow(errorMessage);
  },

  /**
   * Assert successful operation with specific properties
   * @param {Object} result - Operation result
   * @param {Array} requiredProps - Required properties
   */
  expectSuccessResult: (result, requiredProps = []) => {
    expect(result).toBeDefined();
    requiredProps.forEach(prop => {
      expect(result).toHaveProperty(prop);
    });
  }
};

/**
 * Test scenario builders
 */
const scenarios = {
  /**
   * Setup balanced scenario (exchange and bot balances match)
   */
  setupBalanced: () => {
    mockHelpers.mockExchangeBalance(testData.balances.standard);
    mockHelpers.mockDatabaseFunctions({
      getAllPositionsRedis: [testData.positions.standard]
    });
  },

  /**
   * Setup imbalanced scenario (discrepancies exist)
   */
  setupImbalanced: () => {
    mockHelpers.mockExchangeBalance(testData.balances.imbalanced);
    mockHelpers.mockDatabaseFunctions({
      getAllPositionsRedis: [testData.positions.standard] // Different from exchange balance
    });
  },

  /**
   * Setup error scenario for testing error handling
   * @param {string} errorType - Type of error to simulate
   */
  setupError: (errorType = 'networkTimeout') => {
    const error = testData.errors[errorType];
    if (!error) {
      throw new Error(`Unknown error type: ${errorType}`);
    }

    mockHelpers.mockExchangeBalance(Promise.reject(error));
  },

  /**
   * Setup empty data scenario
   */
  setupEmpty: () => {
    mockHelpers.mockExchangeBalance(testData.balances.empty);
    mockHelpers.mockDatabaseFunctions({
      getAllPositionsRedis: []
    });
  }
};

/**
 * Cleanup helpers
 */
const cleanup = {
  /**
   * Reset all mocks to default state
   */
  resetAllMocks: () => {
    jest.clearAllMocks();
    // Reset any global state if needed
  },

  /**
   * Clean up timers and intervals
   */
  clearTimers: () => {
    if (global.balanceCheckTimers) {
      Object.values(global.balanceCheckTimers).forEach(timer => {
        if (timer) {
          clearInterval(timer);
        }
      });
      global.balanceCheckTimers = {};
    }
  }
};

module.exports = {
  mockHelpers,
  testData,
  assertions,
  scenarios,
  cleanup
};