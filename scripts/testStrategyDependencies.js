#!/usr/bin/env node

// Color codes for output
const colors = {
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    reset: '\x1b[0m'
};

// Mock Redis client
const mockRedisClient = {
    get: async (key) => null,
    set: async (key, value) => 'OK',
    del: async (key) => 1,
    exists: async (key) => 0,
    expire: async (key, seconds) => 1,
    quit: async () => 'OK',
    isOpen: true
};

// Mock MongoDB client
const mockMongoClient = {
    db: () => ({
        collection: () => ({
            findOne: async () => null,
            find: () => ({
                toArray: async () => []
            }),
            insertOne: async () => ({ insertedId: 'mock-id' }),
            updateOne: async () => ({ modifiedCount: 1 }),
            deleteOne: async () => ({ deletedCount: 1 })
        })
    }),
    connect: async () => true,
    close: async () => true
};

// Set up environment variables for testing
process.env.NODE_ENV = 'test';

// Mock database modules before requiring strategies
const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function(id) {
    // Mock database connections
    if (id === '../database/redisDatabase' || id.endsWith('redisDatabase.js')) {
        return {
            redisClient: mockRedisClient,
            getOHLCVRedis: async () => null,
            setOHLCVRedis: async () => 'OK',
            getTickerRedis: async () => null,
            setTickerRedis: async () => 'OK'
        };
    }
    
    if (id === '../database/mongoDatabase' || id.endsWith('mongoDatabase.js')) {
        return {
            mongoClient: mockMongoClient,
            connectDB: async () => mockMongoClient,
            fetchHistoricalOHLCVData: async () => [],
            saveOHLCVData: async () => true
        };
    }
    
    if (id === '../database/manager' || id.endsWith('manager.js')) {
        return {
            fetchOHLCVData: async () => generateMockOHLCVData(),
            fetchTicker: async () => ({ bid: 50000, ask: 50100, last: 50050 }),
            getMarketParameters: async () => ({
                pricePrecision: 2,
                amountPrecision: 6,
                minNotional: 10,
                maxNotional: 1000000,
                fee: 0.001
            })
        };
    }
    
    return originalRequire.apply(this, arguments);
};

// Generate mock OHLCV data
function generateMockOHLCVData(count = 100) {
    const data = [];
    const basePrice = 50000;
    let currentTime = Date.now() - (count * 5 * 60 * 1000); // 5 minutes intervals
    
    for (let i = 0; i < count; i++) {
        const variation = (Math.random() - 0.5) * 0.02; // ±1% variation
        const open = basePrice * (1 + variation);
        const close = open * (1 + (Math.random() - 0.5) * 0.01); // ±0.5% from open
        const high = Math.max(open, close) * (1 + Math.random() * 0.005); // Up to 0.5% higher
        const low = Math.min(open, close) * (1 - Math.random() * 0.005); // Up to 0.5% lower
        const volume = 100 + Math.random() * 50; // Random volume
        
        data.push([currentTime, open, high, low, close, volume]);
        currentTime += 5 * 60 * 1000; // Add 5 minutes
    }
    
    return data;
}

