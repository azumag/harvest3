#!/usr/bin/env node
/**
 * EMERGENCY BALANCE AUDIT SCRIPT
 * Live exchange vs Redis position comparison
 * Focus on high-variance currencies: ADA/JPY, APE/JPY, DOT/JPY, GALA/JPY
 */

const { config } = require('./src/config');
const redis = require('redis');

async function createRedisClient() {
  const client = redis.createClient({
    host: 'redis',
    port: 6379,
    retryDelayOnFailover: 100,
    maxRetriesPerRequest: 3
  });
  
  await client.connect();
  return client;
}

async function getLiveExchangeBalances() {
  try {
    console.log('🔍 Fetching live exchange balances...');
    const exchange = config.exchanges.bitbank.instance;
    const balance = await exchange.fetchBalance();
    
    // Filter out zero balances and JPY (per CLAUDE.md requirement)
    const nonZeroBalances = {};
    Object.entries(balance.total).forEach(([currency, amount]) => {
      if (amount > 0 && currency !== 'JPY') {
        nonZeroBalances[currency] = {
          total: amount,
          free: balance.free[currency] || 0,
          used: balance.used[currency] || 0
        };
      }
    });
    
    console.log(`✅ Found ${Object.keys(nonZeroBalances).length} non-zero balances (excluding JPY)`);
    return nonZeroBalances;
  } catch (error) {
    console.error('❌ Exchange balance fetch error:', error.message);
    throw error;
  }
}

async function getRedisPositions() {
  try {
    console.log('🔍 Scanning Redis for position summaries...');
    const redisClient = await createRedisClient();
    
    const keys = await redisClient.keys('summary:trade:*');
    console.log(`Found ${keys.length} trade summary keys`);
    
    const positions = {};
    
    for (const key of keys) {
      try {
        const data = await redisClient.hGetAll(key);
        const netPosition = parseFloat(data.netPosition || 0);
        
        if (netPosition > 0) {
          // Extract currency from key: summary:trade:bitbank:CURRENCY/JPY:STRATEGY
          const keyParts = key.split(':');
          if (keyParts.length >= 4) {
            const pair = keyParts[3];
            const currency = pair.split('/')[0];
            const strategy = keyParts[4] || 'UNKNOWN';
            
            if (!positions[currency]) {
              positions[currency] = {};
            }
            
            positions[currency][strategy] = {
              netPosition,
              buyAmount: parseFloat(data.buyAmount || 0),
              sellAmount: parseFloat(data.sellAmount || 0),
              avgBuyPrice: parseFloat(data.avgBuyPrice || 0),
              updatedAt: data.updatedAt
            };
          }
        }
      } catch (keyError) {
        console.error(`Error processing key ${key}:`, keyError.message);
      }
    }
    
    await redisClient.disconnect();
    
    // Calculate total positions per currency
    const totalPositions = {};
    Object.entries(positions).forEach(([currency, strategies]) => {
      const total = Object.values(strategies).reduce((sum, strategy) => sum + strategy.netPosition, 0);
      totalPositions[currency] = {
        total,
        strategies: Object.keys(strategies).length,
        strategiesDetail: strategies
      };
    });
    
    console.log(`✅ Found positions for ${Object.keys(totalPositions).length} currencies`);
    return totalPositions;
  } catch (error) {
    console.error('❌ Redis positions fetch error:', error.message);
    throw error;
  }
}

function calculateDiscrepancy(exchangeBalance, redisTotal) {
  const discrepancy = redisTotal - exchangeBalance;
  const discrepancyPercent = exchangeBalance > 0 ? (discrepancy / exchangeBalance * 100) : (redisTotal > 0 ? Infinity : 0);
  return { discrepancy, discrepancyPercent };
}

