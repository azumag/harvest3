/**
 * データベース設定モジュール
 * SQLiteとRedisの切り替えを管理
 */

// 環境変数からデータベースタイプを取得
const USE_REDIS = process.env.USE_REDIS === 'true';

// データベースモジュールをインポート
const sqliteDatabase = require('./database');
const redisDatabase = require('./redisDatabase');

// トレードレコードモジュールをインポート
const sqliteTradeRecords = require('./tradeRecords');
const redisTradeRecords = require('./redisTradeRecords');

// APIルートモジュールをインポート
const sqliteRoutes = require('./api/routes');
const redisRoutes = require('./api/redis-routes');

// データベースイベントモジュールをインポート
const sqliteDatabaseEvents = require('./api/database-events');
const redisDatabaseEvents = require('./api/redis-database-events');

// 使用するデータベースに基づいてモジュールをエクスポート
const database = USE_REDIS ? redisDatabase : sqliteDatabase;
const tradeRecords = USE_REDIS ? redisTradeRecords : sqliteTradeRecords;
const apiRoutes = USE_REDIS ? redisRoutes : sqliteRoutes;
const databaseEvents = USE_REDIS ? redisDatabaseEvents : sqliteDatabaseEvents;

// 初期化関数
async function initialize() {
  if (USE_REDIS) {
    console.log('Redisデータベースを使用します');
    await redisDatabase.initialize();
    await redisTradeRecords.initializeCache();
  } else {
    console.log('SQLiteデータベースを使用します');
    // SQLiteは初期化が不要
  }
}

module.exports = {
  USE_REDIS,
  database,
  tradeRecords,
  apiRoutes,
  databaseEvents,
  initialize
};