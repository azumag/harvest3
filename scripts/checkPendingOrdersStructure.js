const redis = require('redis');

async function checkPendingOrdersStructure() {
  const client = redis.createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379'
  });

  await client.connect();

  try {
    console.log('\n=== 未約定注文データ構造確認 ===\n');

    // 未約定注文のキーを取得
    const pendingOrderKeys = await client.keys('pending_order:*');
    console.log(`総未約定注文数: ${pendingOrderKeys.length}`);

    if (pendingOrderKeys.length === 0) {
      console.log('未約定注文がありません。');
      return;
    }

    // 最初の5件のサンプルデータを詳しく確認
    console.log('\n=== サンプルデータ (最初の5件) ===');
    for (let i = 0; i < Math.min(5, pendingOrderKeys.length); i++) {
      const key = pendingOrderKeys[i];
      console.log(`\nキー: ${key}`);

      const orderData = await client.hGetAll(key);
      console.log('データ:', JSON.stringify(orderData, null, 2));

      // キーの構造を分析
      const keyParts = key.split(':');
      console.log('キー分割:', keyParts);
    }

    // 買い注文と売り注文の数を集計
    let buyCount = 0;
    let sellCount = 0;
    const exchangeCount = {};
    const symbolCount = {};

    for (const key of pendingOrderKeys) {
      const orderData = await client.hGetAll(key);

      if (orderData.side === 'buy') {
        buyCount++;
      } else if (orderData.side === 'sell') {
        sellCount++;
      }

      // 取引所情報
      const exchange = orderData.exchange || 'unknown';
      exchangeCount[exchange] = (exchangeCount[exchange] || 0) + 1;

      // シンボル情報
      const symbol = orderData.symbol || 'unknown';
      symbolCount[symbol] = (symbolCount[symbol] || 0) + 1;
    }

    console.log('\n=== 集計結果 ===');
    console.log(`買い注文: ${buyCount}件`);
    console.log(`売り注文: ${sellCount}件`);
    console.log(`買い注文比率: ${((buyCount / (buyCount + sellCount)) * 100).toFixed(1)}%`);

    console.log('\n=== 取引所別分布 ===');
    for (const [exchange, count] of Object.entries(exchangeCount)) {
      console.log(`${exchange}: ${count}件`);
    }

    console.log('\n=== 通貨ペア別分布 (上位10件) ===');
    const sortedSymbols = Object.entries(symbolCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    for (const [symbol, count] of sortedSymbols) {
      console.log(`${symbol}: ${count}件`);
    }

  } catch (error) {
    console.error('エラー:', error);
  } finally {
    await client.quit();
  }
}

// スクリプト実行
checkPendingOrdersStructure().catch(console.error);