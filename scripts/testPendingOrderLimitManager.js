const ccxt = require('ccxt');
const redis = require('redis');
const PendingOrderLimitManager = require('../src/common/pendingOrderLimitManager');

async function testPendingOrderLimitManager() {
    console.log('\n=== 未約定注文上限管理機能テスト ===\n');

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

    // 上限管理マネージャー初期化
    const limitManager = new PendingOrderLimitManager(exchange, client);

    try {
        // テスト1: 現在の統計取得
        console.log('=== Test 1: 現在の統計 ===');
        const stats = await limitManager.getCurrentStats();
        
        if (stats) {
            console.log(`総未約定注文数: ${stats.total}件`);
            console.log(`買い注文比率: ${(stats.buyRatio * 100).toFixed(1)}%`);
            console.log(`平均注文年齢: ${(stats.avgOrderAge / (60 * 60 * 1000)).toFixed(1)}時間`);
            console.log(`総注文価値: ¥${stats.totalValue.toLocaleString()}`);
            
            console.log('\n年齢別分布:');
            console.log(`  新しい(<1h): ${stats.byAge.recent}件`);
            console.log(`  普通(<24h): ${stats.byAge.old}件`);
            console.log(`  古い(>24h): ${stats.byAge.ancient}件`);
            
            console.log('\n上位シンボル:');
            const topSymbols = Object.entries(stats.bySymbol)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5);
            topSymbols.forEach(([symbol, count]) => {
                console.log(`  ${symbol}: ${count}件`);
            });
        }

        // テスト2: 制限違反の検出
        console.log('\n=== Test 2: 制限違反検出 ===');
        const violations = await limitManager.detectLimitViolations();
        
        if (violations.length === 0) {
            console.log('✅ 制限違反なし');
        } else {
            console.log(`⚠️ ${violations.length}件の制限違反を検出:`);
            violations.forEach(v => {
                const severityIcon = v.severity === 'high' ? '🔴' : '🟡';
                console.log(`  ${severityIcon} ${v.message}`);
            });
        }

        // テスト3: 新規注文可否判定
        console.log('\n=== Test 3: 新規注文可否判定 ===');
        
        // ケース1: 通常の注文
        const ticker = await exchange.fetchTicker('BTC/JPY');
        const result1 = await limitManager.canCreateNewOrder('BTC/JPY', 'buy', ticker.last * 0.999, 0.001);
        console.log(`BTC/JPY 買い注文: ${result1.allowed ? '✅ 許可' : '❌ 拒否'}`);
        if (!result1.allowed) console.log(`  理由: ${result1.reason}`);

        // ケース2: 過多シンボルでの注文
        const result2 = await limitManager.canCreateNewOrder('QTUM/JPY', 'buy', 300, 1);
        console.log(`QTUM/JPY 買い注文: ${result2.allowed ? '✅ 許可' : '❌ 拒否'}`);
        if (!result2.allowed) console.log(`  理由: ${result2.reason}`);

        // ケース3: 小額注文
        const result3 = await limitManager.canCreateNewOrder('ETH/JPY', 'buy', 100, 0.001);
        console.log(`ETH/JPY 小額注文: ${result3.allowed ? '✅ 許可' : '❌ 拒否'}`);
        if (!result3.allowed) console.log(`  理由: ${result3.reason}`);

        // ケース4: 売り注文（バランス改善）
        const result4 = await limitManager.canCreateNewOrder('ETH/JPY', 'sell', ticker.last * 1.01, 0.01);
        console.log(`ETH/JPY 売り注文: ${result4.allowed ? '✅ 許可' : '❌ 拒否'}`);
        if (!result4.allowed) console.log(`  理由: ${result4.reason}`);

        // テスト4: ヘルスチェック
        console.log('\n=== Test 4: ヘルスチェック ===');
        const health = await limitManager.healthCheck();
        
        console.log(`ステータス: ${health.status === 'healthy' ? '✅ 健全' : '⚠️ 要注意'}`);
        console.log(`利用率: ${health.utilization} (${health.totalOrders}/${limitManager.limits.maxTotalPendingOrders})`);
        console.log(`買い注文比率: ${health.buyRatio} (上限: ${(limitManager.limits.maxBuyRatio * 100).toFixed(1)}%)`);
        console.log(`制限違反: ${health.violations}件`);
        console.log(`緊急モード: ${health.emergencyMode ? 'ON' : 'OFF'}`);
        console.log(`最終クリーンアップ: ${health.lastCleanup}`);

        // テスト5: 制限設定の表示・変更
        console.log('\n=== Test 5: 制限設定 ===');
        console.log('現在の制限:');
        console.log(`  全体上限: ${limitManager.limits.maxTotalPendingOrders}件`);
        console.log(`  シンボル別上限: ${limitManager.limits.maxPendingOrdersPerSymbol}件`);
        console.log(`  買い注文比率上限: ${(limitManager.limits.maxBuyRatio * 100).toFixed(1)}%`);
        console.log(`  最大注文年齢: ${limitManager.limits.maxOrderAge / (60 * 60 * 1000)}時間`);
        console.log(`  注文金額範囲: ¥${limitManager.limits.minOrderValue.toLocaleString()} - ¥${limitManager.limits.maxOrderValue.toLocaleString()}`);

        // より厳しい制限に変更してテスト
        console.log('\nより厳しい制限に変更:');
        limitManager.updateLimits({
            maxTotalPendingOrders: 30,    // 50 → 30
            maxBuyRatio: 0.60,            // 0.70 → 0.60
            maxPendingOrdersPerSymbol: 2  // 3 → 2
        });

        // 変更後の新規注文可否を再確認
        const result5 = await limitManager.canCreateNewOrder('BTC/JPY', 'buy', ticker.last * 0.999, 0.001);
        console.log(`変更後のBTC/JPY買い注文: ${result5.allowed ? '✅ 許可' : '❌ 拒否'}`);
        if (!result5.allowed) console.log(`  理由: ${result5.reason}`);

        // テスト6: 自動クリーンアップの必要性確認
        console.log('\n=== Test 6: 自動クリーンアップシミュレーション ===');
        
        const newViolations = await limitManager.detectLimitViolations();
        if (newViolations.length > 0) {
            console.log(`⚠️ ${newViolations.length}件の制限違反を検出 - クリーンアップが必要`);
            newViolations.forEach(v => console.log(`  - ${v.message}`));
            
            console.log('\n🔧 自動クリーンアップを実行する場合:');
            console.log('  node scripts/executePendingOrderCleanup.js --dry-run');
            console.log('  node scripts/executePendingOrderCleanup.js --execute');
        } else {
            console.log('✅ 制限違反なし - クリーンアップ不要');
        }

        // テスト7: 緊急モードテスト
        console.log('\n=== Test 7: 緊急モード ===');
        console.log('緊急モードを有効化:');
        limitManager.setEmergencyMode(true, '手動テスト');
        
        const emergencyResult = await limitManager.canCreateNewOrder('BTC/JPY', 'sell', ticker.last * 1.01, 0.001);
        console.log(`緊急モード中の注文: ${emergencyResult.allowed ? '✅ 許可' : '❌ 拒否'}`);
        if (!emergencyResult.allowed) console.log(`  理由: ${emergencyResult.reason}`);
        
        limitManager.setEmergencyMode(false, 'テスト終了');

        // 推奨アクション
        console.log('\n=== 推奨アクション ===');
        if (stats.total > 80) {
            console.log('🔧 未約定注文数が多いため、クリーンアップの実行を推奨');
        }
        if (stats.buyRatio > 0.90) {
            console.log('⚖️ 買い注文比率が極端に高いため、売り注文の促進を推奨');
        }
        if (stats.byAge.ancient > 10) {
            console.log('⏰ 古い注文が多数存在するため、自動キャンセルを推奨');
        }

    } catch (error) {
        console.error('テストエラー:', error);
    } finally {
        await client.quit();
    }

    console.log('\n=== テスト完了 ===');
}

// テスト実行
testPendingOrderLimitManager().catch(console.error);