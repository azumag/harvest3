const redis = require('redis');
const ccxt = require('ccxt');

class LightweightPendingOrderCleaner {
    constructor() {
        this.client = null;
        this.exchange = null;
    }

    async init() {
        this.client = redis.createClient({
            url: process.env.REDIS_URL || 'redis://localhost:6379'
        });
        await this.client.connect();
        
        this.exchange = new ccxt.bitbank({
            apiKey: process.env.BITBANK_API_KEY,
            secret: process.env.BITBANK_API_SECRET,
            sandbox: false
        });
    }

    async close() {
        if (this.client) {
            await this.client.quit();
        }
    }

    // 未約定注文の基本統計を取得
    async getBasicStats() {
        const pendingOrderKeys = await this.client.keys('pending_order:*');
        let buyCount = 0;
        let sellCount = 0;
        const symbolCount = {};
        const orders = [];

        for (const key of pendingOrderKeys) {
            const orderData = await this.client.hGetAll(key);
            orders.push({ ...orderData, key });
            
            if (orderData.side === 'buy') buyCount++;
            else if (orderData.side === 'sell') sellCount++;
            
            const symbol = orderData.symbol || 'unknown';
            symbolCount[symbol] = (symbolCount[symbol] || 0) + 1;
        }

        return { 
            total: pendingOrderKeys.length, 
            buyCount, 
            sellCount, 
            symbolCount, 
            orders 
        };
    }

    // 買い注文過多の調整（市場価格確認なし）
    async identifyBuyOrderReduction(orders, stats) {
        const buyRatio = stats.buyCount / stats.total;
        
        if (buyRatio < 0.90) {
            console.log(`買い注文比率: ${(buyRatio * 100).toFixed(1)}% - 調整不要`);
            return [];
        }

        console.log(`⚠️ 買い注文比率: ${(buyRatio * 100).toFixed(1)}% - 調整が必要`);

        // 買い注文のみを抽出し、古い順にソート
        const buyOrders = orders
            .filter(order => order.side === 'buy')
            .sort((a, b) => {
                const aTime = parseInt(a.timestamp);
                const bTime = parseInt(b.timestamp);
                // 異常なタイムスタンプ（未来）は古いものとして扱う
                const now = Date.now();
                const aIsNormal = aTime > 0 && aTime <= now;
                const bIsNormal = bTime > 0 && bTime <= now;
                
                if (!aIsNormal && bIsNormal) return -1;
                if (aIsNormal && !bIsNormal) return 1;
                if (!aIsNormal && !bIsNormal) return 0;
                
                return aTime - bTime;
            });

        // 上位30% をキャンセル対象とする
        const reductionCount = Math.floor(buyOrders.length * 0.3);
        return buyOrders.slice(0, reductionCount);
    }

    // 同一シンボルで過度に多い注文の削減
    async identifyExcessiveSymbolOrders(orders, stats) {
        const excessiveOrders = [];
        const symbolThreshold = 5; // 1シンボルあたり5件以上で過多と判定

        for (const [symbol, count] of Object.entries(stats.symbolCount)) {
            if (count > symbolThreshold) {
                console.log(`⚠️ ${symbol}: ${count}件 - 過多 (閾値: ${symbolThreshold})`);
                
                const symbolOrders = orders
                    .filter(order => order.symbol === symbol)
                    .sort((a, b) => parseInt(a.timestamp) - parseInt(b.timestamp));
                
                // 閾値を超えた分をキャンセル対象とする
                const excessCount = count - symbolThreshold;
                excessiveOrders.push(...symbolOrders.slice(0, excessCount));
            }
        }

        return excessiveOrders;
    }

    // 注文キャンセル実行（簡易版）
    async cancelOrder(orderInfo, dryRun = true) {
        try {
            if (!dryRun) {
                // 実際のキャンセル実行
                await this.exchange.cancelOrder(orderInfo.orderId, orderInfo.symbol);
                await this.client.del(orderInfo.key);
                console.log(`✅ キャンセル完了: ${orderInfo.symbol} ${orderInfo.side} ¥${orderInfo.price}`);
            } else {
                console.log(`[ドライラン] ${orderInfo.symbol} ${orderInfo.side} ¥${orderInfo.price} - ${orderInfo.reason || '一般調整'}`);
            }
            return true;
        } catch (error) {
            console.log(`❌ キャンセル失敗: ${orderInfo.orderId} - ${error.message}`);
            
            // 注文が既に存在しない場合はRedisから削除
            if (!dryRun && (error.message.includes('Order not found') || error.message.includes('already'))) {
                await this.client.del(orderInfo.key);
                console.log(`🔧 不整合解消: Redis削除 ${orderInfo.key}`);
                return true;
            }
            return false;
        }
    }

    // メイン実行
    async run(options = {}) {
        const { dryRun = true, maxCancel = 30 } = options;
        
        console.log('\n=== 軽量版 未約定注文整理 ===\n');
        
        // 基本統計取得
        const stats = await this.getBasicStats();
        console.log(`総未約定注文: ${stats.total}件`);
        console.log(`買い注文: ${stats.buyCount}件 (${(stats.buyCount/stats.total*100).toFixed(1)}%)`);
        console.log(`売り注文: ${stats.sellCount}件 (${(stats.sellCount/stats.total*100).toFixed(1)}%)`);
        
        // 通貨ペア別統計（上位10件）
        console.log('\n=== 通貨ペア別分布 ===');
        const sortedSymbols = Object.entries(stats.symbolCount)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);
        for (const [symbol, count] of sortedSymbols) {
            console.log(`${symbol}: ${count}件`);
        }

        // キャンセル対象の特定
        const cancelTargets = [];
        
        // 1. 買い注文過多の調整
        const buyReduction = await this.identifyBuyOrderReduction(stats.orders, stats);
        cancelTargets.push(...buyReduction.map(order => ({ ...order, reason: '買い注文過多調整' })));
        
        // 2. 同一シンボル過多の調整
        const symbolReduction = await this.identifyExcessiveSymbolOrders(stats.orders, stats);
        cancelTargets.push(...symbolReduction.map(order => ({ ...order, reason: 'シンボル過多調整' })));

        // 重複除去
        const uniqueTargets = Array.from(
            new Map(cancelTargets.map(order => [order.key, order])).values()
        ).slice(0, maxCancel);

        console.log(`\n=== キャンセル対象: ${uniqueTargets.length}件 ===`);
        
        if (uniqueTargets.length === 0) {
            console.log('キャンセル対象なし');
            return;
        }

        // キャンセル実行
        let successCount = 0;
        for (const order of uniqueTargets) {
            const success = await this.cancelOrder(order, dryRun);
            if (success) successCount++;
            
            // レート制限対策
            if (!dryRun) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        console.log(`\n=== 完了 ===`);
        if (dryRun) {
            console.log(`ドライラン完了: ${uniqueTargets.length}件の対象を特定`);
        } else {
            console.log(`実行完了: ${successCount}/${uniqueTargets.length}件 キャンセル成功`);
        }
    }
}

// コマンドライン実行
const args = process.argv.slice(2);
const dryRun = !args.includes('--execute');
const maxCancel = parseInt(args.find(arg => arg.startsWith('--max='))?.split('=')[1]) || 30;

(async () => {
    const cleaner = new LightweightPendingOrderCleaner();
    await cleaner.init();
    
    try {
        await cleaner.run({ dryRun, maxCancel });
    } finally {
        await cleaner.close();
    }
})().catch(console.error);