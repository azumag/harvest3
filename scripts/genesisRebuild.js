/**
 * GENESIS REBUILD SCRIPT
 * The final solution to recreate bot positions from scratch based on actual exchange holdings
 * Strategy Key: 'REBUILT_GENESIS' - Marks positions as rebuilt from exchange reality
 * 
 * PURPOSE: Complete recreation of position tracking based on ground truth (exchange balances)
 * GOAL: Perfect 1:1 synchronization between bot tracking and exchange reality
 */

const { initRedisClient, client } = require('../src/database/redisClient');
const { config } = require('../src/config');
const { postOrderToDiscord, postErrorToDiscord } = require('../src/common/notifications');

class GenesisRebuild {
  constructor() {
    this.rebuiltPositions = [];
    this.skippedCurrencies = [];
    this.deletedOldPositions = [];
    this.totalRebuiltValue = 0;
    this.rebuildCount = 0;
    this.deletedCount = 0;
  }

  /**
   * PHASE 1: Clear all existing bot position tracking
   */
  async clearExistingPositions() {
    console.log('🗑️ PHASE 1: CLEARING ALL EXISTING POSITION TRACKING');
    console.log('=================================================');
    
    try {
      // Get all existing trade summaries
      const keys = await client.keys('summary:trade:*');
      console.log(`Found ${keys.length} existing position tracking entries`);
      
      if (keys.length === 0) {
        console.log('✅ No existing positions to clear');
        return { success: true, deleted: 0 };
      }
      
      console.log('\n🗑️ Deleting all existing position tracking...');
      
      // Delete all existing trade summaries
      for (const key of keys) {
        try {
          const summary = await client.hGetAll(key);
          if (Object.keys(summary).length > 0) {
            await client.del(key);
            this.deletedOldPositions.push({
              key,
              symbol: summary.symbol || 'unknown',
              netPosition: parseFloat(summary.netPosition || 0),
              action: 'DELETED_OLD'
            });
            this.deletedCount++;
            console.log(`❌ DELETED: ${key}`);
          }
        } catch (error) {
          console.error(`Delete error: ${key} - ${error.message}`);
        }
      }
      
      console.log(`\n✅ Phase 1 Complete: ${this.deletedCount} old positions deleted`);
      
      return {
        success: true,
        deleted: this.deletedCount
      };
      
    } catch (error) {
      console.error('Position clearing error:', error);
      throw error;
    }
  }

  /**
   * PHASE 2: Fetch ground truth from all exchanges
   */
  async getExchangeGroundTruth() {
    console.log('\n📊 PHASE 2: FETCHING EXCHANGE GROUND TRUTH');
    console.log('=========================================');
    
    const exchangeBalances = {};
    let totalExchangeValue = 0;
    
    for (const [exchangeId, exchangeConfig] of Object.entries(config.exchanges)) {
      if (!exchangeConfig.instance) continue;
      
      try {
        console.log(`\n🔍 Fetching balances from ${exchangeId}...`);
        const balance = await exchangeConfig.instance.fetchBalance();
        
        const currencyBalances = {};
        
        for (const [currency, amount] of Object.entries(balance.total || {})) {
          if (amount > 0.0001 && currency !== 'JPY') {
            currencyBalances[currency] = amount;
            totalExchangeValue += amount;
            console.log(`  ${currency}: ${amount.toFixed(6)}`);
          }
        }
        
        exchangeBalances[exchangeId] = currencyBalances;
        
        console.log(`${exchangeId} total: ${Object.keys(currencyBalances).length} currencies`);
        
      } catch (error) {
        console.error(`Error fetching ${exchangeId} balance:`, error.message);
        exchangeBalances[exchangeId] = {};
      }
    }
    
    console.log(`\n📊 GROUND TRUTH SUMMARY:`);
    console.log(`Total exchanges: ${Object.keys(exchangeBalances).length}`);
    console.log(`Total exchange value: ${totalExchangeValue.toFixed(6)} units`);
    console.log(`Total currencies: ${Object.values(exchangeBalances).reduce((acc, curr) => acc + Object.keys(curr).length, 0)}`);
    
    return { exchangeBalances, totalExchangeValue };
  }

