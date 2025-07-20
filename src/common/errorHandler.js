const rateLimiter = require('./discordRateLimiter');
const crypto = require('crypto');
const { discordErrorWebhookUrl } = require('./notifications');
const { checkWebhookUrl } = require('./webhookUtils');

/**
 * 統一エラーハンドラークラス
 * エラー分類、重複除外、Discord通知の統一管理
 * DiscordRateLimiterとの統合により、全システムでの一元的なエラー処理を提供
 */
class UnifiedErrorHandler {
  constructor() {
    // エラー重要度の定義
    this.severityLevels = {
      CRITICAL: 1,
      WARNING: 2,
      INFO: 3
    };

    // 重要度別のEmoji
    this.severityEmojis = {
      CRITICAL: '🚨',
      WARNING: '⚠️',
      INFO: 'ℹ️'
    };

    // 重要度別のデフォルト重複防止時間（ミリ秒）
    this.severityDeduplicationWindows = {
      CRITICAL: 1800000, // 30分
      WARNING: 3600000,  // 1時間
      INFO: 7200000      // 2時間
    };
  }

  /**
   * エラーの重要度を自動判定
   * @param {Error|string} error - エラーオブジェクトまたはメッセージ
   * @param {string} context - エラーコンテキスト
   * @returns {string} 重要度レベル (CRITICAL/WARNING/INFO)
   */
  determineSeverity(error, context = '') {
    // null/undefinedのチェック
    if (!error) {
      return 'INFO';
    }
    const message = typeof error === 'string' ? error : (error.message || '');
    const lowerMessage = message.toLowerCase();
    const lowerContext = context.toLowerCase();

    // CRITICAL レベルの条件
    if (
      lowerMessage.includes('database') ||
      lowerMessage.includes('mongodb') ||
      lowerMessage.includes('redis') ||
      lowerMessage.includes('connection') ||
      lowerMessage.includes('authentication') ||
      lowerMessage.includes('auth') ||
      lowerMessage.includes('balance') ||
      lowerMessage.includes('order') ||
      lowerMessage.includes('trade') ||
      lowerMessage.includes('position') ||
      lowerContext.includes('trading') ||
      lowerContext.includes('order') ||
      lowerContext.includes('balance')
    ) {
      return 'CRITICAL';
    }

    // WARNING レベルの条件
    if (
      lowerMessage.includes('rate limit') ||
      lowerMessage.includes('429') ||
      lowerMessage.includes('timeout') ||
      lowerMessage.includes('network') ||
      lowerMessage.includes('api') ||
      lowerMessage.includes('insufficient') ||
      lowerContext.includes('api') ||
      lowerContext.includes('network')
    ) {
      return 'WARNING';
    }

    // デフォルトはINFO
    return 'INFO';
  }

  /**
   * 重複防止キーを生成
   * @param {Error|string} error - エラーオブジェクトまたはメッセージ
   * @param {string} context - エラーコンテキスト
   * @returns {string} 重複防止キー
   */
  generateDeduplicationKey(error, context = '') {
    if (!error) {
      return crypto.createHash('sha256').update(`${context}:undefined_error`).digest('hex');
    }
    const message = typeof error === 'string' ? error : (error.message || '');
    const stack = typeof error === 'object' && error.stack ? error.stack : '';

    // エラーメッセージとスタックトレースの最初の5行を使用
    const stackLines = stack.split('\n').slice(0, 5).join('\n');
    const hashSource = `${context}:${message}:${stackLines}`;

    // SHA256ハッシュを生成
    return crypto.createHash('sha256').update(hashSource).digest('hex');
  }

