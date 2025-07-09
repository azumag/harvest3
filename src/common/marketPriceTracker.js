const ccxt = require('ccxt');
const marketDataProvider = require('../data/marketDataProvider');

class MarketPriceTracker {
  constructor(exchangeInstance, redisClient) {
    this.exchange = exchangeInstance;
    this.redis = redisClient;
    this.priceAdjustmentThreshold = 0.02; // 2%の価格変動で調整実行
    this.maxAdjustmentPercent = 0.05; // 最大5%の価格調整
    this.adjustmentInterval = 30 * 60 * 1000; // 30分間隔で調整
    this.lastAdjustmentTime = {};
  }

  // 市場価格の取得と記録
  async recordMarketPrice(symbol) {
    try {
      const ticker = await marketDataProvider.fetchTicker(this.exchange, symbol);
      const currentPrice = ticker.last;
      const timestamp = Date.now();

      // Redisに現在価格を記録
      const priceKey = `market_price:${symbol}`;
      await this.redis.hSet(priceKey, {
        price: currentPrice.toString(),
        timestamp: timestamp.toString(),
        bid: ticker.bid ? ticker.bid.toString() : '0',
        ask: ticker.ask ? ticker.ask.toString() : '0',
        volume: ticker.baseVolume ? ticker.baseVolume.toString() : '0'
      });

      // 24時間で期限切れ
      await this.redis.expire(priceKey, 24 * 60 * 60);

      return {
        symbol,
        price: currentPrice,
        timestamp,
        bid: ticker.bid,
        ask: ticker.ask
      };

    } catch (error) {
      console.error(`価格記録エラー ${symbol}:`, error.message);
      return null;
    }
  }

  // 価格変動率の計算
  async calculatePriceChange(symbol, timeframeMinutes = 30) {
    try {
      const priceKey = `market_price:${symbol}`;
      const currentData = await this.redis.hGetAll(priceKey);

      if (!currentData.price) {
        // 現在価格が記録されていない場合は取得
        const priceData = await this.recordMarketPrice(symbol);
        return priceData ? { changePercent: 0, needsAdjustment: false } : null;
      }

      const currentPrice = parseFloat(currentData.price);
      const currentTime = parseInt(currentData.timestamp);

      // 過去の価格データキーを検索
      const historicalKey = `price_history:${symbol}:${Math.floor((currentTime - timeframeMinutes * 60 * 1000) / (5 * 60 * 1000))}`;
      const historicalData = await this.redis.hGetAll(historicalKey);

      if (!historicalData.price) {
        // 履歴データがない場合は現在価格を基準とする
        return { changePercent: 0, needsAdjustment: false };
      }

      const historicalPrice = parseFloat(historicalData.price);
      const changePercent = (currentPrice - historicalPrice) / historicalPrice;
      const needsAdjustment = Math.abs(changePercent) >= this.priceAdjustmentThreshold;

      return {
        currentPrice,
        historicalPrice,
        changePercent,
        needsAdjustment,
        timeframe: timeframeMinutes
      };

    } catch (error) {
      console.error(`価格変動計算エラー ${symbol}:`, error.message);
      return null;
    }
  }

