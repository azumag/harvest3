/**
 * バックテストエラー分類システム
 * エラー種別に応じた復旧戦略を提供
 */

const { BITBANK_ERRORS, BITFLYER_ERRORS, isBitbankError, isBitflyerError } = require('./exchangeErrors');

/**
 * エラー分類の種別
 */
const ERROR_TYPES = {
  NETWORK: 'NETWORK',        // ネットワークエラー - リトライ適用
  CONFIG: 'CONFIG',          // 設定エラー - 即座に停止
  SYSTEM: 'SYSTEM',          // システムエラー - 段階的対応
  UNKNOWN: 'UNKNOWN'         // 不明なエラー - デフォルト処理
};

/**
 * エラー種別に応じた復旧戦略
 */
const RECOVERY_STRATEGIES = {
  [ERROR_TYPES.NETWORK]: {
    shouldRetry: true,
    maxRetries: 5,
    useExponentialBackoff: true,
    immediateStop: false,
    description: 'ネットワークエラー - 指数バックオフでリトライ'
  },
  [ERROR_TYPES.CONFIG]: {
    shouldRetry: false,
    maxRetries: 0,
    useExponentialBackoff: false,
    immediateStop: true,
    description: '設定エラー - 即座に停止（リトライ無効）'
  },
  [ERROR_TYPES.SYSTEM]: {
    shouldRetry: true,
    maxRetries: 3,
    useExponentialBackoff: true,
    immediateStop: false,
    description: 'システムエラー - 段階的対応'
  },
  [ERROR_TYPES.UNKNOWN]: {
    shouldRetry: true,
    maxRetries: 3,
    useExponentialBackoff: true,
    immediateStop: false,
    description: '不明なエラー - デフォルト処理'
  }
};

/**
 * バックテストエラー分類器クラス
 */
class BacktestErrorClassifier {
  /**
   * エラーを分類する
   * @param {Error|string} error - エラーオブジェクトまたはメッセージ
   * @returns {string} エラー種別 (ERROR_TYPES のいずれか)
   */
  static classifyError(error) {
    if (!error) {
      return ERROR_TYPES.UNKNOWN;
    }

    const message = typeof error === 'string' ? error : (error.message || '');
    const lowerMessage = message.toLowerCase();

    // 設定エラーの判定（最優先 - 最も具体的）
    if (this.isConfigError(error, lowerMessage)) {
      return ERROR_TYPES.CONFIG;
    }

    // システムエラーの判定（2番目 - データベース、残高等の具体的システムエラー）
    if (this.isSystemError(error, lowerMessage)) {
      return ERROR_TYPES.SYSTEM;
    }

    // ネットワークエラーの判定（3番目 - より一般的なエラー）
    if (this.isNetworkError(error, lowerMessage)) {
      return ERROR_TYPES.NETWORK;
    }

    return ERROR_TYPES.UNKNOWN;
  }

