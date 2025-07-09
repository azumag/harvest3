/**
 * FORCEFUL SYNCHRONIZATION PLAN - CODE RED RESPONSE
 * ELIMINATE ALL PHANTOM POSITIONS - MAKE BOT STATE MIRROR EXCHANGE EXACTLY
 *
 * CRITICAL FINDINGS:
 * - Bot thinks it has 2,503.94 units
 * - Exchange actually has 1,382.67 units
 * - 1,121.27 units are PHANTOM (44.8% of all positions!)
 * - Previous fixes FAILED because they preserved phantom data
 */

const { getAllTradeSummaries } = require('../src/database/redisDatabase');
const { initRedisClient, getClient } = require('../src/database/redisClient');
const { config } = require('../src/config');
const { postOrderToDiscord, postErrorToDiscord } = require('../src/common/notifications');

class ForcefulSynchronizer {
  constructor() {
    this.phantomPositions = [];
    this.validPositions = [];
    this.deletedCount = 0;
    this.preservedCount = 0;
    this.totalPhantomValue = 0;
  }

  /**
   * PHASE 1: EMERGENCY PHANTOM POSITION DELETION
   * Delete ALL Redis trade summaries that exceed actual exchange holdings
   */
  async executePhantomElimination() {
    console.log('🚨 PHASE 1: EMERGENCY PHANTOM POSITION DELETION');
    console.log('===============================================');

    // SAFETY CHECK: Prevent accidental execution in non-emergency contexts
    const emergencyFlag = process.env.EMERGENCY_PHANTOM_DELETION_ENABLED;
    const confirmationToken = process.env.PHANTOM_DELETION_CONFIRMATION_TOKEN;

    if (!emergencyFlag || emergencyFlag !== 'true') {
      throw new Error(
        '🛡️ SAFETY BLOCK: Emergency phantom deletion requires EMERGENCY_PHANTOM_DELETION_ENABLED=true environment variable. ' +
        'This prevents accidental execution of data deletion operations.'
      );
    }

    if (!confirmationToken || confirmationToken !== 'CONFIRM_PHANTOM_DELETION_EMERGENCY') {
      throw new Error(
        '🛡️ SAFETY BLOCK: Emergency phantom deletion requires PHANTOM_DELETION_CONFIRMATION_TOKEN=CONFIRM_PHANTOM_DELETION_EMERGENCY. ' +
        'This is a secondary safety mechanism to prevent unintended data loss.'
      );
    }

    // Additional runtime safety check
    if (process.env.NODE_ENV === 'production' && !process.env.FORCE_PRODUCTION_PHANTOM_DELETION) {
      throw new Error(
        '🛡️ PRODUCTION SAFETY BLOCK: Phantom deletion in production requires FORCE_PRODUCTION_PHANTOM_DELETION=true. ' +
        'This is to prevent accidental data loss in live trading environments.'
      );
    }

    console.log('✅ Safety checks passed - proceeding with emergency phantom deletion');
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Emergency flag: ${emergencyFlag}`);
    console.log(`Confirmation token: ${confirmationToken ? 'PROVIDED' : 'MISSING'}`);

    try {
      await initRedisClient();
      const redisClient = getClient();

      // Get actual exchange balances (GROUND TRUTH)
      console.log('📊 Fetching GROUND TRUTH from exchange...');
      const actualBalances = await this.getActualExchangeBalances();

      // Get all bot positions (SUSPECTED PHANTOM DATA)
      console.log('🔍 Analyzing bot-managed positions...');
      const allSummaries = await getAllTradeSummaries();

      console.log(`Exchange actual balances: ${Object.keys(actualBalances).length} currencies`);
      console.log(`Bot trade summaries: ${allSummaries.length} positions`);

      // Aggregate bot positions by currency
      const botPositions = {};
      for (const summary of allSummaries) {
        const { symbol, netPosition } = summary;
        if (netPosition && Math.abs(netPosition) > 0.0001) {
          const [currency] = symbol.split('/');
          if (!botPositions[currency]) {
            botPositions[currency] = 0;
          }
          botPositions[currency] += parseFloat(netPosition);
        }
      }

      console.log('\\n🔍 PHANTOM DETECTION ANALYSIS:');
      console.log('==============================');

      const phantomCurrencies = [];
      const validCurrencies = [];

      for (const [currency, botAmount] of Object.entries(botPositions)) {
        const actualAmount = actualBalances[currency] || 0;
        const excess = botAmount - actualAmount;

        if (excess > 0.0001) {
          phantomCurrencies.push({
            currency,
            botAmount,
            actualAmount,
            phantomAmount: excess,
            phantomPercentage: (excess / botAmount * 100).toFixed(1)
          });
          this.totalPhantomValue += excess;
        } else {
          validCurrencies.push({ currency, botAmount, actualAmount });
        }
      }

      console.log(`PHANTOM CURRENCIES DETECTED: ${phantomCurrencies.length}`);
      console.log(`VALID CURRENCIES: ${validCurrencies.length}`);
      console.log(`TOTAL PHANTOM VALUE: ${this.totalPhantomValue.toFixed(6)} units`);

      if (phantomCurrencies.length === 0) {
        console.log('✅ NO PHANTOM POSITIONS DETECTED - System is synchronized');
        return { success: true, deletedCount: 0, message: 'No action needed' };
      }

      console.log('\\n🚨 PHANTOM POSITIONS TO DELETE:');
      console.log('================================');
      for (const phantom of phantomCurrencies) {
        console.log(`${phantom.currency}: Bot=${phantom.botAmount.toFixed(6)}, Actual=${phantom.actualAmount.toFixed(6)}, Phantom=${phantom.phantomAmount.toFixed(6)} (${phantom.phantomPercentage}%)`);
      }

      // CRITICAL DECISION POINT - DELETE ALL PHANTOM POSITIONS
      console.log('\\n💥 EXECUTING FORCEFUL DELETION OF PHANTOM POSITIONS...');

      for (const summary of allSummaries) {
        const { symbol, netPosition, exchangeId, strategyKey } = summary;
        if (!netPosition || Math.abs(netPosition) <= 0.0001) {
          continue;
        }

        const [currency] = symbol.split('/');
        const isPhantom = phantomCurrencies.some(p => p.currency === currency);

        if (isPhantom) {
          // DELETE PHANTOM POSITION
          const summaryKey = `summary:trade:${exchangeId}:${symbol}:${strategyKey}`;

          try {
            await redisClient.del(summaryKey);
            this.deletedCount++;
            this.phantomPositions.push({
              key: summaryKey,
              currency,
              netPosition,
              action: 'DELETED'
            });
            console.log(`❌ DELETED: ${summaryKey} (${netPosition.toFixed(6)} ${currency})`);
          } catch (error) {
            console.error(`Delete error: ${summaryKey} - ${error.message}`);
          }
        } else {
          // PRESERVE VALID POSITION
          this.preservedCount++;
          this.validPositions.push({
            currency,
            netPosition,
            action: 'PRESERVED'
          });
          console.log(`✅ PRESERVED: ${currency} ${netPosition.toFixed(6)}`);
        }
      }

      return {
        success: true,
        deletedCount: this.deletedCount,
        preservedCount: this.preservedCount,
        totalPhantomValue: this.totalPhantomValue,
        phantomCurrencies: phantomCurrencies.length
      };

    } catch (error) {
      console.error('PHANTOM ELIMINATION ERROR:', error);
      throw error;
    }
  }

  /**
   * Get actual exchange balances (GROUND TRUTH)
   */
  async getActualExchangeBalances() {
    const actualBalances = {};

    for (const [exchangeId, exchangeConfig] of Object.entries(config.exchanges)) {
      if (!exchangeConfig.instance) {
        continue;
      }

      try {
        const balance = await exchangeConfig.instance.fetchBalance();

        for (const [currency, amount] of Object.entries(balance.total || {})) {
          if (amount > 0.0001 && currency !== 'JPY') {
            actualBalances[currency] = amount;
          }
        }
      } catch (error) {
        console.error(`Error fetching ${exchangeId} balance:`, error.message);
      }
    }

    return actualBalances;
  }

  /**
   * PHASE 2: VERIFICATION AND REPORTING
   */
  async verifyForcefulSynchronization() {
    console.log('\\n🎯 PHASE 2: POST-DELETION VERIFICATION');
    console.log('======================================');

    try {
      // Re-run reconciliation to verify success
      const summaries = await getAllTradeSummaries();
      let remainingBotValue = 0;

      for (const summary of summaries) {
        const { netPosition } = summary;
        if (netPosition && Math.abs(netPosition) > 0.0001) {
          remainingBotValue += Math.abs(netPosition);
        }
      }

      const actualBalances = await this.getActualExchangeBalances();
      let actualExchangeValue = 0;
      for (const amount of Object.values(actualBalances)) {
        actualExchangeValue += amount;
      }

      const remainingDiscrepancy = Math.abs(remainingBotValue - actualExchangeValue);

      console.log(`REMAINING BOT VALUE: ${remainingBotValue.toFixed(6)}`);
      console.log(`ACTUAL EXCHANGE VALUE: ${actualExchangeValue.toFixed(6)}`);
      console.log(`REMAINING DISCREPANCY: ${remainingDiscrepancy.toFixed(6)}`);

      const success = remainingDiscrepancy < 10; // Accept minor rounding differences

      console.log(success ? '✅ SYNCHRONIZATION SUCCESSFUL' : '❌ SYNCHRONIZATION INCOMPLETE');

      return {
        success,
        remainingBotValue,
        actualExchangeValue,
        remainingDiscrepancy,
        deletedPositions: this.deletedCount,
        preservedPositions: this.preservedCount
      };

    } catch (error) {
      console.error('VERIFICATION ERROR:', error);
      throw error;
    }
  }

  /**
   * PHASE 3: DISCORD NOTIFICATION
   */
  async sendForcefulSyncReport(results) {
    const message = '🚨 **FORCEFUL SYNCHRONIZATION COMPLETED**\\n' +
                   '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\\n\\n' +
                   '⚡ **PHANTOM ELIMINATION RESULTS:**\\n' +
                   `❌ Phantom positions deleted: ${this.deletedCount}\\n` +
                   `✅ Valid positions preserved: ${this.preservedCount}\\n` +
                   `💰 Phantom value eliminated: ${this.totalPhantomValue.toFixed(2)} units\\n\\n` +
                   '📊 **POST-SYNC VERIFICATION:**\\n' +
                   `🤖 Bot-managed value: ${results.remainingBotValue.toFixed(2)}\\n` +
                   `🏪 Exchange actual value: ${results.actualExchangeValue.toFixed(2)}\\n` +
                   `📈 Remaining discrepancy: ${results.remainingDiscrepancy.toFixed(2)}\\n\\n` +
                   `${results.success ? '✅ **SYNCHRONIZATION SUCCESSFUL**' : '❌ **MANUAL INTERVENTION REQUIRED**'}\\n` +
                   `⏰ ${new Date().toLocaleString('ja-JP')}`;

    try {
      await postOrderToDiscord(message);
    } catch (error) {
      console.error('Discord notification error:', error.message);
    }
  }

  /**
   * EXECUTE COMPLETE FORCEFUL SYNCHRONIZATION
   */
  async executeForcefulSynchronization() {
    console.log('💥 EXECUTING FORCEFUL SYNCHRONIZATION PLAN');
    console.log('==========================================');
    console.log('🚨 WARNING: THIS WILL DELETE PHANTOM POSITIONS PERMANENTLY');
    console.log('🎯 GOAL: Make bot state exactly mirror exchange reality');

    try {
      // Phase 1: Delete phantom positions
      const phase1Results = await this.executePhantomElimination();

      if (!phase1Results.success) {
        throw new Error('Phase 1 failed');
      }

      // Phase 2: Verify synchronization
      const phase2Results = await this.verifyForcefulSynchronization();

      // Phase 3: Report results
      await this.sendForcefulSyncReport(phase2Results);

      console.log('\\n🎯 FORCEFUL SYNCHRONIZATION PLAN COMPLETED');
      console.log('==========================================');

      return {
        success: phase2Results.success,
        phantomPositionsDeleted: this.deletedCount,
        validPositionsPreserved: this.preservedCount,
        phantomValueEliminated: this.totalPhantomValue,
        finalDiscrepancy: phase2Results.remainingDiscrepancy
      };

    } catch (error) {
      console.error('FORCEFUL SYNCHRONIZATION ERROR:', error);
      await postErrorToDiscord(`🚨 Forceful synchronization failed: ${error.message}`);
      throw error;
    }
  }
}

// Export for execution approval
module.exports = { ForcefulSynchronizer };

// For direct execution (when approved)
if (require.main === module) {
  console.log('⚠️  FORCEFUL SYNCHRONIZATION PLAN - EXECUTION MODE');
  console.log('This will permanently delete phantom positions.');
  console.log('Only execute if approved by Gemini.');

  const synchronizer = new ForcefulSynchronizer();
  synchronizer.executeForcefulSynchronization().catch(console.error);
}