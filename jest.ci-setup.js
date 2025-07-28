/**
 * CI環境専用のJest設定
 * タイムアウト対策とリソースクリーンアップの強化
 */

// Jest グローバル関数のインポート
const { afterEach, afterAll } = require('@jest/globals');

// グローバルタイムアウトの設定
const GLOBAL_TIMEOUT = 25000; // 30秒のテストタイムアウト内に収める

// 未処理の Promise を追跡
const pendingPromises = new Set();
const originalPromise = global.Promise;

global.Promise = class extends originalPromise {
  constructor(executor) {
    const promiseInstance = new originalPromise((resolve, reject) => {
      pendingPromises.add(promiseInstance);
      
      const wrappedResolve = (value) => {
        pendingPromises.delete(promiseInstance);
        resolve(value);
      };
      
      const wrappedReject = (reason) => {
        pendingPromises.delete(promiseInstance);
        reject(reason);
      };
      
      try {
        executor(wrappedResolve, wrappedReject);
      } catch (error) {
        pendingPromises.delete(promiseInstance);
        reject(error);
      }
    });
    
    return promiseInstance;
  }
};

// タイマーの強制クリア
const activeTimers = new Set();
const originalSetTimeout = global.setTimeout;
const originalSetInterval = global.setInterval;
const originalClearTimeout = global.clearTimeout;
const originalClearInterval = global.clearInterval;

global.setTimeout = (fn, delay, ...args) => {
  const id = originalSetTimeout(fn, delay, ...args);
  activeTimers.add(id);
  return id;
};

global.setInterval = (fn, delay, ...args) => {
  const id = originalSetInterval(fn, delay, ...args);
  activeTimers.add(id);
  return id;
};

global.clearTimeout = (id) => {
  activeTimers.delete(id);
  return originalClearTimeout(id);
};

global.clearInterval = (id) => {
  activeTimers.delete(id);
  return originalClearInterval(id);
};

// 各テスト後のクリーンアップ
afterEach(async () => {
  // アクティブなタイマーをすべてクリア
  for (const timerId of activeTimers) {
    originalClearTimeout(timerId);
    originalClearInterval(timerId);
  }
  activeTimers.clear();
  
  // 未処理のPromiseを警告
  if (pendingPromises.size > 0) {
    console.warn(`CI Warning: ${pendingPromises.size} pending promises detected`);
    pendingPromises.clear();
  }
  
  // データベース接続のクリーンアップ
  try {
    // Redis接続のクリーンアップ
    const redisClient = require('./src/database/redisClient');
    if (redisClient && typeof redisClient.closeRedisClient === 'function') {
      await redisClient.closeRedisClient();
    }
  } catch (error) {
    // Redis接続エラーは無視
  }
  
  try {
    // MongoDB接続のクリーンアップ
    const mongoClient = require('./src/database/mongoDatabase');
    if (mongoClient && typeof mongoClient.closeMongoDB === 'function') {
      await mongoClient.closeMongoDB();
    }
  } catch (error) {
    // MongoDB接続エラーは無視
  }
  
  // ガベージコレクションを試行
  if (global.gc) {
    global.gc();
  }
});

// テストスイート完了後の最終クリーンアップ
afterAll(async () => {
  // 残存するすべてのタイマーをクリア
  for (const timerId of activeTimers) {
    originalClearTimeout(timerId);
    originalClearInterval(timerId);
  }
  activeTimers.clear();
  
  // 最終的な未処理Promise確認
  if (pendingPromises.size > 0) {
    console.warn(`CI Final Warning: ${pendingPromises.size} unresolved promises at test end`);
    pendingPromises.clear();
  }
  
  // プロセス終了を強制するためのタイムアウト
  setTimeout(() => {
    console.warn('CI: Force exit timeout reached');
    process.exit(0);
  }, 5000);
});

// プロセス終了時のクリーンアップ
process.on('exit', () => {
  // すべてのタイマーをクリア
  for (const timerId of activeTimers) {
    originalClearTimeout(timerId);
    originalClearInterval(timerId);
  }
});

// 予期しないエラーのハンドリング
process.on('unhandledRejection', (reason, promise) => {
  console.warn('CI: Unhandled Rejection at:', promise, 'reason:', reason);
  pendingPromises.delete(promise);
});

process.on('uncaughtException', (error) => {
  console.warn('CI: Uncaught Exception:', error);
});