async function testStrategyDependencies() {
    console.log(`${colors.blue}=== Strategy Dependencies Test ===${colors.reset}\n`);
    
    const results = [];
    
    // Test each strategy
    const strategies = [
        { name: 'Mean Reversion', path: '../src/strategies/meanReversion.js' },
        { name: 'Trend Following', path: '../src/strategies/trendFollowing.js' },
        { name: 'Mutual Information', path: '../src/strategies/mutualInformation.js' }
    ];
    
    for (const strategy of strategies) {
        console.log(`${colors.yellow}Testing ${strategy.name}...${colors.reset}`);
        
        try {
            // Load the strategy module
            const strategyModule = require(strategy.path);
            console.log(`  ${colors.green}✓ Module loaded successfully${colors.reset}`);
            
            // List exported functions
            const functions = Object.keys(strategyModule).filter(key => 
                typeof strategyModule[key] === 'function'
            );
            console.log(`  ${colors.green}✓ Functions exported: ${functions.join(', ')}${colors.reset}`);
            
            // Test dependency resolution by checking if functions can be called
            const mockExchange = {
                id: 'binance',
                fetchTicker: async () => ({ bid: 50000, ask: 50100, last: 50050 }),
                fetchOHLCV: async () => generateMockOHLCVData()
            };
            
            const mockParams = {
                lookbackPeriod: 20,
                shortPeriod: 10,
                longPeriod: 20,
                rsiPeriod: 14,
                embedDim: 3,
                lag: 1,
                kNeighbors: 3
            };
            
            const mockOptions = {
                logger: {
                    info: () => {},
                    error: () => {},
                    warn: () => {}
                }
            };
            
            let executionResults = {};
            
            // Test main functions that are likely to be entry points
            const testFunctions = functions.filter(f => 
                f.includes('Strategy') || f === 'calculateSignal' || f === 'adjustParameters'
            );
            
            for (const funcName of testFunctions.slice(0, 2)) { // Test first 2 functions
                try {
                    console.log(`    Testing ${funcName}...`);
                    const result = await strategyModule[funcName](
                        mockExchange,
                        'BTC/USDT',
                        mockParams,
                        mockOptions
                    );
                    executionResults[funcName] = 'success';
                    console.log(`    ${colors.green}✓ ${funcName} executed successfully${colors.reset}`);
                } catch (err) {
                    executionResults[funcName] = err.message;
                    console.log(`    ${colors.yellow}⚠ ${funcName} error: ${err.message.substring(0, 50)}...${colors.reset}`);
                }
            }
            
            results.push({
                name: strategy.name,
                success: true,
                functions,
                executionResults
            });
            
        } catch (error) {
            console.log(`  ${colors.red}✗ Failed to load: ${error.message}${colors.reset}`);
            results.push({
                name: strategy.name,
                success: false,
                error: error.message
            });
        }
        
        console.log('');
    }
    
    // Summary
    console.log(`${colors.blue}=== Dependencies Test Summary ===${colors.reset}\n`);
    
    const successCount = results.filter(r => r.success).length;
    console.log(`Total strategies tested: ${strategies.length}`);
    console.log(`Successfully loaded: ${colors.green}${successCount}${colors.reset}`);
    console.log(`Failed to load: ${colors.red}${strategies.length - successCount}${colors.reset}\n`);
    
    // Detailed results
    for (const result of results) {
        console.log(`${colors.yellow}${result.name}:${colors.reset}`);
        if (result.success) {
            console.log(`  ${colors.green}✓ Loading: Success${colors.reset}`);
            console.log(`  Functions: ${result.functions.length} (${result.functions.join(', ')})`);
            console.log(`  Execution tests:`);
            for (const [func, status] of Object.entries(result.executionResults)) {
                const statusColor = status === 'success' ? colors.green : colors.yellow;
                console.log(`    - ${func}: ${statusColor}${status}${colors.reset}`);
            }
        } else {
            console.log(`  ${colors.red}✗ Loading: Failed${colors.reset}`);
            console.log(`  Error: ${result.error}`);
        }
        console.log('');
    }
    
    // Check for tradingUtils dependency
    console.log(`${colors.blue}=== TradingUtils Dependency Check ===${colors.reset}\n`);
    try {
        const tradingUtils = require('../src/strategies/utils/tradingUtils.js');
        const utilFunctions = Object.keys(tradingUtils).filter(key => 
            typeof tradingUtils[key] === 'function'
        );
        console.log(`${colors.green}✓ tradingUtils loaded successfully${colors.reset}`);
        console.log(`  Functions: ${utilFunctions.join(', ')}`);
    } catch (error) {
        console.log(`${colors.red}✗ tradingUtils loading failed: ${error.message}${colors.reset}`);
    }
    
    return results;
}

// Run the test
if (require.main === module) {
    testStrategyDependencies()
        .then(results => {
            const allSuccess = results.every(r => r.success);
            console.log(`\n${colors.blue}Test completed. ${allSuccess ? 'All strategies loaded successfully!' : 'Some strategies had issues.'}${colors.reset}`);
            process.exit(allSuccess ? 0 : 1);
        })
        .catch(err => {
            console.error(`${colors.red}Fatal error: ${err.message}${colors.reset}`);
            console.error(err.stack);
            process.exit(1);
        });
}

module.exports = { testStrategyDependencies };