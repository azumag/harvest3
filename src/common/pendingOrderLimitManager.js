const OrderValidation = require('./orderValidation');

class PendingOrderLimitManager {
    constructor(exchangeInstance, redisClient) {
        this.exchange = exchangeInstance;
        this.redis = redisClient;
        this.validator = new OrderValidation(exchangeInstance);
        
        // 制限設定
        this.limits = {
            maxTotalPendingOrders: 50,        // 全体上限
            maxPendingOrdersPerSymbol: 3,     // シンボル別上限
            maxBuyRatio: 0.70,                // 買い注文比率上限70%
            maxOrderAge: 24 * 60 * 60 * 1000, // 24時間上限
            minOrderValue: 500,               // 最小注文金額
            maxOrderValue: 50000,             // 最大注文金額
        };
        
        // 自動調整設定
        this.autoManagement = {
            enabled: true,
            checkInterval: 10 * 60 * 1000,    // 10分間隔でチェック
            cleanupThreshold: 0.8,            // 80%到達で自動クリーンアップ
            emergencyThreshold: 0.95,         // 95%到達で緊急制限
        };
        
        this.lastCleanupTime = 0;
        this.isEmergencyMode = false;
    }

    // 現在の未約定注文統計を取得
    async getCurrentStats() {
        try {
            const allKeys = await this.redis.keys('pending_order:*');
            const stats = {
                total: allKeys.length,
                bySymbol: {},
                byExchange: {},
                bySide: { buy: 0, sell: 0 },
                byAge: { recent: 0, old: 0, ancient: 0 },
                totalValue: 0,
                avgOrderAge: 0
            };

            const now = Date.now();
            let totalAge = 0;

            for (const key of allKeys) {
                const orderData = await this.redis.hGetAll(key);
                if (!orderData.symbol) continue;

                // シンボル別集計
                stats.bySymbol[orderData.symbol] = (stats.bySymbol[orderData.symbol] || 0) + 1;
                
                // 取引所別集計
                const exchange = orderData.exchangeId || 'unknown';
                stats.byExchange[exchange] = (stats.byExchange[exchange] || 0) + 1;
                
                // サイド別集計
                if (orderData.side === 'buy') stats.bySide.buy++;
                else if (orderData.side === 'sell') stats.bySide.sell++;
                
                // 年齢別集計
                const timestamp = parseInt(orderData.timestamp) || now;
                const age = now - timestamp;
                totalAge += age;
                
                if (age < 60 * 60 * 1000) stats.byAge.recent++;        // 1時間未満
                else if (age < 24 * 60 * 60 * 1000) stats.byAge.old++; // 24時間未満
                else stats.byAge.ancient++;                             // 24時間以上
                
                // 注文金額集計
                const price = parseFloat(orderData.price) || 0;
                const amount = parseFloat(orderData.amount) || 0;
                stats.totalValue += price * amount;
            }

            stats.avgOrderAge = allKeys.length > 0 ? totalAge / allKeys.length : 0;
            stats.buyRatio = stats.total > 0 ? stats.bySide.buy / stats.total : 0;

            return stats;
            
        } catch (error) {
            console.error('統計取得エラー:', error);
            return null;
        }
    }

    // 制限違反の検出
    async detectLimitViolations() {
        const stats = await this.getCurrentStats();
        if (!stats) return [];

        const violations = [];

        // 全体数制限
        if (stats.total > this.limits.maxTotalPendingOrders) {
            violations.push({
                type: 'total_limit',
                severity: 'high',
                current: stats.total,
                limit: this.limits.maxTotalPendingOrders,
                message: `未約定注文総数が上限を超過 (${stats.total}/${this.limits.maxTotalPendingOrders})`
            });
        }

        // シンボル別制限
        for (const [symbol, count] of Object.entries(stats.bySymbol)) {
            if (count > this.limits.maxPendingOrdersPerSymbol) {
                violations.push({
                    type: 'symbol_limit',
                    severity: 'medium',
                    symbol,
                    current: count,
                    limit: this.limits.maxPendingOrdersPerSymbol,
                    message: `${symbol}の未約定注文数が上限を超過 (${count}/${this.limits.maxPendingOrdersPerSymbol})`
                });
            }
        }

        // 買い注文比率制限
        if (stats.buyRatio > this.limits.maxBuyRatio) {
            violations.push({
                type: 'buy_ratio',
                severity: 'high',
                current: stats.buyRatio,
                limit: this.limits.maxBuyRatio,
                message: `買い注文比率が上限を超過 (${(stats.buyRatio * 100).toFixed(1)}%/${(this.limits.maxBuyRatio * 100).toFixed(1)}%)`
            });
        }

        // 古い注文の検出
        if (stats.byAge.ancient > 0) {
            violations.push({
                type: 'old_orders',
                severity: 'medium',
                current: stats.byAge.ancient,
                limit: 0,
                message: `24時間以上の古い注文が存在 (${stats.byAge.ancient}件)`
            });
        }

        return violations;
    }

