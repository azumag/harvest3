const WebSocketClient = require('./WebSocketClient');
const Logger = require('../utils/Logger'); // ロギングユーティリティを使用
const { addOrderMongoDB, updateOrderByOrderId, addTradeMongoDB } = require('../../database/manager');
const crypto = require('crypto');
const { sleep } = require('../../common/utils');

class PrivateStreamClient {
  constructor(endpoint, config, exchange) {
    this.endpoint = endpoint;
    this.config = config; // WebSocket接続設定、APIキーなどを含む可能性
    this.exchange = exchange; // CCXT exchange instance for authentication
    this.client = new WebSocketClient(endpoint, config);
    this.logger = new Logger('PrivateStreamClient');
    
    // 認証状態管理
    this.isAuthenticated = false;
    this.pendingSubscriptions = [];
    this.activeSubscriptions = new Set();
    
    // データ処理管理
    this.lastHeartbeat = Date.now();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;

    this._setupEventHandlers();
  }

  /**
   * WebSocket 接続を確立します。プライベートストリームには認証が必要になる場合があります。
   * @returns {Promise<void>}
   */
  async connect() {
    try {
      await this.client.connect();
      this.logger.info('Private stream connected, initiating authentication...');
      
      // 認証処理を実行
      await this._authenticate();
      
      // ペンディング中の購読を処理
      await this._processPendingSubscriptions();
      
      this.logger.info('Private stream fully initialized.');
    } catch (error) {
      this.logger.error('Failed to connect private stream:', error);
      await this._handleConnectionError(error);
      throw error;
    }
  }

  /**
   * 指定されたプライベートチャネルを購読します。
   * @param {string} channel - 購読するチャネル名 (例: 'my_orders', 'my_positions')
   * @param {object} [params] - 購読に必要な追加パラメータ (例: 認証情報)
   */
  subscribe(channel, params = {}) {
    this.logger.info(`Subscribing to private channel: ${channel}`);
    
    const subscription = { channel, params };
    
    if (!this.isAuthenticated) {
      // 認証が完了していない場合はペンディングに追加
      this.pendingSubscriptions.push(subscription);
      this.logger.info(`Added subscription to pending queue: ${channel}`);
      return;
    }
    
    try {
      // bitbankのプライベートストリームAPI仕様に基づいた購読リクエスト
      const subscriptionRequest = {
        type: 'subscribe',
        channel: channel,
        ...params
      };
      
      this.client.send(JSON.stringify(subscriptionRequest));
      this.activeSubscriptions.add(channel);
      this.logger.info(`Successfully subscribed to channel: ${channel}`);
      
    } catch (error) {
      this.logger.error(`Failed to subscribe to channel ${channel}:`, error);
      throw error;
    }
  }

  /**
   * WebSocket イベントハンドラを設定します。
   */
  _setupEventHandlers() {
    // 'message' イベントは bitbank のプライベートストリームの主要なデータ通知イベントと仮定
    this.client.on('message', (data) => {
      this._handleMessage(data);
    });

    // 接続イベント
    this.client.on('connect', () => {
      this.logger.info('Private WebSocket connected');
      this.reconnectAttempts = 0;
    });
    
    this.client.on('disconnect', () => {
      this.logger.warn('Private WebSocket disconnected');
      this.isAuthenticated = false;
      this._handleReconnection();
    });
    
    // エラーイベント
    this.client.on('error', (error) => {
      this.logger.error('Private WebSocket error:', error);
      this._handleConnectionError(error);
    });
    
    // 認証関連イベント
    this.client.on('auth_success', () => {
      this.logger.info('Private stream authentication successful');
      this.isAuthenticated = true;
    });
    
    this.client.on('auth_error', (error) => {
      this.logger.error('Private stream authentication failed:', error);
      this.isAuthenticated = false;
    });
  }

  /**
   * 受信したメッセージを処理します。
   * @param {object} message - 受信したメッセージデータ
   */
  async _handleMessage(message) {
    if (!message || !message.room || !message.message) {
      this.logger.warn('Received invalid private message format:', message);
      return;
    }

    const { room, message: data } = message;
    this.logger.debug(`Received private message from room: ${room}`, data);

    try {
      // 受信したプライベートデータを処理
      switch (room) {
      case 'orders':
      case 'my_orders':
        await this._handleMyOrders(data);
        break;
      case 'trades':
      case 'my_trades':
        await this._handleMyTrades(data);
        break;
      case 'positions':
      case 'my_positions':
        await this._handleMyPositions(data);
        break;
      case 'balances':
      case 'my_balances':
        await this._handleMyBalances(data);
        break;
      case 'heartbeat':
        this._handleHeartbeat(data);
        break;
      default:
        this.logger.debug(`Received message from unhandled private room: ${room}`);
      }
    } catch (error) {
      this.logger.error(`Error processing private message from room ${room}:`, error);
    }
  }

  /**
   * 認証処理を実行
   */
  async _authenticate() {
    try {
      if (!this.exchange || !this.exchange.apiKey || !this.exchange.secret) {
        this.logger.warn('No exchange credentials provided, running in mock mode');
        this.isAuthenticated = true; // モックモードでは認証成功として扱う
        return;
      }
      
      const timestamp = Date.now();
      const nonce = timestamp.toString();
      
      // bitbank APIの認証シグネチャを作成
      const message = nonce + this.exchange.apiKey;
      const signature = crypto
        .createHmac('sha256', this.exchange.secret)
        .update(message)
        .digest('hex');
      
      const authRequest = {
        type: 'auth',
        apikey: this.exchange.apiKey,
        nonce: nonce,
        signature: signature
      };
      
      this.client.send(JSON.stringify(authRequest));
      this.logger.info('Authentication request sent');
      
      // 認証レスポンスを待機
      await this._waitForAuthentication();
      
    } catch (error) {
      this.logger.error('Authentication failed:', error);
      throw error;
    }
  }
  
