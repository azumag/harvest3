/**
 * XYM/JPY の残高とオープンオーダーを確認するスクリプト
 */
require('dotenv').config();
const ccxt = require('ccxt');

async function checkXymBalance() {
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

    console.log('=== XYM/JPY 詳細調査 ===');
    
    // マーケットをロード
    await exchange.loadMarkets();
    
    // オープンオーダーを取得
    const openOrders = await exchange.fetchOpenOrders('XYM/JPY');
    console.log(`\nオープンオーダー数: ${openOrders.length}`);
    
    let totalBuyOrders = 0;
    let totalSellOrders = 0;
    
    openOrders.forEach((order, index) => {
      console.log(`[${index + 1}] ${order.side} ${order.amount} XYM @ ¥${order.price} (ID: ${order.id})`);
      if (order.side === 'buy') {
        totalBuyOrders += order.amount;
      } else {
        totalSellOrders += order.amount;
      }
    });
    
    console.log(`\n買い注文合計: ${totalBuyOrders} XYM`);
    console.log(`売り注文合計: ${totalSellOrders} XYM`);

    // 残高を取得
    console.log('\n=== XYM 残高詳細 ===');
    const balance = await exchange.fetchBalance();
    const xymBalance = balance['XYM'];
    
    if (xymBalance) {
      console.log(`総残高: ${xymBalance.total} XYM`);
      console.log(`利用可能: ${xymBalance.free} XYM`);
      console.log(`拘束中: ${xymBalance.used} XYM`);
      
      console.log('\n=== 分析 ===');
      console.log(`実際利用可能: ${xymBalance.free} XYM`);
      console.log(`売り注文で拘束: ${totalSellOrders} XYM`);
      console.log(`差分: ${xymBalance.free - totalSellOrders} XYM`);
    } else {
      console.log('XYM残高: 0 または情報なし');
    }

  } catch (error) {
    console.error('エラー:', error.message);
  }
}

checkXymBalance();