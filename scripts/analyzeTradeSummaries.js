/**
 * Trade Summary Analysis Script
 * Analyzes Redis trade summaries to identify data inconsistencies
 */
const { initRedisClient, client: redisClient } = require('../src/database/redisClient');

async function analyzeTradeSummaries() {
  try {
    console.log('🔍 Trade Summary Analysis Starting...\n');

    await initRedisClient();

    // Get all trade summary keys
    const summaryKeys = await redisClient.keys('summary:trade:bitbank:*');
    console.log(`📊 Found ${summaryKeys.length} trade summaries\n`);

    const issues = {
      negative: [],
      stale: [],
      undefined: [],
      largeDiscrepancy: []
    };

    const symbolTotals = {};

    for (const key of summaryKeys) {
      try {
        const data = await redisClient.hGetAll(key);
        const [, exchange, symbol, strategy] = key.split(':');

        // Check for undefined entries
        if (exchange === 'undefined' || symbol === 'undefined' || strategy === 'undefined') {
          issues.undefined.push({ key, data });
          continue;
        }

        const netPosition = parseFloat(data.netPosition || 0);
        const buyAmount = parseFloat(data.buyAmount || 0);
        const sellAmount = parseFloat(data.sellAmount || 0);
        const updatedAt = parseInt(data.updatedAt || 0);

        // Initialize symbol total
        if (!symbolTotals[symbol]) {
          symbolTotals[symbol] = {
            total: 0,
            strategies: {},
            negativeCount: 0,
            totalNegative: 0
          };
        }

        // Add to symbol total
        symbolTotals[symbol].total += netPosition;
        symbolTotals[symbol].strategies[strategy] = {
          netPosition,
          buyAmount,
          sellAmount,
          avgBuyPrice: parseFloat(data.avgBuyPrice || 0),
          avgSellPrice: parseFloat(data.avgSellPrice || 0)
        };

        // Check for negative positions
        if (netPosition < 0) {
          issues.negative.push({
            symbol,
            strategy,
            netPosition,
            buyAmount,
            sellAmount,
            key
          });
          symbolTotals[symbol].negativeCount++;
          symbolTotals[symbol].totalNegative += netPosition;
        }

        // Check for stale data (older than 24 hours)
        const ageInHours = (Date.now() - updatedAt) / (1000 * 60 * 60);
        if (ageInHours > 24) {
          issues.stale.push({
            symbol,
            strategy,
            ageInHours: Math.round(ageInHours),
            lastUpdate: new Date(updatedAt).toISOString(),
            key
          });
        }

        // Check for large discrepancies
        const calculatedNet = buyAmount - sellAmount;
        const discrepancy = Math.abs(calculatedNet - netPosition);
        if (discrepancy > 0.00001) {
          issues.largeDiscrepancy.push({
            symbol,
            strategy,
            netPosition,
            calculatedNet,
            discrepancy,
            key
          });
        }

      } catch (err) {
        console.error(`Error processing ${key}: ${err.message}`);
      }
    }

    // Generate report
    console.log('📊 === ANALYSIS REPORT ===\n');

    console.log('❌ NEGATIVE POSITIONS (Impossible State):');
    console.log(`Found ${issues.negative.length} strategies with negative positions\n`);

    // Sort by magnitude
    issues.negative.sort((a, b) => a.netPosition - b.netPosition);

    console.log('Top 10 Worst Negative Positions:');
    issues.negative.slice(0, 10).forEach((issue, i) => {
      console.log(`${i + 1}. ${issue.symbol} ${issue.strategy}: ${issue.netPosition.toFixed(8)}`);
      console.log(`   Buy: ${issue.buyAmount.toFixed(8)}, Sell: ${issue.sellAmount.toFixed(8)}`);
    });

    console.log('\n📊 SYMBOL TOTALS WITH ISSUES:');
    Object.entries(symbolTotals)
      .filter(([, data]) => data.negativeCount > 0)
      .sort((a, b) => a[1].totalNegative - b[1].totalNegative)
      .forEach(([symbol, data]) => {
        console.log(`\n${symbol}:`);
        console.log(`  Total Position: ${data.total.toFixed(8)}`);
        console.log(`  Negative Strategies: ${data.negativeCount}`);
        console.log(`  Total Negative: ${data.totalNegative.toFixed(8)}`);

        // Show strategy breakdown
        Object.entries(data.strategies)
          .filter(([, s]) => s.netPosition < 0)
          .forEach(([strategy, stratData]) => {
            console.log(`    ${strategy}: ${stratData.netPosition.toFixed(8)}`);
          });
      });

    console.log('\n⏰ STALE DATA:');
    console.log(`Found ${issues.stale.length} stale summaries (>24 hours old)`);

    console.log('\n🔧 UNDEFINED ENTRIES:');
    console.log(`Found ${issues.undefined.length} undefined entries`);
    issues.undefined.forEach(issue => {
      console.log(`  ${issue.key}`);
    });

    console.log('\n📈 CALCULATION DISCREPANCIES:');
    console.log(`Found ${issues.largeDiscrepancy.length} summaries with calculation errors`);

    // Summary
    console.log('\n📋 === SUMMARY ===');
    console.log(`Total Issues Found: ${issues.negative.length + issues.stale.length + issues.undefined.length + issues.largeDiscrepancy.length}`);
    console.log(`Symbols Affected by Negative Positions: ${Object.keys(symbolTotals).filter(s => symbolTotals[s].negativeCount > 0).length}`);

    // Recommendations
    console.log('\n💡 === RECOMMENDATIONS ===');
    console.log('1. Immediate: Delete or reset all trade summaries with negative positions');
    console.log('2. Investigate: Why GALA/JPY OUTSIDE strategy has -699.946 position');
    console.log('3. Fix: Recalculate all summaries from actual trade history');
    console.log('4. Prevent: Add validation to prevent negative positions in the future');

    return {
      issues,
      symbolTotals,
      totalSummaries: summaryKeys.length
    };

  } catch (error) {
    console.error('❌ Analysis Error:', error.message);
    console.error(error.stack);
  } finally {
    await redisClient.quit();
  }
}

if (require.main === module) {
  analyzeTradeSummaries().then(() => process.exit(0)).catch(console.error);
}

module.exports = { analyzeTradeSummaries };