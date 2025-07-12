// 綺麗で見やすいロギングユーティリティ
class Logger {
  constructor(context = 'General') {
    this.context = context;
    this.logLevel = process.env.HFT_LOG_LEVEL || process.env.LOG_LEVEL || 'INFO';

    // 色設定
    this.colors = {
      reset: '\x1b[0m',
      bright: '\x1b[1m',
      dim: '\x1b[2m',
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      blue: '\x1b[34m',
      magenta: '\x1b[35m',
      cyan: '\x1b[36m',
      white: '\x1b[37m',
      gray: '\x1b[90m'
    };

    // ログレベルの優先度
    this.levelPriority = {
      'DEBUG': 0,
      'INFO': 1,
      'WARN': 2,
      'ERROR': 3
    };
  }

  shouldLog(level) {
    return this.levelPriority[level.toUpperCase()] >= this.levelPriority[this.logLevel.toUpperCase()];
  }

  formatTimestamp() {
    const now = new Date();
    return `${this.colors.gray}${now.toLocaleTimeString('ja-JP')}${this.colors.reset}`;
  }

  formatLevel(level) {
    const colors = {
      'DEBUG': this.colors.cyan,
      'INFO': this.colors.green,
      'WARN': this.colors.yellow,
      'ERROR': this.colors.red
    };

    const color = colors[level.toUpperCase()] || this.colors.white;
    return `${color}${this.colors.bright}${level.toUpperCase().padEnd(5)}${this.colors.reset}`;
  }

  formatContext() {
    return `${this.colors.blue}[${this.context}]${this.colors.reset}`;
  }

  log(level, message, ...args) {
    if (!this.shouldLog(level)) {
      return;
    }

    const timestamp = this.formatTimestamp();
    const levelStr = this.formatLevel(level);
    const context = this.formatContext();

    // メッセージの整形
    let formattedMessage = message;
    if (args.length > 0) {
      const argsStr = args.map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' ');
      formattedMessage = `${message} ${argsStr}`;
    }

    const fullMessage = `${timestamp} ${levelStr} ${context} ${formattedMessage}`;

    // 適切なコンソールメソッドを使用
    switch (level.toUpperCase()) {
      case 'WARN':
        console.warn(fullMessage);
        break;
      case 'ERROR':
        console.error(fullMessage);
        break;
      default:
        console.log(fullMessage);
        break;
    }
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
    this.log('debug', message, ...args);
  }

  // 特別なフォーマット用メソッド
  success(message, ...args) {
    if (!this.shouldLog('info')) return;
    console.log(`${this.formatTimestamp()} ${this.colors.green}${this.colors.bright}✓${this.colors.reset} ${this.formatContext()} ${this.colors.green}${message}${this.colors.reset}`, ...args);
  }

  separator() {
    if (!this.shouldLog('info')) return;
    console.log(`${this.colors.gray}${'─'.repeat(80)}${this.colors.reset}`);
  }

  header(title) {
    if (!this.shouldLog('info')) return;
    this.separator();
    console.log(`${this.colors.cyan}${this.colors.bright}  ${title}  ${this.colors.reset}`);
    this.separator();
  }
}

module.exports = Logger;