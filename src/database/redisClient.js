/**
 * Redisクライアント接続モジュール
 * SQLiteからRedisへの移行の一部として実装
 */
const redis = require('redis');
const { MONITORING_SETTINGS } = require('../common/const');

// 環境変数からRedis接続URLを取得、または既定値を使用
// Docker環境では適切なサービス名を使用
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Redis接続の無効化フラグ
const DISABLE_REDIS = process.env.DISABLE_REDIS === 'true';

// Redisクライアントの作成
const client = redis.createClient({
  url: REDIS_URL,
  socket: {
    connectTimeout: MONITORING_SETTINGS.REDIS_CONNECTION_TIMEOUT,
    commandTimeout: MONITORING_SETTINGS.REDIS_CONNECTION_TIMEOUT,
    // 再接続の設定
    reconnectDelay: 1000,
    lazyConnect: true
  },
  // 接続エラー時の再試行設定
  retry_strategy: (options) => {
    if (options.error && options.error.code === 'ECONNREFUSED') {
      console.error('Redis接続が拒否されました。再接続を試みます...');
      return Math.min(options.attempt * 100, 3000);
    }
    if (options.total_retry_time > 1000 * 60 * 60) {
      console.error('Redis接続のタイムアウトに達しました。');
      return new Error('Redis接続のタイムアウトに達しました。');
    }
    return Math.min(options.attempt * 100, 3000);
  }
});

// イベントリスナーを追加
client.on('error', (err) => {
  if (!DISABLE_REDIS) {
    console.error('Redisエラー:', err);
    // 接続エラーの場合は再接続を試みる
    if (err.code === 'ECONNREFUSED') {
      console.log('Redis接続が拒否されました。5秒後に再接続を試みます...');
      setTimeout(() => {
        if (!client.isReady && !client.isOpen) {
          reconnect();
        }
      }, 5000);
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

// モジュールのエクスポート
module.exports = {
  client,
  initRedisClient,
  closeRedisClient,
  reconnect
};