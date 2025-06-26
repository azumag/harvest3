/**
 * Fix Negative Positions Script
 * Resets trade summaries with negative net positions
 */
const { initRedisClient, client: redisClient } = require('../src/database/redisClient');
const fs = require('fs');

async function fixNegativePositions(dryRun = true) {
  try {
    console.log(`🔧 Fix Negative Positions Script - ${dryRun ? 'DRY RUN' : 'EXECUTION'} Mode\n`);
    
    await initRedisClient();
    
    // Get all trade summary keys
    const summaryKeys = await redisClient.keys('summary:trade:bitbank:*');
    console.log(`📊 Checking ${summaryKeys.length} trade summaries...\n`);
    
    const backupData = [];
    const fixedSummaries = [];
    let totalFixed = 0;
    
    for (const key of summaryKeys) {
      try {
        const data = await redisClient.hGetAll(key);
        const [, exchange, symbol, strategy] = key.split(':');
        
        const netPosition = parseFloat(data.netPosition || 0);
        
        // Check for negative positions
        if (netPosition < 0) {
          console.log(`❌ Found negative position: ${symbol} ${strategy}`);
          console.log(`   Current Net Position: ${netPosition}`);
          console.log(`   Buy Amount: ${data.buyAmount}`);
          console.log(`   Sell Amount: ${data.sellAmount}`);
          
          // Backup current data
          backupData.push({
            key,
            originalData: { ...data },
            symbol,
            strategy,
            timestamp: new Date().toISOString()
          });
          
          if (!dryRun) {
            // Reset the summary to zero state
            const resetData = {
              buyAmount: '0',
              sellAmount: '0',
              totalBuyCost: '0',
              totalSellRevenue: '0',
              netPosition: '0',
              avgBuyPrice: '0',
              avgSellPrice: '0',
              realizedPnL: '0',
              totalFee: '0',
              createdAt: Date.now().toString(),
              updatedAt: Date.now().toString()
            };
            
            await redisClient.hSet(key, resetData);
            console.log(`   ✅ Reset to zero state\n`);
            
            fixedSummaries.push({
              key,
              symbol,
              strategy,
              originalNetPosition: netPosition
            });
            totalFixed++;
          } else {
            console.log(`   🔍 Would reset to zero state (DRY RUN)\n`);
          }
        }
        
      } catch (err) {
        console.error(`Error processing ${key}: ${err.message}`);
      }
    }
    
    // Save backup file
    if (backupData.length > 0) {
      const backupFilename = `negative-positions-backup-${Date.now()}.json`;
      fs.writeFileSync(backupFilename, JSON.stringify(backupData, null, 2));
      console.log(`\n💾 Backup saved to: ${backupFilename}`);
    }
    
    // Summary
    console.log('\n📊 === SUMMARY ===');
    console.log(`Total Negative Positions Found: ${backupData.length}`);
    if (!dryRun) {
      console.log(`Total Fixed: ${totalFixed}`);
      
      // Group by symbol
      const bySymbol = {};
      fixedSummaries.forEach(fix => {
        if (!bySymbol[fix.symbol]) bySymbol[fix.symbol] = [];
        bySymbol[fix.symbol].push(fix);
      });
      
      console.log('\n📋 Fixed Summaries by Symbol:');
      Object.entries(bySymbol)
        .sort((a, b) => b[1].length - a[1].length)
        .forEach(([symbol, fixes]) => {
          console.log(`${symbol}: ${fixes.length} strategies reset`);
        });
    } else {
      console.log('\n⚠️ This was a DRY RUN. To execute fixes, run with --fix flag');
    }
    
    return {
      backupFile: backupData.length > 0 ? `negative-positions-backup-${Date.now()}.json` : null,
      totalFound: backupData.length,
      totalFixed: dryRun ? 0 : totalFixed
    };
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await redisClient.quit();
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--fix');
  
  fixNegativePositions(dryRun)
    .then(() => process.exit(0))
    .catch(console.error);
}

module.exports = { fixNegativePositions };