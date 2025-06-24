/**
 * XYMポジションの詳細調査 - 取引所データとRedis記録の照合
 */
require('dotenv').config();
const ccxt = require('ccxt');

async function investigateXymOrders() {
  try {
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

    console.log('=== XYM注文詳細調査 ===');
    await exchange.loadMarkets();

    // Redis内のポジションと対応する注文ID
    const positionOrderIds = [
      '47086243329', // MA - 52.3926 XYM
      '47091302770', // MA - 0.4294 XYM  
      '47092734024', // MA - 26.0185 XYM
      '47086250526', // RSI - 47.0909 XYM
      '47098510771', // MA - 150.1935 XYM
      '47090090624'  // MA - 13.2627 XYM
    ];
    
    const deletedOrderIds = [
      '47103825993', // OSCILLATOR - 削除済み
      '47103832197'  // RSI - 削除済み
    ];

    console.log('\n=== Redis記録との照合調査 ===');
    
    // 各注文の状況を詳細調査
    for (const orderId of positionOrderIds) {
      try {
        console.log(`\n--- 注文ID: ${orderId} ---`);
        
        // 注文詳細を取得
        const order = await exchange.fetchOrder(orderId, 'XYM/JPY');
        console.log(`ステータス: ${order.status}`);
        console.log(`サイド: ${order.side}`);
        console.log(`数量: ${order.amount}`);
        console.log(`約定量: ${order.filled || 0}`);
        console.log(`未約定量: ${order.remaining || 0}`);
        console.log(`価格: ${order.price}`);
        console.log(`実行価格: ${order.average || 'N/A'}`);
        console.log(`作成日: ${new Date(order.timestamp).toLocaleString()}`);
        
        // Redis記録との不整合チェック
        if (order.status !== 'closed' && order.filled > 0) {
          console.log(`🚨 部分約定の可能性: 約定量${order.filled} vs 未約定量${order.remaining}`);
        }
        
        if (order.status === 'open' && order.filled === 0) {
          console.log(`⚠️ 完全未約定なのにRedisではopenポジション`);
        }
        
        if (order.status === 'closed' && order.filled === order.amount) {
          console.log(`✅ 完全約定済み - Redisのopen記録が不正`);
        }
        
      } catch (error) {
        console.error(`注文 ${orderId} の取得失敗:`, error.message);
      }
    }
    
    console.log('\n=== 削除済み注文の確認 ===');
    for (const orderId of deletedOrderIds) {
      try {
        const order = await exchange.fetchOrder(orderId, 'XYM/JPY');
        console.log(`削除済み注文 ${orderId}: ${order.status} (約定量: ${order.filled || 0})`);
      } catch (error) {
        console.log(`削除済み注文 ${orderId}: ${error.message}`);
      }
    }
    
    // 現在の取引履歴との照合
    console.log('\n=== 最近の取引履歴 ===');
    const trades = await exchange.fetchMyTrades('XYM/JPY', undefined, 20);
    const recentTrades = trades.filter(trade => 
      positionOrderIds.includes(trade.order) || deletedOrderIds.includes(trade.order)
    );
    
    console.log(`関連する取引数: ${recentTrades.length}`);
    recentTrades.forEach(trade => {
      console.log(`取引: ${trade.order} - ${trade.side} ${trade.amount} XYM @ ¥${trade.price} (${new Date(trade.timestamp).toLocaleString()})`);
    });
    
  } catch (error) {
    console.error('❌ 調査エラー:', error.message);
  }
}

investigateXymOrders();