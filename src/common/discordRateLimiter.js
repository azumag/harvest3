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
    if (!existing) return false;

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
    if (!webhookQueue || webhookQueue.processing) return;

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
          console.log(`[DISCORD_RATE_LIMITER] Notification sent successfully`);
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
   * 実際のDiscord送信処理
   */
  async sendToDiscord(webhookUrl, message) {
    try {
      const axios = require('axios');
      await axios.post(webhookUrl, { content: message });
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
      
      console.error('[DISCORD_RATE_LIMITER] Send error:', error.message);
      return { success: false, error: error.message };
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