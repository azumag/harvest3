/**
 * 高度な注文管理システム
 * Issue #147: 複数注文タイプと実行最適化の実装
 * 未約定注文管理機能統合版
 */

const { getTickerRedis } = require('../../database/redisDatabase');
const { postOrderToDiscord, postErrorToDiscord } = require('../../common/notifications');
const { sleep } = require('../../common/utils');
const OrderValidation = require('../../common/orderValidation');
const TransactionalOrderManager = require('../../common/transactionalOrderManager');
const redis = require('redis');

/**
 * 注文タイプの定義
 */
const ORDER_TYPES = {
  LIMIT_POST_ONLY: 'post_only',     // 現在の方式（メイカー限定）
  LIMIT: 'limit',                   // 通常のリミット注文
  LIMIT_IOC: 'ioc',                 // Immediate or Cancel（bitbankでは非サポート）
  MARKET: 'market',                 // 成行注文
  STOP_LIMIT: 'stop_limit',         // ストップ限指
  ICEBERG: 'iceberg'                // 氷山注文（大口分割）
};

/**
 * 緊急度レベル
 */
const URGENCY_LEVELS = {
  LOW: 'low',       // 時間に余裕がある
  MEDIUM: 'medium', // 通常の実行
  HIGH: 'high'      // 急ぎの実行
};

/**
 * 高度注文管理クラス
 */
class AdvancedOrderManager {
  constructor(exchange) {
    this.exchange = exchange;
    this.activeOrders = new Map();
    this.orderTimeout = 60000; // 60秒でキャンセル
    this.maxRetries = 3;
    this.retryDelay = 1000; // 1秒
    
    // 未約定注文管理機能
    this.orderValidator = new OrderValidation(exchange);
    this.redisClient = null;
    this.validationEnabled = true;
    
    // トランザクショナル注文管理
    this.transactionalManager = new TransactionalOrderManager(exchange);
    this.useTransactionalOrders = true; // デフォルトで有効
    
    this.initRedisConnection();
  }

