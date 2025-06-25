const ccxt = require('ccxt');
const { AdvancedOrderManager } = require('../src/strategies/utils/orderManager');

async function testOrderRejectionNotification() {
    console.log('\n=== 注文拒否通知テスト ===\n');

    try {
        // 取引所接続（テスト用）
        const exchange = new ccxt.bitbank({
            apiKey: process.env.BITBANK_API_KEY,
            secret: process.env.BITBANK_API_SECRET,
            sandbox: false
        });

        // 高度注文管理システム初期化
        const orderManager = new AdvancedOrderManager(exchange);
        
        // Redis接続完了まで少し待機
        await new Promise(resolve => setTimeout(resolve, 2000));

        console.log('=== Test 1: 極小金額注文（拒否される予定）===');
        try {
            const result1 = await orderManager.executeOrderWithManagement(
                'ETH/JPY', 
                'buy', 
                0.001, 
                100, // 100円（500円未満で拒否される）
                'limit',
                { backtest: false } // 実際のDiscord通知をテスト
            );
            
            console.log('結果:', result1.success ? '✅ 成功' : '❌ 拒否');
            if (result1.validation) {
                console.log('拒否理由:', result1.validation.reason);
            }
        } catch (error) {
            console.error('テスト1エラー:', error.message);
        }

        console.log('\n=== Test 2: 価格乖離の大きい注文（拒否される予定）===');
        try {
            const ticker = await exchange.fetchTicker('BTC/JPY');
            const highPrice = ticker.last * 1.1; // 市場価格の110%（3%制限を超過）
            
            const result2 = await orderManager.executeOrderWithManagement(
                'BTC/JPY', 
                'buy', 
                0.001, 
                highPrice,
                'limit',
                { backtest: false }
            );
            
            console.log('結果:', result2.success ? '✅ 成功' : '❌ 拒否');
            if (result2.validation) {
                console.log('拒否理由:', result2.validation.reason);
                if (result2.validation.recommendedPrice) {
                    console.log('推奨価格:', result2.validation.recommendedPrice.toLocaleString());
                }
            }
        } catch (error) {
            console.error('テスト2エラー:', error.message);
        }

        console.log('\n=== Test 3: 正常な注文（ドライラン）===');
        try {
            const ticker = await exchange.fetchTicker('ETH/JPY');
            const normalPrice = ticker.last * 0.999; // 市場価格の99.9%
            
            const result3 = await orderManager.executeOrderWithManagement(
                'ETH/JPY', 
                'buy', 
                0.01, 
                normalPrice,
                'limit',
                { backtest: true } // バックテストモード（実際の注文は発行しない）
            );
            
            console.log('結果:', result3.success ? '✅ 成功' : '❌ 拒否');
        } catch (error) {
            console.error('テスト3エラー:', error.message);
        }

        console.log('\n=== Discord通知テスト完了 ===');
        console.log('注意: 実際のDiscord通知は #order チャンネルに送信されます');
        console.log('拒否された注文の詳細な理由情報が表示されることを確認してください');

    } catch (error) {
        console.error('テスト実行エラー:', error);
    }
}

// テスト実行
testOrderRejectionNotification().catch(console.error);