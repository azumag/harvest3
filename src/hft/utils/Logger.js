// シンプルなロギングユーティリティ
class Logger {
  constructor(context = 'General') {
    this.context = context;
    this.logLevel = 'DEBUG'; // 'INFO'から'DEBUG'に変更
  }

  log(level, message, ...args) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level.toUpperCase()}] [${this.context}] ${message}`, ...args);
  }

  info(message, ...args) {
    this.log('info', message, ...args);
  }

  warn(message, ...args) {
    this.log('warn', message, ...args);
  }

  error(message, ...args) {
    this.log('error', message, ...args);
  }

  debug(message, ...args) {
    // デバッグログは環境変数などで制御することも可能
    // if (process.env.DEBUG) {
      this.log('debug', message, ...args);
    // }
  }
}

module.exports = Logger;