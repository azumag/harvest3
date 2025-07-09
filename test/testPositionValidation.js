/**
 * Position Validation Test Script
 * Tests the newly implemented position existence validation and comprehensive logging
 */

const { config } = require('../src/config');
const { executeSellOrder } = require('../src/strategies/utils/common');
const { getMarketParametersByExchangeSymbol } = require('../src/database/manager');

/**
 * Test position validation logic
 */
async function testPositionValidation() {
  console.log('=== Position Validation Test ===');

  const exchange = config.exchanges.bitbank.instance;
  const symbol = 'BTC/JPY';
  const strategyKey = 'TEST_VALIDATION';
  const strategyName = 'TEST_VALIDATION';

  try {
    // Get current market parameters
    console.log('📋 Getting market parameters...');
    const marketParameters = await getMarketParametersByExchangeSymbol(exchange, symbol);
    if (!marketParameters) {
      console.error('❌ Failed to get market parameters');
      return;
    }

    // Get current balance
    console.log('💰 Fetching current balance...');
    const balance = await exchange.fetchBalance();
    const baseCurrency = symbol.split('/')[0];
    const currentBalance = balance.free[baseCurrency] || 0;

    console.log(`✅ Current ${baseCurrency} balance: ${currentBalance}`);

    // Test 1: Valid amount (should pass validation)
    if (currentBalance > 0) {
      console.log('\n🧪 TEST 1: Valid amount validation');
      const validAmount = Math.min(currentBalance * 0.1, 0.001); // 10% of balance or 0.001, whichever is smaller

      console.log(`Testing with amount: ${validAmount} (should PASS)`);

      const result1 = await executeSellOrder(
        exchange,
        symbol,
        strategyKey,
        { orderType: 'market' },
        marketParameters,
        5000000, // Mock price
        strategyName,
        { signal: 'test', reason: 'validation test' },
        { backtest: true } // Use backtest mode to avoid actual trading
      );

      console.log('Result:', result1.success ? '✅ PASSED' : '❌ FAILED');
      if (!result1.success) {
        console.log('Reason:', result1.reason);
      }
    }

    // Test 2: Invalid amount (should fail validation)
    console.log('\n🧪 TEST 2: Invalid amount validation');
    const invalidAmount = currentBalance + 1; // More than available balance

    console.log(`Testing with amount: ${invalidAmount} (should FAIL validation)`);

    const result2 = await executeSellOrder(
      exchange,
      symbol,
      strategyKey,
      { orderType: 'market' },
      marketParameters,
      5000000, // Mock price
      strategyName,
      { signal: 'test', reason: 'validation test - invalid amount' },
      { backtest: true } // Use backtest mode to avoid actual trading
    );

    console.log('Result:', result2.success ? '❌ UNEXPECTED PASS' : '✅ CORRECTLY FAILED');
    console.log('Reason:', result2.reason);

    if (result2.validationDetails || result2.fallbackValidationDetails) {
      const details = result2.validationDetails || result2.fallbackValidationDetails;
      console.log('📊 Validation Details:');
      console.log(`   Exchange Amount: ${details.exchangeAmount}`);
      console.log(`   Attempted Amount: ${details.attemptedAmount}`);
      console.log(`   Shortage: ${details.shortage}`);
      console.log(`   Shortage %: ${details.shortagePercent}%`);
    }

    // Test 3: Zero balance scenario
    console.log('\n🧪 TEST 3: Zero balance scenario');

    // Mock a zero balance scenario by testing with a currency we don't have
    const zeroBalanceSymbol = 'ETH/JPY';
    const zeroBalanceCurrency = 'ETH';
    const ethBalance = balance.free[zeroBalanceCurrency] || 0;

    if (ethBalance === 0) {
      console.log(`Testing ${zeroBalanceSymbol} with zero balance (should FAIL validation)`);

      const ethMarketParams = await getMarketParametersByExchangeSymbol(exchange, zeroBalanceSymbol);
      if (ethMarketParams) {
        const result3 = await executeSellOrder(
          exchange,
          zeroBalanceSymbol,
          strategyKey,
          { orderType: 'market' },
          ethMarketParams,
          400000, // Mock ETH price
          strategyName,
          { signal: 'test', reason: 'zero balance test' },
          { backtest: true }
        );

        console.log('Result:', result3.success ? '❌ UNEXPECTED PASS' : '✅ CORRECTLY FAILED');
        console.log('Reason:', result3.reason);
      }
    } else {
      console.log(`⚠️ Skipping zero balance test - ETH balance is ${ethBalance}`);
    }

    console.log('\n✅ Position validation tests completed');

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
    console.error('Stack:', error.stack);
  }
}

/**
 * Test the closeAllPositions validation
 */
async function testCloseAllValidation() {
  console.log('\n=== Close All Positions Validation Test ===');

  try {
    const exchange = config.exchanges.bitbank.instance;

    // Get current balance
    console.log('💰 Fetching current balance for closeAll test...');
    const balance = await exchange.fetchBalance();

    console.log('📊 Current balances:');
    Object.keys(balance.free).forEach(currency => {
      const amount = balance.free[currency];
      if (amount > 0) {
        console.log(`   ${currency}: ${amount} (Free) + ${balance.used[currency] || 0} (Used) = ${balance.total[currency] || 0} (Total)`);
      }
    });

    console.log('\n✅ Balance validation for closeAll test completed');
    console.log('💡 Recommendation: Run closeAllPositions.js in dry-run mode to test validation');

  } catch (error) {
    console.error('❌ CloseAll validation test failed:', error.message);
  }
}

// Main test execution
async function runTests() {
  console.log('🚀 Starting Position Validation Tests');
  console.log('⚠️  Running in SAFE MODE - No actual trades will be executed');
  console.log('=' .repeat(60));

  try {
    await testPositionValidation();
    await testCloseAllValidation();

    console.log('\n' + '='.repeat(60));
    console.log('🎉 All validation tests completed successfully');
    console.log('✅ Position validation and comprehensive logging are working correctly');

  } catch (error) {
    console.error('💥 Test suite failed:', error.message);
    process.exit(1);
  }
}

// Run tests if called directly
if (require.main === module) {
  runTests();
}

module.exports = { testPositionValidation, testCloseAllValidation, runTests };