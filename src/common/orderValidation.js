const ccxt = require('ccxt');
const marketDataProvider = require('../data/marketDataProvider');

class OrderValidation {
  constructor(exchangeInstance) {
    this.exchange = exchangeInstance;
    this.priceTolerancePercent = 0.03; // 3%の価格乖離許容範囲
    this.maxOrderAge = 6 * 60 * 60 * 1000; // 6時間の最大注文保持時間
    this.maxPendingOrdersPerSymbol = 3; // シンボル別最大未約定注文数
    this.maxBuyRatio = 0.75; // 買い注文の最大比率75%
  }

  // 市場価格に対する注文価格の妥当性チェック
  async validateOrderPrice(symbol, side, orderPrice) {
    try {
      const ticker = await marketDataProvider.fetchTicker(this.exchange, symbol);
      const marketPrice = ticker.last;

      if (!marketPrice || marketPrice <= 0) {
        return { valid: false, reason: '市場価格取得失敗' };
      }

      const priceDeviation = Math.abs((orderPrice - marketPrice) / marketPrice);

      if (priceDeviation > this.priceTolerancePercent) {
        return {
          valid: false,
          reason: '価格乖離過大',
          details: {
            orderPrice,
            marketPrice,
            deviation: (priceDeviation * 100).toFixed(2) + '%',
            threshold: (this.priceTolerancePercent * 100).toFixed(1) + '%'
          }
        };
      }

      // 買い注文は市場価格以下、売り注文は市場価格以上であることを確認
      if (side === 'buy' && orderPrice > marketPrice * (1 + this.priceTolerancePercent)) {
        return {
          valid: false,
          reason: '買い注文価格が高すぎる',
          details: { orderPrice, marketPrice, maxAllowed: marketPrice * (1 + this.priceTolerancePercent) }
        };
      }

      if (side === 'sell' && orderPrice < marketPrice * (1 - this.priceTolerancePercent)) {
        return {
          valid: false,
          reason: '売り注文価格が安すぎる',
          details: { orderPrice, marketPrice, minAllowed: marketPrice * (1 - this.priceTolerancePercent) }
        };
      }

      return { valid: true };

    } catch (error) {
      return { valid: false, reason: `市場価格取得エラー: ${error.message}` };
    }
  }

  // 未約定注文の上限チェック
  async validatePendingOrderLimits(client, symbol, side) {
    try {
      // シンボル別未約定注文数チェック
      const symbolPattern = `pending_order:*:${symbol}:*`;
      const symbolOrders = await client.keys(symbolPattern);

      if (symbolOrders.length >= this.maxPendingOrdersPerSymbol) {
        return {
          valid: false,
          reason: `${symbol}の未約定注文上限超過`,
          details: {
            current: symbolOrders.length,
            limit: this.maxPendingOrdersPerSymbol
          }
        };
      }

      // 全体的な買い売りバランスチェック
      const allPendingOrders = await client.keys('pending_order:*');
      let buyCount = 0;
      let sellCount = 0;

      for (const key of allPendingOrders) {
        const orderData = await client.hGetAll(key);
        if (orderData.side === 'buy') {
          buyCount++;
        } else if (orderData.side === 'sell') {
          sellCount++;
        }
      }

      const totalOrders = buyCount + sellCount;
      if (totalOrders > 0) {
        const buyRatio = buyCount / totalOrders;

        // 新規買い注文が買い比率をさらに悪化させる場合は拒否
        if (side === 'buy' && buyRatio >= this.maxBuyRatio) {
          return {
            valid: false,
            reason: '買い注文比率上限超過',
            details: {
              currentBuyRatio: (buyRatio * 100).toFixed(1) + '%',
              limit: (this.maxBuyRatio * 100).toFixed(1) + '%',
              buyCount,
              sellCount
            }
          };
        }
      }

      return { valid: true };

    } catch (error) {
      return { valid: false, reason: `未約定注文チェックエラー: ${error.message}` };
    }
  }

  // 注文の総合妥当性チェック
  async validateOrder(client, symbol, side, price, amount) {
    const validations = [];

    // 価格妥当性チェック
    const priceValidation = await this.validateOrderPrice(symbol, side, price);
    validations.push({ type: 'price', ...priceValidation });

    // 未約定注文上限チェック
    const limitValidation = await this.validatePendingOrderLimits(client, symbol, side);
    validations.push({ type: 'limits', ...limitValidation });

    // 注文金額の妥当性チェック（極小・極大注文の防止）
    const orderValue = price * amount;
    if (orderValue < 500) { // 500円未満
      validations.push({
        type: 'amount',
        valid: false,
        reason: '注文金額が小さすぎます',
        details: { orderValue, minimum: 500 }
      });
    }

    if (orderValue > 100000) { // 10万円超過
      validations.push({
        type: 'amount',
        valid: false,
        reason: '注文金額が大きすぎます',
        details: { orderValue, maximum: 100000 }
      });
    }

    // 全体的な結果
    const allValid = validations.every(v => v.valid);
    const errors = validations.filter(v => !v.valid);

    return {
      valid: allValid,
      validations,
      errors,
      summary: allValid ? '注文は妥当です' : `${errors.length}件の問題があります`
    };
  }

  // 推奨注文価格の算出
  async getRecommendedPrice(symbol, side) {
    try {
      const ticker = await marketDataProvider.fetchTicker(this.exchange, symbol);
      const marketPrice = ticker.last;

      if (side === 'buy') {
        // 買い注文: 市場価格より少し低めを推奨
        return marketPrice * (1 - this.priceTolerancePercent / 2);
      } else {
        // 売り注文: 市場価格より少し高めを推奨
        return marketPrice * (1 + this.priceTolerancePercent / 2);
      }
    } catch (error) {
      throw new Error(`推奨価格算出エラー: ${error.message}`);
    }
  }

  // 設定可能パラメータの更新
  updateConfig(config) {
    if (config.priceTolerancePercent) {
      this.priceTolerancePercent = config.priceTolerancePercent;
    }
    if (config.maxOrderAge) {
      this.maxOrderAge = config.maxOrderAge;
    }
    if (config.maxPendingOrdersPerSymbol) {
      this.maxPendingOrdersPerSymbol = config.maxPendingOrdersPerSymbol;
    }
    if (config.maxBuyRatio) {
      this.maxBuyRatio = config.maxBuyRatio;
    }
  }
}

module.exports = OrderValidation;