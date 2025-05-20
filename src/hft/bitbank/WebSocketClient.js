const io = require('socket.io-client');
const Logger = require('../utils/Logger');

class WebSocketClient {
  constructor(endpoint, config) {
    this.endpoint = endpoint;
    this.config = config;
    this.socket = null;
    this.logger = new Logger('WebSocketClient');
    this.eventHandlers = {};
  }

  connect() {
    return new Promise((resolve, reject) => {
      try {
        this.logger.debug(`Connecting to Socket.IO endpoint: ${this.endpoint}`);
        this.socket = io(this.endpoint, {
          transports: ['websocket'],
          reconnection: true,
          reconnectionAttempts: 5,
          timeout: this.config.timeout || 20000
        });
        
        this.socket.on('connect', () => {
          this.logger.info(`Socket.IO connected to ${this.endpoint}`);
          resolve();
        });
        
        this.socket.on('connect_error', (error) => {
          this.logger.error(`Socket.IO connection error: ${error.message}`);
          reject(error);
        });
        
        this.socket.on('message', (data) => {
          try {
            const parsedData = JSON.parse(data);
            this.logger.debug(`Received data: ${data.substring(0, 200)}...`);
            
            // 登録されたすべてのイベントハンドラーに通知
            this._notifyHandlers('message', parsedData);
          } catch (error) {
            this.logger.error(`Error parsing message: ${error.message}`);
          }
        });
        
        this.socket.on('error', (error) => {
          this.logger.error(`Socket.IO error: ${error.message}`, error);
          reject(error);
        });
        
        this.socket.on('disconnect', (reason) => {
          this.logger.info(`Socket.IO disconnected: ${reason}`);
        });
      } catch (error) {
        this.logger.error(`Failed to create Socket.IO client: ${error.message}`);
        reject(error);
      }
    });
  }

  emit(event, data) {
    if (this.socket && this.socket.connected) {
      const message = JSON.stringify({
        type: event,
        ...data
      });
      this.socket.send(message);
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
    handlers.forEach(handler => {
      try {
        handler(data);
      } catch (error) {
        this.logger.error(`Error in event handler: ${error.message}`);
      }
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.logger.info(`Socket.IO disconnected from ${this.endpoint}`);
    }
  }
}

module.exports = WebSocketClient;