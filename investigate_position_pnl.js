#!/usr/bin/env node

const { createClient } = require('redis');

async function investigatePositionPnL() {
    const redis = createClient({
        host: 'localhost',
        port: 6379
    });

    try {
        await redis.connect();
        console.log('Connected to Redis');

        // Get all position keys
        const positionKeys = await redis.keys('position:*');
        console.log(`Found ${positionKeys.length} positions`);

        const positionAnalysis = [];
        let totalUnrealizedPnL = 0;
        let totalAbsolutePnL = 0;

        // Process each position
        for (const positionKey of positionKeys) {
            try {
                const positionData = await redis.hGetAll(positionKey);
                
                if (!positionData || Object.keys(positionData).length === 0) {
                    console.log(`Empty position data for ${positionKey}`);
                    continue;
                }

                // Extract symbol from position key
                const keyParts = positionKey.split(':');
                const symbol = keyParts[2]; // e.g., "ETH/JPY"
                
                // Get current ticker price
                const tickerKey = `ticker:bitbank:${symbol}`;
                const tickerData = await redis.hGetAll(tickerKey);
                
                const currentPrice = tickerData.last ? parseFloat(tickerData.last) : null;
                const entryPrice = parseFloat(positionData.entry_price || 0);
                const amount = parseFloat(positionData.amount || 0);
                const side = positionData.side;
                
                if (!currentPrice || !entryPrice || !amount) {
                    console.log(`Missing data for ${positionKey}: currentPrice=${currentPrice}, entryPrice=${entryPrice}, amount=${amount}`);
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

            } catch (error) {
                console.error(`Error processing position ${positionKey}:`, error.message);
            }
        }

        // Sort by unrealized PnL (descending)
        positionAnalysis.sort((a, b) => Math.abs(b.unrealizedPnL) - Math.abs(a.unrealizedPnL));

        console.log('\n=== POSITION ANALYSIS SUMMARY ===');
        console.log(`Total positions: ${positionAnalysis.length}`);
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

        Object.entries(symbolGroups).forEach(([key, positions]) => {
            if (positions.length > 1) {
                console.log(`Multiple positions for ${key}:`);
                positions.forEach(pos => {
                    console.log(`  Order ID: ${pos.orderId}, PnL: ${pos.unrealizedPnL.toFixed(3)}, Strategy: ${pos.strategy}`);
                });
                const totalPnL = positions.reduce((sum, pos) => sum + pos.unrealizedPnL, 0);
                console.log(`  Total PnL for ${key}: ${totalPnL.toFixed(3)} JPY`);
                console.log('');
            }
        });

        // Check for positions with unusual PnL patterns
        console.log('\n=== UNUSUAL PnL PATTERNS ===');
        const largePnLPositions = positionAnalysis.filter(pos => Math.abs(pos.unrealizedPnL) > 100);
        console.log(`Positions with PnL > 100 JPY: ${largePnLPositions.length}`);
        
        largePnLPositions.forEach(pos => {
            const pnlPercentage = ((pos.currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
            console.log(`${pos.symbol} (${pos.side}): ${pos.unrealizedPnL.toFixed(3)} JPY (${pnlPercentage.toFixed(2)}%)`);
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

        Object.entries(strategyGroups).forEach(([strategy, data]) => {
            console.log(`${strategy}: ${data.count} positions, Total PnL: ${data.totalPnL.toFixed(3)} JPY`);
        });

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await redis.quit();
    }
}

investigatePositionPnL().catch(console.error);