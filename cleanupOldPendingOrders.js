/**
 * 古い未約定注文のクリーンアップスクリプト
 * Issue #191対応: 高度注文管理システム無効化により蓄積された古い注文を一括削除
 */
require('dotenv').config();
const ccxt = require('ccxt');
const { client, initRedisClient } = require('./src/database/redisClient');

async function cleanupOldPendingOrders() {
  try {
    await initRedisClient();
    console.log('=== 古い未約定注文クリーンアップ開始 ===');
    
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
    
    // 全ての未約定注文キーを取得
    const pendingOrderKeys = await client.keys('pending_order:*');
    console.log(`発見した未約定注文数: ${pendingOrderKeys.length}`);
    
    if (pendingOrderKeys.length === 0) {
      console.log('未約定注文が見つかりませんでした。');
      return;
    }
    
    const results = {
      checked: 0,
      cancelled: 0,
      deleted: 0,
      errors: 0,
      notFound: 0,
      details: []
    };
    
    const now = Date.now();
    const OLD_ORDER_THRESHOLD = 5 * 60 * 1000; // 5分以上古い注文を対象
    
    console.log('\n=== 各未約定注文の処理開始 ===');
    
    for (const pendingKey of pendingOrderKeys) {
      try {
        results.checked++;
        
        // 未約定注文データを取得
        const pendingData = await client.hgetall(pendingKey);
        
        if (!pendingData || !pendingData.orderId || !pendingData.symbol) {
          console.log(`  スキップ: 不完全なデータ (${pendingKey})`);
          await client.del(pendingKey);
          results.deleted++;
          continue;
        }
        
        const { orderId, symbol, timestamp } = pendingData;
        const orderAge = now - parseInt(timestamp);
        const ageHours = (orderAge / (1000 * 60 * 60)).toFixed(1);
        
        console.log(`チェック中: ${orderId} (${symbol}) - 経過時間: ${ageHours}時間`);
        
        // 古い注文のみ処理（5分以上）
        if (orderAge < OLD_ORDER_THRESHOLD) {
          console.log(`  スキップ: 新しい注文 (${ageHours}時間)`);
          continue;
        }
        
        try {
          // 取引所での注文状況確認
          const order = await exchange.fetchOrder(orderId, symbol);
          
          if (order.status === 'open') {
            // 未約定の場合はキャンセル
            console.log(`  🚨 古い未約定注文をキャンセル: ${orderId} (${ageHours}時間)`);
            await exchange.cancelOrder(orderId, symbol);
            results.cancelled++;
          } else if (order.status === 'closed' || order.status === 'canceled') {
            // 既に完了済みまたはキャンセル済み
            console.log(`  ✅ 既に処理済み: ${orderId} (${order.status})`);
          }
          
          // Redisから削除
          await client.del(pendingKey);
          results.deleted++;
          
          results.details.push({
            orderId,
            symbol,
            ageHours,
            status: order.status,
            action: order.status === 'open' ? 'cancelled' : 'cleaned'
          });
          
        } catch (orderError) {
          if (orderError.message.includes('Order not found') || orderError.message.includes('order_not_found')) {
            // 注文が見つからない場合（既に削除済み）
            console.log(`  ✅ 注文未発見（削除済み）: ${orderId}`);
            await client.del(pendingKey);
            results.deleted++;
            results.notFound++;
          } else {
            console.error(`  ❌ 注文確認エラー: ${orderId} - ${orderError.message}`);
            results.errors++;
          }
        }
        
        // API制限回避のための短い待機
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (error) {
        results.errors++;
        console.error(`  ❌ 処理エラー: ${pendingKey} - ${error.message}`);
      }
    }
    
    console.log('\n=== クリーンアップ結果サマリー ===');
    console.log(`チェック済み: ${results.checked}件`);
    console.log(`キャンセル実行: ${results.cancelled}件`);
    console.log(`Redis削除: ${results.deleted}件`);
    console.log(`未発見注文: ${results.notFound}件`);
    console.log(`エラー: ${results.errors}件`);
    
    if (results.details.length > 0) {
      console.log('\n=== 処理詳細 ===');
      results.details.forEach((detail, index) => {
        console.log(`[${index + 1}] ${detail.orderId} (${detail.symbol}): ${detail.action} - ${detail.ageHours}時間`);
      });
    }
    
    // 残存確認
    const remainingKeys = await client.keys('pending_order:*');
    console.log(`\n残存未約定注文数: ${remainingKeys.length}件`);
    
    console.log('\n✅ 古い未約定注文クリーンアップ完了');
    
  } catch (error) {
    console.error('❌ クリーンアップエラー:', error.message);
  } finally {
    if (client && client.isOpen) {
      await client.quit();
    }
  }
}

cleanupOldPendingOrders();