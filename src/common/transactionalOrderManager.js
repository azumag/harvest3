/**
 * トランザクショナル注文管理システム
 * Save-First, Then-Execute パターンの実装
 * 孤立取引を防ぐための根本的解決策
 */

const { addOrderMongoDB, updateOrderByOrderId, listOrders } = require('../database/mongoDatabase');
const { postOrderToDiscord, postErrorToDiscord } = require('./notifications');

class TransactionalOrderManager {
  constructor(exchange) {
    this.exchange = exchange;
    this.pendingOrders = new Map(); // Tracks pre-saved orders
    this.completedOrders = new Map(); // Tracks completed transactions
    this.maxRetries = 3;
    this.retryDelay = 1000;
  }

  /**
   * トランザクショナル注文実行
   * Phase 1: MongoDB事前保存
   * Phase 2: 取引所注文実行
   * Phase 3: MongoDB更新（実際の注文IDで）
   */
  async executeTransactionalOrder(symbol, side, amount, price, options = {}) {
    const transactionId = this.generateTransactionId();
    let preOrder = null;
    let exchangeOrder = null;

    try {
      console.log(`[トランザクショナル注文] 開始: ${transactionId} ${symbol} ${side}`);

      // Phase 1: MongoDB事前保存
      preOrder = await this.saveOrderBeforeExecution(
        transactionId, symbol, side, amount, price, options
      );

      // Phase 2: 取引所注文実行
      exchangeOrder = await this.executeExchangeOrder(
        symbol, side, amount, price, options
      );

      // Phase 3: MongoDB更新（実際の注文IDで）
      await this.updateOrderAfterExecution(
        preOrder, exchangeOrder, transactionId
      );

      // Phase 4: トランザクション完了記録
      await this.completeTransaction(transactionId, exchangeOrder);

      console.log(`[トランザクショナル注文] 成功: ${transactionId} -> ${exchangeOrder.id}`);

      return {
        success: true,
        order: exchangeOrder,
        transactionId,
        preOrderId: preOrder.id
      };

    } catch (error) {
      console.error(`[トランザクショナル注文] エラー: ${transactionId} - ${error.message}`);

      // ロールバック処理
      await this.rollbackTransaction(transactionId, preOrder, exchangeOrder, error);

      return {
        success: false,
        error,
        transactionId,
        preOrderId: preOrder?.id,
        exchangeOrderId: exchangeOrder?.id
      };
    }
  }

  /**
   * Phase 1: MongoDB事前保存
   */
  async saveOrderBeforeExecution(transactionId, symbol, side, amount, price, options) {
    const preOrderId = `pre_${transactionId}`;

    const preOrder = {
      id: preOrderId,
      orderId: preOrderId,
      transactionId,
      symbol,
      side,
      amount,
      price,
      orderType: options.type || 'limit', // Use orderType instead of type
      status: 'pre_saved',
      strategy: options.strategy || 'UNKNOWN',
      exchange: this.exchange.id,
      timestamp: Date.now(),
      metadata: {
        phase: 'pre_execution',
        originalParams: options
      }
    };

    try {
      await addOrderMongoDB(preOrder);
      this.pendingOrders.set(transactionId, preOrder);

      console.log(`[Phase 1] 事前保存完了: ${preOrderId} 戦略: ${preOrder.strategy}`);
      return preOrder;

    } catch (error) {
      console.error(`[Phase 1] 事前保存エラー: ${error.message}`);
      throw new Error(`MongoDB事前保存失敗: ${error.message}`);
    }
  }

