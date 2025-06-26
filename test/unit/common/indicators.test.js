/**
 * Test suite for comparing mathematical accuracy between shared indicators (/src/common/indicators.js) 
 * and original implementations (/src/strategies/utils/indicators.js)
 * 
 * This test ensures that refactored indicator functions maintain identical mathematical precision
 */

const sharedIndicators = require('../../../src/common/indicators');
const originalIndicators = require('../../../src/strategies/utils/indicators');

describe('Indicator Mathematical Accuracy Comparison', () => {
  
  // Test data sets with known expected results
  const testDataSets = {
    simple: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    trending: [100, 102, 101, 105, 108, 110, 107, 112, 115, 118, 116, 120],
    volatile: [50, 55, 45, 60, 40, 65, 35, 70, 30, 75, 25, 80],
    btcPrices: [45000, 46000, 44500, 47000, 48000, 46500, 49000, 50000, 48500, 51000, 52000, 50500],
    edgeCases: {
      single: [100],
      two: [100, 105],
      identical: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50],
      withZeros: [0, 1, 2, 0, 3, 4, 0, 5],
      negative: [-10, -5, 0, 5, 10, 15, 10, 5, 0, -5]
    }
  };

  // Helper function to compare arrays with floating point tolerance
  const compareArrays = (arr1, arr2, tolerance = 1e-10) => {
    if (arr1.length !== arr2.length) {
      return { match: false, reason: `Length mismatch: ${arr1.length} vs ${arr2.length}` };
    }
    
    for (let i = 0; i < arr1.length; i++) {
      // Handle null values
      if (arr1[i] === null && arr2[i] === null) continue;
      if (arr1[i] === null || arr2[i] === null) {
        return { match: false, reason: `Null mismatch at index ${i}: ${arr1[i]} vs ${arr2[i]}` };
      }
      
      // Compare numerical values
      if (Math.abs(arr1[i] - arr2[i]) > tolerance) {
        return { 
          match: false, 
          reason: `Value mismatch at index ${i}: ${arr1[i]} vs ${arr2[i]} (diff: ${Math.abs(arr1[i] - arr2[i])})` 
        };
      }
    }
    
    return { match: true };
  };

  // Helper function to compare MACD objects
  const compareMACDObjects = (obj1, obj2, tolerance = 1e-10) => {
    const macdCompare = compareArrays(obj1.macd, obj2.macd, tolerance);
    const signalCompare = compareArrays(obj1.signal, obj2.signal, tolerance);
    const histogramCompare = compareArrays(obj1.histogram, obj2.histogram, tolerance);
    
    return {
      match: macdCompare.match && signalCompare.match && histogramCompare.match,
      macd: macdCompare,
      signal: signalCompare,
      histogram: histogramCompare
    };
  };

  // Helper function to compare Bollinger Bands objects
  const compareBollingerObjects = (obj1, obj2, tolerance = 1e-10) => {
    const upperCompare = compareArrays(obj1.upper, obj2.upper, tolerance);
    const middleCompare = compareArrays(obj1.middle, obj2.middle, tolerance);
    const lowerCompare = compareArrays(obj1.lower, obj2.lower, tolerance);
    
    return {
      match: upperCompare.match && middleCompare.match && lowerCompare.match,
      upper: upperCompare,
      middle: middleCompare,
      lower: lowerCompare
    };
  };

  describe('SMA (Simple Moving Average) Comparison', () => {
    test('SMA calculation with period 10 on simple dataset', () => {
      const period = 10;
      const data = testDataSets.simple;
      
      const sharedResult = sharedIndicators.calculateSMA(data, period);
      const originalResult = originalIndicators.calculateSMA(data, period);
      
      const comparison = compareArrays(sharedResult, originalResult);
      expect(comparison.match).toBe(true);
      if (!comparison.match) {
        console.log('SMA comparison failed:', comparison.reason);
        console.log('Shared result:', sharedResult);
        console.log('Original result:', originalResult);
      }
    });

    test('SMA with different periods', () => {
      const periods = [3, 5, 7, 12];
      const data = testDataSets.trending;
      
      periods.forEach(period => {
        if (data.length >= period) {
          const sharedResult = sharedIndicators.calculateSMA(data, period);
          const originalResult = originalIndicators.calculateSMA(data, period);
          
          const comparison = compareArrays(sharedResult, originalResult);
          expect(comparison.match).toBe(true);
        }
      });
    });

    test('SMA edge cases', () => {
      // Single value
      const singleResult = {
        shared: sharedIndicators.calculateSMA(testDataSets.edgeCases.single, 1),
        original: originalIndicators.calculateSMA(testDataSets.edgeCases.single, 1)
      };
      expect(compareArrays(singleResult.shared, singleResult.original).match).toBe(true);

      // Identical values
      const identicalResult = {
        shared: sharedIndicators.calculateSMA(testDataSets.edgeCases.identical, 5),
        original: originalIndicators.calculateSMA(testDataSets.edgeCases.identical, 5)
      };
      expect(compareArrays(identicalResult.shared, identicalResult.original).match).toBe(true);

      // With zeros
      const zeroResult = {
        shared: sharedIndicators.calculateSMA(testDataSets.edgeCases.withZeros, 3),
        original: originalIndicators.calculateSMA(testDataSets.edgeCases.withZeros, 3)
      };
      expect(compareArrays(zeroResult.shared, zeroResult.original).match).toBe(true);
    });
  });

  describe('EMA (Exponential Moving Average) Comparison', () => {
    test('EMA calculation with period 5 on price series', () => {
      const period = 5;
      const data = testDataSets.btcPrices;
      
      const sharedResult = sharedIndicators.calculateEMA(data, period);
      const originalResult = originalIndicators.calculateEMA(data, period);
      
      const comparison = compareArrays(sharedResult, originalResult);
      expect(comparison.match).toBe(true);
      if (!comparison.match) {
        console.log('EMA comparison failed:', comparison.reason);
        console.log('Shared result:', sharedResult);
        console.log('Original result:', originalResult);
      }
    });

    test('EMA with different periods', () => {
      const periods = [3, 12, 26];
      const data = testDataSets.volatile;
      
      periods.forEach(period => {
        if (data.length >= period) {
          const sharedResult = sharedIndicators.calculateEMA(data, period);
          const originalResult = originalIndicators.calculateEMA(data, period);
          
          const comparison = compareArrays(sharedResult, originalResult);
          expect(comparison.match).toBe(true);
        }
      });
    });

    test('EMA edge cases', () => {
      // Negative values
      const negativeResult = {
        shared: sharedIndicators.calculateEMA(testDataSets.edgeCases.negative, 3),
        original: originalIndicators.calculateEMA(testDataSets.edgeCases.negative, 3)
      };
      expect(compareArrays(negativeResult.shared, negativeResult.original).match).toBe(true);

      // Minimum data length
      const minLengthData = [100, 105, 110];
      const minResult = {
        shared: sharedIndicators.calculateEMA(minLengthData, 3),
        original: originalIndicators.calculateEMA(minLengthData, 3)
      };
      expect(compareArrays(minResult.shared, minResult.original).match).toBe(true);
    });
  });

  describe('MACD Comparison', () => {
    test('MACD calculation with default parameters (12,26,9)', () => {
      const data = testDataSets.btcPrices.concat(testDataSets.trending).concat(testDataSets.volatile);
      
      const sharedResult = sharedIndicators.calculateMACD(data);
      const originalResult = originalIndicators.calculateMACD(data);
      
      const comparison = compareMACDObjects(sharedResult, originalResult);
      expect(comparison.match).toBe(true);
      if (!comparison.match) {
        console.log('MACD comparison failed:');
        console.log('MACD line:', comparison.macd.reason);
        console.log('Signal line:', comparison.signal.reason);
        console.log('Histogram:', comparison.histogram.reason);
      }
    });

    test('MACD with custom parameters', () => {
      const data = testDataSets.btcPrices.concat(testDataSets.trending);
      const params = [
        { fast: 5, slow: 13, signal: 5 },
        { fast: 8, slow: 21, signal: 7 },
        { fast: 10, slow: 20, signal: 9 }
      ];
      
      params.forEach(({ fast, slow, signal }) => {
        if (data.length >= slow + signal) {
          const sharedResult = sharedIndicators.calculateMACD(data, fast, slow, signal);
          const originalResult = originalIndicators.calculateMACD(data, fast, slow, signal);
          
          const comparison = compareMACDObjects(sharedResult, originalResult);
          expect(comparison.match).toBe(true);
        }
      });
    });

    test('MACD edge cases', () => {
      // Long dataset for better MACD calculation
      const longData = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i / 5) * 10);
      
      const sharedResult = sharedIndicators.calculateMACD(longData);
      const originalResult = originalIndicators.calculateMACD(longData);
      
      const comparison = compareMACDObjects(sharedResult, originalResult);
      expect(comparison.match).toBe(true);
    });
  });

  describe('Bollinger Bands Comparison', () => {
    test('Bollinger Bands with period 20, stdDev 2', () => {
      const data = testDataSets.btcPrices.concat(testDataSets.trending);
      
      const sharedResult = sharedIndicators.calculateBollingerBands(data, 20, 2);
      const originalResult = originalIndicators.calculateBollingerBands(data, 20, 2);
      
      const comparison = compareBollingerObjects(sharedResult, originalResult);
      expect(comparison.match).toBe(true);
      if (!comparison.match) {
        console.log('Bollinger Bands comparison failed:');
        console.log('Upper band:', comparison.upper.reason);
        console.log('Middle band:', comparison.middle.reason);
        console.log('Lower band:', comparison.lower.reason);
      }
    });

    test('Bollinger Bands with different parameters', () => {
      const data = testDataSets.volatile.concat(testDataSets.trending);
      const configs = [
        { period: 10, multiplier: 1.5 },
        { period: 15, multiplier: 2.5 },
        { period: 12, multiplier: 2 }
      ];
      
      configs.forEach(({ period, multiplier }) => {
        if (data.length >= period) {
          const sharedResult = sharedIndicators.calculateBollingerBands(data, period, multiplier);
          const originalResult = originalIndicators.calculateBollingerBands(data, period, multiplier);
          
          const comparison = compareBollingerObjects(sharedResult, originalResult);
          expect(comparison.match).toBe(true);
        }
      });
    });

    test('Bollinger Bands edge cases', () => {
      // Low volatility data
      const lowVolData = Array.from({ length: 25 }, () => 100 + Math.random() * 0.1);
      
      const sharedResult = sharedIndicators.calculateBollingerBands(lowVolData, 20, 2);
      const originalResult = originalIndicators.calculateBollingerBands(lowVolData, 20, 2);
      
      const comparison = compareBollingerObjects(sharedResult, originalResult);
      expect(comparison.match).toBe(true);
    });
  });

  describe('Input Validation and Error Handling', () => {
    test('Empty array inputs', () => {
      const emptyArray = [];
      
      // SMA
      const smaShared = sharedIndicators.calculateSMA(emptyArray, 5);
      const smaOriginal = originalIndicators.calculateSMA(emptyArray, 5);
      expect(compareArrays(smaShared, smaOriginal).match).toBe(true);
      
      // EMA
      const emaShared = sharedIndicators.calculateEMA(emptyArray, 5);
      const emaOriginal = originalIndicators.calculateEMA(emptyArray, 5);
      expect(compareArrays(emaShared, emaOriginal).match).toBe(true);
    });

    test('Null and undefined inputs', () => {
      // These should not crash and should return consistent results
      expect(() => sharedIndicators.calculateSMA(null, 5)).not.toThrow();
      expect(() => originalIndicators.calculateSMA(null, 5)).not.toThrow();
      
      expect(() => sharedIndicators.calculateEMA(undefined, 5)).not.toThrow();
      expect(() => originalIndicators.calculateEMA(undefined, 5)).not.toThrow();
    });

    test('Period larger than data length', () => {
      const shortData = [1, 2, 3];
      const largePeriod = 10;
      
      const smaShared = sharedIndicators.calculateSMA(shortData, largePeriod);
      const smaOriginal = originalIndicators.calculateSMA(shortData, largePeriod);
      expect(compareArrays(smaShared, smaOriginal).match).toBe(true);
      
      const emaShared = sharedIndicators.calculateEMA(shortData, largePeriod);
      const emaOriginal = originalIndicators.calculateEMA(shortData, largePeriod);
      expect(compareArrays(emaShared, emaOriginal).match).toBe(true);
    });
  });

  describe('Performance Comparison', () => {
    test('Performance benchmarking', () => {
      // Generate large dataset for performance testing
      const largeData = Array.from({ length: 1000 }, (_, i) => 100 + Math.sin(i / 10) * 20 + Math.random() * 5);
      
      const performanceResults = {};
      
      // SMA Performance
      const smaStart = performance.now();
      const smaShared = sharedIndicators.calculateSMA(largeData, 20);
      const smaSharedTime = performance.now() - smaStart;
      
      const smaOrigStart = performance.now();
      const smaOriginal = originalIndicators.calculateSMA(largeData, 20);
      const smaOriginalTime = performance.now() - smaOrigStart;
      
      performanceResults.sma = {
        shared: smaSharedTime,
        original: smaOriginalTime,
        ratio: smaSharedTime / smaOriginalTime
      };
      
      // EMA Performance
      const emaStart = performance.now();
      const emaShared = sharedIndicators.calculateEMA(largeData, 20);
      const emaSharedTime = performance.now() - emaStart;
      
      const emaOrigStart = performance.now();
      const emaOriginal = originalIndicators.calculateEMA(largeData, 20);
      const emaOriginalTime = performance.now() - emaOrigStart;
      
      performanceResults.ema = {
        shared: emaSharedTime,
        original: emaOriginalTime,
        ratio: emaSharedTime / emaOriginalTime
      };
      
      // MACD Performance
      const macdStart = performance.now();
      const macdShared = sharedIndicators.calculateMACD(largeData);
      const macdSharedTime = performance.now() - macdStart;
      
      const macdOrigStart = performance.now();
      const macdOriginal = originalIndicators.calculateMACD(largeData);
      const macdOriginalTime = performance.now() - macdOrigStart;
      
      performanceResults.macd = {
        shared: macdSharedTime,
        original: macdOriginalTime,
        ratio: macdSharedTime / macdOriginalTime
      };
      
      // Bollinger Bands Performance
      const bbStart = performance.now();
      const bbShared = sharedIndicators.calculateBollingerBands(largeData, 20, 2);
      const bbSharedTime = performance.now() - bbStart;
      
      const bbOrigStart = performance.now();
      const bbOriginal = originalIndicators.calculateBollingerBands(largeData, 20, 2);
      const bbOriginalTime = performance.now() - bbOrigStart;
      
      performanceResults.bollingerBands = {
        shared: bbSharedTime,
        original: bbOriginalTime,
        ratio: bbSharedTime / bbOriginalTime
      };
      
      // Log performance results
      console.log('\n=== Performance Comparison Results ===');
      Object.entries(performanceResults).forEach(([indicator, times]) => {
        console.log(`${indicator.toUpperCase()}:`);
        console.log(`  Shared: ${times.shared.toFixed(3)}ms`);
        console.log(`  Original: ${times.original.toFixed(3)}ms`);
        console.log(`  Ratio: ${times.ratio.toFixed(3)}x`);
      });
      
      // Verify mathematical accuracy still holds for large datasets
      expect(compareArrays(smaShared, smaOriginal).match).toBe(true);
      expect(compareArrays(emaShared, emaOriginal).match).toBe(true);
      expect(compareMACDObjects(macdShared, macdOriginal).match).toBe(true);
      expect(compareBollingerObjects(bbShared, bbOriginal).match).toBe(true);
    });
  });

  describe('Known Mathematical Values Verification', () => {
    test('SMA known values', () => {
      // For data [1,2,3,4,5,6,7,8,9,10] with period 5:
      // Expected SMA: [null,null,null,null,3,4,5,6,7,8]
      const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const result = sharedIndicators.calculateSMA(data, 5);
      
      expect(result[4]).toBeCloseTo(3); // (1+2+3+4+5)/5 = 3
      expect(result[5]).toBeCloseTo(4); // (2+3+4+5+6)/5 = 4
      expect(result[9]).toBeCloseTo(8); // (6+7+8+9+10)/5 = 8
    });

    test('EMA known initial value', () => {
      // First EMA value should equal SMA for the same period
      const data = [10, 12, 14, 16, 18, 20];
      const period = 3;
      
      const emaResult = sharedIndicators.calculateEMA(data, period);
      const smaResult = sharedIndicators.calculateSMA(data, period);
      
      // First non-null EMA should equal first non-null SMA
      expect(emaResult[period - 1]).toBeCloseTo(smaResult[period - 1]);
    });

    test('Bollinger Bands middle line equals SMA', () => {
      const data = testDataSets.trending;
      const period = 10;
      
      const bbResult = sharedIndicators.calculateBollingerBands(data, period, 2);
      const smaResult = sharedIndicators.calculateSMA(data, period);
      
      // Middle band should equal SMA
      expect(compareArrays(bbResult.middle, smaResult).match).toBe(true);
    });
  });
});