function generateAuditReport(exchangeBalances, redisPositions) {
  console.log('\n🚨 EMERGENCY BALANCE AUDIT REPORT');
  console.log('=' .repeat(50));
  
  const highVarianceCurrencies = ['ADA', 'APE', 'DOT', 'GALA'];
  const criticalDiscrepancies = [];
  const zombiePositions = [];
  const allDiscrepancies = [];
  
  // Check all currencies with Redis positions
  Object.entries(redisPositions).forEach(([currency, positionData]) => {
    const exchangeBalance = exchangeBalances[currency] ? exchangeBalances[currency].total : 0;
    const redisTotal = positionData.total;
    const { discrepancy, discrepancyPercent } = calculateDiscrepancy(exchangeBalance, redisTotal);
    
    const discrepancyInfo = {
      currency,
      exchangeBalance,
      redisTotal,
      discrepancy,
      discrepancyPercent: discrepancyPercent === Infinity ? 'ZOMBIE' : discrepancyPercent.toFixed(2) + '%',
      strategiesCount: positionData.strategies,
      isHighVariance: highVarianceCurrencies.includes(currency),
      isZombie: exchangeBalance === 0 && redisTotal > 0,
      isCritical: Math.abs(discrepancyPercent) > 100 || exchangeBalance === 0
    };
    
    allDiscrepancies.push(discrepancyInfo);
    
    if (discrepancyInfo.isZombie) {
      zombiePositions.push(discrepancyInfo);
    }
    
    if (discrepancyInfo.isCritical) {
      criticalDiscrepancies.push(discrepancyInfo);
    }
  });
  
  // Sort by discrepancy severity
  allDiscrepancies.sort((a, b) => {
    if (a.isZombie && !b.isZombie) return -1;
    if (b.isZombie && !a.isZombie) return 1;
    return Math.abs(parseFloat(b.discrepancyPercent) || 0) - Math.abs(parseFloat(a.discrepancyPercent) || 0);
  });
  
  console.log('\n🎯 HIGH PRIORITY CURRENCIES (ADA, APE, DOT, GALA):');
  allDiscrepancies.filter(d => d.isHighVariance).forEach(d => {
    console.log(`${d.currency}: Exchange=${d.exchangeBalance}, Redis=${d.redisTotal}, Variance=${d.discrepancyPercent}, Strategies=${d.strategiesCount}`);
  });
  
  console.log('\n💀 ZOMBIE POSITIONS (0 exchange balance, >0 Redis):');
  zombiePositions.forEach(d => {
    console.log(`${d.currency}: Redis=${d.redisTotal} (${d.strategiesCount} strategies) - IMMEDIATE CLEANUP REQUIRED`);
  });
  
  console.log('\n🚨 CRITICAL DISCREPANCIES (>100% variance):');
  criticalDiscrepancies.filter(d => !d.isZombie).forEach(d => {
    console.log(`${d.currency}: Exchange=${d.exchangeBalance}, Redis=${d.redisTotal}, Variance=${d.discrepancyPercent}`);
  });
  
  console.log('\n📊 FULL AUDIT SUMMARY:');
  console.log(`Total currencies with positions: ${allDiscrepancies.length}`);
  console.log(`Zombie positions: ${zombiePositions.length}`);
  console.log(`Critical discrepancies: ${criticalDiscrepancies.length}`);
  console.log(`High variance currencies found: ${allDiscrepancies.filter(d => d.isHighVariance).length}/4`);
  
  return {
    allDiscrepancies,
    zombiePositions,
    criticalDiscrepancies,
    totalCurrencies: allDiscrepancies.length
  };
}

async function main() {
  try {
    console.log('🚨 STARTING EMERGENCY BALANCE AUDIT');
    console.log('Focus: ADA/JPY, APE/JPY, DOT/JPY, GALA/JPY + All positions');
    console.log('Time:', new Date().toISOString());
    
    const [exchangeBalances, redisPositions] = await Promise.all([
      getLiveExchangeBalances(),
      getRedisPositions()
    ]);
    
    const auditResults = generateAuditReport(exchangeBalances, redisPositions);
    
    console.log('\n✅ EMERGENCY AUDIT COMPLETE');
    console.log(`Report generated with ${auditResults.totalCurrencies} currency analyses`);
    
    // Return results for further processing
    return auditResults;
    
  } catch (error) {
    console.error('💥 EMERGENCY AUDIT FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main };