  /**
   * Phase 2: 取引所注文実行
   */
  async executeExchangeOrder(symbol, side, amount, price, options) {
    const params = this.buildOrderParams(options);
    let lastError = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        console.log(`[Phase 2] 取引所注文実行 (試行 ${attempt}/${this.maxRetries})`);

        let order;
        if (options.type === 'market') {
          order = side === 'buy'
            ? await this.exchange.createMarketBuyOrder(symbol, amount, params)
            : await this.exchange.createMarketSellOrder(symbol, amount, params);
        } else {
          order = side === 'buy'
            ? await this.exchange.createLimitBuyOrder(symbol, amount, price, params)
            : await this.exchange.createLimitSellOrder(symbol, amount, price, params);
        }

        if (order && order.id) {
          console.log(`[Phase 2] 取引所注文成功: ${order.id}`);
          return order;
        } else {
          throw new Error('注文IDが取得できませんでした');
        }

      } catch (error) {
        lastError = error;
        console.warn(`[Phase 2] 試行 ${attempt} 失敗: ${error.message}`);

        if (attempt < this.maxRetries) {
          await this.sleep(this.retryDelay * attempt);
        }
      }
    }

    throw new Error(`取引所注文失敗 (全${this.maxRetries}回試行): ${lastError.message}`);
  }

  /**
   * Phase 3: MongoDB更新（実際の注文IDで）
   */
  async updateOrderAfterExecution(preOrder, exchangeOrder, transactionId) {
    try {
      const updateData = {
        orderId: exchangeOrder.id || exchangeOrder.orderId, // Update to actual order ID
        orderType: exchangeOrder.type || exchangeOrder.orderType || preOrder.orderType,
        exchange: exchangeOrder.exchange || this.exchange.id,
        symbol: exchangeOrder.symbol || preOrder.symbol,
        side: exchangeOrder.side || preOrder.side,
        amount: exchangeOrder.amount || preOrder.amount,
        price: exchangeOrder.price || preOrder.price,
        status: 'executed',
        strategy: preOrder.strategy,
        transactionId,
        preOrderId: preOrder.id,
        executionTimestamp: Date.now(),
        metadata: {
          phase: 'post_execution',
          originalPreOrder: preOrder.id,
          executionTimestamp: Date.now(),
          exchangeResponse: exchangeOrder
        }
      };

      // Update the existing pre-saved order instead of creating a new one
      const result = await updateOrderByOrderId(preOrder.orderId, updateData);

      if (result.matchedCount === 0) {
        console.warn(`[Phase 3] 事前保存注文が見つかりません: ${preOrder.orderId}`);
        // If pre-order not found, create new order as fallback
        await addOrderMongoDB({
          ...updateData,
          timestamp: preOrder.timestamp
        });
      }

      console.log(`[Phase 3] 注文更新完了: ${exchangeOrder.id} (事前ID: ${preOrder.id})`);

    } catch (error) {
      console.error(`[Phase 3] 注文更新エラー: ${error.message}`);
      throw new Error(`MongoDB更新失敗: ${error.message}`);
    }
  }

  /**
   * Phase 4: トランザクション完了記録
   */
  async completeTransaction(transactionId, exchangeOrder) {
    const transaction = {
      transactionId,
      exchangeOrderId: exchangeOrder.id,
      status: 'completed',
      completedAt: Date.now()
    };

    this.completedOrders.set(transactionId, transaction);
    this.pendingOrders.delete(transactionId);

    console.log(`[Phase 4] トランザクション完了: ${transactionId}`);
  }

  /**
   * ロールバック処理
   */
  async rollbackTransaction(transactionId, preOrder, exchangeOrder, originalError) {
    console.log(`[ロールバック] 開始: ${transactionId}`);

    try {
      // 取引所注文がある場合はキャンセルを試行
      if (exchangeOrder && exchangeOrder.id) {
        try {
          console.log(`[ロールバック] 取引所注文キャンセル試行: ${exchangeOrder.id}`);
          await this.exchange.cancelOrder(exchangeOrder.id, exchangeOrder.symbol);
          console.log(`[ロールバック] 取引所注文キャンセル成功: ${exchangeOrder.id}`);
        } catch (cancelError) {
          console.warn(`[ロールバック] 注文キャンセル失敗: ${cancelError.message}`);
          // キャンセル失敗でも続行（既に約定している可能性）
        }
      }

      // MongoDB事前保存記録をロールバック状態に更新
      if (preOrder) {
        try {
          const rollbackData = {
            status: 'rolled_back',
            rollbackReason: originalError.message,
            rolledBackAt: Date.now()
          };
          await updateOrderByOrderId(preOrder.orderId, rollbackData);
          console.log(`[ロールバック] MongoDB記録更新: ${preOrder.id}`);
        } catch (updateError) {
          console.error(`[ロールバック] MongoDB更新エラー: ${updateError.message}`);
        }
      }

      // Discord通知
      await this.notifyRollback(transactionId, preOrder, exchangeOrder, originalError);

    } catch (rollbackError) {
      console.error(`[ロールバック] 処理エラー: ${rollbackError.message}`);
      await postErrorToDiscord(`🚨 **ロールバック処理エラー**\nトランザクション: ${transactionId}\nエラー: ${rollbackError.message}`);
    } finally {
      // クリーンアップ
      this.pendingOrders.delete(transactionId);
    }
  }

  /**
   * ロールバック通知
   */
  async notifyRollback(transactionId, preOrder, exchangeOrder, originalError) {
    let message = '⚠️ **トランザクショナル注文ロールバック**\n' +
                 '━━━━━━━━━━━━━━━━━━━━━━━\n' +
                 `🆔 **トランザクション**: ${transactionId}\n`;

    if (preOrder) {
      message += `📝 **事前保存**: ${preOrder.id}\n` +
                `💱 **通貨ペア**: ${preOrder.symbol}\n` +
                `📊 **売買**: ${preOrder.side.toUpperCase()}\n` +
                `🎯 **戦略**: ${preOrder.strategy}\n`;
    }

    if (exchangeOrder) {
      message += `🔗 **取引所注文**: ${exchangeOrder.id} (キャンセル試行済み)\n`;
    }

    message += `❌ **エラー**: ${originalError.message}\n` +
              `⏰ ${new Date().toLocaleString('ja-JP')}`;

    try {
      await postOrderToDiscord(message);
    } catch (notifyError) {
      console.error(`[ロールバック] Discord通知エラー: ${notifyError.message}`);
    }
  }

  /**
   * トランザクションID生成
   */
  generateTransactionId() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `tx_${timestamp}_${random}`;
  }

  /**
   * 注文パラメータ構築
   */
  buildOrderParams(options) {
    const params = {};

    if (options.type === 'post_only' || options.postOnly) {
      params.postOnly = true;
    }

    if (options.timeInForce) {
      params.timeInForce = options.timeInForce;
    }

    return params;
  }

  /**
   * スリープ関数
   */
  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 孤立注文の修復
   * 既存の孤立注文を修復するためのメソッド
   */
  async repairOrphanedOrders() {
    console.log('[孤立注文修復] 開始...');

    try {
      // MongoDBから戦略が'OUTSIDE'の注文を取得
      const orphanedOrders = await listOrders(
        { strategy: 'OUTSIDE' },
        { timestamp: -1 },
        100
      );

      console.log(`[孤立注文修復] 対象: ${orphanedOrders.length}件`);

      let repairedCount = 0;
      for (const order of orphanedOrders) {
        try {
          // 関連する取引から正しい戦略を推測
          const correctStrategy = await this.inferCorrectStrategy(order);

          if (correctStrategy && correctStrategy !== 'OUTSIDE') {
            // 正しい戦略で更新
            const repairData = {
              strategy: correctStrategy,
              repairedAt: Date.now(),
              repairReason: 'orphaned_order_repair'
            };

            await updateOrderByOrderId(order.orderId, repairData);
            repairedCount++;

            console.log(`[孤立注文修復] 修復: ${order.id} ${order.strategy} → ${correctStrategy}`);
          }

        } catch (repairError) {
          console.warn(`[孤立注文修復] エラー: ${order.id} - ${repairError.message}`);
        }
      }

      console.log(`[孤立注文修復] 完了: ${repairedCount}件修復`);
      return { repairedCount, totalOrphaned: orphanedOrders.length };

    } catch (error) {
      console.error(`[孤立注文修復] 実行エラー: ${error.message}`);
      throw error;
    }
  }

  /**
   * 正しい戦略の推測
   */
  async inferCorrectStrategy(order) {
    // 実装: 注文の前後の取引、価格、時間などから戦略を推測
    // この実装は複雑になるため、簡単なバージョンを提供

    // デフォルトの推測ロジック
    if (order.type === 'limit' && order.side === 'buy') {
      return 'RSI'; // 買い注文の多くはRSI戦略と仮定
    } else if (order.type === 'limit' && order.side === 'sell') {
      return 'MEAN_REVERSION'; // 売り注文の多くは平均回帰戦略と仮定
    }

    return null; // 推測できない場合
  }

  /**
   * 統計情報の取得
   */
  getStatistics() {
    return {
      pendingTransactions: this.pendingOrders.size,
      completedTransactions: this.completedOrders.size,
      totalProcessed: this.pendingOrders.size + this.completedOrders.size
    };
  }
}

module.exports = TransactionalOrderManager;