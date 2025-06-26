/**
 * Comprehensive Test Suite for tradingUtils.js
 * Testing all utility functions with various scenarios
 */

const tradingUtils = require('./src/common/tradingUtils');

// Test helper functions
function assertTest(testName, condition, message = '') {
  console.log(`${condition ? '✅' : '❌'} ${testName}${message ? ': ' + message : ''}`);
  return condition;
}

function assertEquals(actual, expected, testName) {
  const isEqual = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${isEqual ? '✅' : '❌'} ${testName}`);
  if (!isEqual) {
    console.log(`  Expected: ${JSON.stringify(expected)}`);
    console.log(`  Actual: ${JSON.stringify(actual)}`);
  }
  return isEqual;
}

// Test Results Tracker
let totalTests = 0;
let passedTests = 0;

function runTest(testName, testFunction) {
  console.log(`\n🧪 Testing: ${testName}`);
  console.log('='.repeat(50));
  try {
    const result = testFunction();
    totalTests++;
    if (result) passedTests++;
  } catch (error) {
    console.log(`❌ ${testName} - ERROR: ${error.message}`);
    totalTests++;
  }
}

// 1. Test extractConfigParameters
function testExtractConfigParameters() {
  let allPassed = true;

  // Normal operation
  const config1 = { param1: 'value1', param2: 42 };
  const paramMap1 = { param1: 'default1', param2: 0, param3: 'default3' };
  const result1 = tradingUtils.extractConfigParameters(config1, paramMap1);
  const expected1 = { param1: 'value1', param2: 42, param3: 'default3' };
  allPassed &= assertEquals(result1, expected1, 'Normal parameter extraction');

  // Empty config
  const result2 = tradingUtils.extractConfigParameters({}, paramMap1);
  const expected2 = { param1: 'default1', param2: 0, param3: 'default3' };
  allPassed &= assertEquals(result2, expected2, 'Empty config uses defaults');

  // Null/undefined config
  const result3 = tradingUtils.extractConfigParameters(null, paramMap1);
  allPassed &= assertTest('Null config handling', result3 !== null, 'Should handle null config gracefully');

  // Zero values
  const config4 = { param1: 0, param2: false, param3: '' };
  const paramMap4 = { param1: 1, param2: true, param3: 'default' };
  const result4 = tradingUtils.extractConfigParameters(config4, paramMap4);
  const expected4 = { param1: 0, param2: false, param3: '' };
  allPassed &= assertEquals(result4, expected4, 'Zero/false/empty string values preserved');

  return allPassed;
}

// 2. Test extractMarketParameters
function testExtractMarketParameters() {
  let allPassed = true;

  // Normal operation
  const marketParams1 = { price: 100, volume: 1000, spread: 0.01, extra: 'unused' };
  const requiredFields1 = ['price', 'volume', 'missing'];
  const result1 = tradingUtils.extractMarketParameters(marketParams1, requiredFields1);
  const expected1 = { price: 100, volume: 1000 };
  allPassed &= assertEquals(result1, expected1, 'Normal market parameter extraction');

  // Empty required fields
  const result2 = tradingUtils.extractMarketParameters(marketParams1, []);
  allPassed &= assertEquals(result2, {}, 'Empty required fields returns empty object');

  // No required fields parameter
  const result3 = tradingUtils.extractMarketParameters(marketParams1);
  allPassed &= assertEquals(result3, {}, 'No required fields parameter defaults to empty');

  // Null market parameters
  const result4 = tradingUtils.extractMarketParameters(null, ['price']);
  allPassed &= assertTest('Null market parameters handling', result4 !== null, 'Should handle null gracefully');

  return allPassed;
}

// 3. Test determineSignalType
function testDetermineSignalType() {
  let allPassed = true;

  // Buy signal
  allPassed &= assertEquals(tradingUtils.determineSignalType(true, false), 'buy', 'Buy signal detection');
  allPassed &= assertEquals(tradingUtils.determineSignalType(true, true), 'buy', 'Buy signal takes precedence');

  // Sell signal
  allPassed &= assertEquals(tradingUtils.determineSignalType(false, true), 'sell', 'Sell signal detection');

  // No signal
  allPassed &= assertEquals(tradingUtils.determineSignalType(false, false), 'none', 'No signal detection');

  // Edge cases
  allPassed &= assertEquals(tradingUtils.determineSignalType(null, null), 'none', 'Null values treated as false');
  allPassed &= assertEquals(tradingUtils.determineSignalType(undefined, undefined), 'none', 'Undefined values treated as false');
  allPassed &= assertEquals(tradingUtils.determineSignalType(1, 0), 'buy', 'Truthy/falsy values work');

  return allPassed;
}

// 4. Test createStrategyResults
function testCreateStrategyResults() {
  let allPassed = true;

  // Normal operation
  const baseData1 = { timestamp: 123456, symbol: 'BTC/USDT' };
  const specificData1 = { strategy: 'RSI', signal: 'buy' };
  const result1 = tradingUtils.createStrategyResults(baseData1, specificData1);
  const expected1 = { timestamp: 123456, symbol: 'BTC/USDT', strategy: 'RSI', signal: 'buy' };
  allPassed &= assertEquals(result1, expected1, 'Normal strategy results creation');

  // Overlapping keys (specific data should override)
  const baseData2 = { key: 'base', shared: 'base_value' };
  const specificData2 = { key: 'specific', new: 'new_value' };
  const result2 = tradingUtils.createStrategyResults(baseData2, specificData2);
  const expected2 = { key: 'specific', shared: 'base_value', new: 'new_value' };
  allPassed &= assertEquals(result2, expected2, 'Specific data overrides base data');

  // No specific data
  const result3 = tradingUtils.createStrategyResults(baseData1);
  allPassed &= assertEquals(result3, baseData1, 'No specific data returns base data');

  // Empty objects
  const result4 = tradingUtils.createStrategyResults({}, {});
  allPassed &= assertEquals(result4, {}, 'Empty objects return empty object');

  return allPassed;
}

// 5. Test createStandardLogFormat
function testCreateStandardLogFormat() {
  let allPassed = true;

  // Mock data and functions
  const signalResult = { currentPrice: 50000, rsi: 70, volume: 1000 };
  const messageTemplates = {
    buy: (data) => `BUY: Price ${data.price}, RSI ${data.rsi}`,
    sell: (data) => `SELL: Price ${data.price}, RSI ${data.rsi}`,
    none: (data) => `HOLD: Price ${data.price}, RSI ${data.rsi}`
  };
  const dataExtractor = (result) => ({ price: result.currentPrice, rsi: result.rsi });

  const result = tradingUtils.createStandardLogFormat(signalResult, messageTemplates, dataExtractor);
  
  allPassed &= assertTest('Log format has buy message', result.buy === 'BUY: Price 50000, RSI 70');
  allPassed &= assertTest('Log format has sell message', result.sell === 'SELL: Price 50000, RSI 70');
  allPassed &= assertTest('Log format has none message', result.none === 'HOLD: Price 50000, RSI 70');
  allPassed &= assertTest('Log format has orderInfo', result.orderInfo.price === 50000);
  allPassed &= assertTest('Log format has result with currentPrice', result.result.currentPrice === 50000);

  return allPassed;
}

// 6. Test safeNumberFormat
function testSafeNumberFormat() {
  let allPassed = true;

  // Normal numbers
  allPassed &= assertEquals(tradingUtils.safeNumberFormat(123.456, 2), '123.46', 'Normal number formatting');
  allPassed &= assertEquals(tradingUtils.safeNumberFormat(123.456, 0), '123', 'Zero decimal places');
  allPassed &= assertEquals(tradingUtils.safeNumberFormat(123.456), '123.46', 'Default decimal places');

  // Edge cases
  allPassed &= assertEquals(tradingUtils.safeNumberFormat(0), '0.00', 'Zero value');
  allPassed &= assertEquals(tradingUtils.safeNumberFormat(-123.456, 2), '-123.46', 'Negative number');
  allPassed &= assertEquals(tradingUtils.safeNumberFormat(0.001, 4), '0.0010', 'Small number with precision');

  // Invalid values
  allPassed &= assertEquals(tradingUtils.safeNumberFormat(null), 'N/A', 'Null value');
  allPassed &= assertEquals(tradingUtils.safeNumberFormat(undefined), 'N/A', 'Undefined value');
  allPassed &= assertEquals(tradingUtils.safeNumberFormat(NaN), 'N/A', 'NaN value');
  allPassed &= assertEquals(tradingUtils.safeNumberFormat('not a number'), 'N/A', 'String value');

  return allPassed;
}

// 7. Test safePercentageFormat
function testSafePercentageFormat() {
  let allPassed = true;

  // Normal percentages
  allPassed &= assertEquals(tradingUtils.safePercentageFormat(25.678, 2), '25.68%', 'Normal percentage');
  allPassed &= assertEquals(tradingUtils.safePercentageFormat(0), '0.00%', 'Zero percentage');
  allPassed &= assertEquals(tradingUtils.safePercentageFormat(-10.5, 1), '-10.5%', 'Negative percentage');

  // Invalid values
  allPassed &= assertEquals(tradingUtils.safePercentageFormat(null), 'N/A', 'Null percentage');
  allPassed &= assertEquals(tradingUtils.safePercentageFormat(undefined), 'N/A', 'Undefined percentage');
  allPassed &= assertEquals(tradingUtils.safePercentageFormat(NaN), 'N/A', 'NaN percentage');

  return allPassed;
}

// 8. Test validateStrategyConfig
function testValidateStrategyConfig() {
  let allPassed = true;

  // Valid configuration
  const config1 = { threshold: 0.5, period: 14, enabled: true };
  const rules1 = {
    threshold: { required: true, type: 'number', min: 0, max: 1 },
    period: { required: true, type: 'number', min: 1 },
    enabled: { type: 'boolean' }
  };
  const result1 = tradingUtils.validateStrategyConfig(config1, rules1);
  allPassed &= assertTest('Valid config validation', result1.isValid === true && result1.errors.length === 0);

  // Missing required field
  const config2 = { period: 14 };
  const result2 = tradingUtils.validateStrategyConfig(config2, rules1);
  allPassed &= assertTest('Missing required field', result2.isValid === false);
  allPassed &= assertTest('Missing field error message', result2.errors.includes('threshold is required'));

  // Type validation
  const config3 = { threshold: '0.5', period: 14, enabled: true };
  const result3 = tradingUtils.validateStrategyConfig(config3, rules1);
  allPassed &= assertTest('Type validation failure', result3.isValid === false);
  allPassed &= assertTest('Type error message', result3.errors.some(err => err.includes('must be of type number')));

  // Range validation
  const config4 = { threshold: 1.5, period: 0, enabled: true };
  const result4 = tradingUtils.validateStrategyConfig(config4, rules1);
  allPassed &= assertTest('Range validation failure', result4.isValid === false);
  allPassed &= assertTest('Max range error', result4.errors.some(err => err.includes('must be <= 1')));
  allPassed &= assertTest('Min range error', result4.errors.some(err => err.includes('must be >= 1')));

  return allPassed;
}

// 9. Test compareWithThresholds
function testCompareWithThresholds() {
  let allPassed = true;

  // Value above upper threshold
  const result1 = tradingUtils.compareWithThresholds(80, 20, 70);
  allPassed &= assertTest('Above upper threshold', result1.isAboveUpper === true);
  allPassed &= assertTest('Not below lower threshold', result1.isBelowLower === false);
  allPassed &= assertTest('Not within range', result1.isWithinRange === false);

  // Value below lower threshold
  const result2 = tradingUtils.compareWithThresholds(10, 20, 70);
  allPassed &= assertTest('Below lower threshold', result2.isBelowLower === true);
  allPassed &= assertTest('Not above upper threshold', result2.isAboveUpper === false);
  allPassed &= assertTest('Not within range (below)', result2.isWithinRange === false);

  // Value within range
  const result3 = tradingUtils.compareWithThresholds(50, 20, 70);
  allPassed &= assertTest('Within range', result3.isWithinRange === true);
  allPassed &= assertTest('Not above upper (within)', result3.isAboveUpper === false);
  allPassed &= assertTest('Not below lower (within)', result3.isBelowLower === false);

  // Boundary conditions
  const result4 = tradingUtils.compareWithThresholds(20, 20, 70);
  allPassed &= assertTest('At lower boundary', result4.isWithinRange === true);
  
  const result5 = tradingUtils.compareWithThresholds(70, 20, 70);
  allPassed &= assertTest('At upper boundary', result5.isWithinRange === true);

  // Return values included
  allPassed &= assertTest('Value returned', result1.value === 80);
  allPassed &= assertTest('Lower threshold returned', result1.lowerThreshold === 20);
  allPassed &= assertTest('Upper threshold returned', result1.upperThreshold === 70);

  return allPassed;
}

// 10. Test fetchAndValidateStrategyData (async function)
async function testFetchAndValidateStrategyData() {
  let allPassed = true;

  // This function is a wrapper that requires external dependencies
  // We'll test that it exists and can be called, but won't test full functionality
  // since it depends on exchange API and other modules
  
  try {
    allPassed &= assertTest('Function exists', typeof tradingUtils.fetchAndValidateStrategyData === 'function');
    
    // Test with null exchange (should handle gracefully)
    const result = await tradingUtils.fetchAndValidateStrategyData(null, 'BTC/USDT', '1h', 20, 'test');
    allPassed &= assertTest('Handles null exchange', result === null || result === undefined);
    
  } catch (error) {
    allPassed &= assertTest('Error handling for invalid inputs', error.message.length > 0);
  }

  return allPassed;
}

// Performance testing
function testPerformance() {
  console.log('\n🚀 Performance Testing');
  console.log('='.repeat(50));

  const iterations = 10000;
  
  // Test extractConfigParameters performance
  const config = { a: 1, b: 2, c: 3, d: 4, e: 5 };
  const paramMap = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, g: 0 };
  
  const start1 = Date.now();
  for (let i = 0; i < iterations; i++) {
    tradingUtils.extractConfigParameters(config, paramMap);
  }
  const time1 = Date.now() - start1;
  console.log(`extractConfigParameters: ${time1}ms for ${iterations} iterations (${(time1/iterations).toFixed(4)}ms per call)`);

  // Test safeNumberFormat performance
  const start2 = Date.now();
  for (let i = 0; i < iterations; i++) {
    tradingUtils.safeNumberFormat(Math.random() * 1000, 2);
  }
  const time2 = Date.now() - start2;
  console.log(`safeNumberFormat: ${time2}ms for ${iterations} iterations (${(time2/iterations).toFixed(4)}ms per call)`);

  // Test compareWithThresholds performance
  const start3 = Date.now();
  for (let i = 0; i < iterations; i++) {
    tradingUtils.compareWithThresholds(Math.random() * 100, 20, 80);
  }
  const time3 = Date.now() - start3;
  console.log(`compareWithThresholds: ${time3}ms for ${iterations} iterations (${(time3/iterations).toFixed(4)}ms per call)`);

  return true;
}

// Main test runner
async function runAllTests() {
  console.log('🧪 TRADING UTILS COMPREHENSIVE TEST SUITE');
  console.log('='.repeat(60));

  runTest('extractConfigParameters', testExtractConfigParameters);
  runTest('extractMarketParameters', testExtractMarketParameters);
  runTest('determineSignalType', testDetermineSignalType);
  runTest('createStrategyResults', testCreateStrategyResults);
  runTest('createStandardLogFormat', testCreateStandardLogFormat);
  runTest('safeNumberFormat', testSafeNumberFormat);
  runTest('safePercentageFormat', testSafePercentageFormat);
  runTest('validateStrategyConfig', testValidateStrategyConfig);
  runTest('compareWithThresholds', testCompareWithThresholds);
  
  // Async test
  console.log('\n🧪 Testing: fetchAndValidateStrategyData');
  console.log('='.repeat(50));
  try {
    const asyncResult = await testFetchAndValidateStrategyData();
    totalTests++;
    if (asyncResult) passedTests++;
  } catch (error) {
    console.log(`❌ fetchAndValidateStrategyData - ERROR: ${error.message}`);
    totalTests++;
  }

  testPerformance();

  // Final results
  console.log('\n📊 TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total Tests: ${totalTests}`);
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${totalTests - passedTests}`);
  console.log(`Success Rate: ${(passedTests/totalTests*100).toFixed(1)}%`);
  
  if (passedTests === totalTests) {
    console.log('🎉 All tests passed!');
  } else {
    console.log('⚠️  Some tests failed. Please review output above.');
  }
}

// Run the tests
runAllTests().catch(console.error);