  /**
   * 認証完了を待機
   */
  async _waitForAuthentication(timeout = 10000) {
    const startTime = Date.now();
    
    while (!this.isAuthenticated && Date.now() - startTime < timeout) {
      await sleep(100);
    }
    
    if (!this.isAuthenticated) {
      throw new Error('Authentication timeout');
    }
  }
  
  /**
   * ペンディング中の購読を処理
   */
  async _processPendingSubscriptions() {
    if (this.pendingSubscriptions.length === 0) {
      return;
    }
    
    this.logger.info(`Processing ${this.pendingSubscriptions.length} pending subscriptions`);
    
    for (const subscription of this.pendingSubscriptions) {
      try {
        this.subscribe(subscription.channel, subscription.params);
        await sleep(100); // レート制限対策
      } catch (error) {
        this.logger.error(`Failed to process pending subscription:`, error);
      }
    }
    
    this.pendingSubscriptions = [];
  }
  
  /**
   * 注文情報を処理
   */
  async _handleMyOrders(data) {
    try {
      if (!data || !data.order_id) {
        return;
      }
      
      this.logger.debug(`Processing order update: ${data.order_id}`);
      
      // データベースの注文情報を更新
      await updateOrderByOrderId(data.order_id, {
        status: data.status,
        filled: parseFloat(data.executed_amount) || 0,
        remaining: parseFloat(data.remaining_amount) || 0,
        price: parseFloat(data.price) || 0,
        updatedAt: Date.now()
      });
      
      // ステータスに応じた処理
      switch (data.status) {
      case 'FULLY_FILLED':
        this.logger.info(`✅ Order ${data.order_id} fully filled`);
        await this._handleOrderFilled(data);
        break;
      case 'PARTIALLY_FILLED':
        this.logger.info(`🔄 Order ${data.order_id} partially filled`);
        break;
      case 'CANCELED':
        this.logger.info(`❌ Order ${data.order_id} canceled`);
        break;
      case 'UNFILLED':
        this.logger.debug(`⏳ Order ${data.order_id} still unfilled`);
        break;
      }
      
    } catch (error) {
      this.logger.error('Error handling order update:', error);
    }
  }
  
  /**
   * 取引情報を処理
   */
  async _handleMyTrades(data) {
    try {
      if (!data || !data.trade_id) {
        return;
      }
      
      this.logger.info(`💰 Trade executed: ${data.trade_id} | ${data.side} ${data.amount} @ ¥${data.price}`);
      
      // データベースに取引を記録
      await addTradeMongoDB({
        tradeId: data.trade_id,
        orderId: data.order_id,
        exchange: 'bitbank',
        symbol: data.pair,
        side: data.side,
        amount: parseFloat(data.amount),
        price: parseFloat(data.price),
        timestamp: data.executed_at || Date.now(),
        fee: {
          cost: parseFloat(data.fee_amount) || 0,
          currency: data.fee_currency || 'JPY'
        },
        strategy: 'HFT'
      });
      
    } catch (error) {
      this.logger.error('Error handling trade update:', error);
    }
  }
  
  /**
   * ポジション情報を処理
   */
  async _handleMyPositions(data) {
    try {
      this.logger.debug('Position update received:', data);
      
      // ポジション情報の処理ロジック
      // bitbankはスポット取引なのでポジションはないが、
      // 将来の拡張のためにフレームワークを用意
      
    } catch (error) {
      this.logger.error('Error handling position update:', error);
    }
  }
  
  /**
   * 残高情報を処理
   */
  async _handleMyBalances(data) {
    try {
      this.logger.debug('Balance update received:', data);
      
      if (data.assets && Array.isArray(data.assets)) {
        for (const asset of data.assets) {
          this.logger.debug(`Balance - ${asset.asset}: free=${asset.free_amount}, locked=${asset.locked_amount}`);
        }
      }
      
    } catch (error) {
      this.logger.error('Error handling balance update:', error);
    }
  }
  
  /**
   * ハートビートを処理
   */
  _handleHeartbeat(data) {
    this.lastHeartbeat = Date.now();
    this.logger.debug('Heartbeat received');
  }
  
  /**
   * 注文約定時の処理
   */
  async _handleOrderFilled(orderData) {
    try {
      // 約定時の追加処理（ポジション更新、P&L計算など）
      this.logger.info(`Order filled processing for ${orderData.order_id}`);
      
    } catch (error) {
      this.logger.error('Error in order filled processing:', error);
    }
  }
  
  /**
   * 接続エラーを処理
   */
  async _handleConnectionError(error) {
    this.logger.error('Connection error occurred:', error);
    
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      await this._handleReconnection();
    } else {
      this.logger.error('Max reconnection attempts reached, giving up');
    }
  }
  
  /**
   * 再接続処理
   */
  async _handleReconnection() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      return;
    }
    
    this.reconnectAttempts++;
    const baseDelay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    const jitter = Math.random() * 0.1 * baseDelay; // 10%のジッター
    const delay = baseDelay + jitter; // ジッター付き指数バックオフ
    
    this.logger.info(`Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);
    
    await sleep(delay);
    
    try {
      await this.connect();
    } catch (error) {
      this.logger.error('Reconnection attempt failed:', error);
      await this._handleReconnection();
    }
  }


  /**
   * WebSocket 接続を切断します。
   */
  disconnect() {
    this.client.disconnect();
    this.logger.info('Private stream disconnected.');
  }
}

module.exports = PrivateStreamClient;