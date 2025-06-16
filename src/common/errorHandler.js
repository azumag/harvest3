const { postErrorToDiscord } = require('./notifications');

/**
 * エラーハンドラークラス
 * エラーのレート制限、重複除外、Discord通知を管理
 */
class ErrorHandler {
  constructor() {
    this.errorQueue = new Map(); // エラーハッシュ -> 最後の送信時刻
    this.rateLimitInterval = 60 * 1000; // 1分間
    this.maxErrorsPerInterval = 1; // 1分間に最大1回
  }

  /**
   * エラーのハッシュを生成
   * @param {Error|string} error - エラーオブジェクトまたはメッセージ
   * @returns {string} エラーハッシュ
   */
  generateErrorHash(error) {
    const message = typeof error === 'string' ? error : error.message;
    const stack = typeof error === 'object' && error.stack ? error.stack : '';
    
    // エラーメッセージとスタックトレースの最初の3行を使用してハッシュを生成
    const stackLines = stack.split('\n').slice(0, 3).join('\n');
    const hashSource = `${message}:${stackLines}`;
    
    // 簡易ハッシュ生成（実際の環境では crypto.createHash を使用することを推奨）
    let hash = 0;
    for (let i = 0; i < hashSource.length; i++) {
      const char = hashSource.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 32bit整数に変換
    }
    return hash.toString();
  }

  /**
   * エラーを処理し、必要に応じてDiscordに通知
   * @param {Error|string} error - エラーオブジェクトまたはメッセージ
   * @param {string} [context] - エラーコンテキスト
   * @param {boolean} [shouldThrow=true] - エラーを再throw するかどうか
   */
  async handleError(error, context = '', shouldThrow = true) {
    const errorHash = this.generateErrorHash(error);
    const now = Date.now();
    const lastSent = this.errorQueue.get(errorHash);

    // レート制限チェック
    if (!lastSent || (now - lastSent) >= this.rateLimitInterval) {
      // Discord通知の作成
      const message = typeof error === 'string' ? error : error.message;
      const stack = typeof error === 'object' && error.stack ? error.stack : '';
      
      let discordMessage = `🚨 **エラー発生**\n`;
      if (context) {
        discordMessage += `**コンテキスト**: ${context}\n`;
      }
      discordMessage += `**メッセージ**: ${message}\n`;
      discordMessage += `**時刻**: ${new Date(now).toLocaleString('ja-JP')}\n`;
      
      if (stack) {
        // スタックトレースを制限して追加
        const stackLines = stack.split('\n').slice(0, 10).join('\n');
        discordMessage += `**スタックトレース**:\n\`\`\`\n${stackLines}\n\`\`\``;
      }

      try {
        await postErrorToDiscord(discordMessage);
        this.errorQueue.set(errorHash, now);
        console.error(`[ErrorHandler] エラーをDiscordに通知: ${message}`);
      } catch (notificationError) {
        console.error(`[ErrorHandler] Discord通知に失敗: ${notificationError.message}`);
      }
    } else {
      console.warn(`[ErrorHandler] レート制限によりエラー通知をスキップ: ${typeof error === 'string' ? error : error.message}`);
    }

    // コンソールにも出力
    if (typeof error === 'string') {
      console.error(`[ErrorHandler] ${context ? `[${context}] ` : ''}${error}`);
    } else {
      console.error(`[ErrorHandler] ${context ? `[${context}] ` : ''}${error.message}`, error);
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
   * @param {string} [context] - エラーコンテキスト
   * @param {boolean} [shouldThrow=false] - エラーを再throw するかどうか
   * @returns {Function} エラーハンドラー関数
   */
  createAsyncHandler(context = '', shouldThrow = false) {
    return async (error) => {
      await this.handleError(error, context, shouldThrow);
    };
  }

  /**
   * 古いエラー記録をクリーンアップ
   */
  cleanup() {
    const now = Date.now();
    const expiredTime = now - (this.rateLimitInterval * 24); // 24時間以上古いものを削除

    for (const [hash, timestamp] of this.errorQueue.entries()) {
      if (timestamp < expiredTime) {
        this.errorQueue.delete(hash);
      }
    }
  }
}

// シングルトンインスタンス
const errorHandler = new ErrorHandler();

// 定期的なクリーンアップ（1時間ごと）
setInterval(() => {
  errorHandler.cleanup();
}, 60 * 60 * 1000);

module.exports = {
  ErrorHandler,
  errorHandler
};