/**
 * closePrice が 0 または null の約定済みポジションを修正するスクリプト
 */
const { MongoClient } = require('mongodb');
const { config } = require('./src/config');

async function fixZeroClosePrices() {
  const mongoClient = new MongoClient(config.mongodb.url);
  
  try {
    await mongoClient.connect();
    console.log('MongoDB接続完了');
    
    const db = mongoClient.db(config.mongodb.database);
    const collection = db.collection('positions');
    
    // closePrice が 0 または null のポジションを検索
    const query = {
      status: 'closed',
      $or: [
        { closePrice: 0 },
        { closePrice: null },
        { closePrice: { $exists: false } }
      ]
    };
    
    const problematicPositions = await collection.find(query).toArray();
    console.log(`修正が必要なポジション数: ${problematicPositions.length}`);
    
    if (problematicPositions.length === 0) {
      console.log('修正が必要なポジションはありません');
      return;
    }
    
    let fixedCount = 0;
    
    for (const position of problematicPositions) {
      try {
        let newClosePrice = null;
        
        // 1. highestPrice を使用（利益確定の場合）
        if (position.highestPrice && position.highestPrice > 0) {
          newClosePrice = position.highestPrice;
          console.log(`[${position.symbol}] Using highestPrice: ${newClosePrice}`);
        }
        // 2. entryPrice を使用（フォールバック）
        else if (position.entryPrice && position.entryPrice > 0) {
          newClosePrice = position.entryPrice;
          console.log(`[${position.symbol}] Using entryPrice as fallback: ${newClosePrice}`);
        }
        // 3. currentPrice を使用（最終フォールバック）
        else if (position.currentPrice && position.currentPrice > 0) {
          newClosePrice = position.currentPrice;
          console.log(`[${position.symbol}] Using currentPrice as final fallback: ${newClosePrice}`);
        }
        else {
          console.warn(`[${position.symbol}] No valid price found, skipping`);
          continue;
        }
        
        // closePriceを更新
        const updateResult = await collection.updateOne(
          { _id: position._id },
          { 
            $set: { 
              closePrice: newClosePrice,
              fixedAt: new Date(),
              fixedReason: 'closePrice was zero/null, used ' + 
                          (position.highestPrice > 0 ? 'highestPrice' : 
                           position.entryPrice > 0 ? 'entryPrice' : 'currentPrice')
            }
          }
        );
        
        if (updateResult.modifiedCount > 0) {
          console.log(`✅ [${position.symbol}] closePrice updated: 0 → ${newClosePrice}`);
          fixedCount++;
        }
        
      } catch (error) {
        console.error(`❌ [${position.symbol}] 修正エラー:`, error.message);
      }
    }
    
    console.log(`\n修正完了: ${fixedCount}/${problematicPositions.length} ポジション`);
    
  } catch (error) {
    console.error('スクリプト実行エラー:', error);
  } finally {
    await mongoClient.close();
    console.log('MongoDB接続を閉じました');
  }
}

// 実行確認
console.log('⚠️  このスクリプトは約定済みポジションのclosePriceを修正します');
console.log('実行を続けますか？ (5秒後に自動実行)');

setTimeout(() => {
  fixZeroClosePrices().catch(console.error);
}, 5000);