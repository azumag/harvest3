/**
 * XYM/JPY 未約定買い注文のキャンセルとRedis同期修復
 */
require('dotenv').config();
const ccxt = require('ccxt');
const { client, initRedisClient } = require('./src/database/redisClient');

async function fixXymOrders() {
  try {
    // Redis接続初期化
    await initRedisClient();
    
    // Bitbank取引所インスタンスを作成
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

    console.log('=== XYM/JPY 修復開始 ===');
    
    // マーケットをロード
    await exchange.loadMarkets();
    
    // 未約定買い注文のキャンセル
    const buyOrderIds = ['47103825993', '47103832197'];
    
    for (const orderId of buyOrderIds) {
      try {
        console.log(`\\n1. 買い注文キャンセル: ${orderId}`);
        const cancelResult = await exchange.cancelOrder(orderId, 'XYM/JPY');
        console.log('キャンセル結果:', cancelResult.status);
        
        // 対応するRedisポジションを削除
        const positionKey = `position:bitbank:XYM/JPY:OSCILLATOR:${orderId}`;
        const rsiPositionKey = `position:bitbank:XYM/JPY:RSI:${orderId}`;
        
        // どちらのキーが存在するか確認
        const oscillatorExists = await client.exists(positionKey);
        const rsiExists = await client.exists(rsiPositionKey);
        
        if (oscillatorExists) {
          await client.del(positionKey);
          console.log(`Redis ポジション削除: ${positionKey}`);
        }
        
        if (rsiExists) {
          await client.del(rsiPositionKey);
          console.log(`Redis ポジション削除: ${rsiPositionKey}`);
        }
        
        // 未約定注文も削除
        const pendingKeys = await client.keys(`pending_order:bitbank:XYM/JPY:*:${orderId}`);
        for (const key of pendingKeys) {
          await client.del(key);
          console.log(`Redis 未約定注文削除: ${key}`);
        }
        
      } catch (error) {
        console.error(`注文 ${orderId} のキャンセル失敗:`, error.message);
      }
    }
    
    // 修復後の状況確認
    console.log('\\n2. 修復後状況確認...');
    
    const openOrders = await exchange.fetchOpenOrders('XYM/JPY');
    console.log(`残りのオープンオーダー数: ${openOrders.length}`);
    
    const balance = await exchange.fetchBalance();
    const xymBalance = balance['XYM'];
    
    if (xymBalance) {
      console.log(`\\nXYM残高:`);
      console.log(`  総残高: ${xymBalance.total}`);
      console.log(`  利用可能: ${xymBalance.free}`);
      console.log(`  拘束中: ${xymBalance.used}`);
    }
    
    console.log('\\n✅ XYM/JPY 修復完了');
    
  } catch (error) {
    console.error('❌ エラー:', error.message);
  } finally {
    if (client) {
      await client.quit();
    }
  }
}

fixXymOrders();