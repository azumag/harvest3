/**
 * 既存の不整合ポジション一括修復スクリプト
 * 約定済みなのにRedisでopenのままのポジションを検出・修復
 */
require('dotenv').config();
const ccxt = require('ccxt');
const { client, initRedisClient } = require('./src/database/redisDatabase');

async function fixInconsistentPositions() {
  try {
    await initRedisClient();
    
    console.log('=== 不整合ポジション一括修復開始 ===');
    
    // Bitbank取引所インスタンス
    const exchange = new ccxt.bitbank({
      apiKey: process.env.BB_API_KEY,
      secret: process.env.BB_API_SECRET,
      sandbox: false,
      options: {
        enableUnifiedAccount: false,
        enableUnifiedMargin: false,
        defaultType: 'spot'
      }
    });
    
    await exchange.loadMarkets();
    
    // 全てのpositionキーを取得
    console.log('\n1. 全ポジション検索中...');
    const allPositionKeys = await client.keys('position:*');
    console.log(`発見したポジション数: ${allPositionKeys.length}`);
    
    if (allPositionKeys.length === 0) {
      console.log('ポジションが見つかりませんでした。');
      return;
    }
    
    const results = {
      checked: 0,
      inconsistent: 0,
      fixed: 0,
      errors: 0,
      details: []
    };
    
    console.log('\n2. 各ポジションの整合性チェック...');
    
    for (const positionKey of allPositionKeys) {
      try {
        results.checked++;
        
        // ポジションデータを取得
        const positionData = await client.hgetall(positionKey);
        
        if (!positionData || !positionData.orderId || !positionData.symbol) {
          console.log(`  スキップ: 不完全なデータ (${positionKey})`);
          continue;
        }
        
        const { orderId, symbol, exchangeId, status } = positionData;
        
        // 取引所での注文状況を確認
        try {
          const order = await exchange.fetchOrder(orderId, symbol);
          const isInconsistent = (status === 'open' && order.status === 'closed' && order.filled === order.amount);
          
          if (isInconsistent) {
            results.inconsistent++;
            console.log(`  🚨 不整合発見: ${orderId} (Redis: ${status}, Exchange: ${order.status}, 約定量: ${order.filled})`);
            
            // ポジションをクローズして削除
            try {
              // まずstatusをclosedに更新
              await client.hset(positionKey, 'status', 'closed', 'closedAt', Date.now(), 'updatedAt', Date.now());
              
              // 履歴保存のためにMongoDB保存を試行（エラーでも継続）
              try {
                const { savePositionHistoryToMongoDB } = require('./src/database/redisDatabase');
                await savePositionHistoryToMongoDB({
                  ...positionData,
                  status: 'closed',
                  closedAt: Date.now(),
                  updatedAt: Date.now()
                });
              } catch (historyError) {
                console.warn(`    履歴保存失敗: ${historyError.message}`);
              }
              
              // Redisから削除
              await client.del(positionKey);
              
              results.fixed++;
              results.details.push({
                orderId,
                symbol,
                positionKey,
                action: 'closed_and_deleted',
                exchangeStatus: order.status,
                filled: order.filled,
                amount: order.amount
              });
              
              console.log(`  ✅ 修復完了: ${orderId} (ポジション削除)`);
              
            } catch (fixError) {
              results.errors++;
              console.error(`  ❌ 修復失敗: ${orderId} - ${fixError.message}`);
              
              results.details.push({
                orderId,
                symbol,
                positionKey,
                action: 'fix_failed',
                error: fixError.message
              });
            }
          } else {
            console.log(`  ✅ 整合性OK: ${orderId} (Redis: ${status}, Exchange: ${order.status})`);
          }
          
        } catch (orderError) {
          if (orderError.message.includes('Order not found') || orderError.message.includes('order_not_found')) {
            // 注文が見つからない場合も不整合として扱う
            results.inconsistent++;
            console.log(`  🚨 注文未発見: ${orderId} (削除済み注文がRedisに残存)`);
            
            try {
              await client.del(positionKey);
              results.fixed++;
              console.log(`  ✅ 修復完了: ${orderId} (未発見注文のポジション削除)`);
              
              results.details.push({
                orderId,
                symbol,
                positionKey,
                action: 'deleted_orphan',
                reason: 'order_not_found'
              });
            } catch (deleteError) {
              results.errors++;
              console.error(`  ❌ 削除失敗: ${orderId} - ${deleteError.message}`);
            }
          } else {
            console.warn(`  ⚠️ 注文確認エラー: ${orderId} - ${orderError.message}`);
          }
        }
        
        // API制限回避のための短い待機
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        results.errors++;
        console.error(`  ❌ 処理エラー: ${positionKey} - ${error.message}`);
      }
    }
    
    console.log('\n=== 修復結果サマリー ===');
    console.log(`チェック済み: ${results.checked}件`);
    console.log(`不整合発見: ${results.inconsistent}件`);
    console.log(`修復成功: ${results.fixed}件`);
    console.log(`エラー: ${results.errors}件`);
    
    if (results.details.length > 0) {
      console.log('\n=== 修復詳細 ===');
      results.details.forEach((detail, index) => {
        console.log(`[${index + 1}] ${detail.orderId} (${detail.symbol}): ${detail.action}`);
        if (detail.error) {
          console.log(`    エラー: ${detail.error}`);
        }
      });
    }
    
    console.log('\n✅ 不整合ポジション一括修復完了');
    
  } catch (error) {
    console.error('❌ 修復処理エラー:', error.message);
  } finally {
    if (client) {
      await client.quit();
    }
  }
}

fixInconsistentPositions();