/**
 * Discord通知の統一レートリミット管理システム
 * 複数の通知経路での重複送信を防ぎ、レートリミットを適切に管理
 */

class DiscordRateLimiter {
  constructor() {
    this.webhookQueues = new Map(); // webhook URL別のキュー
    this.errorHashes = new Map(); // エラー重複防止用のハッシュ
    this.notificationPriorities = {
      CRITICAL: 1,
      WARNING: 2,
      INFO: 3
    };
  }

  /**
   * 通知の送信（統一エントリポイント）
   */
  async send(webhookUrl, message, options = {}) {
    const {
      priority = this.notificationPriorities.INFO,
      deduplicationKey = null,
      maxRetries = 3,
      deduplicationWindow = 3600000 // 1時間
    } = options;

    // 重複チェック
    if (deduplicationKey && this.isDuplicate(deduplicationKey, deduplicationWindow)) {
      console.log(`[DISCORD_RATE_LIMITER] Duplicate notification blocked: ${deduplicationKey}`);
      return { success: false, reason: 'duplicate' };
    }

    // webhook URL別のキューに追加
    if (!this.webhookQueues.has(webhookUrl)) {
      this.webhookQueues.set(webhookUrl, {
        queue: [],
        processing: false,
        lastSent: 0,
        rateLimitUntil: 0
      });
    }

    const webhookQueue = this.webhookQueues.get(webhookUrl);

    // 重複防止のためのハッシュを記録
    if (deduplicationKey) {
      this.errorHashes.set(deduplicationKey, {
        timestamp: Date.now(),
        message: message.substring(0, 100) // 最初の100文字を保存
      });
    }

    // キューに追加
    const notificationTask = {
      message,
      priority,
      maxRetries,
      deduplicationKey,
      timestamp: Date.now(),
      retryCount: 0
    };

    webhookQueue.queue.push(notificationTask);

    // 優先度でソート（数値が小さいほど優先度が高い）
    webhookQueue.queue.sort((a, b) => a.priority - b.priority);

    // キューの処理開始
    if (!webhookQueue.processing) {
      this.processQueue(webhookUrl);
    }

    return { success: true, reason: 'queued' };
  }

  /**
   * 重複チェック
   */
  isDuplicate(key, windowMs) {
    const existing = this.errorHashes.get(key);
    if (!existing) {
      return false;
    }

    const now = Date.now();
    if (now - existing.timestamp > windowMs) {
      // 期限切れのエントリを削除
      this.errorHashes.delete(key);
      return false;
    }

    return true;
  }

