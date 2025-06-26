const { config } = require('./src/config');
const redis = require('redis');

async function main() {
  try {
    console.log('🚨 EMERGENCY BALANCE AUDIT');
    
    // Step 1: Get live exchange balances
    console.log('\n1️⃣ LIVE EXCHANGE BALANCES:');
    const exchange = config.exchanges.bitbank.instance;
    const balance = await exchange.fetchBalance();
    
    const nonZeroBalances = {};
    Object.entries(balance.total).forEach(([currency, amount]) => {
      if (amount > 0 && currency !== 'JPY') {
        nonZeroBalances[currency] = amount;
        console.log(`${currency}: ${amount}`);
      }
    });
    
    // Step 2: Get Redis position summaries 
    console.log('\n2️⃣ REDIS POSITION ANALYSIS:');
    const client = redis.createClient({ url: 'redis://redis:6379' });
    await client.connect();
    
    const keys = await client.keys('summary:trade:*');
    console.log(`Found ${keys.length} trade summary keys`);
    
    // Focus on target currencies
    const targets = ['ADA', 'APE', 'DOT', 'GALA'];
    const auditResults = [];
    
    for (const currency of targets) {
      const currencyKeys = keys.filter(k => k.includes(`:${currency}/JPY:`));
      let totalRedis = 0;
      let strategyCount = 0;
      
      for (const key of currencyKeys) {
        const data = await client.hGetAll(key);
        const netPos = parseFloat(data.netPosition || 0);
        if (netPos > 0) {
          totalRedis += netPos;
          strategyCount++;
        }
      }
      
      const exchangeBal = nonZeroBalances[currency] || 0;
      const discrepancy = totalRedis - exchangeBal;
      
      let variance;
      if (exchangeBal === 0 && totalRedis > 0) {
        variance = 'ZOMBIE';
      } else if (exchangeBal > 0) {
        variance = ((discrepancy / exchangeBal) * 100).toFixed(2) + '%';
      } else {
        variance = '0%';
      }
      
      auditResults.push({
        currency,
        exchange: exchangeBal,
        redis: totalRedis,
        discrepancy,
        variance,
        strategies: strategyCount
      });
      
      console.log(`${currency}: Exchange=${exchangeBal}, Redis=${totalRedis.toFixed(4)}, Variance=${variance}, Strategies=${strategyCount}`);
    }
    
    await client.disconnect();
    
    // Step 3: Summary
    console.log('\n3️⃣ CRITICAL SUMMARY:');
    auditResults.forEach(result => {
      if (result.variance === 'ZOMBIE') {
        console.log(`🧟 ${result.currency}: ZOMBIE POSITION - ${result.redis} recorded but 0 on exchange`);
      } else if (Math.abs(parseFloat(result.variance)) > 100) {
        console.log(`🚨 ${result.currency}: CRITICAL VARIANCE - ${result.variance}`);
      }
    });
    
    console.log('\n✅ AUDIT COMPLETE');
    
  } catch (error) {
    console.error('💥 Error:', error.message);
    console.error(error.stack);
  }
}

main();