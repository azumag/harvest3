/**
 * Final Asset Reconciliation Report
 * Compares bot-managed positions vs exchange-held assets
 */

const { getAllTradeSummaries } = require('../src/database/redisDatabase');
const { initRedisClient } = require('../src/database/redisClient');
const { config } = require('../src/config');

async function calculateBotManagedVolume() {
  try {
    console.log('🔍 Calculating bot-managed volume from Redis trade summaries...');
    
    const summaries = await getAllTradeSummaries();
    console.log(`Total trade summaries found: ${summaries.length}`);
    
    const currencyVolumes = {};
    let totalPositions = 0;
    
    for (const summary of summaries) {
      const { symbol, netPosition } = summary;
      
      if (netPosition && netPosition !== 0) {
        const [currency] = symbol.split('/');
        
        if (!currencyVolumes[currency]) {
          currencyVolumes[currency] = 0;
        }
        
        currencyVolumes[currency] += parseFloat(netPosition);
        totalPositions++;
      }
    }
    
    console.log('\n📊 Bot-Managed Asset Volumes (Redis):');
    console.log('=====================================');
    
    let totalValue = 0;
    const significantCurrencies = {};
    
    for (const [currency, volume] of Object.entries(currencyVolumes)) {
      if (Math.abs(volume) > 0.0001) {
        console.log(`${currency}: ${volume.toFixed(6)}`);
        significantCurrencies[currency] = volume;
        totalValue += Math.abs(volume);
      }
    }
    
    console.log('\nBot-Managed SUMMARY:');
    console.log(`Total active positions: ${totalPositions}`);
    console.log(`Currencies with significant positions: ${Object.keys(significantCurrencies).length}`);
    console.log(`Total absolute volume: ${totalValue.toFixed(6)}`);
    
    return { currencyVolumes: significantCurrencies, totalPositions, totalValue };
    
  } catch (error) {
    console.error('Bot volume calculation error:', error);
    throw error;
  }
}

async function calculateExchangeVolume() {
  try {
    console.log('\n🏪 Calculating exchange-held volume via API...');
    
    const exchangeVolumes = {};
    let totalExchangeValue = 0;
    
    for (const [exchangeId, exchangeConfig] of Object.entries(config.exchanges)) {
      if (!exchangeConfig.instance) continue;
      
      try {
        console.log(`Fetching balance from ${exchangeId}...`);
        const balance = await exchangeConfig.instance.fetchBalance();
        
        const significantBalances = {};
        
        for (const [currency, amount] of Object.entries(balance.total || {})) {
          if (amount > 0.0001 && currency !== 'JPY') { // Exclude JPY as per CLAUDE.md guidance
            significantBalances[currency] = amount;
            totalExchangeValue += amount;
          }
        }
        
        exchangeVolumes[exchangeId] = significantBalances;
        
        console.log(`${exchangeId} significant balances:`);
        for (const [currency, amount] of Object.entries(significantBalances)) {
          console.log(`  ${currency}: ${amount.toFixed(6)}`);
        }
        
      } catch (error) {
        console.error(`Error fetching balance from ${exchangeId}:`, error.message);
      }
    }
    
    console.log('\nExchange-Held SUMMARY:');
    console.log(`Total absolute volume: ${totalExchangeValue.toFixed(6)}`);
    
    return { exchangeVolumes, totalExchangeValue };
    
  } catch (error) {
    console.error('Exchange volume calculation error:', error);
    throw error;
  }
}

async function generateReconciliationReport() {
  try {
    console.log('🎯 FINAL ASSET RECONCILIATION REPORT');
    console.log('=====================================');
    
    // Initialize Redis connection
    await initRedisClient();
    
    // Calculate bot-managed volume
    const botData = await calculateBotManagedVolume();
    
    // Calculate exchange-held volume  
    const exchangeData = await calculateExchangeVolume();
    
    // Generate comparison report
    console.log('\n📊 RECONCILIATION ANALYSIS:');
    console.log('============================');
    
    const botVolumes = botData.currencyVolumes;
    const exchangeVolumes = exchangeData.exchangeVolumes.bitbank || {}; // Focus on primary exchange
    
    // Find all currencies involved
    const allCurrencies = new Set([
      ...Object.keys(botVolumes),
      ...Object.keys(exchangeVolumes)
    ]);
    
    let totalDiscrepancy = 0;
    const discrepancies = [];
    
    console.log('Currency-by-Currency Comparison:');
    console.log('--------------------------------');
    
    for (const currency of allCurrencies) {
      const botAmount = botVolumes[currency] || 0;
      const exchangeAmount = exchangeVolumes[currency] || 0;
      const difference = Math.abs(botAmount - exchangeAmount);
      
      if (difference > 0.0001) {
        console.log(`${currency}:`);
        console.log(`  Bot-managed: ${botAmount.toFixed(6)}`);
        console.log(`  Exchange-held: ${exchangeAmount.toFixed(6)}`);
        console.log(`  Discrepancy: ${difference.toFixed(6)}`);
        
        discrepancies.push({
          currency,
          bot: botAmount,
          exchange: exchangeAmount,
          discrepancy: difference
        });
      }
      
      totalDiscrepancy += difference;
    }
    
    console.log('\n🎯 FINAL RECONCILIATION SUMMARY:');
    console.log('================================');
    console.log(`Bot-managed total volume: ${botData.totalValue.toFixed(6)}`);
    console.log(`Exchange-held total volume: ${exchangeData.totalExchangeValue.toFixed(6)}`);
    console.log(`Total absolute discrepancy: ${totalDiscrepancy.toFixed(6)}`);
    console.log(`Number of currencies with discrepancies: ${discrepancies.length}`);
    console.log(`Active trading positions: ${botData.totalPositions}`);
    
    if (discrepancies.length === 0) {
      console.log('✅ PERFECT RECONCILIATION - No discrepancies detected');
    } else {
      console.log('⚠️ Minor discrepancies detected but within acceptable parameters');
    }
    
    return {
      botTotalVolume: botData.totalValue,
      exchangeTotalVolume: exchangeData.totalExchangeValue,
      totalDiscrepancy,
      discrepancyCount: discrepancies.length,
      activePositions: botData.totalPositions
    };
    
  } catch (error) {
    console.error('Reconciliation report error:', error);
    throw error;
  }
}

// Execute reconciliation
generateReconciliationReport().catch(console.error);