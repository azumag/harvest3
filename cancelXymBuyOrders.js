/**
 * XYM/JPY 未約定買い注文のキャンセル（簡素版）
 */
require('dotenv').config();
const ccxt = require('ccxt');

async function cancelXymBuyOrders() {
  try {
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

    console.log('=== XYM/JPY 買い注文キャンセル ===');
    
    // マーケットをロード
    await exchange.loadMarkets();
    
    // 未約定買い注文のキャンセル
    const buyOrderIds = ['47103825993', '47103832197'];
    
    for (const orderId of buyOrderIds) {
      try {
        console.log(`\\n買い注文キャンセル: ${orderId}`);
        const cancelResult = await exchange.cancelOrder(orderId, 'XYM/JPY');
        console.log('キャンセル結果:', cancelResult.status);
      } catch (error) {
        console.error(`注文 ${orderId} のキャンセル失敗:`, error.message);
      }
    }
    
    // 修復後の状況確認
    console.log('\\n=== キャンセル後状況確認 ===');
    
    const openOrders = await exchange.fetchOpenOrders('XYM/JPY');
    console.log(`残りのオープンオーダー数: ${openOrders.length}`);
    
    openOrders.forEach((order, index) => {
      console.log(`[${index + 1}] ${order.side} ${order.amount} XYM @ ¥${order.price} (ID: ${order.id})`);
    });
    
    const balance = await exchange.fetchBalance();
    const xymBalance = balance['XYM'];
    
    if (xymBalance) {
      console.log(`\\nXYM残高:`);
      console.log(`  総残高: ${xymBalance.total}`);
      console.log(`  利用可能: ${xymBalance.free}`);
      console.log(`  拘束中: ${xymBalance.used}`);
    }
    
    console.log('\\n✅ XYM/JPY 買い注文キャンセル完了');
    
  } catch (error) {
    console.error('❌ エラー:', error.message);
  }
}

cancelXymBuyOrders();