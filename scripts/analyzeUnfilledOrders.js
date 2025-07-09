/**
 * 未約定オーダーの価格乖離分析
 */
require('dotenv').config();
const ccxt = require('ccxt');

async function analyzeUnfilledOrders() {
  try {
    console.log('=== 未約定オーダー価格乖離分析 ===');
    console.log(`分析時刻: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);

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

    // 現在価格を取得
    console.log('\n1. 現在価格取得中...');
    const symbols = ['BTC/JPY', 'ETH/JPY', 'XRP/JPY', 'LTC/JPY', 'XYM/JPY', 'ADA/JPY', 'DOT/JPY', 'LINK/JPY', 'MKR/JPY', 'ENJ/JPY', 'MATIC/JPY', 'ATOM/JPY', 'SAND/JPY', 'AXS/JPY', 'RENDER/JPY', 'OP/JPY', 'ARB/JPY', 'QTUM/JPY', 'FLR/JPY', 'GALA/JPY', 'OMG/JPY'];

    const tickers = {};
    for (const symbol of symbols) {
      try {
        const ticker = await exchange.fetchTicker(symbol);
        tickers[symbol] = ticker;
        await new Promise(resolve => setTimeout(resolve, 100)); // API制限回避
      } catch (err) {
        // 通貨ペアが存在しない場合はスキップ
      }
    }

    // オープンオーダーを取得して分析
    console.log('\n2. オープンオーダー分析中...');
    const orderAnalysis = [];
    let totalOrders = 0;
    let ordersAfter22 = 0;

    for (const symbol of symbols) {
      try {
        const orders = await exchange.fetchOpenOrders(symbol);
        const currentPrice = tickers[symbol]?.last;

        for (const order of orders) {
          totalOrders++;

          // オーダー作成時刻を日本時間で確認
          const orderTime = new Date(order.timestamp);
          const japanTime = new Date(orderTime.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
          const hour = japanTime.getHours();

          // 22時以降のオーダーかチェック
          if (hour >= 22 || hour < 6) {
            ordersAfter22++;

            const divergence = currentPrice ? ((order.price - currentPrice) / currentPrice * 100).toFixed(2) : 'N/A';
            const age = Math.floor((Date.now() - order.timestamp) / (1000 * 60 * 60));

            orderAnalysis.push({
              symbol: order.symbol,
              id: order.id,
              side: order.side,
              type: order.type,
              orderPrice: order.price,
              currentPrice: currentPrice || 0,
              divergence: divergence,
              amount: order.amount,
              remaining: order.remaining,
              created: japanTime.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
              age: age
            });
          }
        }

        await new Promise(resolve => setTimeout(resolve, 100)); // API制限回避
      } catch (err) {
        // エラーはスキップ
      }
    }

    // 価格乖離率でソート（大きい順）
    orderAnalysis.sort((a, b) => {
      const divA = parseFloat(a.divergence) || -999;
      const divB = parseFloat(b.divergence) || -999;
      return divA - divB;
    });

    console.log(`\n総オーダー数: ${totalOrders}件`);
    console.log(`22時以降のオーダー数: ${ordersAfter22}件`);

    // 乖離率別に分類
    console.log('\n=== 価格乖離率分析 ===');
    const ranges = [
      { min: -100, max: -10, label: '現在価格より10%以上安い' },
      { min: -10, max: -5, label: '現在価格より5-10%安い' },
      { min: -5, max: -3, label: '現在価格より3-5%安い' },
      { min: -3, max: -1, label: '現在価格より1-3%安い' },
      { min: -1, max: 0, label: '現在価格より0-1%安い' },
      { min: 0, max: 100, label: '現在価格より高い（異常）' }
    ];

    for (const range of ranges) {
      const count = orderAnalysis.filter(o => {
        const div = parseFloat(o.divergence);
        return !isNaN(div) && div >= range.min && div < range.max;
      }).length;

      if (count > 0) {
        console.log(`${range.label}: ${count}件`);
      }
    }

    // 詳細表示（乖離率が大きいものから上位20件）
    console.log('\n=== 価格乖離率詳細（上位20件） ===');
    const topOrders = orderAnalysis.slice(0, 20);

    topOrders.forEach((order, index) => {
      console.log(`\n[${index + 1}] ${order.symbol} - ${order.side.toUpperCase()}`);
      console.log(`  注文価格: ¥${order.orderPrice.toLocaleString()}`);
      console.log(`  現在価格: ¥${order.currentPrice.toLocaleString()}`);
      console.log(`  乖離率: ${order.divergence}%`);
      console.log(`  数量: ${order.amount} (残り: ${order.remaining})`);
      console.log(`  経過時間: ${order.age}時間`);
    });

    // 通貨別統計
    console.log('\n=== 通貨別平均乖離率 ===');
    const bySymbol = {};
    orderAnalysis.forEach(order => {
      if (!bySymbol[order.symbol]) {
        bySymbol[order.symbol] = { count: 0, totalDiv: 0 };
      }
      const div = parseFloat(order.divergence);
      if (!isNaN(div)) {
        bySymbol[order.symbol].count++;
        bySymbol[order.symbol].totalDiv += div;
      }
    });

    Object.entries(bySymbol)
      .map(([symbol, data]) => ({
        symbol,
        avgDiv: (data.totalDiv / data.count).toFixed(2),
        count: data.count
      }))
      .sort((a, b) => parseFloat(a.avgDiv) - parseFloat(b.avgDiv))
      .forEach(item => {
        console.log(`${item.symbol}: 平均乖離率 ${item.avgDiv}% (${item.count}件)`);
      });

    console.log('\n✅ 分析完了');

  } catch (error) {
    console.error('❌ エラー:', error.message);
  }
}

analyzeUnfilledOrders();