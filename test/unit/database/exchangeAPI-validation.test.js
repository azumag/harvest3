/**
 * Issue #929: exchangeAPI.js validation logic integration tests
 * Tests for exchange object validation through fetchOHLCVDataAPI
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
const { fetchOHLCVDataAPI } = require('../../../src/database/exchangeAPI');

describe('ExchangeAPI - Issue #929: Exchange Validation Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isBacktestMode.mockReturnValue(false);
  });

  describe('Exchange Object Validation through fetchOHLCVDataAPI', () => {
    test('should handle null exchange object', async () => {
      const result = await fetchOHLCVDataAPI(null, 'BTC/JPY', '1m', 100);
      
      expect(result).toEqual([]);
      expect(recordError).toHaveBeenCalledWith('unknown', 'invalid_exchange_object', 'exchange is null or undefined');
    });

    // Issue #933: fetchOHLCV関数の存在チェック
    test('should handle exchange object without fetchOHLCV function', async () => {
      const mockExchange = {
        id: 'bitbank',
        // fetchOHLCV関数が存在しない
      };
      
      const result = await fetchOHLCVDataAPI(mockExchange, 'BTC/JPY', '1m', 100);
      
      expect(result).toEqual([]);
      expect(recordError).toHaveBeenCalledWith('bitbank', 'missing_fetchOHLCV_method', 'BTC/JPY 1m');
    });

    // Issue #933: fetchOHLCVが関数でない場合
    test('should handle exchange object with non-function fetchOHLCV', async () => {
      const mockExchange = {
        id: 'bitbank',
        fetchOHLCV: 'not a function' // 関数ではない
      };
      
      const result = await fetchOHLCVDataAPI(mockExchange, 'DOT/JPY', '1m', 100);
      
      expect(result).toEqual([]);
      expect(recordError).toHaveBeenCalledWith('bitbank', 'missing_fetchOHLCV_method', 'DOT/JPY 1m');
    });

    test('should handle undefined exchange object', async () => {
      const result = await fetchOHLCVDataAPI(undefined, 'BTC/JPY', '1m', 100);
      
      expect(result).toEqual([]);
      expect(recordError).toHaveBeenCalledWith('unknown', 'invalid_exchange_object', 'exchange is null or undefined');
    });

    test('should handle invalid exchange object type', async () => {
      const result = await fetchOHLCVDataAPI('invalid_string', 'BTC/JPY', '1m', 100);
      
      expect(result).toEqual([]);
      expect(recordError).toHaveBeenCalledWith('unknown', 'invalid_exchange_object', 'exchange type: string');
    });

    test('should handle exchange object missing id', async () => {
      const result = await fetchOHLCVDataAPI({}, 'BTC/JPY', '1m', 100);
      
      expect(result).toEqual([]);
      expect(recordError).toHaveBeenCalledWith('unknown', 'invalid_exchange_object', 'exchange.id is missing');
    });

    test('should handle exchange object missing fetchOHLCV method for non-bitbank supported timeframe', async () => {
      const invalidExchange = {
        id: 'binance',
        fetchOHLCV: 'not_a_function'
      };
      
      const result = await fetchOHLCVDataAPI(invalidExchange, 'BTC/USDT', '1m', 100);
      
      expect(result).toEqual([]);
      expect(recordError).toHaveBeenCalledWith('binance', 'missing_fetchOHLCV_method', 'BTC/USDT 1m');
    });

    test('should work with valid exchange object for non-bitbank exchange', async () => {
      const mockOHLCVData = [
        [1641024000000, 5000000, 5100000, 4900000, 5050000, 10.5]
      ];
      
      const validExchange = {
        id: 'binance',
        fetchOHLCV: jest.fn().mockResolvedValue(mockOHLCVData)
      };
      
      const result = await fetchOHLCVDataAPI(validExchange, 'BTC/USDT', '1m', 100);
      
      expect(result).toEqual(mockOHLCVData);
      expect(validExchange.fetchOHLCV).toHaveBeenCalled();
      expect(recordError).not.toHaveBeenCalled();
    });

    test('should handle bitbank unsupported timeframe correctly', async () => {
      const validExchange = {
        id: 'bitbank',
        fetchOHLCV: jest.fn()
      };
      
      // For non-supported timeframes, it should try standard API and fail with validation
      const result = await fetchOHLCVDataAPI(validExchange, 'BTC/JPY', '4h', 100);
      
      expect(result).toEqual([]);
      expect(recordError).toHaveBeenCalledWith('bitbank', 'unsupported_timeframe_precheck', 'BTC/JPY 4h');
      expect(validExchange.fetchOHLCV).not.toHaveBeenCalled();
    });

    test('should work with non-bitbank exchange for any timeframe', async () => {
      const mockOHLCVData = [
        [1641024000000, 50000, 51000, 49000, 50500, 10.5]
      ];
      
      const validExchange = {
        id: 'binance',
        fetchOHLCV: jest.fn().mockResolvedValue(mockOHLCVData)
      };
      
      const result = await fetchOHLCVDataAPI(validExchange, 'BTC/USDT', '4h', 100);
      
      expect(result).toEqual(mockOHLCVData);
      expect(validExchange.fetchOHLCV).toHaveBeenCalledWith('BTC/USDT', '4h', undefined, 100);
      expect(recordError).not.toHaveBeenCalled();
    });

    test('should not output debug info in backtest mode', async () => {
      isBacktestMode.mockReturnValue(true);
      
      const invalidExchange = {
        id: 'binance',
        fetchOHLCV: 'not_a_function'
      };
      
      const result = await fetchOHLCVDataAPI(invalidExchange, 'BTC/USDT', '1m', 100);
      
      expect(result).toEqual([]);
      expect(recordError).toHaveBeenCalledWith('binance', 'missing_fetchOHLCV_method', 'BTC/USDT 1m');
      // In backtest mode, debug logging should be limited
    });
  });
});