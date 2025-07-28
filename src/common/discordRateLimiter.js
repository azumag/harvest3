/**
 * Discord通知の統一レートリミット管理システム
 * 複数の通知経路での重複送信を防ぎ、レートリミットを適切に管理
 */

const { SETTINGS } = require('../config/settings');

class DiscordRateLimiter {
  constructor() {
    this.webhookQueues = new Map(); // webhook URL別のキュー
    this.errorHashes = new Map(); // エラー重複防止用のハッシュ
    this.notificationPriorities = {
      CRITICAL: 1,
      WARNING: 2,
      INFO: 3
    };
    
    // 定数定義
    this.REPLACEMENT_CHAR_ONLY_PATTERN = /^[?]+$/;
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

    // メッセージが2000文字を超える場合は分割
    const messageChunks = this.splitMessage(message);

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

    // 各チャンクをキューに追加
    messageChunks.forEach((chunk, index) => {
      const chunkDeduplicationKey = deduplicationKey ? 
        `${deduplicationKey}_chunk_${index}` : null;

      const notificationTask = {
        message: chunk,
        priority,
        maxRetries,
        deduplicationKey: chunkDeduplicationKey,
        timestamp: Date.now(),
        retryCount: 0
      };

      webhookQueue.queue.push(notificationTask);
    });

    // 優先度でソート（数値が小さいほど優先度が高い）
    webhookQueue.queue.sort((a, b) => a.priority - b.priority);

    // キューの処理開始
    if (!webhookQueue.processing) {
      this.processQueue(webhookUrl);
    }

    return { success: true, reason: 'queued', chunks: messageChunks.length };
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
   * Webhook URLを安全にログ出力用にマスク
   */
  maskWebhookUrl(webhookUrl) {
    if (!webhookUrl || typeof webhookUrl !== 'string') {
      return '[INVALID_URL]';
    }
    
    // Discord webhook URLの場合、トークン部分をマスク
    if (webhookUrl.includes('/api/webhooks/')) {
      return webhookUrl.replace(/\/[^\/]+$/, '/***');
    }
    
    // その他のURLは最初の50文字のみ表示
    return webhookUrl.length > 50 ? webhookUrl.substring(0, 50) + '...' : webhookUrl;
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
    
    // メッセージ内容の検証（長さ制限は削除 - 自動分割されるため）
    if (message === null || message === undefined) {
      errors.push('Message cannot be null or undefined');
    } else if (typeof message !== 'string') {
      errors.push('Message must be a string');
    } else if (message.trim() === '') {
      errors.push('Message cannot be empty');
    }
    
    return errors;
  }

  /**
   * メッセージを2000文字以内のチャンクに分割
   */
  splitMessage(message) {
    const MAX_LENGTH = 2000;
    
    if (typeof message !== 'string') {
      message = String(message);
    }
    
    // メッセージが制限内の場合はそのまま返す
    if (message.length <= MAX_LENGTH) {
      return [message];
    }
    
    const chunks = [];
    let currentChunk = '';
    
    // メッセージを行ごとに分割
    const lines = message.split('\n');
    
    for (const line of lines) {
      // 現在のチャンクに次の行を追加しても制限を超えない場合
      if (currentChunk.length + line.length + 1 <= MAX_LENGTH) { // +1 は改行文字分
        currentChunk += (currentChunk ? '\n' : '') + line;
      } else {
        // 1行だけで制限を超える場合、その行を強制的に分割
        if (line.length > MAX_LENGTH) {
          // まず現在のチャンクがあれば送信
          if (currentChunk) {
            chunks.push(currentChunk);
          }
          // 長い行を分割してチャンクに追加
          for (let i = 0; i < line.length; i += MAX_LENGTH) {
            chunks.push(line.substring(i, i + MAX_LENGTH));
          }
          currentChunk = ''; // 新しいチャンクを開始
        } else {
          // 現在のチャンクを送信リストに追加し、新しいチャンクを開始
          if (currentChunk) {
            chunks.push(currentChunk);
          }
          currentChunk = line;
        }
      }
    }
    
    // 最後のチャンクを追加
    if (currentChunk) {
      chunks.push(currentChunk);
    }
    
    return chunks;
  }

  /**
   * メッセージ内容をサニタイズしてDiscordで受け入れられるように調整
   */
  sanitizeMessage(message) {
    if (typeof message !== 'string') {
      return String(message);
    }

    // まず\x01と\x02を"?"に置換
    let sanitized = message.replace(/[\x01\x02]/g, '?');
    
    // その後、他の制御文字を完全削除（改行、タブは保持）
    sanitized = sanitized.replace(/[\x00\x03-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    
    // その他のサポートされていない文字を"?"に置換
    // 保持する文字: 印刷可能ASCII (\x20-\x7E)、Unicode (\u00A0-\uFFFF)、改行(\n)、タブ(\t)
    sanitized = sanitized.replace(/[^\x20-\x7E\u00A0-\uFFFF\n\t]/g, '?');
    
    // 連続する改行を制限（最大3個まで）
    sanitized = sanitized.replace(/\n{4,}/g, '\n\n\n');
    
    // 非表示文字やゼロ幅文字を除去
    sanitized = sanitized.replace(/[\u200B-\u200D\uFEFF\u2060]/g, '');
    
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
   * オブジェクトを安全にJSON文字列化する
   * 循環参照やタイムアウトを適切に処理
   */
  async safeStringify(obj, timeout = 1000) {
    return new Promise((resolve) => {
      // タイムアウト設定
      const timeoutId = setTimeout(() => {
        resolve('[STRINGIFY_TIMEOUT]');
      }, timeout);

      try {
        // 循環参照を処理するためのreplacer
        const seen = new WeakSet();
        const replacer = (key, value) => {
          if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) {
              return '[循環参照]';
            }
            seen.add(value);
          }
          return value;
        };

        // JSON.stringifyを実行
        const stringified = JSON.stringify(obj, replacer, 2);
        clearTimeout(timeoutId);
        resolve(stringified);
      } catch (error) {
        clearTimeout(timeoutId);
        resolve(`[STRINGIFY_ERROR: ${error.message}]`);
      }
    });
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
    
    // サニタイズ後に空になった場合、または"?"のみになった場合の処理
    if (sanitizedMessage.trim() === '' || this.REPLACEMENT_CHAR_ONLY_PATTERN.test(sanitizedMessage.trim())) {
      console.error('[DISCORD_RATE_LIMITER] Message became empty after sanitization');
      return { 
        success: false, 
        error: 'empty_after_sanitization',
        details: { originalLength: message.length, sanitizedLength: sanitizedMessage.length }
      };
    }

    try {
      const axios = require('axios');
      
      // Overflow防止のためのAxios設定
      const axiosConfig = {
        timeout: 30000, // 30秒のタイムアウト
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Discord-Webhook-Client/1.0'
        },
        // HTTP/1.1を使用してコネクション数を制限
        httpAgent: new (require('http').Agent)({
          keepAlive: true,
          maxSockets: 5, // 最大5個の同時接続に制限
          timeout: 30000
        }),
        httpsAgent: new (require('https').Agent)({
          keepAlive: true,
          maxSockets: 5, // 最大5個の同時接続に制限
          timeout: 30000
        })
      };
      
      await axios.post(webhookUrl, { content: sanitizedMessage }, axiosConfig);
      return { success: true };
    } catch (error) {
      if (error.response && error.response.status === 429) {
        // レートリミット処理
        const retryAfterSeconds = error.response.data?.retry_after ||
                                 parseInt(error.response.headers['retry-after'], 10) || 1;
        const rateLimitUntil = Date.now() + (retryAfterSeconds * 1000) + SETTINGS.MONITORING.DISCORD_RATE_LIMIT_BUFFER_MS; // 設定可能な余裕時間

        return {
          success: false,
          rateLimitUntil,
          error: 'rate_limit'
        };
      }

      // HTTP 503エラー（Service Unavailable）の専用処理
      if (error.response && error.response.status === 503) {
        const errorData = error.response.data;
        const isOverflowError = typeof errorData === 'string' && 
          errorData.includes('upstream connect error') && 
          errorData.includes('reset reason: overflow');
        
        console.warn('[DISCORD_RATE_LIMITER] HTTP 503 Service Unavailable error:');
        console.warn('  Status:', error.response.status);
        console.warn('  Status Text:', error.response.statusText);
        console.warn('  Response Data:', JSON.stringify(errorData, null, 2));
        console.warn('  Request URL:', this.maskWebhookUrl(webhookUrl));
        
        if (isOverflowError) {
          console.warn('  → Overflow Error Detected: Discord API接続バッファオーバーフロー');
          console.warn('  → 接続数制限または処理能力不足による一時的な問題です');
          
          // Overflowエラーの場合はより長いバックオフ（60秒）
          const backoffSeconds = 60;
          const rateLimitUntil = Date.now() + (backoffSeconds * 1000) + (SETTINGS.MONITORING.DISCORD_RATE_LIMIT_BUFFER_MS || 5000);
          
          return {
            success: false,
            rateLimitUntil,
            error: 'service_unavailable_overflow',
            details: {
              status: error.response.status,
              statusText: error.response.statusText,
              data: errorData,
              backoffSeconds,
              isOverflow: true,
              recommendedAction: 'Discord API接続バッファオーバーフロー - 長時間待機中'
            }
          };
        } else {
          console.warn('  Discord API側の一時的な過負荷が原因の可能性があります');
          
          // 通常の503エラーの場合は30秒のバックオフ
          const backoffSeconds = 30;
          const rateLimitUntil = Date.now() + (backoffSeconds * 1000) + (SETTINGS.MONITORING.DISCORD_RATE_LIMIT_BUFFER_MS || 5000);
          
          return {
            success: false,
            rateLimitUntil,
            error: 'service_unavailable',
            details: {
              status: error.response.status,
              statusText: error.response.statusText,
              data: errorData,
              backoffSeconds,
              isOverflow: false,
              recommendedAction: 'Discord API側の過負荷解消を待機中'
            }
          };
        }
      }

      // HTTP 400エラーの詳細処理
      if (error.response && error.response.status === 400) {
        console.error('[DISCORD_RATE_LIMITER] HTTP 400 Bad Request error:');
        console.error('  Status:', error.response.status);
        console.error('  Status Text:', error.response.statusText);
        console.error('  Response Data:', JSON.stringify(error.response.data, null, 2));
        console.error('  Request URL:', this.maskWebhookUrl(webhookUrl));
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
        const errorInfo = {
          status: error.response.status,
          statusText: error.response.statusText,
          data: error.response.data,
          url: this.maskWebhookUrl(webhookUrl)
        };
        const serializedError = await this.safeStringify(errorInfo);
        
        // serialization failureを検出してフォールバックログを出力
        if (serializedError.startsWith('[STRINGIFY_ERROR:') || serializedError === '[STRINGIFY_TIMEOUT]') {
          console.error('[DISCORD_RATE_LIMITER] HTTP error (serialization failed):', {
            status: error.response.status,
            statusText: error.response.statusText,
            dataType: typeof error.response.data,
            serializationError: serializedError
          });
        } else {
          console.error('[DISCORD_RATE_LIMITER] HTTP error:', serializedError);
        }
        
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
      // 元のエラーオブジェクト全体をシリアライゼーション
      const serializedError = await this.safeStringify(error);
      
      // serialization failureを検出してフォールバックログを出力
      if (serializedError.startsWith('[STRINGIFY_ERROR:') || serializedError === '[STRINGIFY_TIMEOUT]') {
        console.error('[DISCORD_RATE_LIMITER] Network/Other error (serialization failed):', {
          messageType: typeof error.message,
          codeType: typeof error.code,
          serializationError: serializedError
        });
      } else {
        console.error('[DISCORD_RATE_LIMITER] Network/Other error:', serializedError);
      }
      
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

// クリーンアップ用のタイマーID（テスト環境では設定しない）
let cleanupInterval = null;

// テスト環境でない場合のみクリーンアップタイマーを設定
if (process.env.NODE_ENV !== 'test' && typeof jest === 'undefined') {
  cleanupInterval = setInterval(() => {
    instance.cleanup();
  }, 3600000);
}

// テスト用のクリーンアップメソッドを追加
instance._clearCleanupInterval = () => {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
};

module.exports = instance;