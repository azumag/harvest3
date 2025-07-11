const { 
  safeValidateOrderPairData,
  safeValidateExchangeData,
  safeValidateOHLCVData,
  safeValidateTickerData,
  safeValidateSignalData,
  safeValidateParameterValue
} = require('../../../src/database/schemas');

describe('Redis Type Validation System', () => {
  
  describe('Order Pair Validation', () => {
    it('should validate valid order pair data', () => {
      const validData = {
        pair: {
          buy: 'order_buy_123',
          sell: 'order_sell_456'
        }
      };
      
      const result = safeValidateOrderPairData(validData, 'test');
      expect(result).not.toBeNull();
      expect(result.pair.buy).toBe('order_buy_123');
      expect(result.pair.sell).toBe('order_sell_456');
    });
    
    it('should reject invalid order pair data', () => {
      const invalidData = {
        pair: {
          buy: '', // empty string should fail
          sell: 'order_sell_456'
        }
      };
      
      const result = safeValidateOrderPairData(invalidData, 'test');
      expect(result).toBeNull();
    });
  });
  
  describe('OHLCV Data Validation', () => {
    it('should validate valid OHLCV data', () => {
      const validData = [
        [1640995200000, 50000, 51000, 49000, 50500, 1.5], // [timestamp, open, high, low, close, volume]
        [1640995260000, 50500, 50800, 50200, 50600, 2.1]
      ];
      
      const result = safeValidateOHLCVData(validData, 'test');
      expect(result).not.toBeNull();
      expect(result).toHaveLength(2);
      expect(result[0]).toHaveLength(6);
    });
    
    it('should reject invalid OHLCV data', () => {
      const invalidData = [
        [1640995200000, 50000, 51000, 49000, 50500], // missing volume
        [1640995260000, 50500, 50800, 50200, 50600, 2.1]
      ];
      
      const result = safeValidateOHLCVData(invalidData, 'test');
      expect(result).toBeNull();
    });
  });
  
  describe('Ticker Data Validation', () => {
    it('should validate valid ticker data', () => {
      const validData = {
        symbol: 'BTC/JPY',
        timestamp: 1640995200000,
        high: 51000,
        low: 49000,
        bid: 50200,
        ask: 50300,
        last: 50250,
        baseVolume: 100,
        quoteVolume: 5025000
      };
      
      const result = safeValidateTickerData(validData, 'test');
      expect(result).not.toBeNull();
      expect(result.symbol).toBe('BTC/JPY');
      expect(result.timestamp).toBe(1640995200000);
    });
    
    it('should reject invalid ticker data', () => {
      const invalidData = {
        symbol: '', // empty symbol should fail
        timestamp: 1640995200000,
        high: 51000,
        low: 49000
      };
      
      const result = safeValidateTickerData(invalidData, 'test');
      expect(result).toBeNull();
    });
  });
  
  describe('Signal Data Validation', () => {
    it('should validate valid signal data', () => {
      const validData = {
        exchange: 'bitbank',
        symbol: 'BTC/JPY',
        strategy: 'momentum',
        signal: 'buy',
        confidence: 0.85,
        timestamp: 1640995200000,
        price: 50000,
        volume: 1.5
      };
      
      const result = safeValidateSignalData(validData, 'test');
      expect(result).not.toBeNull();
      expect(result.signal).toBe('buy');
      expect(result.confidence).toBe(0.85);
    });
    
    it('should reject invalid signal data', () => {
      const invalidData = {
        exchange: 'bitbank',
        symbol: 'BTC/JPY',
        strategy: 'momentum',
        signal: 'invalid_signal', // invalid signal value
        confidence: 0.85,
        timestamp: 1640995200000
      };
      
      const result = safeValidateSignalData(invalidData, 'test');
      expect(result).toBeNull();
    });
  });
  
  describe('Parameter Value Validation', () => {
    it('should validate various parameter types', () => {
      const testCases = [
        { value: null, description: 'null' },
        { value: true, description: 'boolean true' },
        { value: false, description: 'boolean false' },
        { value: 42, description: 'number' },
        { value: 3.14, description: 'float' },
        { value: 'test string', description: 'string' },
        { value: [1, 2, 3], description: 'array' },
        { value: { key: 'value' }, description: 'object' }
      ];
      
      testCases.forEach((testCase, index) => {
        const result = safeValidateParameterValue(testCase.value, `test-${index}`);
        if (result === null && testCase.value !== null) {
          console.log(`Test case ${index} (${testCase.description}) failed:`, testCase.value);
        }
        // For null values, result should be null but validation should succeed
        if (testCase.value === null) {
          expect(result).toBeNull();
        } else {
          expect(result).not.toBeNull();
          expect(result).toEqual(testCase.value);
        }
      });
    });
  });
  
  describe('Exchange Data Validation', () => {
    it('should validate valid exchange data', () => {
      const validData = [{
        id: 'bitbank',
        name: 'bitbank',
        countries: ['JP'],
        urls: {
          api: 'https://api.bitbank.cc',
          www: 'https://bitbank.cc'
        },
        fees: {
          trading: {
            percentage: true,
            maker: 0.001,
            taker: 0.002
          }
        }
      }];
      
      const result = safeValidateExchangeData(validData, 'test');
      expect(result).not.toBeNull();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('bitbank');
    });
    
    it('should reject invalid exchange data', () => {
      const invalidData = [{
        id: '', // empty id should fail
        name: 'bitbank'
      }];
      
      const result = safeValidateExchangeData(invalidData, 'test');
      expect(result).toBeNull();
    });
  });
});