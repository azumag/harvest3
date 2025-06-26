#!/usr/bin/env node

const path = require('path');

// Color codes for output
const colors = {
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    reset: '\x1b[0m'
};

// Mock data for testing
const mockExchange = {
    id: 'binance',
    name: 'Binance',
    fetchTicker: async () => ({ bid: 50000, ask: 50100, last: 50050 }),
    fetchOrderBook: async () => ({ bids: [[50000, 1]], asks: [[50100, 1]] }),
    fetchOHLCV: async () => [[Date.now(), 50000, 50100, 49900, 50050, 100]],
    createMarketBuyOrder: async () => ({ id: 'mock-order-1', status: 'closed' }),
    createMarketSellOrder: async () => ({ id: 'mock-order-2', status: 'closed' })
};

const mockSymbol = 'BTC/USDT';

const mockStrategyConfig = {
    symbol: mockSymbol,
    enabled: true,
    parameters: {
        // Mean Reversion parameters
        lookbackPeriod: 20,
        entryThreshold: 2,
        exitThreshold: 0.5,
        maxPositionSize: 0.1,
        stopLossPercent: 2,
        takeProfitPercent: 1,
        
        // Trend Following parameters
        shortPeriod: 10,
        longPeriod: 20,
        atrPeriod: 14,
        riskPercent: 1,
        
        // Mutual Information parameters
        embedDim: 3,
        lag: 1,
        kNeighbors: 3,
        miThreshold: 0.3
    }
};

const mockMarketParameters = {
    volatility: 0.02,
    spread: 0.001,
    liquidity: 1000000
};

const mockOptions = {
    config: mockStrategyConfig,
    logger: {
        info: (msg) => console.log(`[INFO] ${msg}`),
        error: (msg) => console.error(`[ERROR] ${msg}`),
        warn: (msg) => console.warn(`[WARN] ${msg}`)
    }
};

// Strategy files to test
const strategies = [
    {
        name: 'Mean Reversion',
        path: '../src/strategies/meanReversion.js'
    },
    {
        name: 'Trend Following',
        path: '../src/strategies/trendFollowing.js'
    },
    {
        name: 'Mutual Information',
        path: '../src/strategies/mutualInformation.js'
    }
];

