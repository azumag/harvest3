#!/usr/bin/env node

const { execSync } = require('child_process');

function executeRedisCommand(command) {
    try {
        const result = execSync(`docker exec harvest3-redis redis-cli ${command}`, { encoding: 'utf8' });
        return result.trim();
    } catch (error) {
        console.error(`Redis command failed: ${command}`, error.message);
        return null;
    }
}

function parseRedisHash(hashOutput) {
    const lines = hashOutput.split('\n');
    const result = {};
    for (let i = 0; i < lines.length; i += 2) {
        if (lines[i] && lines[i + 1] !== undefined) {
            result[lines[i]] = lines[i + 1];
        }
    }
    return result;
}

async function investigatePositionPnL() {
    console.log('Starting position PnL investigation...');

    // Get all position keys
    const positionKeysOutput = executeRedisCommand('KEYS "position:*"');
    if (!positionKeysOutput) {
        console.error('Failed to get position keys');
        return;
    }

    const positionKeys = positionKeysOutput.split('\n').filter(key => key.trim());
    console.log(`Found ${positionKeys.length} positions`);

    const positionAnalysis = [];
    let totalUnrealizedPnL = 0;
    let totalAbsolutePnL = 0;
    let processedCount = 0;
    let errorCount = 0;

    // Process each position
    for (const positionKey of positionKeys) {
        try {
            // Get position data
            const positionOutput = executeRedisCommand(`HGETALL "${positionKey}"`);
            if (!positionOutput) {
                console.log(`No data for position: ${positionKey}`);
                errorCount++;
                continue;
            }

            const positionData = parseRedisHash(positionOutput);
            
            if (Object.keys(positionData).length === 0) {
                console.log(`Empty position data for ${positionKey}`);
                errorCount++;
                continue;
            }

            // Extract symbol from position key
            const keyParts = positionKey.split(':');
            const symbol = keyParts[2]; // e.g., "ETH/JPY"
            
            // Get current ticker price
            const tickerKey = `ticker:bitbank:${symbol}`;
            const tickerOutput = executeRedisCommand(`GET "${tickerKey}"`);
            
            let currentPrice = null;
            if (tickerOutput && tickerOutput !== '(nil)') {
                try {
                    const tickerData = JSON.parse(tickerOutput);
                    currentPrice = tickerData.last ? parseFloat(tickerData.last) : null;
                } catch (e) {
                    console.log(`Failed to parse ticker data for ${symbol}: ${e.message}`);
                }
            }

            const entryPrice = parseFloat(positionData.entryPrice || 0);
            const amount = parseFloat(positionData.amount || 0);
            const side = positionData.side;
            
            if (!currentPrice || !entryPrice || !amount) {
                console.log(`Missing data for ${positionKey}: currentPrice=${currentPrice}, entryPrice=${entryPrice}, amount=${amount}`);
                errorCount++;
                continue;
            }

            // Calculate unrealized PnL
            let unrealizedPnL = 0;
            if (side === 'buy') {
                unrealizedPnL = (currentPrice - entryPrice) * amount;
            } else if (side === 'sell') {
                unrealizedPnL = (entryPrice - currentPrice) * amount;
            }

            totalUnrealizedPnL += unrealizedPnL;
            totalAbsolutePnL += Math.abs(unrealizedPnL);

            const analysis = {
                positionKey,
                symbol,
                side,
                amount,
                entryPrice,
                currentPrice,
                unrealizedPnL,
                strategy: keyParts[3],
                orderId: keyParts[4],
                timestamp: positionData.timestamp || 'N/A',
                status: positionData.status || 'N/A'
            };

            positionAnalysis.push(analysis);
            processedCount++;

        } catch (error) {
            console.error(`Error processing position ${positionKey}:`, error.message);
            errorCount++;
        }
    }

    // Sort by unrealized PnL (descending by absolute value)
    positionAnalysis.sort((a, b) => Math.abs(b.unrealizedPnL) - Math.abs(a.unrealizedPnL));

    console.log('\n=== POSITION ANALYSIS SUMMARY ===');
    console.log(`Total positions found: ${positionKeys.length}`);
    console.log(`Successfully processed: ${processedCount}`);
    console.log(`Errors: ${errorCount}`);
    console.log(`Total unrealized PnL: ${totalUnrealizedPnL.toFixed(3)} JPY`);
    console.log(`Total absolute PnL: ${totalAbsolutePnL.toFixed(3)} JPY`);

    console.log('\n=== TOP 20 POSITIONS BY ABSOLUTE PnL ===');
    positionAnalysis.slice(0, 20).forEach((pos, index) => {
        console.log(`${index + 1}. ${pos.symbol} (${pos.side}) - ${pos.strategy}`);
        console.log(`   Amount: ${pos.amount}, Entry: ${pos.entryPrice}, Current: ${pos.currentPrice}`);
        console.log(`   Unrealized PnL: ${pos.unrealizedPnL.toFixed(3)} JPY`);
        console.log(`   Order ID: ${pos.orderId}, Status: ${pos.status}`);
        console.log(`   Timestamp: ${pos.timestamp}`);
        console.log('');
    });

    // Check for duplicate positions (same symbol, different order IDs)
    console.log('\n=== DUPLICATE POSITION ANALYSIS ===');
    const symbolGroups = {};
    positionAnalysis.forEach(pos => {
        const key = `${pos.symbol}:${pos.side}`;
        if (!symbolGroups[key]) {
            symbolGroups[key] = [];
        }
        symbolGroups[key].push(pos);
    });

    let duplicateSymbolCount = 0;
    Object.entries(symbolGroups).forEach(([key, positions]) => {
        if (positions.length > 1) {
            duplicateSymbolCount++;
            console.log(`Multiple positions for ${key} (${positions.length} positions):`);
            positions.forEach(pos => {
                console.log(`  Order ID: ${pos.orderId}, PnL: ${pos.unrealizedPnL.toFixed(3)}, Strategy: ${pos.strategy}, Amount: ${pos.amount}`);
            });
            const totalPnL = positions.reduce((sum, pos) => sum + pos.unrealizedPnL, 0);
            console.log(`  Total PnL for ${key}: ${totalPnL.toFixed(3)} JPY`);
            console.log('');
        }
    });

    console.log(`Found ${duplicateSymbolCount} symbols with multiple positions`);

    // Check for positions with unusual PnL patterns
    console.log('\n=== UNUSUAL PnL PATTERNS (>100 JPY) ===');
    const largePnLPositions = positionAnalysis.filter(pos => Math.abs(pos.unrealizedPnL) > 100);
    console.log(`Positions with absolute PnL > 100 JPY: ${largePnLPositions.length}`);
    
    largePnLPositions.forEach(pos => {
        const pnlPercentage = ((pos.currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
        console.log(`${pos.symbol} (${pos.side}): ${pos.unrealizedPnL.toFixed(3)} JPY (${pnlPercentage.toFixed(2)}% change)`);
        console.log(`  Entry: ${pos.entryPrice}, Current: ${pos.currentPrice}, Amount: ${pos.amount}`);
    });

    // Summary by strategy
    console.log('\n=== PnL BY STRATEGY ===');
    const strategyGroups = {};
    positionAnalysis.forEach(pos => {
        if (!strategyGroups[pos.strategy]) {
            strategyGroups[pos.strategy] = { count: 0, totalPnL: 0, positions: [] };
        }
        strategyGroups[pos.strategy].count++;
        strategyGroups[pos.strategy].totalPnL += pos.unrealizedPnL;
        strategyGroups[pos.strategy].positions.push(pos);
    });

    Object.entries(strategyGroups)
        .sort(([,a], [,b]) => Math.abs(b.totalPnL) - Math.abs(a.totalPnL))
        .forEach(([strategy, data]) => {
            console.log(`${strategy}: ${data.count} positions, Total PnL: ${data.totalPnL.toFixed(3)} JPY`);
        });

    // Look for potential issues
    console.log('\n=== POTENTIAL ISSUES ===');
    
    // 1. Very old positions
    const currentTime = Date.now();
    const oldPositions = positionAnalysis.filter(pos => {
        if (pos.timestamp === 'N/A' || !pos.timestamp) return false;
        const posTime = parseInt(pos.timestamp);
        return (currentTime - posTime) > (24 * 60 * 60 * 1000); // Older than 24 hours
    });
    
    if (oldPositions.length > 0) {
        console.log(`Found ${oldPositions.length} positions older than 24 hours:`);
        oldPositions.slice(0, 10).forEach(pos => {
            const age = ((currentTime - parseInt(pos.timestamp)) / (60 * 60 * 1000)).toFixed(1);
            console.log(`  ${pos.symbol} (${pos.side}): ${age} hours old, PnL: ${pos.unrealizedPnL.toFixed(3)}`);
        });
    }

    // 2. Positions with extreme price differences
    const extremePositions = positionAnalysis.filter(pos => {
        const priceDiff = Math.abs((pos.currentPrice - pos.entryPrice) / pos.entryPrice);
        return priceDiff > 0.1; // More than 10% price difference
    });
    
    console.log(`\nPositions with >10% price difference: ${extremePositions.length}`);
    extremePositions.slice(0, 5).forEach(pos => {
        const priceDiff = ((pos.currentPrice - pos.entryPrice) / pos.entryPrice * 100).toFixed(2);
        console.log(`  ${pos.symbol}: ${priceDiff}% change, PnL: ${pos.unrealizedPnL.toFixed(3)}`);
    });
}

investigatePositionPnL().catch(console.error);