const io = require('socket.io-client');
const Logger = require('../utils/Logger');
const { errorHandler } = require('../../common/errorHandler');

class WebSocketClient {
  constructor(endpoint, config) {
    this.endpoint = endpoint;
    this.config = config;
    this.socket = null;
    this.logger = new Logger('WebSocketClient');
    this.eventHandlers = {};
    this.mockMode = config.mockMode || false;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = config.maxReconnectAttempts || 5;
    this.reconnectDelay = config.reconnectDelay || 1000;
    this.shouldReconnect = true;
  }

  connect() {
    return new Promise((resolve, reject) => {
      if (this.mockMode) {
        this.logger.info('Running in mock mode - simulating WebSocket connection');
        this._setupMockSocket();
        resolve();
        return;
      }

      try {
        this.logger.debug(`Connecting to bitbank stream endpoint: ${this.endpoint}`);
        this.socket = io(this.endpoint, {
          transports: ['websocket'],
          upgrade: false,
          rememberUpgrade: false,
          timeout: this.config.timeout || 20000,
          forceNew: true
        });
        
        this.socket.on('connect', () => {
          this.logger.info(`Socket.IO connected to ${this.endpoint}`);
          this.isConnected = true;
          this.reconnectAttempts = 0; // Reset reconnect attempts on successful connection
          resolve();
        });
        
        this.socket.on('connect_error', (error) => {
          this.logger.error(`Socket.IO connection error: ${error.message}`);
          reject(error);
        });
        
        this.socket.on('message', (data) => {
          this.logger.debug(`Received message: ${JSON.stringify(data).substring(0, 200)}...`);
          // 登録されたすべてのイベントハンドラーに通知
          this._notifyHandlers('message', data);
        });
        
        this.socket.on('error', (error) => {
          this.logger.error(`Socket.IO error: ${error.message}`, error);
          reject(error);
        });
        
        this.socket.on('disconnect', (reason) => {
          this.logger.info(`Socket.IO disconnected: ${reason}`);
          this.isConnected = false;
          this._notifyHandlers('disconnect', reason);
          
          // Attempt reconnection if not intentionally disconnected
          if (this.shouldReconnect && reason !== 'io client disconnect') {
            this._attemptReconnection();
          }
        });
      } catch (error) {
        this.logger.error(`Failed to create Socket.IO client: ${error.message}`);
        reject(error);
      }
    });
  }

  _setupMockSocket() {
    this.socket = {
      connected: true,
      emit: (event, data) => {
        this.logger.debug(`Mock emit: ${event} with data: ${JSON.stringify(data)}`);
        
        // Simulate receiving messages after subscription
        if (event === 'join-room') {
          setTimeout(() => {
            this._simulateMessage(data);
          }, 1000);
        }
      },
      disconnect: () => {
        this.logger.info('Mock socket disconnected');
        this.socket.connected = false;
      }
    };
  }

  _simulateMessage(roomName) {
    // Create mock data based on the room type
    const [dataType] = roomName.split('_');
    let mockData;

    switch (dataType) {
      case 'ticker':
        // 新しいオブジェクト形式に対応
        mockData = {
          "room_name": roomName,
          "message": {
            "pid": 123456789,
            "data": {
              "sell": "896490",
              "buy": "896489", 
              "open": "896489",
              "high": "905002",
              "low": "881500",
              "last": "896489",
              "vol": "650.2026",
              "timestamp": Date.now()
            }
          }
        };
        break;
      case 'transactions':
        // 新しいオブジェクト形式に対応
        mockData = {
          "room_name": roomName,
          "message": {
            "pid": 123456790,
            "data": {
              "transactions": [{
                "transaction_id": 347450047,
                "side": "sell",
                "price": "896489",
                "amount": "0.1000",
                "executed_at": Date.now()
              }]
            }
          }
        };
        break;
      case 'depth':
        // 新しいオブジェクト形式に対応
        mockData = {
          "room_name": roomName,
          "message": {
            "data": {
              "asks": [
                ["896500", "1.0000"],
                ["896510", "2.0000"]
              ],
              "bids": [
                ["896490", "1.5000"],
                ["896480", "2.5000"]
              ],
              "timestamp": Date.now(),
              "sequenceId": "1234567890"
            }
          }
        };
        break;
      default:
        this.logger.warn(`Unknown room type for simulation: ${dataType}`);
        return;
    }

    this.logger.debug(`Simulating message for ${roomName}`);
    this._notifyHandlers('message', mockData);
  }

  emit(event, data) {
    if (this.socket && this.socket.connected) {
      this.socket.emit(event, data);
    } else {
      this.logger.warn('Attempted to emit event while socket is not connected.');
    }
  }

  on(event, handler) {
    if (!this.eventHandlers[event]) {
      this.eventHandlers[event] = [];
    }
    this.eventHandlers[event].push(handler);
  }

  _notifyHandlers(event, data) {
    const handlers = this.eventHandlers[event] || [];
    handlers.forEach(async (handler) => {
      try {
        handler(data);
      } catch (error) {
        await errorHandler.handleError(error, `WebSocket event handler - ${event}`, false);
      }
    });
  }

  disconnect() {
    this.shouldReconnect = false; // Prevent automatic reconnection
    this.isConnected = false;
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.logger.info(`Socket.IO disconnected from ${this.endpoint}`);
    }
  }

  /**
   * 再接続を試みます
   * @private
   */
  _attemptReconnection() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error(`Max reconnection attempts (${this.maxReconnectAttempts}) reached`);
      this._notifyHandlers('max_reconnect_failed', this.reconnectAttempts);
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 30000);
    
    this.logger.info(`🔄 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    setTimeout(() => {
      if (!this.shouldReconnect) {
        this.logger.debug('Reconnection cancelled');
        return;
      }
      
      this.connect()
        .then(() => {
          this.logger.info('✅ Reconnection successful');
          this._notifyHandlers('reconnected', this.reconnectAttempts);
        })
        .catch((error) => {
          this.logger.error(`❌ Reconnection failed: ${error.message}`);
          if (this.shouldReconnect) {
            this._attemptReconnection();
          }
        });
    }, delay);
  }
}

module.exports = WebSocketClient;