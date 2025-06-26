#!/usr/bin/env node
/**
 * PHANTOM POSITION CLEANUP SYSTEM
 * 
 * Systematic cleanup of phantom positions with:
 * 1. Live exchange balance verification
 * 2. Redis summary:trade position comparison  
 * 3. Phantom position identification
 * 4. Audit trail backup before deletion
 * 5. Progressive cleanup with verification
 */

const { config } = require('./src/config');
const redis = require('redis');
const fs = require('fs');
const path = require('path');

class PhantomPositionCleaner {
  constructor() {
    this.redisClient = null;
    this.exchange = null;
    this.backupData = [];
    this.phantomPositions = [];
    this.targetCurrencies = ['ADA', 'APE', 'DOT', 'GALA']; // High variance currencies first
    this.cleanupLog = [];
  }

  async initialize() {
    console.log('🚨 PHANTOM POSITION CLEANUP SYSTEM INITIALIZING...');
    
    // Initialize Redis client
    this.redisClient = redis.createClient({ url: 'redis://redis:6379' });
    await this.redisClient.connect();
    console.log('✅ Redis connected');
    
    // Initialize exchange
    this.exchange = config.exchanges.bitbank.instance;
    console.log('✅ Exchange API connected');
    
    // Create backup directory
    const backupDir = path.join(__dirname, 'phantom_position_backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    
    console.log('✅ Phantom Position Cleanup System ready');
  }

  async getLiveExchangeBalances() {
    console.log('📊 Fetching live exchange balances...');
    const balance = await this.exchange.fetchBalance();
    
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
    
    console.log(`✅ Found ${Object.keys(nonZeroBalances).length} non-zero exchange balances`);
    return nonZeroBalances;
  }

  async getRedisPositionSummaries() {
    console.log('🔍 Scanning Redis position summaries...');
    const keys = await this.redisClient.keys('summary:trade:*');
    console.log(`Found ${keys.length} summary:trade keys`);
    
    const positionsByCurrency = {};
    
    for (const key of keys) {
      try {
        const data = await this.redisClient.hGetAll(key);
        const netPosition = parseFloat(data.netPosition || 0);
        
        if (netPosition > 0) {
          // Extract currency from key: summary:trade:bitbank:CURRENCY/JPY:STRATEGY
          const keyParts = key.split(':');
          if (keyParts.length >= 4) {
            const pair = keyParts[3];
            const currency = pair.split('/')[0];
            const strategy = keyParts[4] || 'UNKNOWN';
            
            if (!positionsByCurrency[currency]) {
              positionsByCurrency[currency] = [];
            }
            
            positionsByCurrency[currency].push({
              key,
              strategy,
              netPosition,
              buyAmount: parseFloat(data.buyAmount || 0),
              sellAmount: parseFloat(data.sellAmount || 0),
              avgBuyPrice: parseFloat(data.avgBuyPrice || 0),
              updatedAt: data.updatedAt,
              fullData: data
            });
          }
        }
      } catch (error) {
        console.error(`Error processing key ${key}:`, error.message);
      }
    }
    
    console.log(`✅ Organized positions for ${Object.keys(positionsByCurrency).length} currencies`);
    return positionsByCurrency;
  }

  async identifyPhantomPositions(exchangeBalances, redisPositions) {
    console.log('👻 Identifying phantom positions...');
    
    const phantoms = [];
    const legitimatePositions = [];
    
    for (const [currency, positions] of Object.entries(redisPositions)) {
      const exchangeBalance = exchangeBalances[currency]?.total || 0;
      const totalRedisPosition = positions.reduce((sum, pos) => sum + pos.netPosition, 0);
      
      const analysis = {
        currency,
        exchangeBalance,
        totalRedisPosition,
        discrepancy: totalRedisPosition - exchangeBalance,
        isPhantom: false,
        phantomType: 'none',
        positions
      };
      
      // Determine phantom type
      if (exchangeBalance === 0 && totalRedisPosition > 0) {
        analysis.isPhantom = true;
        analysis.phantomType = 'zombie'; // Complete phantom - nothing on exchange
      } else if (totalRedisPosition > exchangeBalance * 1.1) { // Allow 10% tolerance
        analysis.isPhantom = true;
        analysis.phantomType = 'inflated'; // Partially phantom - over-recorded
      }
      
      if (analysis.isPhantom) {
        phantoms.push(analysis);
      } else {
        legitimatePositions.push(analysis);
      }
    }
    
    console.log(`👻 Found ${phantoms.length} phantom currencies`);
    console.log(`✅ Found ${legitimatePositions.length} legitimate currencies`);
    
    return { phantoms, legitimatePositions };
  }

  async backupPhantomData(phantomAnalysis) {
    console.log('💾 Creating phantom position backup...');
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFilename = `phantom-positions-backup-${timestamp}.json`;
    const backupPath = path.join(__dirname, 'phantom_position_backups', backupFilename);
    
    const backupData = {
      timestamp: new Date().toISOString(),
      totalPhantomCurrencies: phantomAnalysis.length,
      phantomPositions: phantomAnalysis,
      metadata: {
        purpose: 'Phantom position cleanup backup',
        systemState: 'Emergency balance investigation',
        cleanupPhase: 'Pre-deletion backup'
      }
    };
    
    fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));
    console.log(`✅ Backup saved: ${backupFilename}`);
    