  /**
   * エラーを統一的に処理し、適切な重要度でDiscordに通知
   * @param {Error|string} error - エラーオブジェクトまたはメッセージ
   * @param {Object} options - オプション
   * @param {string} [options.context=''] - エラーコンテキスト
   * @param {boolean} [options.shouldThrow=true] - エラーを再throw するかどうか
   * @param {string} [options.severity] - 手動で指定する重要度
   * @param {number} [options.deduplicationWindow] - 重複防止時間（ミリ秒）
   */
  async handleError(error, options = {}) {
    const {
      context = '',
      shouldThrow = true,
      severity = null,
      deduplicationWindow = null
    } = options;

    // null/undefinedのチェック（空文字列は除外）
    if (error === null || error === undefined) {
      const fallbackError = 'Unknown error (null or undefined)';
      if (shouldThrow) {
        throw new Error(fallbackError);
      }
      return;
    }

    const message = typeof error === 'string' ? error : (error.message || 'Error without message');
    const stack = typeof error === 'object' && error.stack ? error.stack : '';
    const now = Date.now();

    // 重要度を決定（手動指定またはオート判定）
    const errorSeverity = severity || this.determineSeverity(error, context);
    const emoji = this.severityEmojis[errorSeverity];
    const priority = this.severityLevels[errorSeverity];
    const dedupWindow = deduplicationWindow || this.severityDeduplicationWindows[errorSeverity];

    // 重複防止キーを生成
    const deduplicationKey = this.generateDeduplicationKey(error, context);

    // Discord通知メッセージを構築
    let discordMessage = `${emoji} **[${errorSeverity}] エラー発生**\n`;
    if (context) {
      discordMessage += `**コンテキスト**: ${context}\n`;
    }
    discordMessage += `**メッセージ**: ${message}\n`;
    discordMessage += `**時刻**: ${new Date(now).toLocaleString('ja-JP')}\n`;
    discordMessage += `**重要度**: ${errorSeverity}\n`;

    if (stack) {
      // スタックトレースを制限して追加（重要度に応じて行数を調整）
      const maxStackLines = errorSeverity === 'CRITICAL' ? 15 : errorSeverity === 'WARNING' ? 10 : 5;
      const stackLines = stack.split('\n').slice(0, maxStackLines).join('\n');
      discordMessage += `**スタックトレース**:\n\`\`\`\n${stackLines}\n\`\`\``;
    }

    // DiscordRateLimiterを使用して通知を送信
    try {
      if (!checkWebhookUrl(discordErrorWebhookUrl)) {
        // ウェブフックURLが未設定の場合はcheckWebhookUrl内でログ出力済み
      } else {
        const result = await rateLimiter.send(discordErrorWebhookUrl, discordMessage, {
          priority,
          deduplicationKey,
          deduplicationWindow: dedupWindow,
          maxRetries: errorSeverity === 'CRITICAL' ? 5 : 3
        });

        if (result.success) {
          console.error(`[UnifiedErrorHandler] [${errorSeverity}] エラーをDiscordに通知: ${message}`);
        } else {
          console.warn(`[UnifiedErrorHandler] Discord通知がスキップされました (${result.reason}): ${message}`);
        }
      }
    } catch (notificationError) {
      console.error(`[UnifiedErrorHandler] Discord通知に失敗: ${notificationError.message}`);
    }

    // コンソールにも出力（重要度に応じてログレベルを変更）
    const logPrefix = `[UnifiedErrorHandler] [${errorSeverity}] ${context ? `[${context}] ` : ''}`;
    if (errorSeverity === 'CRITICAL') {
      console.error(`${logPrefix}${message}`, typeof error === 'object' ? error : undefined);
    } else if (errorSeverity === 'WARNING') {
      console.warn(`${logPrefix}${message}`);
    } else {
      console.log(`${logPrefix}${message}`);
    }

    // 必要に応じてエラーを再throw
    if (shouldThrow) {
      if (typeof error === 'string') {
        throw new Error(error);
      } else {
        throw error;
      }
    }
  }

  /**
   * 非同期エラーハンドラー（Promise.catch用）
   * @param {Object} options - オプション
   * @returns {Function} エラーハンドラー関数
   */
  createAsyncHandler(options = {}) {
    return async (error) => {
      await this.handleError(error, { shouldThrow: false, ...options });
    };
  }

  /**
   * レガシーサポート用のエラーハンドリングメソッド
   * @deprecated 新しいhandleErrorメソッドを使用してください
   */
  async handleErrorLegacy(error, context = '', shouldThrow = true) {
    return this.handleError(error, { context, shouldThrow });
  }

  /**
   * エラー統計情報を取得
   * @returns {Object} 統計情報
   */
  getErrorStats() {
    const rateLimiterStats = rateLimiter.getStats();
    return {
      ...rateLimiterStats,
      unifiedErrorHandler: {
        severityLevels: this.severityLevels,
        severityDeduplicationWindows: this.severityDeduplicationWindows
      }
    };
  }

  /**
   * DiscordRateLimiterのクリーンアップを実行
   * （UnifiedErrorHandler自体はクリーンアップ不要）
   */
  cleanup() {
    rateLimiter.cleanup();
  }
}

// シングルトンインスタンス
const unifiedErrorHandler = new UnifiedErrorHandler();

module.exports = {
  UnifiedErrorHandler,
  unifiedErrorHandler
};