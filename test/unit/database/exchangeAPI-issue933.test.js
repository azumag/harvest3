/**
 * Issue #933: fetchStandardHistoricalOHLCVData double-check validation tests
 * Tests for the enhanced validation logic in fetchStandardHistoricalOHLCVData
 */

// Mock dependencies
jest.mock('../../../src/hft/utils/Logger', () => {
  return jest.fn().mockImplementation(() => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  }));
});

jest.mock('../../../src/api/controllers/errorStats', () => ({
  recordError: jest.fn()
}));

jest.mock('../../../src/common/utils', () => ({
  isBacktestMode: jest.fn().mockReturnValue(false)
}));

jest.mock('../../../src/common/notifications', () => ({
  postErrorToDiscord: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../src/common/throttleMonitor', () => ({
  throttleMonitor: {
    recordRequest: jest.fn()
  }
}));

const { recordError } = require('../../../src/api/controllers/errorStats');
const { isBacktestMode } = require('../../../src/common/utils');

// Test utilities
const mockLogger = require('../../../src/hft/utils/Logger');

describe('ExchangeAPI - Issue #933: fetchOHLCVDataAPI Enhanced Validation', () => {
  let exchangeAPI;
  let mockExchange;

  beforeEach(() => {
    jest.clearAllMocks();
    isBacktestMode.mockReturnValue(false);
    
    // exchangeAPIモジュールを動的にインポート
    exchangeAPI = require('../../../src/database/exchangeAPI');
    
    // 基本的なmockExchangeオブジェクト
    mockExchange = {
      id: 'bitbank',
      fetchOHLCV: jest.fn()
    };
  });

  describe('fetchOHLCVDataAPI Enhanced Validation', () => {
    test('should handle exchange object without fetchOHLCV function', async () => {
      const mockExchangeWithoutFetchOHLCV = {
        id: 'bitbank'
        // fetchOHLCV関数が存在しない
      };
      
      const result = await exchangeAPI.fetchOHLCVDataAPI(mockExchangeWithoutFetchOHLCV, 'BTC/JPY', '1m', 100);
      
      expect(result).toEqual([]);
      expect(recordError).toHaveBeenCalledWith('bitbank', 'missing_fetchOHLCV_method', 'BTC/JPY 1m');
    });

    test('should handle exchange object with non-function fetchOHLCV', async () => {
      const mockExchangeWithInvalidFetchOHLCV = {
        id: 'bitbank',
        fetchOHLCV: 'not a function' // 関数ではない
      };
      
      const result = await exchangeAPI.fetchOHLCVDataAPI(mockExchangeWithInvalidFetchOHLCV, 'DOT/JPY', '1m', 100);
      
      expect(result).toEqual([]);
      expect(recordError).toHaveBeenCalledWith('bitbank', 'missing_fetchOHLCV_method', 'DOT/JPY 1m');
    });

    test('should handle exchange object with undefined fetchOHLCV', async () => {
      const mockExchangeWithUndefinedFetchOHLCV = {
        id: 'bitbank',
        fetchOHLCV: undefined
      };
      
      const result = await exchangeAPI.fetchOHLCVDataAPI(mockExchangeWithUndefinedFetchOHLCV, 'ETH/JPY', '5m', 100);
      
      expect(result).toEqual([]);
      expect(recordError).toHaveBeenCalledWith('bitbank', 'missing_fetchOHLCV_method', 'ETH/JPY 5m');
    });

    test('should handle exchange object with null fetchOHLCV', async () => {
      const mockExchangeWithNullFetchOHLCV = {
        id: 'bitbank',
        fetchOHLCV: null
      };
      
      const result = await exchangeAPI.fetchOHLCVDataAPI(mockExchangeWithNullFetchOHLCV, 'LTC/JPY', '15m', 100);
      
      expect(result).toEqual([]);
      expect(recordError).toHaveBeenCalledWith('bitbank', 'missing_fetchOHLCV_method', 'LTC/JPY 15m');
    });
  });

  describe('Error Message Consistency', () => {
    test('should handle multiple currency pairs consistently', async () => {
      const mockExchangeWithoutFetchOHLCV = {
        id: 'bitbank'
      };

      const pairs = ['BTC/JPY', 'DOT/JPY', 'ETH/JPY'];
      const timeframes = ['1m', '5m', '15m'];

      for (const pair of pairs) {
        for (const timeframe of timeframes) {
          jest.clearAllMocks();
          const result = await exchangeAPI.fetchOHLCVDataAPI(mockExchangeWithoutFetchOHLCV, pair, timeframe, 100);
          
          expect(result).toEqual([]);
          expect(recordError).toHaveBeenCalledWith('bitbank', 'missing_fetchOHLCV_method', `${pair} ${timeframe}`);
        }
      }
    });

    test('should return empty array for all invalid fetchOHLCV scenarios', async () => {
      const scenarios = [
        { desc: 'missing fetchOHLCV', exchange: { id: 'bitbank' } },
        { desc: 'string fetchOHLCV', exchange: { id: 'bitbank', fetchOHLCV: 'string' } },
        { desc: 'number fetchOHLCV', exchange: { id: 'bitbank', fetchOHLCV: 123 } },
        { desc: 'null fetchOHLCV', exchange: { id: 'bitbank', fetchOHLCV: null } },
        { desc: 'undefined fetchOHLCV', exchange: { id: 'bitbank', fetchOHLCV: undefined } },
        { desc: 'object fetchOHLCV', exchange: { id: 'bitbank', fetchOHLCV: {} } }
      ];

      for (const scenario of scenarios) {
        jest.clearAllMocks();
        const result = await exchangeAPI.fetchOHLCVDataAPI(scenario.exchange, 'BTC/JPY', '1m', 100);
        
        expect(result).toEqual([]);
        expect(recordError).toHaveBeenCalledWith('bitbank', 'missing_fetchOHLCV_method', 'BTC/JPY 1m');
      }
    });
  });

  describe('Input Validation', () => {
    test('should handle null exchange object', async () => {
      const result = await exchangeAPI.fetchOHLCVDataAPI(null, 'BTC/JPY', '1m', 100);
      
      expect(result).toEqual([]);
      expect(recordError).toHaveBeenCalledWith('unknown', 'invalid_exchange_object', 'exchange is null or undefined');
    });

    test('should handle undefined exchange object', async () => {
      const result = await exchangeAPI.fetchOHLCVDataAPI(undefined, 'BTC/JPY', '1m', 100);
      
      expect(result).toEqual([]);
      expect(recordError).toHaveBeenCalledWith('unknown', 'invalid_exchange_object', 'exchange is null or undefined');
    });

    test('should handle non-object exchange', async () => {
      const result = await exchangeAPI.fetchOHLCVDataAPI('not an object', 'BTC/JPY', '1m', 100);
      
      expect(result).toEqual([]);
      expect(recordError).toHaveBeenCalledWith('unknown', 'invalid_exchange_object', 'exchange type: string');
    });

    test('should handle exchange object without id', async () => {
      const mockExchangeWithoutId = {
        fetchOHLCV: jest.fn()
      };
      
      const result = await exchangeAPI.fetchOHLCVDataAPI(mockExchangeWithoutId, 'BTC/JPY', '1m', 100);
      
      expect(result).toEqual([]);
      expect(recordError).toHaveBeenCalledWith('unknown', 'invalid_exchange_object', 'exchange.id is missing');
    });
  });
});