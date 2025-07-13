const Logger = require('../utils/Logger'); // ロギングユーティリティを使用
const { addOrderMongoDB, updateOrderByOrderId } = require('../../database/manager');
const { withBitbankErrorHandling } = require('../../common/bitbankErrorHandler');
const { sleep } = require('../../common/utils');

class OrderProcessor {
  constructor(config, exchange) {
    this.config = config; // APIキー、取引量設定などを含む可能性
    this.exchange = exchange; // CCXT exchange instance
    this.logger = new Logger('OrderProcessor');
    
    if (!this.exchange) {
      this.logger.warn('No exchange instance provided, running in mock mode');
      this.mockMode = true;
    } else {
      this.mockMode = false;
    }
  }

  /**
   * 買い注文を実行します。
   * @param {string} pair - 通貨ペア
   * @param {number} price - 注文価格
   * @param {number} amount - 注文量
   * @returns {Promise<object>} - 注文結果
   */
  async placeBuyOrder(pair, price, amount) {
    this.logger.info(`Placing buy order for ${pair}: price=${price}, amount=${amount}`);
    try {
      // 残高確認
      if (!this.mockMode) {
        await this._verifyBuyOrderBalance(pair, price, amount);
      }
      
      let orderResult;
      
      if (this.mockMode) {
        // モックモード: 仮の成功レスポンス
        orderResult = {
          id: 'dummy_buy_' + Date.now(),
          symbol: pair,
          side: 'buy',
          price: price,
          amount: amount,
          timestamp: Date.now(),
          status: 'open',
          filled: 0,
          remaining: amount,
          fee: { cost: 0, currency: 'JPY' }
        };
      } else {
        // 実際のAPI呼び出し
        orderResult = await withBitbankErrorHandling(async () => {
          return await this.exchange.createOrder(pair, 'limit', 'buy', amount, price);
        });
      }
      
      // データベースに注文情報を記録
      await addOrderMongoDB({
        orderId: orderResult.id,
        exchange: this.exchange?.id || 'mock',
        symbol: pair,
        side: 'buy',
        amount: amount,
        price: price,
        timestamp: orderResult.timestamp || Date.now(),
        status: orderResult.status || 'open',
        strategy: 'HFT'
      });

      this.logger.info(`Buy order placed successfully for ${pair}: Order ID ${orderResult.id}`);
      return orderResult;
    } catch (error) {
      this.logger.error(`Failed to place buy order for ${pair}:`, error);
      throw error; // 注文失敗を通知
    }
  }

  /**
   * 売り注文を実行します。
   * @param {string} pair - 通貨ペア
   * @param {number} price - 注文価格
   * @param {number} amount - 注文量
   * @returns {Promise<object>} - 注文結果
   */
  async placeSellOrder(pair, price, amount) {
    this.logger.info(`Placing sell order for ${pair}: price=${price}, amount=${amount}`);
    try {
      // 残高確認
      if (!this.mockMode) {
        await this._verifySellOrderBalance(pair, amount);
      }
      
      let orderResult;
      
      if (this.mockMode) {
        // モックモード: 仮の成功レスポンス
        orderResult = {
          id: 'dummy_sell_' + Date.now(),
          symbol: pair,
          side: 'sell',
          price: price,
          amount: amount,
          timestamp: Date.now(),
          status: 'open',
          filled: 0,
          remaining: amount,
          fee: { cost: 0, currency: 'JPY' }
        };
      } else {
        // 実際のAPI呼び出し
        orderResult = await withBitbankErrorHandling(async () => {
          return await this.exchange.createOrder(pair, 'limit', 'sell', amount, price);
        });
      }
      
      // データベースに注文情報を記録
      await addOrderMongoDB({
        orderId: orderResult.id,
        exchange: this.exchange?.id || 'mock',
        symbol: pair,
        side: 'sell',
        amount: amount,
        price: price,
        timestamp: orderResult.timestamp || Date.now(),
        status: orderResult.status || 'open',
        strategy: 'HFT'
      });

      this.logger.info(`Sell order placed successfully for ${pair}: Order ID ${orderResult.id}`);
      return orderResult;
    } catch (error) {
      this.logger.error(`Failed to place sell order for ${pair}:`, error);
      throw error; // 注文失敗を通知
    }
  }

