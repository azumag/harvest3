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

// Enhanced mock exchange with realistic data
const mockExchange = {
    id: 'binance',
    name: 'Binance',
    fetchTicker: async (symbol) => ({ 
        symbol,
        bid: 50000, 
        ask: 50100, 
        last: 50050,
        percentage: 2.5,
        change: 1225
    }),
    fetchOrderBook: async (symbol) => ({ 
        symbol,
        bids: [[50000, 1.2], [49950, 0.8]], 
        asks: [[50100, 1.5], [50150, 0.9]]
    }),
    fetchOHLCV: async (symbol, timeframe = '1h', since, limit = 100) => {
        // Generate realistic OHLCV data
        const data = [];
        const basePrice = 50000;
        let currentTime = Date.now() - (limit * 60 * 60 * 1000); // Go back 'limit' hours
        
        for (let i = 0; i < limit; i++) {
            const variation = Math.random() * 0.02 - 0.01; // ±1% variation
            const open = basePrice * (1 + variation);
            const close = open * (1 + (Math.random() * 0.01 - 0.005)); // ±0.5% from open
            const high = Math.max(open, close) * (1 + Math.random() * 0.005); // Up to 0.5% higher
            const low = Math.min(open, close) * (1 - Math.random() * 0.005); // Up to 0.5% lower
            const volume = 100 + Math.random() * 50; // Random volume
            
            data.push([currentTime, open, high, low, close, volume]);
            currentTime += 60 * 60 * 1000; // Add 1 hour
        }
        
        return data;
    },
    createMarketBuyOrder: async (symbol, amount) => ({ 
        id: `mock-buy-${Date.now()}`, 
        status: 'closed',
        symbol,
        amount,
        side: 'buy',
        type: 'market'
    }),
    createMarketSellOrder: async (symbol, amount) => ({ 
        id: `mock-sell-${Date.now()}`, 
        status: 'closed',
        symbol,
        amount,
        side: 'sell',
        type: 'market'
    })
};

const mockSymbol = 'BTC/USDT';

// Mock logger
const mockLogger = {
    info: (msg) => console.log(`[INFO] ${msg}`),
    error: (msg) => console.error(`[ERROR] ${msg}`),
    warn: (msg) => console.warn(`[WARN] ${msg}`),
    debug: (msg) => console.log(`[DEBUG] ${msg}`)
};

// Strategy configurations
const strategyConfigs = {
    meanReversion: {
        symbol: mockSymbol,
        enabled: true,
        parameters: {
            lookbackPeriod: 20,
            entryThreshold: 2,
            exitThreshold: 0.5,
            maxPositionSize: 0.1,
            stopLossPercent: 2,
            takeProfitPercent: 1
        }
    },
    trendFollowing: {
        symbol: mockSymbol,
        enabled: true,
        parameters: {
            shortPeriod: 10,
            longPeriod: 20,
            atrPeriod: 14,
            riskPercent: 1,
            rsiPeriod: 14,
            rsiOverbought: 70,
            rsiOversold: 30
        }
    },
    mutualInformation: {
        symbol: mockSymbol,
        enabled: true,
        parameters: {
            embedDim: 3,
            lag: 1,
            kNeighbors: 3,
            miThreshold: 0.3,
            lookbackPeriod: 50
        }
    }
};