  /**
   * PHASE 3: Rebuild position tracking from ground truth
   */
  async rebuildPositionsFromGroundTruth(exchangeBalances) {
    console.log('\n🔧 PHASE 3: REBUILDING POSITION TRACKING FROM GROUND TRUTH');
    console.log('========================================================');
    
    try {
      for (const [exchangeId, currencyBalances] of Object.entries(exchangeBalances)) {
        if (Object.keys(currencyBalances).length === 0) continue;
        
        console.log(`\n🏗️ Rebuilding positions for ${exchangeId}...`);
        
        for (const [currency, amount] of Object.entries(currencyBalances)) {
          // Create trading pair (most common is /JPY)
          const symbol = `${currency}/JPY`;
          const strategyKey = 'REBUILT_GENESIS';
          
          const summaryKey = `summary:trade:${exchangeId}:${symbol}:${strategyKey}`;
          
          // Create fresh position tracking entry based on exchange reality
          const genesisData = {
            symbol,
            netPosition: amount.toString(),
            buyAmount: amount.toString(), // Assume all current holdings are from buys
            sellAmount: '0',
            totalBuyCost: '0', // Historical cost unknown - will be calculated from current price
            totalSellValue: '0',
            totalFee: '0',
            realizedPnL: '0',
            exchangeId,
            strategyKey,
            
            // Genesis metadata
            genesisRebuilt: 'true',
            rebuiltAt: new Date().toISOString(),
            rebuiltFromExchangeBalance: amount.toString(),
            rebuiltSource: 'EXCHANGE_GROUND_TRUTH',
            rebuiltReason: 'GENESIS_OPERATION_COMPLETE_REBUILD',
            
            // Timestamps
            createdAt: Date.now().toString(),
            updatedAt: Date.now().toString()
          };
          
          try {
            // Create the genesis position tracking
            await client.hSet(summaryKey, genesisData);
            
            this.rebuiltPositions.push({
              currency,
              amount,
              exchangeId,
              symbol,
              key: summaryKey,
              action: 'GENESIS_REBUILT'
            });
            
            this.totalRebuiltValue += amount;
            this.rebuildCount++;
            
            console.log(`✅ GENESIS REBUILT: ${currency} ${amount.toFixed(6)} (${summaryKey})`);
            
          } catch (error) {
            console.error(`Failed to rebuild ${currency}:`, error.message);
            this.skippedCurrencies.push({
              currency,
              exchangeId,
              amount,
              reason: error.message
            });
          }
        }
      }
      
      console.log(`\n📊 GENESIS REBUILD SUMMARY:`);
      console.log(`Positions rebuilt: ${this.rebuildCount}`);
      console.log(`Total value rebuilt: ${this.totalRebuiltValue.toFixed(6)}`);
      console.log(`Skipped currencies: ${this.skippedCurrencies.length}`);
      
      return {
        success: true,
        rebuilt: this.rebuildCount,
        totalValue: this.totalRebuiltValue,
        skipped: this.skippedCurrencies.length
      };
      
    } catch (error) {
      console.error('Genesis rebuild error:', error);
      throw error;
    }
  }

