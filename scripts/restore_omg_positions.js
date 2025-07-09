const { initRedisClient } = require('../src/database/redisClient');
const { config } = require('../src/config');
const redis = require('redis');

async function restoreOMGPositions() {
  let client;
  try {
    console.log('=== OMG/JPY Redis記録復元処理 ===\n');

    // Redis接続
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    client = redis.createClient({ url: redisUrl });
    await client.connect();
    console.log('Redis接続完了');

    const exchange = config.exchanges.bitbank.instance;
    const symbol = 'OMG/JPY';
    const exchangeId = 'bitbank';

    // 現在価格を取得
    const ticker = await exchange.fetchTicker(symbol);
    const currentPrice = ticker.last;
    console.log(`現在価格: ${currentPrice}円\n`);

    // オープンオーダーを取得
    const orders = await exchange.fetchOpenOrders(symbol);
    const sellOrders = orders.filter(o => o.side === 'sell');

    console.log(`売り注文数: ${sellOrders.length}件`);
    console.log('復元するポジション:\n');

    // 各売り注文から元のポジション情報を推定
    let totalRestored = 0;
    const restoredPositions = [];

    for (const order of sellOrders) {
      // 戦略を推定（価格帯から判断）
      let strategy = 'UNKNOWN';
      if (order.price > 34) {
        strategy = 'MA';
      } else if (order.price > 31) {
        strategy = 'BOLLINGER_BANDS';
      } else if (order.price > 30) {
        strategy = 'RSI';
      } else if (order.price > 27) {
        strategy = 'MACD';
      }

      const positionKey = `position:${exchangeId}:${symbol}:${strategy}:restored_${order.id}`;
      const estimatedEntryPrice = order.price * 0.95; // 売値の95%をエントリー価格と推定

      // Redis直接保存
      const positionData = {
        exchangeId: exchangeId,
        symbol: symbol,
        strategyKey: strategy,
        orderId: `restored_${order.id}`,
        side: 'buy',
        amount: String(order.amount),
        entryPrice: String(estimatedEntryPrice),
        highestPrice: String(currentPrice),
        status: 'open',
        createdAt: String(Date.now() - 86400000), // 1日前と仮定
        updatedAt: String(Date.now()),
        restored: 'true',
        originalSellOrderId: String(order.id),
        key: positionKey
      };

      // hSetで保存
      try {
        await client.hSet(positionKey, positionData);
        console.log(`✅ 復元: ${strategy} - ${order.amount} OMG @ 推定エントリー${estimatedEntryPrice.toFixed(3)}円 (売注文ID: ${order.id})`);
        totalRestored += order.amount;
        restoredPositions.push({ positionKey, ...positionData });
      } catch (error) {
        console.log(`❌ 復元失敗: ${order.id} - ${error.message}`);
      }
    }

    console.log(`\n復元完了: 合計 ${totalRestored.toFixed(4)} OMG`);

    // 復元結果の確認
    console.log('\n=== 復元後の確認 ===');
    const { getStrategyPositionsRedis } = require('../src/database/redisDatabase');
    const strategies = ['MA', 'BOLLINGER_BANDS', 'RSI', 'MACD', 'UNKNOWN'];

    let grandTotal = 0;
    for (const strategy of strategies) {
      const positions = await getStrategyPositionsRedis(exchangeId, symbol, strategy);
      const openPositions = positions.filter(p => p.status === 'open');
      if (openPositions.length > 0) {
        const total = openPositions.reduce((sum, p) => sum + parseFloat(p.amount), 0);
        console.log(`${strategy}: ${openPositions.length}件, 合計 ${total.toFixed(4)} OMG`);
        grandTotal += total;
      }
    }

    console.log(`\n総合計: ${grandTotal.toFixed(4)} OMG`);
    console.log('\n⚠️ 注意: エントリー価格と戦略は推定値です。実際の値と異なる可能性があります。');

    // Discord通知
    const { postOrderToDiscord } = require('../src/common/notifications');
    const message = '📊 [OMG/JPY ポジション復元完了]\n' +
                   `復元件数: ${restoredPositions.length}件\n` +
                   `復元総量: ${totalRestored.toFixed(4)} OMG\n` +
                   `現在価格: ${currentPrice}円\n` +
                   '※ エントリー価格と戦略は推定値です';

    await postOrderToDiscord(message);

  } catch (error) {
    console.error('復元エラー:', error);
  } finally {
    if (client) {
      await client.quit();
    }
  }

  process.exit(0);
}

// 実行
restoreOMGPositions().catch(console.error);