  /**
   * ネットワークエラーかどうか判定
   * @param {Error|string} error - エラーオブジェクト
   * @param {string} lowerMessage - 小文字変換されたエラーメッセージ
   * @returns {boolean}
   */
  static isNetworkError(error, lowerMessage) {
    // 一般的なネットワークエラー
    const networkKeywords = [
      'network', 'timeout', 'connection', 'econnreset', 'enotfound',
      'econnrefused', 'etimedout', 'socket', 'dns', 'host',
      'rate limit', 'too many requests', '429', '503', '502', '504'
    ];

    if (networkKeywords.some(keyword => lowerMessage.includes(keyword))) {
      return true;
    }

    // 取引所特有のレート制限エラー
    if (typeof error === 'object') {
      if (isBitbankError(error, BITBANK_ERRORS.RATE_LIMIT_EXCEEDED)) {
        return true;
      }
      if (isBitflyerError(error, BITFLYER_ERRORS.RATE_LIMIT_EXCEEDED) ||
          isBitflyerError(error, BITFLYER_ERRORS.SYSTEM_BUSY) ||
          isBitflyerError(error, BITFLYER_ERRORS.SERVICE_UNAVAILABLE)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 設定エラーかどうか判定
   * @param {Error|string} error - エラーオブジェクト
   * @param {string} lowerMessage - 小文字変換されたエラーメッセージ
   * @returns {boolean}
   */
  static isConfigError(error, lowerMessage) {
    // 設定関連のキーワード
    const configKeywords = [
      'authentication', 'auth', 'api key', 'secret', 'permission',
      'invalid parameter', 'invalid field', 'missing field', 'missing required',
      'invalid symbol', 'invalid product', 'config', 'configuration'
    ];

    if (configKeywords.some(keyword => lowerMessage.includes(keyword))) {
      return true;
    }

    // 取引所特有の認証・設定エラー
    if (typeof error === 'object') {
      if (isBitbankError(error, BITBANK_ERRORS.AUTHENTICATION_ERROR) ||
          isBitbankError(error, BITBANK_ERRORS.INVALID_PARAMETER)) {
        return true;
      }
      if (isBitflyerError(error, BITFLYER_ERRORS.INVALID_API_KEY) ||
          isBitflyerError(error, BITFLYER_ERRORS.INVALID_SIGNATURE) ||
          isBitflyerError(error, BITFLYER_ERRORS.MISSING_FIELD) ||
          isBitflyerError(error, BITFLYER_ERRORS.INVALID_FIELD_FORMAT) ||
          isBitflyerError(error, BITFLYER_ERRORS.INVALID_FIELD_VALUE)) {
        return true;
      }
    }

    return false;
  }

  /**
   * システムエラーかどうか判定
   * @param {Error|string} error - エラーオブジェクト
   * @param {string} lowerMessage - 小文字変換されたエラーメッセージ
   * @returns {boolean}
   */
  static isSystemError(error, lowerMessage) {
    // システム関連のキーワード
    const systemKeywords = [
      'database', 'mongodb', 'redis', 'insufficient funds',
      'balance', 'system error', 'internal error', 'server error',
      'maintenance', 'market closed', 'market is closed', 'trade suspended', 'trading suspended'
    ];

    if (systemKeywords.some(keyword => lowerMessage.includes(keyword))) {
      return true;
    }

    // 取引所特有のシステム・市場エラー
    if (typeof error === 'object') {
      if (isBitbankError(error, BITBANK_ERRORS.SYSTEM_ERROR) ||
          isBitbankError(error, BITBANK_ERRORS.INSUFFICIENT_FUNDS) ||
          isBitbankError(error, BITBANK_ERRORS.MARKET_CLOSED)) {
        return true;
      }
      if (isBitflyerError(error, BITFLYER_ERRORS.INSUFFICIENT_FUNDS) ||
          isBitflyerError(error, BITFLYER_ERRORS.INSUFFICIENT_MARGIN) ||
          isBitflyerError(error, BITFLYER_ERRORS.MAINTENANCE) ||
          isBitflyerError(error, BITFLYER_ERRORS.MARKET_CLOSED) ||
          isBitflyerError(error, BITFLYER_ERRORS.TRADE_SUSPENDED)) {
        return true;
      }
    }

    return false;
  }

  /**
   * エラー種別に応じた復旧戦略を取得
   * @param {string} errorType - エラー種別
   * @returns {Object} 復旧戦略
   */
  static getRecoveryStrategy(errorType) {
    return RECOVERY_STRATEGIES[errorType] || RECOVERY_STRATEGIES[ERROR_TYPES.UNKNOWN];
  }

  /**
   * エラーの詳細分析結果を取得
   * @param {Error|string} error - エラーオブジェクトまたはメッセージ
   * @returns {Object} 分析結果
   */
  static analyzeError(error) {
    const errorType = this.classifyError(error);
    const strategy = this.getRecoveryStrategy(errorType);
    const message = typeof error === 'string' ? error : (error.message || '');

    return {
      errorType,
      message,
      strategy,
      classification: {
        isNetworkError: errorType === ERROR_TYPES.NETWORK,
        isConfigError: errorType === ERROR_TYPES.CONFIG,
        isSystemError: errorType === ERROR_TYPES.SYSTEM,
        isUnknownError: errorType === ERROR_TYPES.UNKNOWN
      }
    };
  }
}

module.exports = {
  BacktestErrorClassifier,
  ERROR_TYPES,
  RECOVERY_STRATEGIES
};