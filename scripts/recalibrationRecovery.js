/**
 * RECALIBRATION RECOVERY SCRIPT
 * Restores position tracking for currencies with legitimate exchange holdings
 * while preserving phantom elimination gains
 *
 * PROBLEM: Over-correction after phantom deletion
 * - Bot managed: 602.27 units
 * - Exchange actual: 1,382.67 units
 * - Missing tracking: 780.40 units (56.44%)
 *
 * SOLUTION: Restore legitimate positions based on actual exchange holdings
 */

const { getAllTradeSummaries } = require('../src/database/redisDatabase');
const { initRedisClient, client } = require('../src/database/redisClient');
const { config } = require('../src/config');
const { postOrderToDiscord, postErrorToDiscord } = require('../src/common/notifications');

class RecalibrationRecovery {
  constructor() {
    this.restoredPositions = [];
    this.skippedCurrencies = [];
    this.totalRestoredValue = 0;
    this.restoreCount = 0;
  }

  /**
   * Get actual exchange balances to determine what positions should exist
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
            actualBalances[currency] = {
              amount,
              exchangeId
            };
          }
        }
      } catch (error) {
        console.error(`Error fetching ${exchangeId} balance:`, error.message);
      }
    }

    return actualBalances;
  }

  /**
   * Get current bot positions to see what's missing
   */
  async getCurrentBotPositions() {
    const summaries = await getAllTradeSummaries();
    const botPositions = {};

    for (const summary of summaries) {
      const { symbol, netPosition } = summary;
      if (netPosition && Math.abs(netPosition) > 0.0001) {
        const currency = symbol.split('/')[0];
        if (!botPositions[currency]) {
          botPositions[currency] = 0;
        }
        botPositions[currency] += parseFloat(netPosition);
      }
    }

    return botPositions;
  }

  /**
   * PHASE 1: Identify missing legitimate positions
   */
  async identifyMissingPositions() {
    console.log('🔍 PHASE 1: IDENTIFYING MISSING LEGITIMATE POSITIONS');
    console.log('===================================================');

    try {
      const actualBalances = await this.getActualExchangeBalances();
      const botPositions = await this.getCurrentBotPositions();

      console.log(`Exchange currencies with balances: ${Object.keys(actualBalances).length}`);
      console.log(`Bot currently tracking: ${Object.keys(botPositions).length} currencies`);

      const missingPositions = [];
      const wellTrackedPositions = [];

      for (const [currency, exchangeData] of Object.entries(actualBalances)) {
        const botAmount = botPositions[currency] || 0;
        const exchangeAmount = exchangeData.amount;
        const deficit = exchangeAmount - botAmount;

        if (deficit > 0.1) { // Significant under-tracking
          missingPositions.push({
            currency,
            exchangeAmount,
            botAmount,
            deficit,
            exchangeId: exchangeData.exchangeId,
            deficitPercentage: ((deficit / exchangeAmount) * 100).toFixed(1)
          });
        } else {
          wellTrackedPositions.push({
            currency,
            exchangeAmount,
            botAmount,
            status: 'WELL_TRACKED'
          });
        }
      }

      console.log('\n📊 ANALYSIS RESULTS:');
      console.log('==================');
      console.log(`Missing position tracking: ${missingPositions.length} currencies`);
      console.log(`Well-tracked currencies: ${wellTrackedPositions.length} currencies`);

      if (missingPositions.length > 0) {
        console.log('\n⚠️ CURRENCIES REQUIRING POSITION RESTORATION:');
        console.log('=============================================');
        for (const missing of missingPositions) {
          console.log(`${missing.currency}: Exchange=${missing.exchangeAmount.toFixed(6)}, Bot=${missing.botAmount.toFixed(6)}, Deficit=${missing.deficit.toFixed(6)} (${missing.deficitPercentage}%)`);
        }
      }

      return { missingPositions, wellTrackedPositions };

    } catch (error) {
      console.error('Position identification error:', error);
      throw error;
    }
  }

  /**
   * PHASE 2: Restore missing position tracking
   */
  async restoreMissingPositions(missingPositions) {
    console.log('\n🔧 PHASE 2: RESTORING MISSING POSITION TRACKING');
    console.log('===============================================');

    if (missingPositions.length === 0) {
      console.log('✅ No missing positions detected - system is properly calibrated');
      return { success: true, restored: 0 };
    }

    try {
      const redisClient = client;

      console.log(`\nRestoring positions for ${missingPositions.length} currencies...`);

      for (const missing of missingPositions) {
        const { currency, deficit, exchangeId } = missing;

        // Create a conservative restoration strategy
        // We'll create a position tracking the deficit amount
        const symbol = `${currency}/JPY`; // Most common trading pair
        const strategyKey = 'RECALIBRATION_RECOVERY'; // Special strategy for restored positions

        const summaryKey = `summary:trade:${exchangeId}:${symbol}:${strategyKey}`;

        const restorationData = {
          symbol,
          netPosition: deficit,
          exchangeId,
          strategyKey,
          restoredAt: new Date().toISOString(),
          restorationReason: 'POST_PHANTOM_ELIMINATION_RECALIBRATION',
          originalDeficit: deficit
        };

        try {
          // Create the position tracking entry
          await redisClient.hSet(summaryKey, restorationData);

          this.restoredPositions.push({
            currency,
            amount: deficit,
            key: summaryKey,
            action: 'RESTORED'
          });

          this.totalRestoredValue += deficit;
          this.restoreCount++;

          console.log(`✅ RESTORED: ${currency} ${deficit.toFixed(6)} (${summaryKey})`);

        } catch (error) {
          console.error(`Failed to restore ${currency}:`, error.message);
          this.skippedCurrencies.push({
            currency,
            reason: error.message
          });
        }
      }

      console.log('\n📊 RESTORATION SUMMARY:');
      console.log(`Positions restored: ${this.restoreCount}`);
      console.log(`Total value restored: ${this.totalRestoredValue.toFixed(6)}`);
      console.log(`Skipped currencies: ${this.skippedCurrencies.length}`);

      return {
        success: true,
        restored: this.restoreCount,
        totalValue: this.totalRestoredValue,
        skipped: this.skippedCurrencies.length
      };

    } catch (error) {
      console.error('Position restoration error:', error);
      throw error;
    }
  }