async function testStrategyExecution() {
    console.log(`${colors.blue}=== Strategy Execution Test ===${colors.reset}\n`);
    
    const results = [];
    
    // Test Mean Reversion Strategy
    console.log(`${colors.yellow}Testing Mean Reversion Strategy...${colors.reset}`);
    try {
        const meanReversionModule = require('../src/strategies/meanReversion.js');
        
        // Test meanReversionStrategy function
        console.log('  Testing meanReversionStrategy...');
        const meanRevResult = await meanReversionModule.meanReversionStrategy(
            mockExchange,
            mockSymbol,
            strategyConfigs.meanReversion.parameters,
            { logger: mockLogger }
        );
        console.log(`  ${colors.green}✓ meanReversionStrategy result:${colors.reset}`, meanRevResult);
        
        // Test oscillatorStrategy function
        console.log('  Testing oscillatorStrategy...');
        const oscillatorResult = await meanReversionModule.oscillatorStrategy(
            mockExchange,
            mockSymbol,
            strategyConfigs.meanReversion.parameters,
            { logger: mockLogger }
        );
        console.log(`  ${colors.green}✓ oscillatorStrategy result:${colors.reset}`, oscillatorResult);
        
        results.push({
            strategy: 'Mean Reversion',
            success: true,
            functions: ['meanReversionStrategy', 'oscillatorStrategy'],
            results: { meanReversionStrategy: meanRevResult, oscillatorStrategy: oscillatorResult }
        });
        
    } catch (error) {
        console.log(`  ${colors.red}✗ Mean Reversion error: ${error.message}${colors.reset}`);
        results.push({
            strategy: 'Mean Reversion',
            success: false,
            error: error.message
        });
    }
    
    console.log('');
    
    // Test Trend Following Strategy
    console.log(`${colors.yellow}Testing Trend Following Strategy...${colors.reset}`);
    try {
        const trendFollowingModule = require('../src/strategies/trendFollowing.js');
        
        // Test different strategy functions
        const trendFunctions = ['maStrategy', 'macdStrategy', 'rsiStrategy'];
        const trendResults = {};
        
        for (const funcName of trendFunctions) {
            console.log(`  Testing ${funcName}...`);
            const result = await trendFollowingModule[funcName](
                mockExchange,
                mockSymbol,
                strategyConfigs.trendFollowing.parameters,
                { logger: mockLogger }
            );
            console.log(`  ${colors.green}✓ ${funcName} result:${colors.reset}`, result);
            trendResults[funcName] = result;
        }
        
        results.push({
            strategy: 'Trend Following',
            success: true,
            functions: trendFunctions,
            results: trendResults
        });
        
    } catch (error) {
        console.log(`  ${colors.red}✗ Trend Following error: ${error.message}${colors.reset}`);
        results.push({
            strategy: 'Trend Following',
            success: false,
            error: error.message
        });
    }
    
    console.log('');
    
    // Test Mutual Information Strategy
    console.log(`${colors.yellow}Testing Mutual Information Strategy...${colors.reset}`);
    try {
        const mutualInfoModule = require('../src/strategies/mutualInformation.js');
        
        // Test main strategy function
        console.log('  Testing mutualInformationStrategy...');
        const miResult = await mutualInfoModule.mutualInformationStrategy(
            mockExchange,
            mockSymbol,
            strategyConfigs.mutualInformation.parameters,
            { logger: mockLogger }
        );
        console.log(`  ${colors.green}✓ mutualInformationStrategy result:${colors.reset}`, miResult);
        
        // Test signal calculation
        console.log('  Testing calculateMutualInformationSignals...');
        const signalsResult = await mutualInfoModule.calculateMutualInformationSignals(
            mockExchange,
            mockSymbol,
            strategyConfigs.mutualInformation.parameters,
            { logger: mockLogger }
        );
        console.log(`  ${colors.green}✓ calculateMutualInformationSignals result:${colors.reset}`, signalsResult);
        
        results.push({
            strategy: 'Mutual Information',
            success: true,
            functions: ['mutualInformationStrategy', 'calculateMutualInformationSignals'],
            results: { 
                mutualInformationStrategy: miResult,
                calculateMutualInformationSignals: signalsResult
            }
        });
        
    } catch (error) {
        console.log(`  ${colors.red}✗ Mutual Information error: ${error.message}${colors.reset}`);
        results.push({
            strategy: 'Mutual Information',
            success: false,
            error: error.message
        });
    }
    
    console.log('');
    
    // Summary
    console.log(`${colors.blue}=== Execution Test Summary ===${colors.reset}\n`);
    
    const successCount = results.filter(r => r.success).length;
    console.log(`Total strategies tested: ${results.length}`);
    console.log(`Successfully executed: ${colors.green}${successCount}${colors.reset}`);
    console.log(`Failed to execute: ${colors.red}${results.length - successCount}${colors.reset}\n`);
    
    // Detailed results
    for (const result of results) {
        console.log(`${colors.yellow}${result.strategy}:${colors.reset}`);
        console.log(`  Status: ${result.success ? colors.green + '✓ Success' : colors.red + '✗ Failed'}${colors.reset}`);
        
        if (result.success) {
            console.log(`  Functions tested: ${result.functions.join(', ')}`);
            console.log('  Results summary:');
            for (const [func, res] of Object.entries(result.results)) {
                if (res && typeof res === 'object') {
                    console.log(`    - ${func}: ${JSON.stringify(res).substring(0, 100)}...`);
                } else {
                    console.log(`    - ${func}: ${res}`);
                }
            }
        } else {
            console.log(`  Error: ${colors.red}${result.error}${colors.reset}`);
        }
        console.log('');
    }
    
    return results;
}

// Run the test
if (require.main === module) {
    testStrategyExecution()
        .then(results => {
            const allSuccess = results.every(r => r.success);
            process.exit(allSuccess ? 0 : 1);
        })
        .catch(err => {
            console.error(`${colors.red}Fatal error: ${err.message}${colors.reset}`);
            console.error(err.stack);
            process.exit(1);
        });
}

module.exports = { testStrategyExecution };