  /**
   * 注文をキャンセルします。
   * @param {string} orderId - キャンセルする注文ID
   * @param {string} pair - 通貨ペア
   * @returns {Promise<object>} - キャンセル結果
   */
  async cancelOrder(orderId, pair) {
    this.logger.info(`Cancelling order ${orderId} for ${pair}`);
    try {
      let cancelResult;
      
      if (this.mockMode) {
        cancelResult = {
          id: orderId,
          status: 'canceled',
          timestamp: Date.now()
        };
      } else {
        cancelResult = await withBitbankErrorHandling(async () => {
          return await this.exchange.cancelOrder(orderId, pair);
        });
      }
      
      // データベースの注文ステータスを更新
      await updateOrderByOrderId(orderId, {
        status: 'canceled',
        updatedAt: cancelResult.timestamp || Date.now()
      });
      
      this.logger.info(`Order ${orderId} cancelled successfully`);
      return cancelResult;
    } catch (error) {
      this.logger.error(`Failed to cancel order ${orderId}:`, error);
      throw error;
    }
  }
  
  /**
   * 注文の状況を確認します。
   * @param {string} orderId - 確認する注文ID
   * @param {string} pair - 通貨ペア
   * @returns {Promise<object>} - 注文情報
   */
  async getOrderStatus(orderId, pair) {
    try {
      let orderInfo;
      
      if (this.mockMode) {
        orderInfo = {
          id: orderId,
          status: 'open',
          filled: 0,
          remaining: 1.0,
          timestamp: Date.now()
        };
      } else {
        orderInfo = await withBitbankErrorHandling(async () => {
          return await this.exchange.fetchOrder(orderId, pair);
        });
        
        // ステータスが変更されていればデータベースを更新
        await updateOrderByOrderId(orderId, {
          status: orderInfo.status,
          filled: orderInfo.filled,
          remaining: orderInfo.remaining,
          updatedAt: orderInfo.timestamp || Date.now()
        });
      }
      
      return orderInfo;
    } catch (error) {
      this.logger.error(`Failed to get order status for ${orderId}:`, error);
      throw error;
    }
  }
  
  /**
   * アクティブな注文一覧を取得します。
   * @param {string} pair - 通貨ペア
   * @returns {Promise<Array>} - アクティブな注文一覧
   */
  async getActiveOrders(pair) {
    try {
      if (this.mockMode) {
        return [];
      }
      
      const orders = await withBitbankErrorHandling(async () => {
        return await this.exchange.fetchOpenOrders(pair);
      });
      
      this.logger.debug(`Found ${orders.length} active orders for ${pair}`);
      return orders;
    } catch (error) {
      this.logger.error(`Failed to get active orders for ${pair}:`, error);
      throw error;
    }
  }
  
  /**
   * 買い注文の残高を確認
   * @param {string} pair - 通貨ペア
   * @param {number} price - 注文価格
   * @param {number} amount - 注文量
   */
  async _verifyBuyOrderBalance(pair, price, amount) {
    try {
      const balance = await this.exchange.fetchBalance();
      const requiredAmount = price * amount;
      const quoteCurrency = pair.split('/')[1]; // 例: BTC/JPY → JPY
      const availableBalance = balance.free[quoteCurrency] || 0;
      
      this.logger.debug(`Balance check for buy order: required=${requiredAmount} ${quoteCurrency}, available=${availableBalance} ${quoteCurrency}`);
      
      if (availableBalance < requiredAmount) {
        throw new Error(`Insufficient balance for buy order: ${availableBalance} ${quoteCurrency} < ${requiredAmount} ${quoteCurrency}`);
      }
    } catch (error) {
      this.logger.error('Balance verification failed for buy order:', error);
      throw error;
    }
  }
  
  /**
   * 売り注文の残高を確認
   * @param {string} pair - 通貨ペア
   * @param {number} amount - 注文量
   */
  async _verifySellOrderBalance(pair, amount) {
    try {
      const balance = await this.exchange.fetchBalance();
      const baseCurrency = pair.split('/')[0]; // 例: BTC/JPY → BTC
      const availableBalance = balance.free[baseCurrency] || 0;
      
      this.logger.debug(`Balance check for sell order: required=${amount} ${baseCurrency}, available=${availableBalance} ${baseCurrency}`);
      
      if (availableBalance < amount) {
        throw new Error(`Insufficient balance for sell order: ${availableBalance} ${baseCurrency} < ${amount} ${baseCurrency}`);
      }
    } catch (error) {
      this.logger.error('Balance verification failed for sell order:', error);
      throw error;
    }
  }
}

module.exports = OrderProcessor;