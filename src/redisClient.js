/**
 * Redisクライアント接続モジュール
 * SQLiteからRedisへの移行の一部として実装
 */
const redis = require('redis');

// 環境変数からRedis接続URLを取得、または既定値を使用
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Redisクライアントの作成
const client = redis.createClient({
  url: REDIS_URL
});

// 接続イベントハンドラー
client.on('connect', () => {
  console.log('Redisサーバーに接続しました');
});

// エラーイベントハンドラー
client.on('error', (err) => {
  console.error('Redis接続エラー:', err);
});

// 再接続イベントハンドラー
client.on('reconnecting', () => {
  console.log('Redisサーバーに再接続しています...');
});

// 接続終了イベントハンドラー
client.on('end', () => {
  console.log('Redisサーバーとの接続が終了しました');
});

/**
 * Redisクライアントを初期化する関数
 * @returns {Promise} 接続完了時に解決されるPromise
 */
async function initRedisClient() {
  if (!client.isOpen) {
    await client.connect();
  }
  return client;
}

/**
 * Redisクライアントを終了する関数
 * @returns {Promise} 切断完了時に解決されるPromise
 */
async function closeRedisClient() {
  if (client.isOpen) {
    await client.quit();
  }
}

// モジュールのエクスポート
module.exports = {
  client,
  initRedisClient,
  closeRedisClient
};