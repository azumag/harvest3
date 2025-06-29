#!/usr/bin/env node

/**
 * Debug script to test position close mechanism
 */

const { closeAndCleanupPosition, getPositionRedis } = require('./src/database/redisDatabase');

async function testPositionClose() {
  console.log('🔍 Position Close Debug Test');
  console.log('============================');
  
  // Test the failing position IDs
  const failingPositions = [
    'bitbank:LINK/JPY:MULTI_INDICATOR:47265679381',
    'bitbank:ASTR/JPY:MULTI_INDICATOR:47265736969',
    'bitbank:BTC/JPY:MULTI_INDICATOR:47265479997',
    'bitbank:CHZ/JPY:OSCILLATOR:47265508010'
  ];
  
  for (const positionKey of failingPositions) {
    console.log(`\n📋 Testing position: ${positionKey}`);
    
    try {
      // First check if position exists
      const positionData = await getPositionRedis(positionKey);
      if (!positionData) {
        console.log(`❌ Position not found in Redis`);
        continue;
      }
      
      console.log(`✅ Position found:`, {
        status: positionData.status,
        amount: positionData.amount,
        entryPrice: positionData.entryPrice,
        createdAt: new Date(positionData.createdAt),
        updatedAt: new Date(positionData.updatedAt)
      });
      
      // Try to close the position
      console.log(`🔄 Attempting to close position...`);
      const closeResult = await closeAndCleanupPosition(positionKey, { 
        saveHistory: true,
        delayHours: 0 
      });
      
      if (closeResult.success) {
        console.log(`✅ Position close SUCCESS:`, closeResult);
      } else {
        console.log(`❌ Position close FAILED:`, closeResult);
      }
      
    } catch (error) {
      console.log(`💥 Exception during position close:`, error.message);
      console.log(`Stack trace:`, error.stack);
    }
  }
}

// Initialize Redis connection first
const { initialize } = require('./src/database/redisDatabase');

async function main() {
  try {
    await initialize();
    console.log('✅ Redis initialized');
    await testPositionClose();
  } catch (error) {
    console.error('💥 Failed to initialize:', error);
  } finally {
    process.exit(0);
  }
}

main();