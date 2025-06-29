const { getStrategyKey } = require('../src/database/manager');

// Test getStrategyKey function
console.log('Testing getStrategyKey function...\n');

const testCases = [
  { input: 'MA戦略', expected: 'MA' },
  { input: 'MA', expected: 'MA' },
  { input: 'MACD', expected: 'MACD' },
  { input: 'BB戦略', expected: 'BOLLINGER_BANDS' },
  { input: 'BOLLINGER_BANDS', expected: 'BOLLINGER_BANDS' },
  { input: 'オシレーター戦略', expected: 'OSCILLATOR' },
  { input: 'OSCILLATOR', expected: 'OSCILLATOR' },
  { input: 'RSI戦略', expected: 'RSI' },
  { input: 'RSI', expected: 'RSI' },
  { input: 'マルチ指標戦略', expected: 'MULTI_INDICATOR' },
  { input: 'MULTI_INDICATOR', expected: 'MULTI_INDICATOR' },
  { input: 'UNKNOWN_STRATEGY', expected: 'UNKNOWN_STRATEGY' }, // Should return as-is
];

let passedTests = 0;
let failedTests = 0;

testCases.forEach((test, index) => {
  const result = getStrategyKey(test.input);
  const passed = result === test.expected;
  
  if (passed) {
    console.log(`✅ Test ${index + 1} PASSED: getStrategyKey('${test.input}') => '${result}'`);
    passedTests++;
  } else {
    console.log(`❌ Test ${index + 1} FAILED: getStrategyKey('${test.input}') => '${result}' (expected: '${test.expected}')`);
    failedTests++;
  }
});

console.log(`\n=== Test Summary ===`);
console.log(`Total tests: ${testCases.length}`);
console.log(`Passed: ${passedTests}`);
console.log(`Failed: ${failedTests}`);

if (failedTests === 0) {
  console.log(`\n✅ All tests passed! The getStrategyKey function is working correctly.`);
  process.exit(0);
} else {
  console.log(`\n❌ Some tests failed. Please check the implementation.`);
  process.exit(1);
}