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
      this.logger.info('Public stream connected.');

      // 接続成功後にイベントハンドラーを設定
      this._setupEventHandlers();

      // 接続維持のためのping
      this.pingInterval = setInterval(() => {
        this.client.emit('ping');
        this.logger.debug('Sent ping to server');
      }, 30000); // 30秒ごと
    } catch (error) {
      this.logger.error('Failed to connect public stream:', error);
      throw error; // 接続失敗を通知
    }
  }

  /**
   * 指定された通貨ペアのパブリックチャネルを購読します。
   * @param {string} pair - 通貨ペア (例: 'btc_jpy')
   */
  subscribePair(pair) {
    this.logger.info(`Subscribing to public channels for pair: ${pair}`);

    // 重要なチャネルをすべて購読
    this.subscribe('ticker', { pair });
    this.subscribe('transactions', { pair });
    this.subscribe('depth_whole', { pair });

    // 購読リクエストをログに出力
    this.logger.debug(`Sent subscription requests for ${pair}`);
  }

  /**
   * WebSocket イベントハンドラを設定します。
   */
  _setupEventHandlers() {
    // Socket.IOの標準イベント
    this.client.on('message', (data) => {
      this.logger.debug(`Received 'message' event`);
      this._handleMessage(data);
    });

    // socketが初期化されていることを確認
    if (this.client.socket) {
      // Bitbankドキュメントに基づくイベント
      // メッセージはルームごとに送信される
      this.client.socket.on('message', (data) => {
        this.logger.debug(`Received socket 'message' event`);
        this._handleMessage(data);
      });

      // すべてのイベントをテストとしてキャプチャ
      this.client.socket.onAny((event, ...args) => {
        this.logger.debug(`Socket event '${event}' received`);
        if (event !== 'ping' && event !== 'pong') {
          this._tryHandleMessage(event, args);
        }
      });
      
      // Bitbankの仕様に基づいた特定のイベントも追加
      this.client.socket.on('connect', () => {
        this.logger.debug('Socket connect event received');
      });
      
      // ルームイベント（Bitbank固有）
      this.client.socket.on('room_message', (roomName, data) => {
        this.logger.debug(`Room message from ${roomName}`);
        this._handleRoomEvent(roomName, data);
      });
    } else {
      this.logger.warn('WebSocket not initialized, cannot set socket event handlers');
    }
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

    // Bitbankの実際のメッセージ形式に合わせて条件を調整
    if (!message.room && !message.message) {
      this.logger.debug('Message in unexpected format, trying alternative parsing');
      // 代替解析を試みる
      try {
        // 可能性のある形式を試す
        if (typeof message === 'string') {
          message = JSON.parse(message);
        }
        // その他の可能性...
      } catch (e) {
        this.logger.warn(`Failed to parse message: ${e.message}`);
        return;
      }
    }

    const { room, message: data } = message;
    const roomParts = room.split('_');
    if (roomParts.length < 2) {
      this.logger.warn(`Received message from unknown room format: ${room}`);
      return;
    }

    const dataType = roomParts[0]; // 例: 'depth', 'ticker', 'transactions'
    const pair = roomParts.slice(1).join('_'); // 例: 'btc_jpy'

    switch (dataType) {
      case 'depth':
        // depth_whole または depth_diff
        this.dataStore.updateOrderBook(pair, data);
        break;
      case 'ticker':
        this.dataStore.updateTicker(pair, data);
        break;
      case 'transactions':
        this.dataStore.addTransactions(pair, data);
        break;
      // TODO: その他のデータタイプに対応
      default:
        this.logger.debug(`Received message from unhandled data type room: ${room}`);
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

  subscribe(channel, params) {
    const pair = params.pair;
    const roomName = `${channel}_${pair}`;

    this.logger.debug(`Joining room: ${roomName}`);
    
    // Bitbank WebSocket APIの正しいフォーマット
    const message = JSON.stringify({
      command: "subscribe",
      room: roomName
    });
    
    this.client.socket.send(message);
  }

  // 新しいメソッド: あらゆる形式のメッセージ処理を試みる
  _tryHandleMessage(event, args) {
    this.logger.debug(`Trying to handle event: ${event}`);

    // さまざまな形式でのメッセージ処理を試みる
    if (args && args.length > 0) {
      const data = args[0];
      this.logger.debug(`Processing potential data: ${JSON.stringify(data).substring(0, 300)}`);

      try {
        // 単純なデータ構造の場合
        if (typeof data === 'object' && data !== null) {
          if (data.room && data.message) {
            // 標準形式
            this._handleMessage(data);
          } else if (data.type && data.data) {
            // 代替形式
            this._handleAlternativeFormat(data);
          } else if (event.includes('_')) {
            // イベント名にルーム情報が含まれている場合
            this._handleRoomEvent(event, data);
          }
        }
      } catch (e) {
        this.logger.warn(`Error processing event data: ${e.message}`);
      }
    }
  }

  // ルームイベント形式のハンドリング
  _handleRoomEvent(roomName, data) {
    const roomParts = roomName.split('_');
    if (roomParts.length < 2) return;

    const dataType = roomParts[0];
    const pair = roomParts.slice(1).join('_');

    this.logger.debug(`Processing room event: ${roomName}, type: ${dataType}, pair: ${pair}`);

    switch (dataType) {
      case 'depth':
      case 'depth_whole':
      case 'depth_diff':
        this.dataStore.updateOrderBook(pair, data);
        break;
      case 'ticker':
        this.dataStore.updateTicker(pair, data);
        break;
      case 'transactions':
        this.dataStore.addTransactions(pair, data);
        break;
      default:
        this.logger.debug(`Unknown data type in room event: ${dataType}`);
    }
  }
}

module.exports = PublicStreamClient;