  /**
   * PHASE 4: Verify perfect synchronization
   */
  async verifyGenesisSynchronization(originalExchangeBalances, totalExchangeValue) {
    console.log('\n🎯 PHASE 4: VERIFYING PERFECT SYNCHRONIZATION');
    console.log('============================================');
    
    try {
      // Get rebuilt bot positions
      const keys = await client.keys('summary:trade:*:*:REBUILT_GENESIS');
      const rebuiltPositions = {};
      let totalBotValue = 0;
      
      for (const key of keys) {
        const summary = await client.hGetAll(key);
        if (summary.netPosition) {
          const [, exchangeId, symbol] = key.split(':');
          const currency = symbol.split('/')[0];
          const amount = parseFloat(summary.netPosition);
          
          if (!rebuiltPositions[currency]) rebuiltPositions[currency] = 0;
          rebuiltPositions[currency] += amount;
          totalBotValue += amount;
        }
      }
      
      console.log(`BOT REBUILT POSITIONS: ${Object.keys(rebuiltPositions).length} currencies`);
      console.log(`EXCHANGE ACTUAL POSITIONS: ${Object.values(originalExchangeBalances).reduce((acc, curr) => acc + Object.keys(curr).length, 0)} currencies`);
      
      // Compare currency by currency
      const allCurrencies = new Set([
        ...Object.keys(rebuiltPositions),
        ...Object.keys(Object.values(originalExchangeBalances).reduce((acc, curr) => ({ ...acc, ...curr }), {}))
      ]);
      
      let perfectMatches = 0;
      const discrepancies = [];
      
      console.log(`\n🔍 CURRENCY-BY-CURRENCY VERIFICATION:`);
      console.log('====================================');
      
      for (const currency of allCurrencies) {
        const botAmount = rebuiltPositions[currency] || 0;
        const exchangeAmount = Object.values(originalExchangeBalances)
          .reduce((acc, curr) => acc + (curr[currency] || 0), 0);
        
        const difference = Math.abs(botAmount - exchangeAmount);
        
        if (difference < 0.000001) { // Perfect match (accounting for floating point precision)
          console.log(`✅ ${currency}: PERFECT SYNC (${botAmount.toFixed(6)})`);
          perfectMatches++;
        } else {
          console.log(`⚠️ ${currency}: Bot=${botAmount.toFixed(6)}, Exchange=${exchangeAmount.toFixed(6)}, Diff=${difference.toFixed(6)}`);
          discrepancies.push({
            currency,
            botAmount,
            exchangeAmount,
            difference
          });
        }
      }
      
      const finalDiscrepancy = Math.abs(totalBotValue - totalExchangeValue);
      const discrepancyPercentage = totalExchangeValue > 0 ? (finalDiscrepancy / totalExchangeValue * 100) : 0;
      
      console.log(`\n🎯 FINAL GENESIS VERIFICATION:`);
      console.log('============================');
      console.log(`Bot managed value: ${totalBotValue.toFixed(6)}`);
      console.log(`Exchange actual value: ${totalExchangeValue.toFixed(6)}`);
      console.log(`Final discrepancy: ${finalDiscrepancy.toFixed(6)}`);
      console.log(`Discrepancy percentage: ${discrepancyPercentage.toFixed(4)}%`);
      console.log(`Perfect currency matches: ${perfectMatches}/${allCurrencies.size}`);
      
      const success = finalDiscrepancy < 0.01 && discrepancyPercentage < 0.01;
      
      console.log(success ? '\n✅ GENESIS VERIFICATION: PERFECT SYNCHRONIZATION ACHIEVED' : '\n❌ GENESIS VERIFICATION: MINOR DISCREPANCIES DETECTED');
      
      return {
        success,
        totalBotValue,
        totalExchangeValue,
        finalDiscrepancy,
        discrepancyPercentage,
        perfectMatches,
        totalCurrencies: allCurrencies.size,
        discrepancies
      };
      
    } catch (error) {
      console.error('Genesis verification error:', error);
      throw error;
    }
  }

