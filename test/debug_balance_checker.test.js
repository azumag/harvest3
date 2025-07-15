/**
 * Debug test to check what logs are actually being output
 */

// Mock dependencies
jest.mock('../src/config', () => ({
  config: {
    exchanges: {
      bitbank: {
        symbols: ['BTC/JPY', 'ETH/JPY', 'CYBER/JPY'],
        instance: {
          id: 'bitbank',
          fetchBalance: jest.fn()
        }
      }
    },
    strategies: {
      MA: { enabled: true, type: 'trend_following' },
      BOLLINGER_BANDS: { enabled: true, type: 'mean_reversion' }
    }
  }
}));

jest.mock('../src/common/notifications', () => ({
  postErrorToDiscord: jest.fn(),
  postOrderToDiscord: jest.fn()
}));

jest.mock('../src/database/redisDatabase', () => ({
  getClient: jest.fn(() => ({
    set: jest.fn(),
    get: jest.fn(),
    eval: jest.fn(),
    isReady: true
  })),
  getAllPositionsRedis: jest.fn(),
  getAllTradeSummaries: jest.fn()
}));

jest.mock('../src/database/manager', () => ({
  getTradeCurrentPosition: jest.fn()
}));

jest.mock('../src/database/redisClient', () => ({
  initRedisClient: jest.fn(() => ({
    isReady: true,
    set: jest.fn(),
    get: jest.fn(),
    eval: jest.fn()
  }))
}));

jest.mock('../src/common/balanceCheckerConfig', () => ({
  getValidatedConfig: jest.fn(() => ({
    thresholds: {
      significantBalance: 0.0001,
      highDiscrepancyPercent: 10
    },
    intervals: {
      exchangeCheckDelay: 1000
    },
    distributedLock: {
      stateKey: 'balance_checker_state',
      lockKeyPrefix: 'balance_checker_lock',
      defaultTtl: 300000
    },
    notifications: {
      maxCurrenciesToShow: 5,
      maxInconsistenciesToShow: 3
    }
  }))
}));

jest.mock('../src/common/bitbankErrorHandler', () => ({
  withBitbankErrorHandling: jest.fn((fn) => fn())
}));

jest.mock('../src/common/strategyUtils', () => ({
  getBalanceCheckEligibleStrategies: jest.fn(() => ['MA', 'BOLLINGER_BANDS'])
}));

// Logger のモック
const mockLoggerInstance = {
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
};

jest.mock('../src/hft/utils/Logger', () => {
  return jest.fn().mockImplementation(() => mockLoggerInstance);
});

const { compareBalances } = require('../src/common/balanceChecker');
const { config } = require('../src/config');
const { getAllPositionsRedis } = require('../src/database/redisDatabase');
const { postOrderToDiscord } = require('../src/common/notifications');

describe('Debug test for balance checker log output', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    postOrderToDiscord.mockResolvedValue();
  });

  it('should output debug info for high discrepancy case', async () => {
    // 高度不整合（90%以上）を設定
    config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
      total: { CYBER: 0.1531, BTC: 1.0 }
    });

    getAllPositionsRedis.mockResolvedValue([
      {
        exchange: 'bitbank',
        symbol: 'CYBER/JPY',
        side: 'buy',
        amount: 0.0074,
        status: 'open'
      },
      {
        exchange: 'bitbank',
        symbol: 'CYBER/JPY',
        side: 'buy',
        amount: 0.0074,
        status: 'open'
      },
      {
        exchange: 'bitbank',
        symbol: 'BTC/JPY',
        side: 'buy',
        amount: 1.0,
        status: 'open'
      }
    ]);

    const result = await compareBalances('bitbank');

    // 実際に不整合があるかどうかを確認
    expect(result.discrepancies.length).toBeGreaterThan(0);
    
    // CYBER の不整合が検出されることを確認
    const cyberDiscrepancy = result.discrepancies.find(d => d.currency === 'CYBER');
    expect(cyberDiscrepancy).toBeDefined();
    expect(cyberDiscrepancy.exchangeAmount).toBe(0.1531);
    expect(cyberDiscrepancy.botAmount).toBe(0.0148);
    
    // 差異率を計算
    const expectedDifference = 0.1531 - 0.0148;
    const expectedDiscrepancyPercent = (expectedDifference / 0.1531) * 100;
    
    // 差異率が 10% 以上かどうかを確認
    const isHighDiscrepancy = expectedDiscrepancyPercent >= 10;
    
    // ログ出力の検証
    if (isHighDiscrepancy) {
      // 高度不整合の場合は ERROR レベルで出力される
      const errorCalls = mockLoggerInstance.error.mock.calls;
      const hasHighDiscrepancyLog = errorCalls.some(call => 
        call[0] && call[0].includes('高度不整合')
      );
      
      // デバッグ用の出力
      if (!hasHighDiscrepancyLog) {
        console.log('Expected high discrepancy log not found');
        console.log('ERROR calls:', errorCalls);
        console.log('WARN calls:', mockLoggerInstance.warn.mock.calls);
        console.log('INFO calls:', mockLoggerInstance.info.mock.calls);
        console.log('Discrepancy percent:', expectedDiscrepancyPercent);
      }
      
      expect(hasHighDiscrepancyLog).toBe(true);
    } else {
      // 軽微な不整合の場合は WARN レベルで出力される
      const warnCalls = mockLoggerInstance.warn.mock.calls;
      const hasLowDiscrepancyLog = warnCalls.some(call => 
        call[0] && call[0].includes('軽微な残高不整合')
      );
      expect(hasLowDiscrepancyLog).toBe(true);
    }
  });
});