/**
 * データベース設定モジュール
 * Redisのみを使用するように修正
 */

// データベースモジュールをインポート
const redisDatabase = require('./redisDatabase');
const redisTradeRecords = require('./redisTradeRecords');
const redisRoutes = require('./api/redis-routes');
const redisDatabaseEvents = require('./api/redis-database-events');

// 常にRedisを使用するようにエクスポート
const database = redisDatabase;
const tradeRecords = redisTradeRecords;
const apiRoutes = redisRoutes;
const databaseEvents = redisDatabaseEvents;

// 初期化関数
async function initialize() {
  console.log('Redisデータベースを使用します');
  await redisDatabase.initialize();
  if (typeof redisTradeRecords.initializeCache === 'function') {
    await redisTradeRecords.initializeCache();
  }
}

module.exports = {
  database,
  tradeRecords,
  apiRoutes,
  databaseEvents,
  initialize
};