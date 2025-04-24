/**
 * Redis版のデータベースイベント処理モジュール
 * SQLiteからRedisへの移行の一部として実装
 */
const redis = require('redis');
const { client, initRedisClient } = require('../database/redisClient');

// イベントリスナー
const eventListeners = [];

// Pub/Sub用のサブスクライバークライアント
let subscriber = null;

/**
 * イベントリスナー登録関数
 * @param {Function} callback - イベント発生時に呼び出されるコールバック関数
 */
function addEventListner(callback) {
  eventListeners.push(callback);
}

/**
 * 取引追加イベントを発火する関数
 * @param {Object} tradeData - 追加された取引データ
 */
function notifyTradeAdded(tradeData) {
  const event = {
    type: 'trade_added',
    data: tradeData
  };
  
  // イベントをRedisに発行
  client.publish('trade_events', JSON.stringify(event)).catch(err => {
    console.error('イベント発行エラー:', err);
  });
  
  // 登録されたリスナーに通知
  eventListeners.forEach(callback => {
    try {
      callback(event);
    } catch (error) {
      console.error('イベントリスナー呼び出しエラー:', error);
    }
  });
}

/**
 * Pub/Subの初期化
 */
async function initializePubSub() {
  try {
    // メインのRedisクライアントを初期化
    await initRedisClient();
    
    // サブスクライバークライアントを作成
    subscriber = redis.createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    });
    
    // サブスクライバーを接続
    await subscriber.connect();
    
    // イベントチャネルをサブスクライブ
    await subscriber.subscribe('trade_events', (message) => {
      try {
        const event = JSON.parse(message);
        
        // 登録されたリスナーに通知
        eventListeners.forEach(callback => {
          try {
            callback(event);
          } catch (error) {
            console.error('イベントリスナー呼び出しエラー:', error);
          }
        });
      } catch (error) {
        console.error('イベントメッセージのパースエラー:', error);
      }
    });
    
    console.log('Redis Pub/Subが初期化されました');
  } catch (error) {
    console.error('Redis Pub/Sub初期化エラー:', error);
  }
}

/**
 * Pub/Subの終了
 */
async function closePubSub() {
  if (subscriber) {
    try {
      await subscriber.unsubscribe('trade_events');
      await subscriber.quit();
      console.log('Redis Pub/Subが終了しました');
    } catch (error) {
      console.error('Redis Pub/Sub終了エラー:', error);
    }
  }
}

// 初期化を実行
initializePubSub();

module.exports = {
  addEventListner,
  notifyTradeAdded,
  initializePubSub,
  closePubSub
};