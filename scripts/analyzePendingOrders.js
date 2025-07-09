const redis = require('redis');
const ccxt = require('ccxt');
const { table } = require('console');

async function analyzePendingOrders() {
  const client = redis.createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379'
  });

  await client.connect();

  try {
    console.log('\n=== 未約定注文分析 ===\n');

    // 未約定注文のキーを取得
    const pendingOrderKeys = await client.keys('pending_order:*');
    console.log(`\n総未約定注文数: ${pendingOrderKeys.length}`);

    if (pendingOrderKeys.length === 0) {
      console.log('未約定注文がありません。');
      return;
    }

    // 注文詳細を取得
    const orders = [];
    for (const key of pendingOrderKeys) {
      const orderData = await client.hGetAll(key);
      if (orderData && Object.keys(orderData).length > 0) {
        orders.push({
          key,
          ...orderData,
          createdAt: orderData.createdAt ? new Date(parseInt(orderData.createdAt)) : null,
          age: orderData.createdAt ? Math.floor((Date.now() - parseInt(orderData.createdAt)) / (1000 * 60 * 60)) + '時間' : '不明'
        });
      }
    }

    // 取引所別・シンボル別の集計
    const byExchangeSymbol = {};
    const ageDistribution = { '0-1h': 0, '1-6h': 0, '6-24h': 0, '24h+': 0 };

    for (const order of orders) {
      // 取引所・シンボル別集計
      const key = `${order.exchange}:${order.symbol}`;
      if (!byExchangeSymbol[key]) {
        byExchangeSymbol[key] = {
          count: 0,
          buyCount: 0,
          sellCount: 0,
          orders: []
        };
      }
      byExchangeSymbol[key].count++;
      byExchangeSymbol[key].orders.push(order);

      if (order.side === 'buy') {
        byExchangeSymbol[key].buyCount++;
      } else {
        byExchangeSymbol[key].sellCount++;
      }

      // 経過時間分布
      const ageHours = order.createdAt ? (Date.now() - order.createdAt) / (1000 * 60 * 60) : null;
      if (ageHours !== null) {
        if (ageHours < 1) {
          ageDistribution['0-1h']++;
        } else if (ageHours < 6) {
          ageDistribution['1-6h']++;
        } else if (ageHours < 24) {
          ageDistribution['6-24h']++;
        } else {
          ageDistribution['24h+']++;
        }
      }
    }

    // 取引所・シンボル別の詳細表示
    console.log('\n=== 取引所・シンボル別分析 ===');
    for (const [key, data] of Object.entries(byExchangeSymbol)) {
      console.log(`\n${key}: ${data.count}件 (買い: ${data.buyCount}, 売り: ${data.sellCount})`);

      // 最新の市場価格を取得して価格乖離をチェック
      try {
        const [exchangeName, symbol] = key.split(':');
        const exchange = new ccxt[exchangeName]({
          apiKey: process.env[`${exchangeName.toUpperCase()}_API_KEY`],
          secret: process.env[`${exchangeName.toUpperCase()}_API_SECRET`]
        });

        const ticker = await exchange.fetchTicker(symbol);
        const currentPrice = ticker.last;

        // 価格乖離分析
        const priceAnalysis = data.orders.map(order => {
          const orderPrice = parseFloat(order.price);
          const deviation = ((orderPrice - currentPrice) / currentPrice) * 100;
          return {
            orderId: order.orderId,
            side: order.side,
            price: orderPrice,
            deviation: deviation.toFixed(2) + '%',
            age: order.age
          };
        }).sort((a, b) => Math.abs(parseFloat(b.deviation)) - Math.abs(parseFloat(a.deviation)));

        console.log(`現在価格: ${currentPrice}`);
        console.log('\n価格乖離が大きい注文 (上位5件):');
        table(priceAnalysis.slice(0, 5));

      } catch (err) {
        console.log(`市場価格取得エラー (${key}): ${err.message}`);
      }
    }

    // 経過時間分布
    console.log('\n=== 経過時間分布 ===');
    table([
      { 時間帯: '0-1時間', 件数: ageDistribution['0-1h'] },
      { 時間帯: '1-6時間', 件数: ageDistribution['1-6h'] },
      { 時間帯: '6-24時間', 件数: ageDistribution['6-24h'] },
      { 時間帯: '24時間以上', 件数: ageDistribution['24h+'] }
    ]);

    // 問題のある注文の特定
    console.log('\n=== 問題のある注文 (24時間以上経過) ===');
    const oldOrders = orders.filter(order => {
      const ageHours = order.createdAt ? (Date.now() - order.createdAt) / (1000 * 60 * 60) : 0;
      return ageHours > 24;
    });

    if (oldOrders.length > 0) {
      console.log(`\n24時間以上経過した注文: ${oldOrders.length}件`);
      const oldOrdersSummary = oldOrders.slice(0, 10).map(order => ({
        取引所: order.exchange,
        シンボル: order.symbol,
        サイド: order.side,
        価格: order.price,
        経過時間: order.age,
        注文ID: order.orderId
      }));
      table(oldOrdersSummary);

      if (oldOrders.length > 10) {
        console.log(`... 他 ${oldOrders.length - 10} 件`);
      }
    }

  } catch (error) {
    console.error('エラー:', error);
  } finally {
    await client.quit();
  }
}

// スクリプト実行
analyzePendingOrders().catch(console.error);