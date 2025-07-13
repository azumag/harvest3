/**
 * ヘルスチェック共通ロジック
 * CLAUDE.md要件: DRY原則に従った実装
 */

/**
 * システムヘルスチェックを実行
 * @returns {Promise<Object>} ヘルスチェック結果
 */
async function performHealthCheck() {
  const healthStatus = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {}
  };

  // Redis接続チェック
  try {
    const { getClient } = require('../database/redisClient');
    const redisClient = getClient();
    if (redisClient && redisClient.isReady) {
      await redisClient.ping();
      healthStatus.services.redis = 'connected';
    } else {
      healthStatus.services.redis = 'disconnected';
      healthStatus.status = 'degraded';
    }
  } catch (redisError) {
    healthStatus.services.redis = 'error';
    healthStatus.status = 'degraded';
    healthStatus.services.redisError = redisError.message;
  }

  // MongoDB接続チェック
  try {
    const { getClient: getMongoClient } = require('../database/mongoDatabase');
    const mongoClient = getMongoClient();
    if (mongoClient) {
      await mongoClient.admin().ping();
      healthStatus.services.mongodb = 'connected';
    } else {
      healthStatus.services.mongodb = 'disconnected';
      healthStatus.status = 'degraded';
    }
  } catch (mongoError) {
    healthStatus.services.mongodb = 'error';
    healthStatus.status = 'degraded';
    healthStatus.services.mongoError = mongoError.message;
  }

  // すべてのサービスが利用できない場合はエラー
  if (healthStatus.services.redis === 'error' && healthStatus.services.mongodb === 'error') {
    healthStatus.status = 'error';
  }

  return healthStatus;
}

module.exports = {
  performHealthCheck
};