    // 新規注文の可否判定
    async canCreateNewOrder(symbol, side, price, amount) {
        const stats = await this.getCurrentStats();
        if (!stats) return { allowed: false, reason: '統計取得失敗' };

        const violations = await this.detectLimitViolations();
        
        // 緊急モード中は新規注文を制限
        if (this.isEmergencyMode) {
            return { 
                allowed: false, 
                reason: '緊急モード中のため新規注文停止',
                emergencyMode: true 
            };
        }

        // 全体上限の90%に達した場合、新規注文を制限
        const totalUtilization = stats.total / this.limits.maxTotalPendingOrders;
        if (totalUtilization > 0.9) {
            return { 
                allowed: false, 
                reason: `未約定注文数が上限の90%に到達 (${stats.total}/${this.limits.maxTotalPendingOrders})`,
                utilization: totalUtilization 
            };
        }

        // シンボル別制限チェック
        const symbolCount = stats.bySymbol[symbol] || 0;
        if (symbolCount >= this.limits.maxPendingOrdersPerSymbol) {
            return { 
                allowed: false, 
                reason: `${symbol}の未約定注文数が上限に到達 (${symbolCount}/${this.limits.maxPendingOrdersPerSymbol})` 
            };
        }

        // 買い注文比率チェック
        if (side === 'buy') {
            const newBuyRatio = (stats.bySide.buy + 1) / (stats.total + 1);
            if (newBuyRatio > this.limits.maxBuyRatio) {
                return { 
                    allowed: false, 
                    reason: `買い注文追加により比率上限を超過 (予想: ${(newBuyRatio * 100).toFixed(1)}%/${(this.limits.maxBuyRatio * 100).toFixed(1)}%)` 
                };
            }
        }

        // 注文金額チェック
        const orderValue = price * amount;
        if (orderValue < this.limits.minOrderValue) {
            return { 
                allowed: false, 
                reason: `注文金額が最小値未満 (¥${orderValue.toLocaleString()}/${this.limits.minOrderValue.toLocaleString()})` 
            };
        }
        
        if (orderValue > this.limits.maxOrderValue) {
            return { 
                allowed: false, 
                reason: `注文金額が最大値超過 (¥${orderValue.toLocaleString()}/${this.limits.maxOrderValue.toLocaleString()})` 
            };
        }

        return { allowed: true, reason: '制限内' };
    }

    // 自動クリーンアップの実行
    async performAutoCleanup() {
        try {
            console.log('\n=== 未約定注文自動クリーンアップ開始 ===');
            
            const stats = await this.getCurrentStats();
            const violations = await this.detectLimitViolations();
            
            if (violations.length === 0) {
                console.log('制限違反なし - クリーンアップ不要');
                return { cleaned: 0, reason: 'no_violations' };
            }

            console.log(`検出された違反: ${violations.length}件`);
            violations.forEach(v => console.log(`  - ${v.message}`));

            let cleanedCount = 0;
            const cleanupActions = [];

            // 1. 古い注文の削除
            if (violations.some(v => v.type === 'old_orders')) {
                const oldOrdersCleaned = await this.cleanupOldOrders();
                cleanedCount += oldOrdersCleaned;
                cleanupActions.push(`古い注文: ${oldOrdersCleaned}件削除`);
            }

            // 2. シンボル別過多の調整
            const symbolViolations = violations.filter(v => v.type === 'symbol_limit');
            for (const violation of symbolViolations) {
                const symbolCleaned = await this.cleanupExcessiveSymbolOrders(violation.symbol, violation.limit);
                cleanedCount += symbolCleaned;
                cleanupActions.push(`${violation.symbol}: ${symbolCleaned}件削除`);
            }

            // 3. 買い注文比率の調整
            if (violations.some(v => v.type === 'buy_ratio')) {
                const buyOrdersCleaned = await this.cleanupExcessiveBuyOrders();
                cleanedCount += buyOrdersCleaned;
                cleanupActions.push(`買い注文調整: ${buyOrdersCleaned}件削除`);
            }

            this.lastCleanupTime = Date.now();

            console.log(`\nクリーンアップ完了: ${cleanedCount}件の注文を削除`);
            cleanupActions.forEach(action => console.log(`  - ${action}`));

            return { 
                cleaned: cleanedCount, 
                actions: cleanupActions,
                violations: violations.length 
            };

        } catch (error) {
            console.error('自動クリーンアップエラー:', error);
            return { cleaned: 0, error: error.message };
        }
    }

