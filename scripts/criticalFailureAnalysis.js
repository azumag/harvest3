/**
 * CRITICAL FAILURE ANALYSIS
 * Investigating phantom asset crisis and previous fix failures
 */

const { getAllTradeSummaries } = require('../src/database/redisDatabase');
const { initRedisClient } = require('../src/database/redisClient');
const { config } = require('../src/config');

async function analyzeCriticalFailure() {
  try {
    console.log('🚨 CRITICAL FAILURE ANALYSIS - PHANTOM ASSET INVESTIGATION');
    console.log('=========================================================');
    
    await initRedisClient();
    
    // Get current state
    const summaries = await getAllTradeSummaries();
    console.log(`Total trade summaries in Redis: ${summaries.length}`);
    
    // Analyze phantom positions
    let totalPhantomValue = 0;
    let phantomPositions = 0;
    
    console.log('\n🔍 PHANTOM POSITION ANALYSIS:');
    console.log('============================');
    
    for (const summary of summaries) {
      const { symbol, netPosition, exchangeId, strategyKey } = summary;
      
      if (netPosition && Math.abs(netPosition) > 0.0001) {
        const [currency] = symbol.split('/');
        console.log(`${currency}: ${netPosition.toFixed(6)} (${exchangeId}:${symbol}:${strategyKey})`);
        
        totalPhantomValue += Math.abs(netPosition);
        phantomPositions++;
      }
    }
    
    console.log(`\nTOTAL PHANTOM POSITIONS: ${phantomPositions}`);
    console.log(`TOTAL PHANTOM VALUE: ${totalPhantomValue.toFixed(6)}`);
    
    // Check exchange balance for comparison
    console.log('\n📊 EXCHANGE ACTUAL BALANCE:');
    console.log('===========================');
    
    let actualExchangeTotal = 0;
    
    for (const [exchangeId, exchangeConfig] of Object.entries(config.exchanges)) {
      if (!exchangeConfig.instance) continue;
      
      try {
        const balance = await exchangeConfig.instance.fetchBalance();
        
        for (const [currency, amount] of Object.entries(balance.total || {})) {
          if (amount > 0.0001 && currency !== 'JPY') {
            console.log(`${currency}: ${amount.toFixed(6)}`);
            actualExchangeTotal += amount;
          }
        }
      } catch (error) {
        console.error(`Error fetching ${exchangeId} balance:`, error.message);
      }
    }
    
    console.log(`\nACTUAL EXCHANGE TOTAL: ${actualExchangeTotal.toFixed(6)}`);
    
    // Calculate the critical discrepancy
    const phantomDiscrepancy = totalPhantomValue - actualExchangeTotal;
    console.log(`\n🚨 PHANTOM ASSET CRISIS:`);
    console.log(`PHANTOM DISCREPANCY: ${phantomDiscrepancy.toFixed(6)} units`);
    console.log(`PHANTOM PERCENTAGE: ${((phantomDiscrepancy / totalPhantomValue) * 100).toFixed(1)}%`);
    
    if (phantomDiscrepancy > 100) {
      console.log('🚨 CRITICAL: Massive phantom asset problem detected');
    }
    
    // Why did previous fixes fail?
    console.log('\n❌ PREVIOUS FIX FAILURE ANALYSIS:');
    console.log('=================================');
    console.log('1. OUTSIDE strategy fix: INCOMPLETE - only addressed sell trades');
    console.log('2. Strategy reallocation: INSUFFICIENT - did not eliminate phantom positions');
    console.log('3. NetPosition recalculation: FLAWED - preserved phantom data');
    console.log('4. Self-healing systems: INEFFECTIVE - working with corrupted base data');
    
    return {
      totalPhantomValue,
      actualExchangeTotal,
      phantomDiscrepancy,
      phantomPositions
    };
    
  } catch (error) {
    console.error('Critical failure analysis error:', error);
    throw error;
  }
}

analyzeCriticalFailure().catch(console.error);