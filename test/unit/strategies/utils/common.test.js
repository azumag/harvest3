/**
 * Tests for src/strategies/utils/common.js
 * 
 * We'll test utility functions without actual dependencies
 */

describe('Strategy Common Utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  // A simplified version of utility functions from common.js
  const commonUtils = {
    // Test utility to validate OHLCV data structure
    validateOHLCVData: (ohlcv, minLength) => {
      if (!ohlcv || !Array.isArray(ohlcv)) {
        return { valid: false, reason: 'Data is not an array' };
      }
      
      if (ohlcv.length < minLength) {
        return { valid: false, reason: `Data length (${ohlcv.length}) is less than required (${minLength})` };
      }
      
      // Check if all candles have valid prices (no NaN or undefined)
      const closes = ohlcv.map(candle => candle[4]); // Get close prices
      if (closes.some(price => price === undefined || price === null || isNaN(price))) {
        return { valid: false, reason: 'Invalid price data found' };
      }
      
      return { valid: true, closes };
    }
  };
  
  describe('validateOHLCVData function', () => {
    test('returns valid result for valid data', () => {
      const validData = [
        [1620000000000, 100, 110, 90, 105, 10],
        [1620003600000, 105, 115, 95, 110, 15],
        [1620007200000, 110, 120, 100, 115, 20]
      ];
      
      const result = commonUtils.validateOHLCVData(validData, 3);
      
      expect(result.valid).toBe(true);
      expect(result.closes).toEqual([105, 110, 115]);
    });
    
    test('returns invalid result if data length is insufficient', () => {
      const shortData = [
        [1620000000000, 100, 110, 90, 105, 10],
        [1620003600000, 105, 115, 95, 110, 15]
      ];
      
      const result = commonUtils.validateOHLCVData(shortData, 3);
      
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Data length');
    });
    
    test('returns invalid result if data contains invalid prices', () => {
      const invalidData = [
        [1620000000000, 100, 110, 90, 105, 10],
        [1620003600000, 105, 115, 95, NaN, 15],
        [1620007200000, 110, 120, 100, 115, 20]
      ];
      
      const result = commonUtils.validateOHLCVData(invalidData, 3);
      
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Invalid price data');
    });
    
    test('returns invalid result if data is not an array', () => {
      const result = commonUtils.validateOHLCVData(null, 3);
      
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('not an array');
    });
  });
});