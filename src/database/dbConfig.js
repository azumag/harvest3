/**
 * データベース設定モジュール
 */

// データベースモジュールをインポート
const redisDatabase = require('./redisDatabase');
const mongoDB = require('./mongoDatabase');
const redisRoutes = require('../api/redis-routes');
const redisDatabaseEvents = require('../api/redis-database-events');

// 常にRedisを使用するようにエクスポート
const database = redisDatabase;
const apiRoutes = redisRoutes;
const databaseEvents = redisDatabaseEvents;

// 初期化関数
async function initializeDB() {
  console.log('Redisデータベースを使用します');
  await redisDatabase.initialize();
  await mongoDB.connectDB();
}

module.exports = {
  database,
  apiRoutes,
  databaseEvents,
  initializeDB
};