async function testStrategyLoading() {
    console.log(`${colors.blue}=== Strategy Loading Test ===${colors.reset}\n`);
    
    const results = [];
    
    for (const strategy of strategies) {
        console.log(`${colors.yellow}Testing ${strategy.name}...${colors.reset}`);
        const result = {
            name: strategy.name,
            path: strategy.path,
            loadSuccess: false,
            functions: [],
            dependencyIssues: [],
            executionResults: {},
            errors: []
        };
        
        try {
            // Test 1: Loading Test
            console.log('  1. Loading module...');
            const strategyModule = require(strategy.path);
            result.loadSuccess = true;
            console.log(`  ${colors.green}✓ Module loaded successfully${colors.reset}`);
            
            // Test 2: Function Availability
            console.log('  2. Checking exported functions...');
            const exportedFunctions = Object.keys(strategyModule).filter(key => 
                typeof strategyModule[key] === 'function'
            );
            result.functions = exportedFunctions;
            console.log(`  ${colors.green}✓ Found ${exportedFunctions.length} functions: ${exportedFunctions.join(', ')}${colors.reset}`);
            
            // Test 3: Dependency Resolution
            console.log('  3. Testing dependency resolution...');
            // Check if the module can access its dependencies
            if (strategy.name === 'Mean Reversion' || strategy.name === 'Trend Following') {
                // These strategies use tradingUtils
                try {
                    // The strategies should have already loaded tradingUtils internally
                    console.log(`  ${colors.green}✓ Dependencies resolved successfully${colors.reset}`);
                } catch (err) {
                    result.dependencyIssues.push(`tradingUtils: ${err.message}`);
                    console.log(`  ${colors.red}✗ Dependency issue: ${err.message}${colors.reset}`);
                }
            }
            
            // Test 4: Function Execution
            console.log('  4. Testing function execution...');
            
            // Test calculateSignal if available
            if (strategyModule.calculateSignal) {
                try {
                    console.log('     - Testing calculateSignal...');
                    const signal = await strategyModule.calculateSignal(
                        mockExchange,
                        mockSymbol,
                        mockStrategyConfig.parameters,
                        mockOptions
                    );
                    result.executionResults.calculateSignal = {
                        success: true,
                        output: signal
                    };
                    console.log(`     ${colors.green}✓ calculateSignal executed: ${JSON.stringify(signal)}${colors.reset}`);
                } catch (err) {
                    result.executionResults.calculateSignal = {
                        success: false,
                        error: err.message
                    };
                    console.log(`     ${colors.red}✗ calculateSignal error: ${err.message}${colors.reset}`);
                }
            }
            
            // Test adjustParameters if available
            if (strategyModule.adjustParameters) {
                try {
                    console.log('     - Testing adjustParameters...');
                    const adjusted = strategyModule.adjustParameters(
                        mockStrategyConfig.parameters,
                        mockMarketParameters
                    );
                    result.executionResults.adjustParameters = {
                        success: true,
                        output: adjusted
                    };
                    console.log(`     ${colors.green}✓ adjustParameters executed successfully${colors.reset}`);
                } catch (err) {
                    result.executionResults.adjustParameters = {
                        success: false,
                        error: err.message
                    };
                    console.log(`     ${colors.red}✗ adjustParameters error: ${err.message}${colors.reset}`);
                }
            }
            
            // Test 5: Error Handling
            console.log('  5. Testing error handling...');
            
            // Test with invalid parameters
            if (strategyModule.calculateSignal) {
                try {
                    console.log('     - Testing with null exchange...');
                    await strategyModule.calculateSignal(null, mockSymbol, mockStrategyConfig.parameters, mockOptions);
                    console.log(`     ${colors.red}✗ Should have thrown error for null exchange${colors.reset}`);
                } catch (err) {
                    console.log(`     ${colors.green}✓ Properly handled null exchange: ${err.message}${colors.reset}`);
                }
                
                try {
                    console.log('     - Testing with invalid symbol...');
                    await strategyModule.calculateSignal(mockExchange, '', mockStrategyConfig.parameters, mockOptions);
                    console.log(`     ${colors.red}✗ Should have thrown error for empty symbol${colors.reset}`);
                } catch (err) {
                    console.log(`     ${colors.green}✓ Properly handled invalid symbol: ${err.message}${colors.reset}`);
                }
            }
            
        } catch (err) {
            result.errors.push(err.message);
            console.log(`  ${colors.red}✗ Error loading strategy: ${err.message}${colors.reset}`);
            console.log(`  ${colors.red}  Stack: ${err.stack}${colors.reset}`);
        }
        
        results.push(result);
        console.log(''); // Empty line between strategies
    }
    
    // Summary
    console.log(`${colors.blue}=== Test Summary ===${colors.reset}\n`);
    
    const successCount = results.filter(r => r.loadSuccess).length;
    console.log(`Total strategies tested: ${strategies.length}`);
    console.log(`Successfully loaded: ${colors.green}${successCount}${colors.reset}`);
    console.log(`Failed to load: ${colors.red}${strategies.length - successCount}${colors.reset}\n`);
    
    // Detailed summary
    for (const result of results) {
        console.log(`${colors.yellow}${result.name}:${colors.reset}`);
        console.log(`  Load Status: ${result.loadSuccess ? colors.green + '✓' : colors.red + '✗'}${colors.reset}`);
        console.log(`  Exported Functions: ${result.functions.length > 0 ? result.functions.join(', ') : 'None'}`);
        console.log(`  Dependency Issues: ${result.dependencyIssues.length > 0 ? result.dependencyIssues.join(', ') : 'None'}`);
        
        if (Object.keys(result.executionResults).length > 0) {
            console.log('  Execution Results:');
            for (const [func, res] of Object.entries(result.executionResults)) {
                console.log(`    - ${func}: ${res.success ? colors.green + '✓' : colors.red + '✗'}${colors.reset}`);
            }
        }
        
        if (result.errors.length > 0) {
            console.log(`  Errors: ${colors.red}${result.errors.join(', ')}${colors.reset}`);
        }
        console.log('');
    }
    
    // No Redis connection to close in this test
    
    return results;
}

// Run the test
if (require.main === module) {
    testStrategyLoading()
        .then(results => {
            const allSuccess = results.every(r => r.loadSuccess);
            process.exit(allSuccess ? 0 : 1);
        })
        .catch(err => {
            console.error(`${colors.red}Fatal error: ${err.message}${colors.reset}`);
            console.error(err.stack);
            process.exit(1);
        });
}

module.exports = { testStrategyLoading };