  /**
   * キューの処理
   */
  async processQueue(webhookUrl) {
    const webhookQueue = this.webhookQueues.get(webhookUrl);
    if (!webhookQueue || webhookQueue.processing) {
      return;
    }

    webhookQueue.processing = true;

    try {
      while (webhookQueue.queue.length > 0) {
        const now = Date.now();

        // レートリミット中かチェック
        if (now < webhookQueue.rateLimitUntil) {
          const waitTime = webhookQueue.rateLimitUntil - now;
          console.log(`[DISCORD_RATE_LIMITER] Rate limited, waiting ${waitTime}ms`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }

        // 前回送信から最低1秒は待つ
        const timeSinceLastSent = now - webhookQueue.lastSent;
        if (timeSinceLastSent < 1000) {
          await new Promise(resolve => setTimeout(resolve, 1000 - timeSinceLastSent));
        }

        const task = webhookQueue.queue.shift();
        const result = await this.sendToDiscord(webhookUrl, task.message);

        if (result.success) {
          webhookQueue.lastSent = Date.now();
          console.log('[DISCORD_RATE_LIMITER] Notification sent successfully');
        } else {
          // 失敗した場合のリトライ処理
          task.retryCount++;
          if (task.retryCount <= task.maxRetries) {
            console.log(`[DISCORD_RATE_LIMITER] Retry ${task.retryCount}/${task.maxRetries} for notification`);

            if (result.rateLimitUntil) {
              webhookQueue.rateLimitUntil = result.rateLimitUntil;
            }

            // 優先度を維持してキューに戻す
            webhookQueue.queue.unshift(task);
            webhookQueue.queue.sort((a, b) => a.priority - b.priority);

            // 指数バックオフで待機
            const backoffTime = Math.min(1000 * Math.pow(2, task.retryCount - 1), 30000);
            await new Promise(resolve => setTimeout(resolve, backoffTime));
          } else {
            console.error(`[DISCORD_RATE_LIMITER] Notification failed after ${task.maxRetries} retries`);
          }
        }
      }
    } finally {
      webhookQueue.processing = false;
    }
  }

  /**
   * メッセージ内容とWebhook URLのバリデーション
   */
  validateMessage(webhookUrl, message) {
    const errors = [];
    
    // Webhook URLの検証
    if (!webhookUrl || typeof webhookUrl !== 'string') {
      errors.push('Webhook URL is required and must be a string');
    } else if (!webhookUrl.startsWith('https://discord.com/api/webhooks/') && 
               !webhookUrl.startsWith('https://discordapp.com/api/webhooks/')) {
      errors.push('Invalid Discord webhook URL format');
    }
    
    // メッセージ内容の検証
    if (message === null || message === undefined) {
      errors.push('Message cannot be null or undefined');
    } else if (typeof message !== 'string') {
      errors.push('Message must be a string');
    } else if (message.trim() === '') {
      errors.push('Message cannot be empty');
    } else if (message.length > 2000) {
      errors.push(`Message is too long: ${message.length} characters (max 2000)`);
    }
    
    return errors;
  }

  /**
   * メッセージ内容をサニタイズしてDiscordで受け入れられるように調整
   */
  sanitizeMessage(message) {
    if (typeof message !== 'string') {
      return String(message);
    }

    // 制御文字を除去（改行、タブは保持）
    let sanitized = message.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    
    // 連続する改行を制限（最大3個まで）
    sanitized = sanitized.replace(/\n{4,}/g, '\n\n\n');
    
    // 非表示文字やゼロ幅文字を除去
    sanitized = sanitized.replace(/[\u200B-\u200D\uFEFF\u2060]/g, '');
    
    // Discordが処理できない可能性のある特殊文字をエスケープ
    sanitized = sanitized.replace(/[^\x20-\x7E\u00A0-\uFFFF\n\t]/g, '?');
    
    return sanitized.trim();
  }

  /**
   * Webhook URLの健全性をテスト
   */
  async testWebhookHealth(webhookUrl) {
    try {
      const axios = require('axios');
      
      // 空のメッセージでテスト（400エラーになるはずだが、URLが有効かわかる）
      await axios.post(webhookUrl, { content: '' });
      return { healthy: true };
    } catch (error) {
      if (error.response) {
        // 400エラーでも"Bad Request"なら基本的にはURLは生きている
        // 404なら完全に無効、401/403なら権限問題
        if (error.response.status === 400) {
          return { healthy: true, note: 'URL is valid but requires content' };
        } else if (error.response.status === 404) {
          return { healthy: false, reason: 'Webhook not found (deleted)' };
        } else if (error.response.status === 401 || error.response.status === 403) {
          return { healthy: false, reason: 'Webhook access denied (permissions)' };
        }
      }
      return { healthy: false, reason: error.message };
    }
  }

  /**
   * 実際のDiscord送信処理
   */
  async sendToDiscord(webhookUrl, message) {
    // 事前バリデーション
    const validationErrors = this.validateMessage(webhookUrl, message);
    if (validationErrors.length > 0) {
      console.error('[DISCORD_RATE_LIMITER] Validation errors:', validationErrors);
      return { 
        success: false, 
        error: 'validation_failed', 
        details: validationErrors 
      };
    }

    // メッセージをサニタイズ
    const sanitizedMessage = this.sanitizeMessage(message);
    
    // サニタイズ後に空になった場合の処理
    if (sanitizedMessage.trim() === '') {
      console.error('[DISCORD_RATE_LIMITER] Message became empty after sanitization');
      return { 
        success: false, 
        error: 'empty_after_sanitization',
        details: { originalLength: message.length, sanitizedLength: 0 }
      };
    }

    try {
      const axios = require('axios');
      await axios.post(webhookUrl, { content: sanitizedMessage });
      return { success: true };
    } catch (error) {
      if (error.response && error.response.status === 429) {
        // レートリミット処理
        const retryAfterSeconds = error.response.data?.retry_after ||
                                 parseInt(error.response.headers['retry-after'], 10) || 1;
        const rateLimitUntil = Date.now() + (retryAfterSeconds * 1000) + 1000; // 1秒の余裕

        return {
          success: false,
          rateLimitUntil,
          error: 'rate_limit'
        };
      }

      // HTTP 400エラーの詳細処理
      if (error.response && error.response.status === 400) {
        console.error('[DISCORD_RATE_LIMITER] HTTP 400 Bad Request error:');
        console.error('  Status:', error.response.status);
        console.error('  Status Text:', error.response.statusText);
        console.error('  Response Data:', JSON.stringify(error.response.data, null, 2));
        console.error('  Request URL:', webhookUrl.substring(0, 50) + '...');
        console.error('  Original Message Length:', message.length);
        console.error('  Sanitized Message Length:', sanitizedMessage.length);
        console.error('  Original Message Preview:', message.substring(0, 100));
        console.error('  Sanitized Message Preview:', sanitizedMessage.substring(0, 100));
        
        // Webhook URLの健全性をテスト
        const healthCheck = await this.testWebhookHealth(webhookUrl);
        if (!healthCheck.healthy) {
          console.error('  Webhook Health:', healthCheck.reason);
        }
        
        return { 
          success: false, 
          error: 'bad_request',
          details: {
            status: error.response.status,
            statusText: error.response.statusText,
            data: error.response.data,
            originalMessageLength: message.length,
            sanitizedMessageLength: sanitizedMessage.length,
            webhookHealth: healthCheck
          }
        };
      }

      // その他のHTTPエラーの詳細ログ
      if (error.response) {
        console.error('[DISCORD_RATE_LIMITER] HTTP error:', {
          status: error.response.status,
          statusText: error.response.statusText,
          data: error.response.data,
          url: webhookUrl.substring(0, 50) + '...'
        });
        return { 
          success: false, 
          error: `http_${error.response.status}`,
          details: {
            status: error.response.status,
            statusText: error.response.statusText,
            data: error.response.data
          }
        };
      }

      // ネットワークエラーなどの詳細ログ
      console.error('[DISCORD_RATE_LIMITER] Network/Other error:', {
        message: error.message,
        code: error.code,
        url: webhookUrl.substring(0, 50) + '...'
      });
      return { 
        success: false, 
        error: error.code || error.message,
        details: {
          message: error.message,
          code: error.code
        }
      };
    }
  }

  /**
   * 統計情報の取得
   */
  getStats() {
    const stats = {
      totalWebhooks: this.webhookQueues.size,
      totalPendingNotifications: 0,
      totalDeduplicatedHashes: this.errorHashes.size,
      webhookStats: {}
    };

    this.webhookQueues.forEach((queue, url) => {
      stats.totalPendingNotifications += queue.queue.length;
      stats.webhookStats[url] = {
        queueLength: queue.queue.length,
        processing: queue.processing,
        lastSent: queue.lastSent,
        rateLimitUntil: queue.rateLimitUntil
      };
    });

    return stats;
  }

  /**
   * 期限切れのエントリをクリーンアップ
   */
  cleanup() {
    const now = Date.now();
    const expiredKeys = [];

    this.errorHashes.forEach((value, key) => {
      if (now - value.timestamp > 3600000) { // 1時間経過
        expiredKeys.push(key);
      }
    });

    expiredKeys.forEach(key => this.errorHashes.delete(key));

    if (expiredKeys.length > 0) {
      console.log(`[DISCORD_RATE_LIMITER] Cleaned up ${expiredKeys.length} expired entries`);
    }
  }
}

// シングルトンインスタンス
const instance = new DiscordRateLimiter();

// 1時間ごとにクリーンアップ
setInterval(() => {
  instance.cleanup();
}, 3600000);

module.exports = instance;