  // 未約定注文の価格調整
  async adjustPendingOrdersPrices(symbol) {
    try {
      console.log(`\n=== ${symbol} 価格調整開始 ===`);

      // 調整間隔チェック
      const lastAdjusted = this.lastAdjustmentTime[symbol] || 0;
      if (Date.now() - lastAdjusted < this.adjustmentInterval) {
        console.log(`${symbol}: 調整間隔未達 (${Math.floor((Date.now() - lastAdjusted) / 60000)}分前に実行済み)`);
        return { adjusted: 0, skipped: 'interval' };
      }

      // 価格変動の確認
      const priceChange = await this.calculatePriceChange(symbol);
      if (!priceChange || !priceChange.needsAdjustment) {
        console.log(`${symbol}: 価格調整不要 (変動率: ${priceChange ? (priceChange.changePercent * 100).toFixed(2) : 'N/A'}%)`);
        return { adjusted: 0, skipped: 'no_change' };
      }

      console.log(`${symbol}: 価格変動検出 ${(priceChange.changePercent * 100).toFixed(2)}% - 調整実行`);

      // 対象シンボルの未約定注文を取得
      const pendingOrderKeys = await this.redis.keys(`pending_order:*:${symbol}:*`);
      let adjustedCount = 0;
      const errors = [];

      for (const key of pendingOrderKeys) {
        try {
          const orderData = await this.redis.hGetAll(key);
          if (!orderData.orderId || !orderData.price) {
            continue;
          }

          const currentOrderPrice = parseFloat(orderData.price);
          const newPrice = this.calculateAdjustedPrice(
            currentOrderPrice,
            priceChange.currentPrice,
            orderData.side,
            priceChange.changePercent
          );

          // 価格変更が微小な場合はスキップ
          const priceChangePercent = Math.abs((newPrice - currentOrderPrice) / currentOrderPrice);
          if (priceChangePercent < 0.005) { // 0.5%未満の変更はスキップ
            continue;
          }

          // 取引所側で注文を更新（キャンセル→再注文）
          const updateResult = await this.updateOrderPrice(orderData, newPrice);

          if (updateResult.success) {
            // Redis内のデータも更新
            await this.redis.hSet(key, {
              price: newPrice.toString(),
              orderId: updateResult.newOrderId,
              lastAdjusted: Date.now().toString()
            });

            adjustedCount++;
            console.log(`  ✅ ${orderData.side} ¥${currentOrderPrice.toLocaleString()} → ¥${newPrice.toLocaleString()}`);
          } else {
            errors.push(`${orderData.orderId}: ${updateResult.error}`);
          }

          // レート制限対策
          await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (error) {
          errors.push(`${key}: ${error.message}`);
        }
      }

      // 調整時刻を記録
      this.lastAdjustmentTime[symbol] = Date.now();

      console.log(`${symbol}: 調整完了 ${adjustedCount}/${pendingOrderKeys.length}件`);
      if (errors.length > 0) {
        console.log(`エラー: ${errors.length}件`);
        errors.slice(0, 3).forEach(err => console.log(`  - ${err}`));
      }

      return {
        adjusted: adjustedCount,
        total: pendingOrderKeys.length,
        errors: errors.length,
        priceChange: priceChange.changePercent
      };

    } catch (error) {
      console.error(`価格調整エラー ${symbol}:`, error);
      return { adjusted: 0, error: error.message };
    }
  }

  // 調整後価格の計算
  calculateAdjustedPrice(currentOrderPrice, marketPrice, side, marketChangePercent) {
    // 市場価格の変動方向に応じて注文価格を調整
    const adjustmentFactor = Math.min(Math.abs(marketChangePercent), this.maxAdjustmentPercent);

    if (side === 'buy') {
      // 買い注文: 市場価格上昇時は注文価格も上げ、下落時は下げる
      // ただし市場価格を超えないように制限
      const adjustedPrice = currentOrderPrice * (1 + marketChangePercent * 0.5);
      return Math.min(adjustedPrice, marketPrice * 0.998); // 市場価格の99.8%まで
    } else {
      // 売り注文: 市場価格上昇時は注文価格も上げ、下落時は下げる
      // ただし市場価格を下回らないように制限
      const adjustedPrice = currentOrderPrice * (1 + marketChangePercent * 0.5);
      return Math.max(adjustedPrice, marketPrice * 1.002); // 市場価格の100.2%以上
    }
  }

  // 注文価格の更新（キャンセル→再注文）
  async updateOrderPrice(orderData, newPrice) {
    try {
      // 既存注文をキャンセル
      await this.exchange.cancelOrder(orderData.orderId, orderData.symbol);

      // 新しい価格で再注文
      const newOrder = await this.exchange.createLimitOrder(
        orderData.symbol,
        orderData.side,
        parseFloat(orderData.amount),
        newPrice
      );

      return {
        success: true,
        newOrderId: newOrder.id,
        oldPrice: parseFloat(orderData.price),
        newPrice: newPrice
      };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // 複数シンボルの一括価格調整
  async adjustMultipleSymbols(symbols) {
    console.log('\n=== 一括価格調整開始 ===');
    const results = {};

    for (const symbol of symbols) {
      // 価格記録
      await this.recordMarketPrice(symbol);

      // 調整実行
      results[symbol] = await this.adjustPendingOrdersPrices(symbol);

      // 間隔を空ける
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // 結果サマリー
    const totalAdjusted = Object.values(results).reduce((sum, r) => sum + (r.adjusted || 0), 0);
    const totalErrors = Object.values(results).reduce((sum, r) => sum + (r.errors || 0), 0);

    console.log('\n=== 一括調整完了 ===');
    console.log(`合計調整数: ${totalAdjusted}件`);
    console.log(`合計エラー: ${totalErrors}件`);

    return results;
  }

  // 設定更新
  updateConfig(config) {
    if (config.priceAdjustmentThreshold) {
      this.priceAdjustmentThreshold = config.priceAdjustmentThreshold;
    }
    if (config.maxAdjustmentPercent) {
      this.maxAdjustmentPercent = config.maxAdjustmentPercent;
    }
    if (config.adjustmentInterval) {
      this.adjustmentInterval = config.adjustmentInterval;
    }
  }
}

module.exports = MarketPriceTracker;