    this.backupData = backupData;
    return backupPath;
  }

  async generateCleanupReport(phantoms, legitimatePositions) {
    console.log('\n📋 PHANTOM POSITION CLEANUP REPORT');
    console.log('=' .repeat(60));
    
    console.log(`\n🎯 TARGET CURRENCIES (High Variance):`);
    this.targetCurrencies.forEach(currency => {
      const phantom = phantoms.find(p => p.currency === currency);
      const legitimate = legitimatePositions.find(p => p.currency === currency);
      
      if (phantom) {
        console.log(`❌ ${currency}: PHANTOM (${phantom.phantomType}) - Redis: ${phantom.totalRedisPosition.toFixed(6)}, Exchange: ${phantom.exchangeBalance}`);
      } else if (legitimate) {
        console.log(`✅ ${currency}: LEGITIMATE - Redis: ${legitimate.totalRedisPosition.toFixed(6)}, Exchange: ${legitimate.exchangeBalance}`);
      } else {
        console.log(`⚪ ${currency}: NO POSITIONS`);
      }
    });
    
    console.log(`\n👻 ALL PHANTOM POSITIONS:`);
    phantoms.forEach(phantom => {
      console.log(`${phantom.currency}: ${phantom.phantomType.toUpperCase()} - Redis: ${phantom.totalRedisPosition.toFixed(6)}, Exchange: ${phantom.exchangeBalance}, Strategies: ${phantom.positions.length}`);
    });
    
    console.log(`\n📊 CLEANUP SUMMARY:`);
    console.log(`Total currencies analyzed: ${phantoms.length + legitimatePositions.length}`);
    console.log(`Phantom currencies found: ${phantoms.length}`);
    console.log(`Legitimate currencies: ${legitimatePositions.length}`);
    console.log(`High-priority phantoms: ${phantoms.filter(p => this.targetCurrencies.includes(p.currency)).length}/4`);
    
    return {
      totalAnalyzed: phantoms.length + legitimatePositions.length,
      phantomCount: phantoms.length,
      legitimateCount: legitimatePositions.length,
      highPriorityPhantoms: phantoms.filter(p => this.targetCurrencies.includes(p.currency)).length
    };
  }

  async executeCleanup(phantoms) {
    console.log('\n🧹 EXECUTING PHANTOM POSITION CLEANUP...');
    
    // Start with high-priority currencies
    const highPriorityPhantoms = phantoms.filter(p => this.targetCurrencies.includes(p.currency));
    const otherPhantoms = phantoms.filter(p => !this.targetCurrencies.includes(p.currency));
    
    const cleanupOrder = [...highPriorityPhantoms, ...otherPhantoms];
    
    for (const phantom of cleanupOrder) {
      console.log(`\n🎯 Cleaning up ${phantom.currency} (${phantom.phantomType})...`);
      
      for (const position of phantom.positions) {
        console.log(`  Removing: ${position.key}`);
        
        // Log the action
        this.cleanupLog.push({
          timestamp: new Date().toISOString(),
          action: 'DELETE',
          key: position.key,
          currency: phantom.currency,
          strategy: position.strategy,
          netPosition: position.netPosition,
          reason: phantom.phantomType
        });
        
        // TODO: Execute actual deletion
        // await this.redisClient.del(position.key);
        console.log(`    ⚠️ DELETION PLANNED (not executed yet)`);
      }
      
      console.log(`✅ ${phantom.currency} cleanup planned (${phantom.positions.length} positions)`);
    }
    
    console.log(`\n✅ Cleanup plan generated for ${cleanupOrder.length} phantom currencies`);
    return this.cleanupLog;
  }

  async run() {
    try {
      await this.initialize();
      
      console.log('\n🔍 PHASE 1: DATA COLLECTION');
      const exchangeBalances = await this.getLiveExchangeBalances();
      const redisPositions = await this.getRedisPositionSummaries();
      
      console.log('\n🔬 PHASE 2: PHANTOM ANALYSIS');
      const { phantoms, legitimatePositions } = await this.identifyPhantomPositions(exchangeBalances, redisPositions);
      
      console.log('\n💾 PHASE 3: BACKUP CREATION');
      const backupPath = await this.backupPhantomData(phantoms);
      
      console.log('\n📋 PHASE 4: CLEANUP PLANNING');
      const reportSummary = await this.generateCleanupReport(phantoms, legitimatePositions);
      const cleanupPlan = await this.executeCleanup(phantoms);
      
      console.log('\n🎯 PHANTOM CLEANUP SYSTEM COMPLETE');
      console.log(`Backup: ${backupPath}`);
      console.log(`Report: ${JSON.stringify(reportSummary, null, 2)}`);
      
      await this.redisClient.disconnect();
      
      return {
        backupPath,
        reportSummary,
        cleanupPlan,
        phantoms,
        legitimatePositions
      };
      
    } catch (error) {
      console.error('💥 Phantom cleanup failed:', error.message);
      console.error(error.stack);
      
      if (this.redisClient) {
        await this.redisClient.disconnect();
      }
      
      throw error;
    }
  }
}

// Execute if run directly
if (require.main === module) {
  const cleaner = new PhantomPositionCleaner();
  cleaner.run().catch(console.error);
}

module.exports = PhantomPositionCleaner;