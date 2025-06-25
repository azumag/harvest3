const ccxt = require('ccxt');
const redis = require('redis');
const OrderValidation = require('../src/common/orderValidation');

async function testOrderValidation() {
    console.log('\n=== 注文妥当性チェック機能テスト ===\n');

    // Redis接続
    const client = redis.createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379'
    });
    await client.connect();

    // 取引所接続
    const exchange = new ccxt.bitbank({
        apiKey: process.env.BITBANK_API_KEY,
        secret: process.env.BITBANK_API_SECRET,
        sandbox: false
    });

    // バリデータ初期化
    const validator = new OrderValidation(exchange);

    try {
        // テストケース1: 正常な注文
        console.log('=== Test 1: 正常な注文 ===');
        const ticker1 = await exchange.fetchTicker('BTC/JPY');
        const normalPrice = ticker1.last * 0.999; // 市場価格より0.1%安い買い注文
        
        const result1 = await validator.validateOrder(client, 'BTC/JPY', 'buy', normalPrice, 0.001);
        console.log('結果:', result1.valid ? '✅ 妥当' : '❌ 無効');
        console.log('詳細:', result1.summary);
        if (!result1.valid) {
            result1.errors.forEach(err => console.log(`  - ${err.reason}`));
        }

        // テストケース2: 価格乖離が大きい注文
        console.log('\n=== Test 2: 価格乖離が大きい注文 ===');
        const ticker2 = await exchange.fetchTicker('ETH/JPY');
        const highPrice = ticker2.last * 1.1; // 市場価格より10%高い買い注文（異常）
        
        const result2 = await validator.validateOrder(client, 'ETH/JPY', 'buy', highPrice, 0.01);
        console.log('結果:', result2.valid ? '✅ 妥当' : '❌ 無効');
        console.log('詳細:', result2.summary);
        if (!result2.valid) {
            result2.errors.forEach(err => {
                console.log(`  - ${err.reason}`);
                if (err.details) console.log(`    詳細:`, err.details);
            });
        }

        // テストケース3: 推奨価格算出
        console.log('\n=== Test 3: 推奨価格算出 ===');
        const recommendedBuyPrice = await validator.getRecommendedPrice('BTC/JPY', 'buy');
        const recommendedSellPrice = await validator.getRecommendedPrice('BTC/JPY', 'sell');
        const currentPrice = ticker1.last;
        
        console.log(`現在価格: ¥${currentPrice.toLocaleString()}`);
        console.log(`推奨買い価格: ¥${recommendedBuyPrice.toLocaleString()} (${(((recommendedBuyPrice - currentPrice) / currentPrice) * 100).toFixed(2)}%)`);
        console.log(`推奨売り価格: ¥${recommendedSellPrice.toLocaleString()} (${(((recommendedSellPrice - currentPrice) / currentPrice) * 100).toFixed(2)}%)`);

        // テストケース4: 未約定注文上限チェック
        console.log('\n=== Test 4: 未約定注文状況 ===');
        const allPendingOrders = await client.keys('pending_order:*');
        let buyCount = 0, sellCount = 0;

        for (const key of allPendingOrders.slice(0, 50)) { // 最初の50件だけチェック
            const orderData = await client.hGetAll(key);
            if (orderData.side === 'buy') buyCount++;
            else if (orderData.side === 'sell') sellCount++;
        }

        const totalChecked = buyCount + sellCount;
        const buyRatio = totalChecked > 0 ? buyCount / totalChecked : 0;
        
        console.log(`未約定注文総数: ${allPendingOrders.length}件`);
        console.log(`チェック済み: ${totalChecked}件 (買い: ${buyCount}, 売り: ${sellCount})`);
        console.log(`買い注文比率: ${(buyRatio * 100).toFixed(1)}%`);
        
        if (buyRatio > validator.maxBuyRatio) {
            console.log(`⚠️ 買い注文比率が上限 ${(validator.maxBuyRatio * 100).toFixed(1)}% を超過しています`);
        }

        // テストケース5: 小額注文のチェック
        console.log('\n=== Test 5: 小額注文チェック ===');
        const smallOrderResult = await validator.validateOrder(client, 'BTC/JPY', 'buy', normalPrice, 0.00001); // 極小注文
        console.log('結果:', smallOrderResult.valid ? '✅ 妥当' : '❌ 無効');
        if (!smallOrderResult.valid) {
            smallOrderResult.errors.forEach(err => console.log(`  - ${err.reason}`));
        }

        // テストケース6: 設定変更テスト
        console.log('\n=== Test 6: 設定変更テスト ===');
        console.log('現在の設定:');
        console.log(`  価格乖離許容範囲: ${(validator.priceTolerancePercent * 100).toFixed(1)}%`);
        console.log(`  最大買い注文比率: ${(validator.maxBuyRatio * 100).toFixed(1)}%`);
        console.log(`  シンボル別上限: ${validator.maxPendingOrdersPerSymbol}件`);

        validator.updateConfig({
            priceTolerancePercent: 0.05, // 5%に変更
            maxBuyRatio: 0.60, // 60%に変更
            maxPendingOrdersPerSymbol: 2 // 2件に変更
        });

        console.log('\n設定変更後:');
        console.log(`  価格乖離許容範囲: ${(validator.priceTolerancePercent * 100).toFixed(1)}%`);
        console.log(`  最大買い注文比率: ${(validator.maxBuyRatio * 100).toFixed(1)}%`);
        console.log(`  シンボル別上限: ${validator.maxPendingOrdersPerSymbol}件`);

    } catch (error) {
        console.error('テストエラー:', error);
    } finally {
        await client.quit();
    }

    console.log('\n=== テスト完了 ===');
}

// テスト実行
testOrderValidation().catch(console.error);