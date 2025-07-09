/**
 * 22時以降の未約定オープンオーダーチェック
 */
require('dotenv').config();
const ccxt = require('ccxt');

async function checkOpenOrdersAfter22() {
  try {
    console.log('=== 22時以降の未約定オープンオーダーチェック ===');
    console.log(`現在時刻: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);

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

    // 取引所側の全オープンオーダーを取得
    console.log('\n1. 取引所側オープンオーダー取得中...');
    const symbols = ['BTC/JPY', 'ETH/JPY', 'XRP/JPY', 'LTC/JPY', 'XYM/JPY', 'ADA/JPY', 'DOT/JPY', 'LINK/JPY', 'MKR/JPY', 'ENJ/JPY', 'MATIC/JPY', 'ATOM/JPY', 'SAND/JPY', 'AXS/JPY', 'RENDER/JPY', 'OP/JPY', 'ARB/JPY', 'QTUM/JPY', 'FLR/JPY', 'GALA/JPY', 'OMG/JPY'];

    let totalOrders = 0;
    let ordersAfter22 = 0;
    const ordersDetail = [];

    for (const symbol of symbols) {
      try {
        const orders = await exchange.fetchOpenOrders(symbol);

        for (const order of orders) {
          totalOrders++;

          // オーダー作成時刻を日本時間で確認
          const orderTime = new Date(order.timestamp);
          const japanTime = new Date(orderTime.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
          const hour = japanTime.getHours();

          // 22時以降のオーダーかチェック
          if (hour >= 22 || hour < 6) { // 22時から朝6時までを深夜とする
            ordersAfter22++;
            ordersDetail.push({
              symbol: order.symbol,
              id: order.id,
              side: order.side,
              type: order.type,
              price: order.price,
              amount: order.amount,
              remaining: order.remaining,
              created: japanTime.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
              hour: hour,
              age: Math.floor((Date.now() - order.timestamp) / (1000 * 60 * 60)) // 時間単位
            });
          }
        }

        if (orders.length > 0) {
          console.log(`  ${symbol}: ${orders.length}件`);
        }

        await new Promise(resolve => setTimeout(resolve, 100)); // API制限回避
      } catch (err) {
        // 通貨ペアが存在しない場合はスキップ
      }
    }

    console.log(`\n総オープンオーダー数: ${totalOrders}件`);
    console.log(`22時以降のオーダー数: ${ordersAfter22}件`);

    if (ordersAfter22 > 0) {
      console.log('\n=== 22時以降のオーダー詳細 ===');
      ordersDetail.sort((a, b) => a.age - b.age); // 新しい順にソート

      ordersDetail.forEach((order, index) => {
        console.log(`\n[${index + 1}] ${order.symbol} - ${order.side.toUpperCase()}`);
        console.log(`  ID: ${order.id}`);
        console.log(`  価格: ¥${order.price.toLocaleString()}`);
        console.log(`  数量: ${order.amount} (残り: ${order.remaining})`);
        console.log(`  作成時刻: ${order.created} (${order.hour}時)`);
        console.log(`  経過時間: ${order.age}時間`);
      });

      // 統計情報
      console.log('\n=== 統計情報 ===');
      const bySide = ordersDetail.reduce((acc, order) => {
        acc[order.side] = (acc[order.side] || 0) + 1;
        return acc;
      }, {});
      console.log('買い/売り別:', bySide);

      const bySymbol = ordersDetail.reduce((acc, order) => {
        acc[order.symbol] = (acc[order.symbol] || 0) + 1;
        return acc;
      }, {});
      console.log('通貨ペア別:', bySymbol);

      const avgAge = ordersDetail.reduce((sum, order) => sum + order.age, 0) / ordersDetail.length;
      console.log(`平均経過時間: ${avgAge.toFixed(1)}時間`);
    }

    console.log('\n✅ チェック完了');

  } catch (error) {
    console.error('❌ エラー:', error.message);
  }
}

checkOpenOrdersAfter22();