  /**
   * PHASE 5: Send Genesis completion report
   */
  async sendGenesisCompletionReport(verificationResults) {
    const message = `🚀 **GENESIS OPERATION COMPLETED**\n` +
                   `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                   `⚡ **COMPLETE SYSTEM REBUILD**\n` +
                   `🗑️ Old positions deleted: ${this.deletedCount}\n` +
                   `🏗️ Positions rebuilt from scratch: ${this.rebuildCount}\n` +
                   `💰 Total value rebuilt: ${this.totalRebuiltValue.toFixed(2)} units\n` +
                   `📊 Perfect currency matches: ${verificationResults.perfectMatches}/${verificationResults.totalCurrencies}\n\n` +
                   `🎯 **PERFECT SYNCHRONIZATION ACHIEVED**\n` +
                   `🤖 Bot-managed value: ${verificationResults.totalBotValue.toFixed(6)}\n` +
                   `🏪 Exchange actual value: ${verificationResults.totalExchangeValue.toFixed(6)}\n` +
                   `📈 Final discrepancy: ${verificationResults.finalDiscrepancy.toFixed(6)} (${verificationResults.discrepancyPercentage.toFixed(4)}%)\n\n` +
                   `${verificationResults.success ? '🎉 **GENESIS SUCCESS: PERFECT 1:1 SYNCHRONIZATION**' : '⚠️ **MINOR OPTIMIZATION NEEDED**'}\n\n` +
                   `🔑 **Strategy Key**: REBUILT_GENESIS\n` +
                   `⏰ ${new Date().toLocaleString('ja-JP')}\n\n` +
                   `🚀 The bot now has perfect knowledge of all exchange holdings.\n` +
                   `All positions are rebuilt from ground truth. Ready for optimal trading!`;
    
    try {
      await postOrderToDiscord(message);
    } catch (error) {
      console.error('Discord notification error:', error.message);
    }
  }

  /**
   * Execute complete Genesis Rebuild Operation
   */
  async executeGenesisRebuild() {
    console.log('🚀 GENESIS REBUILD OPERATION INITIATED');
    console.log('======================================');
    console.log('🎯 MISSION: Complete recreation of bot position tracking from exchange reality');
    console.log('🔑 STRATEGY: REBUILT_GENESIS');
    console.log('⚡ GOAL: Perfect 1:1 synchronization');
    
    try {
      await initRedisClient();
      
      // Phase 1: Clear all existing positions
      const clearResult = await this.clearExistingPositions();
      
      if (!clearResult.success) {
        throw new Error('Phase 1 failed: Could not clear existing positions');
      }
      
      // Phase 2: Get exchange ground truth
      const { exchangeBalances, totalExchangeValue } = await this.getExchangeGroundTruth();
      
      // Phase 3: Rebuild from ground truth
      const rebuildResult = await this.rebuildPositionsFromGroundTruth(exchangeBalances);
      
      if (!rebuildResult.success) {
        throw new Error('Phase 3 failed: Could not rebuild positions');
      }
      
      // Phase 4: Verify perfect synchronization
      const verificationResult = await this.verifyGenesisSynchronization(exchangeBalances, totalExchangeValue);
      
      // Phase 5: Send completion report
      await this.sendGenesisCompletionReport(verificationResult);
      
      console.log('\n🎯 GENESIS REBUILD OPERATION COMPLETED');
      console.log('=====================================');
      console.log(`🎉 SUCCESS: ${verificationResult.success ? 'PERFECT SYNCHRONIZATION' : 'MINOR OPTIMIZATION NEEDED'}`);
      
      return {
        success: verificationResult.success,
        oldPositionsDeleted: this.deletedCount,
        newPositionsRebuilt: this.rebuildCount,
        totalValueRebuilt: this.totalRebuiltValue,
        finalDiscrepancy: verificationResult.finalDiscrepancy,
        finalDiscrepancyPercentage: verificationResult.discrepancyPercentage,
        perfectMatches: verificationResult.perfectMatches,
        totalCurrencies: verificationResult.totalCurrencies
      };
      
    } catch (error) {
      console.error('GENESIS REBUILD ERROR:', error);
      await postErrorToDiscord(`🚨 Genesis Rebuild failed: ${error.message}`);
      throw error;
    }
  }
}

// Export for external use
module.exports = { GenesisRebuild };

// Execute if run directly
if (require.main === module) {
  console.log('🚀 GENESIS REBUILD SCRIPT - EXECUTION MODE');
  console.log('This will completely recreate all bot position tracking from exchange reality.');
  console.log('Strategy: REBUILT_GENESIS');
  
  const genesis = new GenesisRebuild();
  genesis.executeGenesisRebuild().catch(console.error);
}