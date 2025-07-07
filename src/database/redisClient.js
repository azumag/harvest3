/**
 * Redisクライアント接続モジュール
 * SQLiteからRedisへの移行の一部として実装
 */
const redis = require('redis');

// 環境変数からRedis接続URLを取得、または既定値を使用
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Redis接続の無効化フラグ
const DISABLE_REDIS = process.env.DISABLE_REDIS === 'true';

// Redisクライアントの作成
const client = redis.createClient({
  url: REDIS_URL,
  socket: {
    connectTimeout: 5000,
    commandTimeout: 5000
  }
});

// イベントリスナーを追加
client.on('error', (err) => {
  if (!DISABLE_REDIS) {
    console.error('Redisエラー:', err);
  }
});

client.on('connect', () => {
  console.log('Redisに接続しました');
});

client.on('end', () => {
  console.log('Redis接続が閉じられました');
});

// 自動再接続を試みる関数
async function reconnect() {
  try {
    if (client.isOpen === false) {
      console.log('Redisへ再接続を試みています...');
      await client.connect();
    }
  } catch (err) {
    console.error('Redis再接続に失敗しました:', err);
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
    if (!client.isOpen) {
      await client.connect();
    }
    return client;
  } catch (error) {
    console.error('Redis接続に失敗しました:', error.message);
    return null;
  }
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