    // 古い注文のクリーンアップ
    async cleanupOldOrders() {
        const allKeys = await this.redis.keys('pending_order:*');
        const now = Date.now();
        let cleanedCount = 0;

        for (const key of allKeys) {
            const orderData = await this.redis.hGetAll(key);
            const timestamp = parseInt(orderData.timestamp) || now;
            const age = now - timestamp;

            if (age > this.limits.maxOrderAge) {
                try {
                    // 取引所側でキャンセル
                    await this.exchange.cancelOrder(orderData.orderId, orderData.symbol);
                } catch (error) {
                    // キャンセル失敗してもRedisからは削除
                    console.log(`キャンセル失敗 (${orderData.orderId}): ${error.message}`);
                }
                
                // Redisから削除
                await this.redis.del(key);
                cleanedCount++;
            }
        }

        return cleanedCount;
    }

    // シンボル別過多注文のクリーンアップ
    async cleanupExcessiveSymbolOrders(symbol, limit) {
        const symbolKeys = await this.redis.keys(`pending_order:*:${symbol}:*`);
        if (symbolKeys.length <= limit) return 0;

        // 古い順にソートして超過分を削除
        const orders = [];
        for (const key of symbolKeys) {
            const orderData = await this.redis.hGetAll(key);
            orders.push({ ...orderData, key, timestamp: parseInt(orderData.timestamp) || 0 });
        }

        orders.sort((a, b) => a.timestamp - b.timestamp);
        const excessCount = orders.length - limit;
        let cleanedCount = 0;

        for (let i = 0; i < excessCount; i++) {
            const order = orders[i];
            try {
                await this.exchange.cancelOrder(order.orderId, order.symbol);
            } catch (error) {
                console.log(`キャンセル失敗 (${order.orderId}): ${error.message}`);
            }
            
            await this.redis.del(order.key);
            cleanedCount++;
        }

        return cleanedCount;
    }

    // 過多な買い注文のクリーンアップ
    async cleanupExcessiveBuyOrders() {
        const allKeys = await this.redis.keys('pending_order:*');
        const buyOrders = [];

        for (const key of allKeys) {
            const orderData = await this.redis.hGetAll(key);
            if (orderData.side === 'buy') {
                buyOrders.push({ ...orderData, key, timestamp: parseInt(orderData.timestamp) || 0 });
            }
        }

        // 目標: 買い注文比率を制限内に戻す
        const totalOrders = allKeys.length;
        const targetBuyCount = Math.floor(totalOrders * this.limits.maxBuyRatio);
        const excessBuyCount = Math.max(0, buyOrders.length - targetBuyCount);

        if (excessBuyCount === 0) return 0;

        // 古い買い注文から削除
        buyOrders.sort((a, b) => a.timestamp - b.timestamp);
        let cleanedCount = 0;

        for (let i = 0; i < excessBuyCount; i++) {
            const order = buyOrders[i];
            try {
                await this.exchange.cancelOrder(order.orderId, order.symbol);
            } catch (error) {
                console.log(`キャンセル失敗 (${order.orderId}): ${error.message}`);
            }
            
            await this.redis.del(order.key);
            cleanedCount++;
        }

        return cleanedCount;
    }

    // 制限設定の更新
    updateLimits(newLimits) {
        this.limits = { ...this.limits, ...newLimits };
        console.log('制限設定を更新しました:', this.limits);
    }

    // 緊急モードの切り替え
    setEmergencyMode(enabled, reason = '') {
        this.isEmergencyMode = enabled;
        console.log(`緊急モード: ${enabled ? 'ON' : 'OFF'}${reason ? ` (理由: ${reason})` : ''}`);
    }

    // ヘルスチェック
    async healthCheck() {
        const stats = await this.getCurrentStats();
        const violations = await this.detectLimitViolations();
        
        const health = {
            status: violations.length === 0 ? 'healthy' : 'unhealthy',
            totalOrders: stats.total,
            utilization: (stats.total / this.limits.maxTotalPendingOrders * 100).toFixed(1) + '%',
            buyRatio: (stats.buyRatio * 100).toFixed(1) + '%',
            violations: violations.length,
            emergencyMode: this.isEmergencyMode,
            lastCleanup: this.lastCleanupTime ? new Date(this.lastCleanupTime).toLocaleString() : 'never'
        };

        return health;
    }
}

module.exports = PendingOrderLimitManager;