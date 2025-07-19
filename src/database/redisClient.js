/**
 * Redisクライアント接続モジュール
 * SQLiteからRedisへの移行の一部として実装
 */
const redis = require('redis');
const { SETTINGS } = require('../config/settings');
const { MONITORING_SETTINGS } = require('../common/const');

// 環境変数からRedis接続URLを取得、または既定値を使用
// Docker環境では適切なサービス名を使用
const REDIS_URL = SETTINGS.DATABASE.REDIS.DEFAULT_URL;

// Redis接続の無効化フラグ
const DISABLE_REDIS = process.env.DISABLE_REDIS === 'true';

// Redisクライアントの作成 - Issue #4884: Enhanced Redis connection resilience
const client = redis.createClient({
  url: REDIS_URL,
  socket: {
    connectTimeout: MONITORING_SETTINGS.REDIS_CONNECTION_TIMEOUT,
    commandTimeout: MONITORING_SETTINGS.REDIS_CONNECTION_TIMEOUT,
    // 再接続の設定
    reconnectDelay: SETTINGS.DATABASE.REDIS.RECONNECT_DELAY,
    lazyConnect: true,
    // Issue #4884: Additional socket configuration for stability
    keepAlive: 30000, // 30 seconds keep-alive
    noDelay: true // Disable Nagle's algorithm for lower latency
  },
  // Issue #4884: Enhanced retry strategy for 2PC transaction resilience
  retry_strategy: (options) => {
    // Log retry attempts for debugging
    console.log(`[Redis Retry] Attempt ${options.attempt}, total time: ${options.total_retry_time}ms`);
    
    if (options.error && options.error.code === 'ECONNREFUSED') {
      console.error('Redis接続が拒否されました。再接続を試みます...');
      return Math.min(options.attempt * 200, SETTINGS.DATABASE.REDIS.RETRY_DELAY_MAX); // Increased delay
    }
    if (options.total_retry_time > SETTINGS.DATABASE.REDIS.CONNECTION_TIMEOUT) {
      console.error('Redis接続のタイムアウトに達しました。');
      return new Error('Redis接続のタイムアウトに達しました。');
    }
    // Issue #4884: Exponential backoff with jitter
    const baseDelay = Math.min(options.attempt * 200, SETTINGS.DATABASE.REDIS.RETRY_DELAY_MAX);
    const jitter = Math.random() * 500; // Add up to 500ms jitter
    return baseDelay + jitter;
  }
});

// イベントリスナーを追加
client.on('error', (err) => {
  if (!DISABLE_REDIS) {
    console.error('Redisエラー:', err);
    // 接続エラーの場合は再接続を試みる
    if (err.code === 'ECONNREFUSED') {
      console.log(`Redis接続が拒否されました。${SETTINGS.DATABASE.REDIS.RECONNECTION_INTERVAL}ms後に再接続を試みます...`);
      setTimeout(() => {
        if (!client.isReady && !client.isOpen) {
          reconnect();
        }
      }, SETTINGS.DATABASE.REDIS.RECONNECTION_INTERVAL);
    }
  }
});

client.on('connect', () => {
  console.log(`Redisに接続しました: ${REDIS_URL}`);
});

client.on('ready', () => {
  console.log('Redisクライアントが準備完了しました');
});

client.on('end', () => {
  console.log('Redis接続が閉じられました');
});

client.on('reconnecting', () => {
  console.log('Redisに再接続中...');
});

// 自動再接続を試みる関数
async function reconnect() {
  try {
    if (!client.isReady && !client.isOpen) {
      console.log('Redisへ再接続を試みています...');
      await client.connect();
    }
  } catch (err) {
    console.error('Redis再接続に失敗しました:', err);
    // 再接続に失敗した場合は、5秒後に再度試行
    setTimeout(() => {
      if (!client.isReady && !client.isOpen) {
        reconnect();
      }
    }, 5000);
  }
}

/**
 * Redisクライアントを初期化する関数
 * @returns {Promise} 接続完了時に解決されるPromise
 */
async function initRedisClient() {
  if (DISABLE_REDIS) {
    console.log('Redis接続が無効化されています');
    return null;
  }

  try {
    if (!client.isReady && !client.isOpen) {
      console.log(`Redis接続を初期化しています: ${REDIS_URL}`);
      await client.connect();

      // 接続が完了するまで待機
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Redis接続タイムアウト'));
        }, MONITORING_SETTINGS.REDIS_CONNECTION_TIMEOUT + 5000); // タイムアウト値 + 5秒のマージン

        if (client.isReady) {
          clearTimeout(timeout);
          resolve();
        } else {
          client.once('ready', () => {
            clearTimeout(timeout);
            resolve();
          });
          client.once('error', (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        }
      });
    }
    return client;
  } catch (error) {
    console.error('Redis接続に失敗しました:', error.message);
    // 接続に失敗した場合でもnullを返してアプリケーションを続行
    return null;
  }
}

/**
 * Redisクライアントを終了する関数
 * @returns {Promise} 切断完了時に解決されるPromise
 */
async function closeRedisClient() {
  try {
    if (client.isOpen || client.isReady) {
      console.log('Redis接続を終了しています...');
      await client.quit();
    }
  } catch (error) {
    console.error('Redis接続終了時にエラーが発生しました:', error.message);
    // 強制的に接続を閉じる
    try {
      await client.disconnect();
    } catch (disconnectError) {
      console.error('Redis強制切断でもエラーが発生しました:', disconnectError.message);
    }
  }
}

/**
 * Redisクライアントを取得する関数
 * @returns {Object} Redis クライアント
 */
function getClient() {
  return client;
}

// モジュールのエクスポート
module.exports = {
  client,
  getClient,
  initRedisClient,
  closeRedisClient,
  reconnect
};