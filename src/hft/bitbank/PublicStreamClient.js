const WebSocketClient = require('./WebSocketClient');
const MarketDataStore = require('../datastore/MarketDataStore'); // MarketDataStore をインポート
const Logger = require('../utils/Logger'); // ロギングユーティリティを使用

class PublicStreamClient {
  constructor(endpoint, config, dataStore) {
    this.endpoint = endpoint;
    this.config = config;
    this.dataStore = dataStore; // MarketDataStore インスタンス
    this.client = new WebSocketClient(endpoint, config);
    this.logger = new Logger('PublicStreamClient');
    // コンストラクタでイベントハンドラーを設定しない
    // this._setupEventHandlers(); ← この行を削除
  }

  /**
   * WebSocket 接続を確立します。
   * @returns {Promise<void>}
   */
  async connect() {
    try {
      await this.client.connect();
      this.logger.success('📡 Public stream connected to Bitbank');

      // 接続成功後にイベントハンドラーを設定
      this._setupEventHandlers();

      // 接続維持のためのping
      this.pingInterval = setInterval(() => {
        this.client.emit('ping');
        this.logger.debug('💓 Heartbeat sent to server');
      }, 30000); // 30秒ごと
    } catch (error) {
      this.logger.error('❌ Failed to connect public stream:', error.message);
      throw error; // 接続失敗を通知
    }
  }

  /**
   * 指定された通貨ペアのパブリックチャネルを購読します。
   * @param {string} pair - 通貨ペア (例: 'btc_jpy')
   */
  subscribePair(pair) {
    this.logger.info(`Subscribing to public channels for pair: ${pair}`);

    // bitbankの公式形式に従って購読
    this.subscribeChannel(`ticker_${pair}`);
    this.subscribeChannel(`transactions_${pair}`);
    this.subscribeChannel(`depth_whole_${pair}`);
    this.subscribeChannel(`depth_diff_${pair}`);

    // 購読リクエストをログに出力
    this.logger.debug(`Sent subscription requests for ${pair}`);
  }

  /**
   * 指定されたチャネルを購読します
   * @param {string} channel - チャネル名 (例: 'ticker_btc_jpy')
   */
  subscribeChannel(channel) {
    this.logger.debug(`📻 Subscribing to: ${channel}`);
    // bitbankの形式: socket.emit('join-room', 'channel_name')
    this.client.emit('join-room', channel);
  }

  /**
   * WebSocket イベントハンドラを設定します。
   */
  _setupEventHandlers() {
    // WebSocketの標準イベント
    this.client.on('message', (data) => {
      this.logger.debug('📨 Message received');
      this._handleMessage(data);
    });

    this.client.on('disconnect', (data) => {
      this.logger.warn('🔌 WebSocket disconnected:', data);
    });
  }

  /**
   * 受信したメッセージを処理し、データストアを更新します。
   * @param {object} message - 受信したメッセージデータ
   */
  _handleMessage(message) {
    this.logger.debug(`Processing received message: ${JSON.stringify(message)}`);

    if (!message) {
      this.logger.warn('Received empty message');
      return;
    }

    try {
      // bitbankの直接オブジェクト形式に対応 (最も一般的)
      if (message && typeof message === 'object' && message.room_name && message.message) {
        this.logger.debug(`📨 Processing direct object format for room: ${message.room_name}`);
        this._processRoomMessage(message.room_name, message.message);
        return;
      }

      // 配列形式にも対応（後方互換性のため）
      if (Array.isArray(message) && message.length === 2 && message[0] === 'message') {
        const messageData = message[1];
        if (messageData && messageData.room_name && messageData.message) {
          this.logger.debug(`📨 Processing array format for room: ${messageData.room_name}`);
          this._processRoomMessage(messageData.room_name, messageData.message);
          return;
        }
      }

      // どちらの形式にも該当しない場合
      this.logger.warn('Unexpected message format:', JSON.stringify(message).substring(0, 200));
    } catch (error) {
      this.logger.error('Error handling message:', error.message);
      this.logger.debug('Error stack:', error.stack);
    }
  }

  /**
   * ルームメッセージを処理します
   * @param {string} roomName - ルーム名 (例: 'ticker_btc_jpy')
   * @param {object} messageData - メッセージデータ
   */
  _processRoomMessage(roomName, messageData) {
    const roomParts = roomName.split('_');
    if (roomParts.length < 2) {
      this.logger.warn(`Received message from unknown room format: ${roomName}`);
      return;
    }

    const dataType = roomParts[0]; // 例: 'ticker', 'transactions', 'depth'
    const subType = roomParts[1]; // 例: 'btc', 'whole', 'diff'
    const pair = roomParts.slice(-2).join('_'); // 例: 'btc_jpy'

    const emojis = {
      'ticker': '💱',
      'transactions': '💰',
      'depth': '📊'
    };
    const emoji = emojis[dataType] || '📈';

    this.logger.debug(`${emoji} Processing ${dataType} data for ${pair.toUpperCase()}`);

    switch (dataType) {
    case 'ticker':
      if (messageData.data) {
        this.dataStore.updateTicker(pair, messageData.data);
      }
      break;
    case 'transactions':
      if (messageData.data && messageData.data.transactions) {
        this.dataStore.addTransactions(pair, messageData.data.transactions);
      }
      break;
    case 'depth':
      // depth_whole または depth_diff
      if (messageData.data) {
        this.dataStore.updateOrderBook(pair, messageData.data);
      }
      break;
    default:
      this.logger.debug(`Received message from unhandled data type room: ${roomName}`);
    }
  }

  /**
   * WebSocket 接続を切断します。
   */
  disconnect() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
    this.client.disconnect();
    this.logger.info('Public stream disconnected.');
  }
}

module.exports = PublicStreamClient;