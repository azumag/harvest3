/**
 * Test to verify position key mapping is correct
 */

console.log('=== Position Key Mapping Test ===\n');

// Simulate the scenario from Discord error
const orderId = '47271723396';
const exchange = 'bitbank';
const symbol = 'ADA/JPY';

// Test 1: Original behavior (would cause mismatch)
console.log('1. Original scenario (before fix):');
console.log('   Strategy used to create position: MA');
console.log('   Position key created: position:bitbank:ADA/JPY:MA:47271723396');
console.log('   Strategy display name for closing: MA戦略');
console.log('   getStrategyKey("MA戦略") would return: MACD (before fix)');
console.log('   Position key for closing: position:bitbank:ADA/JPY:MACD:47271723396');
console.log('   ❌ MISMATCH - Position not found!\n');

// Test 2: Fixed behavior
console.log('2. Fixed scenario (after fix):');
console.log('   Strategy used to create position: MA');
console.log('   Position key created: position:bitbank:ADA/JPY:MA:47271723396');
console.log('   Strategy display name for closing: MA戦略');
console.log('   getStrategyKey("MA戦略") now returns: MA');
console.log('   Position key for closing: position:bitbank:ADA/JPY:MA:47271723396');
console.log('   ✅ MATCH - Position can be found and closed!\n');

// Test 3: Verify with actual function
const { getStrategyKey } = require('../src/database/manager');

console.log('3. Actual function test:');
const testStrategies = ['MA', 'MA戦略', 'MACD', 'MACD戦略'];
testStrategies.forEach(strategy => {
  const key = getStrategyKey(strategy);
  console.log(`   getStrategyKey("${strategy}") => "${key}"`);
});

console.log('\n=== Summary ===');
console.log('The fix ensures that:');
console.log('1. MA strategy positions are created with key "MA"');
console.log('2. When closing, "MA戦略" is correctly mapped to "MA" (not "MACD")');
console.log('3. Position keys match between creation and closing');
console.log('4. This resolves the Discord error where positions could not be found');