  /**
   * PHASE 3: Verify recalibration success
   */
  async verifyRecalibration() {
    console.log('\n🎯 PHASE 3: VERIFICATION OF RECALIBRATION');
    console.log('=========================================');

    try {
      // Re-run balance reconciliation
      const actualBalances = await this.getActualExchangeBalances();
      const botPositions = await this.getCurrentBotPositions();

      let totalExchangeValue = 0;
      let totalBotValue = 0;

      for (const [currency, data] of Object.entries(actualBalances)) {
        totalExchangeValue += data.amount;
      }

      for (const amount of Object.values(botPositions)) {
        totalBotValue += Math.abs(amount);
      }

      const remainingDiscrepancy = Math.abs(totalBotValue - totalExchangeValue);
      const discrepancyPercentage = totalExchangeValue > 0 ? (remainingDiscrepancy / totalExchangeValue * 100) : 0;

      console.log('POST-RECALIBRATION RESULTS:');
      console.log(`Bot managed value: ${totalBotValue.toFixed(6)}`);
      console.log(`Exchange actual value: ${totalExchangeValue.toFixed(6)}`);
      console.log(`Remaining discrepancy: ${remainingDiscrepancy.toFixed(6)}`);
      console.log(`Discrepancy percentage: ${discrepancyPercentage.toFixed(2)}%`);

      const success = remainingDiscrepancy < 100 && discrepancyPercentage < 10;

      console.log(success ? '\n✅ RECALIBRATION SUCCESSFUL' : '\n❌ RECALIBRATION INCOMPLETE');

      return {
        success,
        botValue: totalBotValue,
        exchangeValue: totalExchangeValue,
        discrepancy: remainingDiscrepancy,
        discrepancyPercentage
      };

    } catch (error) {
      console.error('Recalibration verification error:', error);
      throw error;
    }
  }

  /**
   * PHASE 4: Discord notification
   */
  async sendRecalibrationReport(results) {
    const message = '🔧 **RECALIBRATION RECOVERY COMPLETED**\n' +
                   '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
                   '⚡ **POSITION RESTORATION RESULTS:**\n' +
                   `✅ Positions restored: ${this.restoreCount}\n` +
                   `💰 Value restored: ${this.totalRestoredValue.toFixed(2)} units\n` +
                   `⚠️ Currencies skipped: ${this.skippedCurrencies.length}\n\n` +
                   '📊 **POST-RECALIBRATION VERIFICATION:**\n' +
                   `🤖 Bot-managed value: ${results.botValue.toFixed(2)}\n` +
                   `🏪 Exchange actual value: ${results.exchangeValue.toFixed(2)}\n` +
                   `📈 Remaining discrepancy: ${results.discrepancy.toFixed(2)} (${results.discrepancyPercentage.toFixed(1)}%)\n\n` +
                   `${results.success ? '✅ **RECALIBRATION SUCCESSFUL**' : '❌ **MANUAL REVIEW REQUIRED**'}\n` +
                   `⏰ ${new Date().toLocaleString('ja-JP')}`;

    try {
      await postOrderToDiscord(message);
    } catch (error) {
      console.error('Discord notification error:', error.message);
    }
  }

  /**
   * Execute complete recalibration recovery
   */
  async executeRecalibrationRecovery() {
    console.log('🔧 EXECUTING RECALIBRATION RECOVERY');
    console.log('===================================');
    console.log('🎯 GOAL: Restore legitimate position tracking without recreating phantoms');

    try {
      await initRedisClient();

      // Phase 1: Identify missing positions
      const { missingPositions } = await this.identifyMissingPositions();

      // Phase 2: Restore missing positions
      const restoreResults = await this.restoreMissingPositions(missingPositions);

      if (!restoreResults.success) {
        throw new Error('Position restoration failed');
      }

      // Phase 3: Verify success
      const verificationResults = await this.verifyRecalibration();

      // Phase 4: Report results
      await this.sendRecalibrationReport(verificationResults);

      console.log('\n🎯 RECALIBRATION RECOVERY COMPLETED');
      console.log('===================================');

      return {
        success: verificationResults.success,
        positionsRestored: this.restoreCount,
        valueRestored: this.totalRestoredValue,
        finalDiscrepancy: verificationResults.discrepancy,
        finalDiscrepancyPercentage: verificationResults.discrepancyPercentage
      };

    } catch (error) {
      console.error('RECALIBRATION RECOVERY ERROR:', error);
      await postErrorToDiscord(`🚨 Recalibration recovery failed: ${error.message}`);
      throw error;
    }
  }
}

// Export for external use
module.exports = { RecalibrationRecovery };

// Execute if run directly
if (require.main === module) {
  console.log('🔧 RECALIBRATION RECOVERY SCRIPT - EXECUTION MODE');
  console.log('This will restore position tracking for legitimate exchange assets.');

  const recovery = new RecalibrationRecovery();
  recovery.executeRecalibrationRecovery().catch(console.error);
}