const ccxt = require('ccxt');
const redis = require('redis');
const MarketPriceTracker = require('../src/common/marketPriceTracker');

async function testMarketPriceTracker() {
    console.log('\n=== 市場価格追従アルゴリズム テスト ===\n');

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

    // 価格トラッカー初期化
    const tracker = new MarketPriceTracker(exchange, client);

    try {
        // テスト1: 市場価格の記録
        console.log('=== Test 1: 市場価格記録 ===');
        const symbols = ['BTC/JPY', 'ETH/JPY', 'XRP/JPY'];
        
        for (const symbol of symbols) {
            const priceData = await tracker.recordMarketPrice(symbol);
            if (priceData) {
                console.log(`${symbol}: ¥${priceData.price.toLocaleString()} (${new Date(priceData.timestamp).toLocaleTimeString()})`);
            }
        }

        // テスト2: 未約定注文の多いシンボルを特定
        console.log('\n=== Test 2: 未約定注文分析 ===');
        const allPendingOrders = await client.keys('pending_order:*');
        const symbolCounts = {};
        
        for (const key of allPendingOrders.slice(0, 50)) { // 50件のサンプル
            const orderData = await client.hGetAll(key);
            const symbol = orderData.symbol;
            if (symbol) {
                symbolCounts[symbol] = (symbolCounts[symbol] || 0) + 1;
            }
        }

        // 未約定注文の多い上位5シンボル
        const topSymbols = Object.entries(symbolCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        console.log('未約定注文の多いシンボル:');
        for (const [symbol, count] of topSymbols) {
            console.log(`  ${symbol}: ${count}件`);
        }

        // テスト3: 価格変動の計算（シミュレーション）
        console.log('\n=== Test 3: 価格変動計算 ===');
        
        if (topSymbols.length > 0) {
            const testSymbol = topSymbols[0][0]; // 最も未約定注文の多いシンボル
            
            // 現在価格を記録
            await tracker.recordMarketPrice(testSymbol);
            
            // 価格変動の計算
            const priceChange = await tracker.calculatePriceChange(testSymbol);
            
            if (priceChange) {
                console.log(`${testSymbol}:`);
                console.log(`  現在価格: ¥${priceChange.currentPrice ? priceChange.currentPrice.toLocaleString() : 'N/A'}`);
                console.log(`  変動率: ${priceChange.changePercent ? (priceChange.changePercent * 100).toFixed(2) : 'N/A'}%`);
                console.log(`  調整必要: ${priceChange.needsAdjustment ? 'Yes' : 'No'}`);
            }
        }

        // テスト4: 価格調整の計算ロジック（ドライラン）
        console.log('\n=== Test 4: 価格調整計算 ===');
        
        if (topSymbols.length > 0) {
            const testSymbol = topSymbols[0][0];
            const pendingOrderKeys = await client.keys(`pending_order:*:${testSymbol}:*`);
            
            if (pendingOrderKeys.length > 0) {
                console.log(`${testSymbol} の価格調整シミュレーション:`);
                
                // 最初の3件をテスト
                for (let i = 0; i < Math.min(3, pendingOrderKeys.length); i++) {
                    const key = pendingOrderKeys[i];
                    const orderData = await client.hGetAll(key);
                    
                    if (orderData.price && orderData.side) {
                        const currentPrice = parseFloat(orderData.price);
                        const ticker = await exchange.fetchTicker(testSymbol);
                        const marketPrice = ticker.last;
                        
                        // 5%の市場価格上昇をシミュレート
                        const simulatedChangePercent = 0.05;
                        const adjustedPrice = tracker.calculateAdjustedPrice(
                            currentPrice,
                            marketPrice,
                            orderData.side,
                            simulatedChangePercent
                        );
                        
                        const priceChangePercent = ((adjustedPrice - currentPrice) / currentPrice * 100);
                        
                        console.log(`  ${orderData.side} ¥${currentPrice.toLocaleString()} → ¥${adjustedPrice.toLocaleString()} (${priceChangePercent > 0 ? '+' : ''}${priceChangePercent.toFixed(2)}%)`);
                    }
                }
            }
        }

        // テスト5: 設定変更テスト
        console.log('\n=== Test 5: 設定変更 ===');
        console.log('現在の設定:');
        console.log(`  価格調整閾値: ${(tracker.priceAdjustmentThreshold * 100).toFixed(1)}%`);
        console.log(`  最大調整幅: ${(tracker.maxAdjustmentPercent * 100).toFixed(1)}%`);
        console.log(`  調整間隔: ${tracker.adjustmentInterval / 60000}分`);

        // より保守的な設定に変更
        tracker.updateConfig({
            priceAdjustmentThreshold: 0.03, // 3%
            maxAdjustmentPercent: 0.03,     // 3%
            adjustmentInterval: 60 * 60 * 1000 // 60分
        });

        console.log('\n変更後の設定:');
        console.log(`  価格調整閾値: ${(tracker.priceAdjustmentThreshold * 100).toFixed(1)}%`);
        console.log(`  最大調整幅: ${(tracker.maxAdjustmentPercent * 100).toFixed(1)}%`);
        console.log(`  調整間隔: ${tracker.adjustmentInterval / 60000}分`);

        // テスト6: 実際の調整実行の前チェック
        console.log('\n=== Test 6: 調整実行前チェック ===');
        console.log('⚠️ 実際の価格調整はリスクを伴うため、このテストではシミュレーションのみ実行');
        console.log('実際の調整を実行する場合は、以下のコマンドを使用:');
        console.log('  node scripts/executeMarketPriceAdjustment.js --symbol ETH/JPY --dry-run');
        console.log('  node scripts/executeMarketPriceAdjustment.js --all --dry-run');

        // テスト統計
        console.log('\n=== テスト統計 ===');
        console.log(`総未約定注文数: ${allPendingOrders.length}件`);
        console.log(`サンプル調査対象: ${Math.min(50, allPendingOrders.length)}件`);
        console.log(`異なるシンボル数: ${Object.keys(symbolCounts).length}件`);
        console.log(`調整対象候補: ${topSymbols.length}シンボル`);

    } catch (error) {
        console.error('テストエラー:', error);
    } finally {
        await client.quit();
    }

    console.log('\n=== テスト完了 ===');
}

// テスト実行
testMarketPriceTracker().catch(console.error);