  /**
   * Redis接続の初期化
   */
  async initRedisConnection() {
    try {
      this.redisClient = redis.createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379'
      });
      await this.redisClient.connect();
      console.log('[注文管理] Redis接続完了');
    } catch (error) {
      console.warn('[注文管理] Redis接続失敗:', error.message);
      this.validationEnabled = false;
    }
  }

  /**
   * 市場状況に応じた最適な注文タイプを選択
   * @param {string} symbol - 通貨ペア
   * @param {string} urgency - 緊急度 (low/medium/high)
   * @param {number} amount - 注文数量
   * @returns {string} 最適な注文タイプ
   */
  async selectOptimalOrderType(symbol, urgency, amount) {
    try {
      // 流動性レベルを評価
      const liquidityLevel = await this.assessLiquidity(symbol, amount);
      
      // 緊急度と流動性に基づいて注文タイプを決定
      if (urgency === URGENCY_LEVELS.HIGH && liquidityLevel > 0.6) {
        return ORDER_TYPES.MARKET;
      } else if (urgency === URGENCY_LEVELS.MEDIUM && liquidityLevel > 0.4) {
        // bitbankはIOCをサポートしていないため、通常のlimit注文を使用
        return ORDER_TYPES.LIMIT;
      } else if (amount > this.getLargeOrderThreshold(symbol)) {
        return ORDER_TYPES.ICEBERG;
      }
      
      // デフォルトはpost_only
      return ORDER_TYPES.LIMIT_POST_ONLY;
    } catch (error) {
      console.warn(`注文タイプ選択エラー: ${error.message}, デフォルトを使用`);
      return ORDER_TYPES.LIMIT_POST_ONLY;
    }
  }

  /**
   * 流動性レベルの評価
   * @param {string} symbol - 通貨ペア
   * @param {number} amount - 注文数量
   * @returns {number} 流動性レベル (0-1)
   */
  async assessLiquidity(symbol, amount) {
    try {
      // 板情報を取得
      const orderbook = await this.exchange.fetchOrderBook(symbol);
      if (!orderbook || !orderbook.bids || !orderbook.asks) {
        return 0.5; // デフォルト値
      }

      // スプレッドを計算
      const bestBid = orderbook.bids[0]?.[0] || 0;
      const bestAsk = orderbook.asks[0]?.[0] || 0;
      const spread = bestAsk - bestBid;
      const midPrice = (bestBid + bestAsk) / 2;
      const spreadPercent = (spread / midPrice) * 100;

      // 板の厚みを評価（上位5レベル）
      const bidDepth = orderbook.bids.slice(0, 5).reduce((sum, level) => sum + level[1], 0);
      const askDepth = orderbook.asks.slice(0, 5).reduce((sum, level) => sum + level[1], 0);
      const totalDepth = bidDepth + askDepth;

      // 必要な流動性に対する充足率
      const liquidityRatio = Math.min(totalDepth / (amount * 10), 1); // 10倍の深度を基準

      // スプレッドとボリュームから流動性スコアを算出
      const spreadScore = Math.max(0, 1 - (spreadPercent / 2.0)); // 2.0%以下で最高スコア（テスト調整）
      const depthScore = liquidityRatio;

      return (spreadScore + depthScore) / 2;
    } catch (error) {
      console.warn(`流動性評価エラー: ${error.message}`);
      return 0.5;
    }
  }

  /**
   * 動的価格調整
   * @param {string} symbol - 通貨ペア
   * @param {string} side - buy/sell
   * @param {string} urgency - 緊急度
   * @param {number} basePrice - 基準価格
   * @returns {number} 調整後価格
   */
  async calculateOptimalPrice(symbol, side, urgency, basePrice) {
    try {
      const orderbook = await this.exchange.fetchOrderBook(symbol);
      if (!orderbook || !orderbook.bids || !orderbook.asks) {
        return basePrice;
      }

      const bestBid = orderbook.bids[0]?.[0] || basePrice;
      const bestAsk = orderbook.asks[0]?.[0] || basePrice;
      const spread = bestAsk - bestBid;

      let adjustedPrice = basePrice;

      if (side === 'buy') {
        // 買い注文の場合
        if (urgency === URGENCY_LEVELS.HIGH) {
          // 急ぎの場合：スプレッドの50%上乗せして即座に約定を狙う
          adjustedPrice = bestBid + (spread * 0.5);
        } else if (urgency === URGENCY_LEVELS.MEDIUM) {
          // 通常の場合：スプレッドの10%上乗せ
          adjustedPrice = bestBid + (spread * 0.1);
        } else {
          // 時間に余裕がある場合：現在のbest bidより少し上
          adjustedPrice = bestBid + (spread * 0.01);
        }
      } else {
        // 売り注文の場合
        if (urgency === URGENCY_LEVELS.HIGH) {
          adjustedPrice = bestAsk - (spread * 0.5);
        } else if (urgency === URGENCY_LEVELS.MEDIUM) {
          adjustedPrice = bestAsk - (spread * 0.1);
        } else {
          adjustedPrice = bestAsk - (spread * 0.01);
        }
      }

      return adjustedPrice;
    } catch (error) {
      console.warn(`価格調整エラー: ${error.message}`);
      return basePrice;
    }
  }

  /**
   * 高度な注文実行
   * @param {string} symbol - 通貨ペア
   * @param {string} side - buy/sell
   * @param {number} amount - 数量
   * @param {number} price - 価格
   * @param {Object} options - 実行オプション
   * @returns {Object} 注文結果
   */
  async executeAdvancedOrder(symbol, side, amount, price, options = {}) {
    const {
      urgency = URGENCY_LEVELS.MEDIUM,
      strategy = 'UNKNOWN',
      maxSlippage = 0.005, // 0.5%
      enableRetry = true
    } = options;

    // 最適な注文タイプを選択
    const orderType = await this.selectOptimalOrderType(symbol, urgency, amount);
    
    // 価格調整
    const adjustedPrice = await this.calculateOptimalPrice(symbol, side, urgency, price);
    
    // 注文実行
    return await this.executeOrderWithManagement(
      symbol, side, amount, adjustedPrice, orderType, options
    );
  }

  /**
   * 注文前バリデーション
   * @param {string} symbol - 通貨ペア
   * @param {string} side - 売買方向
   * @param {number} price - 注文価格
   * @param {number} amount - 注文数量
   * @returns {Object} バリデーション結果
   */
  async validateOrderBeforeExecution(symbol, side, price, amount) {
    if (!this.validationEnabled || !this.redisClient) {
      return { valid: true, reason: 'バリデーション無効' };
    }

    try {
      // 包括的バリデーション実行
      const validation = await this.orderValidator.validateOrder(
        this.redisClient, 
        symbol, 
        side, 
        price, 
        amount
      );

      if (!validation.valid) {
        console.log(`[注文管理] バリデーション失敗: ${validation.summary}`);
        
        // エラー詳細をログ出力
        validation.errors.forEach(error => {
          console.log(`  - ${error.type}: ${error.reason}`);
          if (error.details) {
            console.log(`    詳細:`, error.details);
          }
        });

        // 推奨価格を取得して提案
        try {
          const recommendedPrice = await this.orderValidator.getRecommendedPrice(symbol, side);
          console.log(`  推奨価格: ¥${recommendedPrice.toLocaleString()}`);
          
          return {
            valid: false,
            reason: validation.summary,
            errors: validation.errors,
            recommendedPrice
          };
        } catch (priceError) {
          return {
            valid: false,
            reason: validation.summary,
            errors: validation.errors
          };
        }
      }

      console.log(`[注文管理] バリデーション通過: ${symbol} ${side} ¥${price.toLocaleString()}`);
      return { valid: true };

    } catch (error) {
      console.warn(`[注文管理] バリデーションエラー: ${error.message}`);
      return { valid: true, reason: 'バリデーションエラー' }; // エラー時は通す
    }
  }

  /**
   * 注文実行と管理（バリデーション統合版）
   * @param {string} symbol - 通貨ペア
   * @param {string} side - buy/sell
   * @param {number} amount - 数量
   * @param {number} price - 価格
   * @param {string} orderType - 注文タイプ
   * @param {Object} options - オプション
   * @returns {Object} 実行結果
   */
  async executeOrderWithManagement(symbol, side, amount, price, orderType, options = {}) {
    // トランザクショナル注文を使用するかチェック
    if (this.useTransactionalOrders && !options.backtest) {
      console.log(`[注文管理] トランザクショナル注文使用: ${symbol} ${side}`);
      
      const transactionalOptions = {
        ...options,
        type: orderType,
        strategy: options.strategy || 'UNKNOWN'
      };
      
      return await this.transactionalManager.executeTransactionalOrder(
        symbol, side, amount, price, transactionalOptions
      );
    }
    
    // 従来の注文方式（バックテスト等）
    console.log(`[注文管理] 従来注文方式使用: ${symbol} ${side}`);
    
    // 注文前バリデーション
    const validation = await this.validateOrderBeforeExecution(symbol, side, price, amount);
    
    if (!validation.valid) {
      console.log(`[注文管理] 注文拒否: ${validation.reason}`);
      
      // Discord通知（バリデーション失敗）
      if (postOrderToDiscord && !options.backtest) {
        let message = `🚫 **注文拒否** ${symbol} ${side.toUpperCase()}\n` +
                     `━━━━━━━━━━━━━━━━━━━━━━━\n` +
                     `💰 **注文内容**\n` +
                     `　価格: ¥${price.toLocaleString()}\n` +
                     `　数量: ${amount}\n` +
                     `　総額: ¥${(price * amount).toLocaleString()}\n\n` +
                     `❌ **拒否理由**\n` +
                     `　${validation.reason}\n`;

        // 詳細エラー情報を追加
        if (validation.errors && validation.errors.length > 0) {
          message += `\n📋 **詳細情報**\n`;
          validation.errors.forEach(error => {
            message += `　• ${error.type}: ${error.reason}\n`;
            if (error.details) {
              if (error.details.current !== undefined && error.details.limit !== undefined) {
                message += `　　現在値: ${error.details.current} / 上限: ${error.details.limit}\n`;
              }
              if (error.details.currentBuyRatio) {
                message += `　　買い注文比率: ${error.details.currentBuyRatio}\n`;
              }
              if (error.details.deviation) {
                message += `　　価格乖離: ${error.details.deviation} (閾値: ${error.details.threshold})\n`;
              }
              if (error.details.orderValue !== undefined) {
                if (error.details.minimum) {
                  message += `　　注文金額: ¥${error.details.orderValue.toLocaleString()} (最小: ¥${error.details.minimum.toLocaleString()})\n`;
                }
                if (error.details.maximum) {
                  message += `　　注文金額: ¥${error.details.orderValue.toLocaleString()} (最大: ¥${error.details.maximum.toLocaleString()})\n`;
                }
              }
            }
          });
        }

        // 推奨価格情報を追加
        if (validation.recommendedPrice) {
          const priceDeviation = ((validation.recommendedPrice - price) / price * 100);
          message += `\n💡 **推奨価格**\n` +
                    `　¥${validation.recommendedPrice.toLocaleString()}\n` +
                    `　(${priceDeviation > 0 ? '+' : ''}${priceDeviation.toFixed(2)}% 調整)\n`;
        }

        message += `\n⏰ ${new Date().toLocaleString('ja-JP')}`;
        
        await postOrderToDiscord(message);
      }
      
      return {
        success: false,
        error: new Error(validation.reason),
        validation: validation,
        blocked: true
      };
    }
    let attempt = 0;
    let lastError = null;

    while (attempt < this.maxRetries) {
      try {
        attempt++;
        
        // 注文パラメータを構築
        const params = this.buildOrderParams(orderType, options);
        
        // CRITICAL: 注文実行前にMongoDBに保存（戦略リンク保持のため）
        // 一時的な注文オブジェクトを作成
        const preOrder = {
          id: `pre_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          symbol,
          side,
          amount,
          price,
          type: orderType,
          status: 'pending',
          strategy: options.strategy || 'UNKNOWN',
          exchange: this.exchange.id,
          timestamp: Date.now(),
          params
        };
        
        try {
          // MongoDBに事前保存
          const { addOrderMongoDB } = require('../../database/manager');
          await addOrderMongoDB(preOrder);
          console.log(`[注文管理] 注文事前保存完了: ${preOrder.id} 戦略: ${preOrder.strategy}`);
        } catch (saveError) {
          console.error(`[注文管理] 注文事前保存エラー: ${saveError.message}`);
          // エラーでも注文は続行（ログのみ）
        }
        
        // 注文実行
        let order;
        if (orderType === ORDER_TYPES.MARKET) {
          order = side === 'buy' 
            ? await this.exchange.createMarketBuyOrder(symbol, amount, params)
            : await this.exchange.createMarketSellOrder(symbol, amount, params);
        } else if (orderType === ORDER_TYPES.ICEBERG) {
          // 氷山注文（分割実行）
          return await this.executeIcebergOrder(symbol, side, amount, price, options);
        } else {
          // 限指注文（post_only, IOC含む）
          order = side === 'buy'
            ? await this.exchange.createLimitBuyOrder(symbol, amount, price, params)
            : await this.exchange.createLimitSellOrder(symbol, amount, price, params);
        }
        
        // 実際の注文IDで更新
        if (order && order.id) {
          try {
            // 事前保存した注文を実際の注文情報で更新
            const updatedOrder = {
              ...order,
              strategy: options.strategy || 'UNKNOWN',
              preOrderId: preOrder.id
            };
            await addOrderMongoDB(updatedOrder);
            console.log(`[注文管理] 注文情報更新: ${order.id} (事前ID: ${preOrder.id})`);
          } catch (updateError) {
            console.error(`[注文管理] 注文更新エラー: ${updateError.message}`);
          }
        }

        // 注文管理開始
        if (order && order.id) {
          this.startOrderManagement(order, options);
        }

        // Discord通知
        if (postOrderToDiscord && !options.backtest) {
          const message = `🚀 [高度注文] ${side.toUpperCase()}\n` +
                         `タイプ: ${orderType}\n` +
                         `銘柄: ${symbol}\n` +
                         `数量: ${amount}\n` +
                         `価格: ${price}\n` +
                         `試行: ${attempt}/${this.maxRetries}`;
          await postOrderToDiscord(message);
        }

        return {
          success: true,
          order,
          orderType,
          adjustedPrice: price,
          attempts: attempt
        };

      } catch (error) {
        lastError = error;
        console.warn(`注文実行エラー (試行 ${attempt}/${this.maxRetries}): ${error.message}`);
        
        if (attempt < this.maxRetries) {
          await sleep(this.retryDelay * attempt); // 指数バックオフ
        }
      }
    }

    // 全ての試行が失敗
    if (postOrderToDiscord) {
      await postOrderToDiscord(`❌ **注文実行失敗** ${symbol} ${side.toUpperCase()}\n` +
                              `数量: ${amount}\n` +
                              `エラー: ${lastError?.message}\n` +
                              `試行回数: ${this.maxRetries}回\n` +
                              `⏰ ${new Date().toLocaleString('ja-JP')}`);
    }

    return {
      success: false,
      error: lastError,
      attempts: attempt
    };
  }

  /**
   * 注文パラメータ構築
   * @param {string} orderType - 注文タイプ
   * @param {Object} options - オプション
   * @returns {Object} パラメータ
   */
  buildOrderParams(orderType, options) {
    const params = {};

    switch (orderType) {
      case ORDER_TYPES.LIMIT_POST_ONLY:
        params.postOnly = true;
        break;
      case ORDER_TYPES.LIMIT:
        // 通常のリミット注文（bitbank標準）
        break;
      case ORDER_TYPES.LIMIT_IOC:
        // bitbankではIOCをサポートしていないため、通常のlimit注文として処理
        console.warn('bitbankはIOCをサポートしていません。通常のlimit注文を使用します。');
        break;
      case ORDER_TYPES.STOP_LIMIT:
        if (options.stopPrice) {
          params.stopPrice = options.stopPrice;
        }
        break;
    }

    return params;
  }

  /**
   * 氷山注文（大口分割実行）
   * @param {string} symbol - 通貨ペア
   * @param {string} side - buy/sell
   * @param {number} totalAmount - 総数量
   * @param {number} price - 価格
   * @param {Object} options - オプション
   * @returns {Object} 実行結果
   */
  async executeIcebergOrder(symbol, side, totalAmount, price, options) {
    const chunkSize = this.calculateOptimalChunkSize(symbol, totalAmount);
    const chunks = Math.ceil(totalAmount / chunkSize);
    const results = [];
    const interval = options.icebergInterval || 2000; // 2秒間隔

    for (let i = 0; i < chunks; i++) {
      const currentAmount = Math.min(chunkSize, totalAmount - (i * chunkSize));
      
      try {
        const params = { postOnly: true };
        const order = side === 'buy'
          ? await this.exchange.createLimitBuyOrder(symbol, currentAmount, price, params)
          : await this.exchange.createLimitSellOrder(symbol, currentAmount, price, params);
        
        results.push(order);
        
        // 最後のチャンク以外は待機
        if (i < chunks - 1) {
          await sleep(interval);
        }
      } catch (error) {
        console.warn(`氷山注文チャンク ${i + 1}/${chunks} エラー: ${error.message}`);
      }
    }

    return {
      success: results.length > 0,
      orders: results,
      orderType: ORDER_TYPES.ICEBERG,
      totalChunks: chunks,
      executedChunks: results.length
    };
  }

  /**
   * 注文管理開始
   * @param {Object} order - 注文オブジェクト
   * @param {Object} options - オプション
   */
  startOrderManagement(order, options) {
    const managementInfo = {
      order,
      startTime: Date.now(),
      options,
      checkCount: 0
    };

    this.activeOrders.set(order.id, managementInfo);

    // テスト環境では監視を開始しない
    if (process.env.NODE_ENV !== 'test' && typeof jest === 'undefined') {
      // 定期チェック開始
      setTimeout(() => {
        this.checkOrderStatus(order.id);
      }, 10000); // 10秒後に初回チェック
    }
  }

  /**
   * 注文状態チェック
   * @param {string} orderId - 注文ID
   */
  async checkOrderStatus(orderId) {
    const managementInfo = this.activeOrders.get(orderId);
    if (!managementInfo) return;

    try {
      const order = await this.exchange.fetchOrder(orderId);
      managementInfo.checkCount++;

      if (order.status === 'closed' || order.status === 'canceled') {
        // 注文完了または取消済み
        this.activeOrders.delete(orderId);
        return;
      }

      if (this.isOrderStale(managementInfo)) {
        // 古い注文をキャンセルして再発注
        await this.cancelAndReplace(managementInfo);
        return;
      }

      if (order.status === 'open' && managementInfo.checkCount < 10) {
        // 継続監視
        setTimeout(() => {
          this.checkOrderStatus(orderId);
        }, 15000); // 15秒後に再チェック
      }

    } catch (error) {
      console.warn(`注文状態チェックエラー: ${orderId} - ${error.message}`);
    }
  }

  /**
   * 注文が古いかチェック
   * @param {Object} managementInfo - 管理情報
   * @returns {boolean} 古いかどうか
   */
  isOrderStale(managementInfo) {
    return Date.now() - managementInfo.startTime > this.orderTimeout;
  }

  /**
   * 注文キャンセルと再発注
   * @param {Object} managementInfo - 管理情報
   */
  async cancelAndReplace(managementInfo) {
    try {
      // 既存注文をキャンセル
      await this.exchange.cancelOrder(managementInfo.order.id);
      
      // 新しい価格で再発注
      const symbol = managementInfo.order.symbol;
      const side = managementInfo.order.side;
      const amount = managementInfo.order.amount;
      
      // 現在の市場価格を取得して調整
      const ticker = await getTickerRedis(this.exchange.id, symbol);
      const newPrice = await this.calculateOptimalPrice(
        symbol, side, URGENCY_LEVELS.MEDIUM, ticker.last
      );

      // 再発注実行
      await this.executeAdvancedOrder(symbol, side, amount, newPrice, {
        ...managementInfo.options,
        urgency: URGENCY_LEVELS.MEDIUM
      });

      this.activeOrders.delete(managementInfo.order.id);

    } catch (error) {
      console.warn(`注文キャンセル・再発注エラー: ${error.message}`);
    }
  }

  /**
   * 最適なチャンクサイズを計算
   * @param {string} symbol - 通貨ペア
   * @param {number} totalAmount - 総数量
   * @returns {number} チャンクサイズ
   */
  calculateOptimalChunkSize(symbol, totalAmount) {
    // 簡易実装：総数量の10%または最小単位の100倍のいずれか大きい方
    const minChunk = 0.001; // 最小チャンクサイズ
    const percentageChunk = totalAmount * 0.1;
    
    return Math.max(minChunk, percentageChunk);
  }

  /**
   * 大口注文の閾値を取得
   * @param {string} symbol - 通貨ペア
   * @returns {number} 閾値
   */
  getLargeOrderThreshold(symbol) {
    // 簡易実装：銘柄に応じた閾値
    if (symbol.includes('BTC')) return 0.1;
    if (symbol.includes('ETH')) return 1.0;
    return 10.0; // その他のアルトコイン
  }
}

module.exports = {
  AdvancedOrderManager,
  ORDER_TYPES,
  URGENCY_LEVELS
};