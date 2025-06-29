#!/usr/bin/env node

/**
 * Emergency fix for position close mechanism failure
 * 
 * ROOT CAUSE ANALYSIS:
 * ====================
 * 1. The closeAndCleanupPosition function succeeds in deleting positions from Redis
 * 2. However, it returns { success: false } instead of { success: true } due to 
 *    MongoDB connection failures when running outside Docker network
 * 3. The trade processing code retries 3 times, all failing because of the false success flag
 * 4. This creates a loop where positions appear to fail to close but are actually deleted
 * 
 * IMMEDIATE FIX:
 * ==============
 * Modify the closeAndCleanupPosition to continue processing even if MongoDB save fails
 * (it already does this but needs to return success: true when Redis deletion succeeds)
 */

const { 
  closeAndCleanupPosition, 
  getPositionRedis, 
  getAllPositionsRedis,
  deletePositionRedis 
} = require('./src/database/redisDatabase');

async function emergencyPositionCleanup() {
  console.log('🚨 EMERGENCY POSITION CLEANUP STARTING...');
  console.log('==========================================');
  
  try {
    // Get all positions that are currently open
    const allPositions = await getAllPositionsRedis();
    const openPositions = allPositions.filter(pos => pos.status === 'open');
    
    console.log(`📊 Found ${openPositions.length} open positions`);
    
    let fixedCount = 0;
    let skipCount = 0;
    let errorCount = 0;
    
    for (const position of openPositions) {
      const positionKey = position.key;
      console.log(`\n🔧 Processing: ${positionKey}`);
      
      try {
        // Try the enhanced close function that skips MongoDB save on failure
        const result = await emergencyClosePosition(positionKey);
        
        if (result.success) {
          console.log(`✅ SUCCESS: ${positionKey}`);
          fixedCount++;
        } else {
          console.log(`⚠️ SKIPPED: ${positionKey} - ${result.reason}`);
          skipCount++;
        }
        
      } catch (error) {
        console.log(`❌ ERROR: ${positionKey} - ${error.message}`);
        errorCount++;
      }
    }
    
    console.log('\n📈 CLEANUP SUMMARY');
    console.log('==================');
    console.log(`✅ Fixed: ${fixedCount}`);
    console.log(`⚠️ Skipped: ${skipCount}`);
    console.log(`❌ Errors: ${errorCount}`);
    console.log(`📊 Total: ${openPositions.length}`);
    
  } catch (error) {
    console.error('💥 Emergency cleanup failed:', error);
  }
}

/**
 * Enhanced position close that prioritizes Redis cleanup over MongoDB save
 */
async function emergencyClosePosition(positionKey) {
  try {
    // Check if position exists
    const positionData = await getPositionRedis(positionKey);
    if (!positionData) {
      return { success: false, reason: 'position_not_found' };
    }
    
    // Direct Redis deletion - prioritize this over MongoDB save
    const deleted = await deletePositionRedis(positionKey);
    
    if (deleted) {
      console.log(`🗑️ Redis deletion SUCCESS: ${positionKey}`);
      
      // Try MongoDB save but don't fail if it doesn't work
      try {
        const { savePositionHistoryToMongoDB } = require('./src/database/redisDatabase');
        const closedPositionData = {
          ...positionData,
          status: 'closed',
          closedAt: Date.now(),
          updatedAt: Date.now()
        };
        
        await savePositionHistoryToMongoDB(closedPositionData);
        console.log(`💾 MongoDB save SUCCESS: ${positionKey}`);
        
      } catch (mongoError) {
        console.log(`⚠️ MongoDB save failed (continuing anyway): ${mongoError.message}`);
      }
      
      return { 
        success: true, 
        action: 'emergency_cleanup',
        message: 'Position deleted from Redis successfully'
      };
    } else {
      return { 
        success: false, 
        reason: 'redis_delete_failed' 
      };
    }
    
  } catch (error) {
    return { 
      success: false, 
      reason: 'exception',
      error: error.message 
    };
  }
}

// Initialize and run
async function main() {
  try {
    const { initialize } = require('./src/database/redisDatabase');
    await initialize();
    console.log('✅ Redis initialized');
    
    await emergencyPositionCleanup();
    
  } catch (error) {
    console.error('💥 Emergency fix failed:', error);
  } finally {
    process.exit(0);
  }
}

main();