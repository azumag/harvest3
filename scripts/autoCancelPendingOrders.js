const redis = require('redis');
const ccxt = require('ccxt');

class PendingOrderManager {
  constructor() {
    this.client = null;
    this.exchanges = {};
  }

  async init() {
    this.client = redis.createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    });
    await this.client.connect();

    // 取引所を初期化
    this.exchanges.bitbank = new ccxt.bitbank({
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

  // 市場価格から大幅に乖離した注文を検出
  async findStaleOrders() {
    const pendingOrderKeys = await this.client.keys('pending_order:*');
    const staleOrders = [];
    const priceDeviationThreshold = 0.05; // 5%以上の価格乖離

    console.log(`\n検査対象: ${pendingOrderKeys.length}件の未約定注文`);

    for (const key of pendingOrderKeys) {
      try {
        const orderData = await this.client.hGetAll(key);

        if (!orderData.symbol || !orderData.price) {
          continue;
        }

        // 現在の市場価格を取得
        const ticker = await this.exchanges.bitbank.fetchTicker(orderData.symbol);
        const currentPrice = ticker.last;
        const orderPrice = parseFloat(orderData.price);

        // 価格乖離率を計算
        const deviation = Math.abs((orderPrice - currentPrice) / currentPrice);

        // 5%以上乖離または異常なタイムスタンプの注文をマーク
        const timestamp = parseInt(orderData.timestamp);
        const isStaleTime = timestamp > Date.now() || (Date.now() - timestamp > 24 * 60 * 60 * 1000);

        if (deviation > priceDeviationThreshold || isStaleTime) {
          staleOrders.push({
            ...orderData,
            key,
            currentPrice,
            deviation: (deviation * 100).toFixed(2),
            reason: deviation > priceDeviationThreshold ? '価格乖離' : '時間経過'
          });
        }

        // 処理間隔を設ける（レート制限対策）
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        console.log(`エラー処理中 ${key}: ${error.message}`);
      }
    }

    return staleOrders;
  }

  // 買い注文過多の調整
  async balanceBuySellRatio() {
    const pendingOrderKeys = await this.client.keys('pending_order:*');
    let buyCount = 0;
    let sellCount = 0;
    const buyOrders = [];

    for (const key of pendingOrderKeys) {
      const orderData = await this.client.hGetAll(key);
      if (orderData.side === 'buy') {
        buyCount++;
        buyOrders.push({ ...orderData, key });
      } else if (orderData.side === 'sell') {
        sellCount++;
      }
    }

    const totalOrders = buyCount + sellCount;
    const buyRatio = buyCount / totalOrders;

    console.log(`\n買い注文比率: ${(buyRatio * 100).toFixed(1)}% (${buyCount}/${totalOrders})`);

    // 90%以上が買い注文の場合、古い買い注文をキャンセル対象にする
    if (buyRatio > 0.90) {
      console.log('⚠️ 買い注文が90%以上！調整が必要です');

      // タイムスタンプで並び替え（古い順）
      buyOrders.sort((a, b) => parseInt(a.timestamp) - parseInt(b.timestamp));

      // 上位30%をキャンセル対象とする
      const cancelCount = Math.floor(buyOrders.length * 0.3);
      return buyOrders.slice(0, cancelCount).map(order => ({
        ...order,
        reason: '買い注文過多調整'
      }));
    }

    return [];
  }

  // 注文キャンセル実行
  async cancelOrder(orderInfo) {
    try {
      // 取引所側でキャンセル
      await this.exchanges.bitbank.cancelOrder(orderInfo.orderId, orderInfo.symbol);

      // Redis からも削除
      await this.client.del(orderInfo.key);

      console.log(`✅ キャンセル成功: ${orderInfo.symbol} ${orderInfo.side} ${orderInfo.price} (理由: ${orderInfo.reason})`);
      return true;
    } catch (error) {
      console.log(`❌ キャンセル失敗: ${orderInfo.orderId} - ${error.message}`);

      // 取引所側でキャンセル失敗した場合でも、Redisからは削除する（不整合解消）
      if (error.message.includes('Order not found') || error.message.includes('already')) {
        await this.client.del(orderInfo.key);
        console.log(`🔧 Redis から削除しました（不整合解消）: ${orderInfo.key}`);
        return true;
      }
      return false;
    }
  }

  // メイン実行関数
  async run(options = {}) {
    try {
      console.log('\n=== 未約定注文自動キャンセル開始 ===\n');

      const { dryRun = false, maxCancelCount = 50 } = options;

      // 価格乖離・時間経過による不良注文を検出
      const staleOrders = await this.findStaleOrders();
      console.log(`\n価格乖離・時間経過による対象注文: ${staleOrders.length}件`);

      // 買い注文過多調整
      const buyAdjustmentOrders = await this.balanceBuySellRatio();
      console.log(`買い注文過多調整対象: ${buyAdjustmentOrders.length}件`);

      // 全キャンセル対象をまとめる
      const allCancelTargets = [...staleOrders, ...buyAdjustmentOrders];
      const limitedTargets = allCancelTargets.slice(0, maxCancelCount);

      console.log(`\n=== キャンセル対象: ${limitedTargets.length}件 (上限: ${maxCancelCount}) ===`);

      if (limitedTargets.length === 0) {
        console.log('キャンセル対象の注文はありません。');
        return;
      }

      // キャンセル対象を表示
      for (const order of limitedTargets) {
        console.log(`${order.symbol} ${order.side} ${order.price} - ${order.reason} (乖離: ${order.deviation}%)`);
      }

      if (dryRun) {
        console.log('\n⚠️ ドライランモード: 実際のキャンセルは実行されません');
        return;
      }

      // 実際のキャンセル実行
      console.log('\n=== キャンセル実行中 ===');
      let successCount = 0;

      for (const order of limitedTargets) {
        const success = await this.cancelOrder(order);
        if (success) {
          successCount++;
        }

        // レート制限対策
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      console.log('\n=== 完了 ===');
      console.log(`キャンセル成功: ${successCount}/${limitedTargets.length}件`);

    } catch (error) {
      console.error('エラー:', error);
    }
  }
}

// コマンドライン引数の処理
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const maxCancelCount = parseInt(args.find(arg => arg.startsWith('--max='))?.split('=')[1]) || 50;

// 実行
(async () => {
  const manager = new PendingOrderManager();
  await manager.init();

  try {
    await manager.run({ dryRun, maxCancelCount });
  } finally {
    await manager.close();
  }
})().catch(console.error);