/**
 * Test to understand how CCXT handles unsupported symbols
 */
const ccxt = require('ccxt');

async function testSymbolHandling() {
  console.log('Testing symbol handling for bitbank exchange');
  
  // Create bitbank instance without API credentials (for market data only)
  const exchange = new ccxt.bitbank({
    enableRateLimit: true
  });

  try {
    // Load markets 
    console.log('Loading markets...');
    await exchange.loadMarkets();
    
    console.log(`Total markets found: ${Object.keys(exchange.markets).length}`);
    console.log('First 10 markets:', Object.keys(exchange.markets).slice(0, 10));
    
    // Check if specific symbols exist
    const symbolsToCheck = ['BTC/JPY', 'BNB/JPY', 'CYBER/JPY', 'ETH/JPY'];
    
    for (const symbol of symbolsToCheck) {
      const isSupported = symbol in exchange.markets;
      console.log(`${symbol}: ${isSupported ? 'SUPPORTED' : 'NOT SUPPORTED'}`);
      
      if (isSupported) {
        console.log(`  Market info: ${JSON.stringify(exchange.markets[symbol].info || 'no info')}`);
      }
    }
    
  } catch (error) {
    console.error('Error loading markets:', error.message);
  }
}

testSymbolHandling();