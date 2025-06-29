/**
 * Refactored backtestRunner.js - Using new BacktestExecutor architecture
 * This file shows how runBacktestForSymbol can be dramatically simplified
 */

const BacktestExecutor = require('./trading/BacktestExecutor');

/**
 * REFACTORED: runBacktestForSymbol - Now 95% smaller and cleaner
 * Original: 339 lines of complex backtest logic
 * Refactored: ~15 lines using BacktestExecutor
 */
async function runBacktestForSymbol(
  exchange, 
  symbol, 
  strategy, 
  strategyKey, 
  marketParametersByExchange, 
  autoUpdate, 
  gridSearch, 
  startDate, 
  endDate, 
  retryCount, 
  allExchangeSymbolPairs
) {
  // Create BacktestExecutor with all configuration
  const executor = new BacktestExecutor(exchange, symbol, strategy, strategyKey, marketParametersByExchange, {
    autoUpdate,
    gridSearch,
    startDate,
    endDate,
    retryCount,
    allExchangeSymbolPairs
  });
  
  // Run comprehensive backtest using extracted common logic
  const results = await executor.runBacktest();
  
  // Return results in format compatible with original function
  return {
    shouldRetry: results.bestResult?.finalBaseFund <= 10000, // Retry if no profit
    results: results.rankedResults,
    bestResult: results.bestResult,
    summary: {
      symbol: results.symbol,
      strategy: results.strategyKey,
      totalTests: results.totalTests,
      bestPerformance: results.bestResult?.finalBaseFund || 10000
    }
  };
}

// Example of how the main backtest function becomes much simpler
async function runMainBacktest() {
  // All the complex setup logic remains the same...
  // (exchange initialization, symbol loading, etc.)
  
  // But now each symbol backtest is just one clean call:
  for (const symbol of symbols) {
    for (const strategyKey of Object.keys(strategies)) {
      const strategy = strategies[strategyKey];
      
      // This replaces 339 lines of complex logic with a simple call
      const result = await runBacktestForSymbol(
        exchange,
        symbol,
        strategy,
        strategyKey,
        marketParametersByExchange,
        autoUpdate,
        gridSearch,
        startDate,
        endDate,
        0, // retryCount
        allExchangeSymbolPairs
      );
      
      console.log(`${symbol} ${strategyKey} backtest completed:`, result.summary);
    }
  }
}

module.exports = {
  runBacktestForSymbol,
  runMainBacktest
};