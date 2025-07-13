/**
 *APIルート定義
 */
const express = require('express');
const router = express.Router();

const { getTradeKeyList, getExchanges, getSymbols } = require('./controllers/exchanges');
const { getTradeSummary } = require('./controllers/summary');
const { getOrders } = require('./controllers/orders');
const tradesController = require('./controllers/trades');
const signalsController = require('./controllers/signals');
const { getStrategiesList } = require('./controllers/strategies');
const parametersController = require('./controllers/parameters'); // コントローラー全体をインポート
const riskManagementController = require('./controllers/riskManagement');
const errorStatsController = require('./controllers/errorStats');
const systemHealthController = require('./controllers/systemHealth');

const { getOhlcv } = require('./controllers/ohlcv');

// // 取引履歴API
// router.get('/history', getHistory);

// // 約定履歴API
// router.get('/filled-history', getFilledHistory);

// // ポジション情報API
// router.get('/positions', getPositions);

// サマリー情報API
router.get('/trade-summary', getTradeSummary);

// 注文履歴API
router.get('/orders', getOrders);

// 約定履歴API
router.get('/trades', tradesController.getTrades);

// シグナル履歴API
router.get('/signals', signalsController.getSignals);

// イベントストリームAPI
// router.get('/events', eventsHandler);

// // 注文ペアAPI
// router.get('/order-pairs', getOrderPairs);

// // 現在の注文ペアAPI
// router.get('/current-order-pairs', getCurrentOrderPairs);

// // 戦略シグナル履歴API
// router.get('/strategy-signals', getStrategySignals);

// // ローソク足データAPI
router.get('/ohlcv', getOhlcv);

// 取引キー一覧取得API
router.get('/trade-keys', getTradeKeyList);

// 取引所一覧API
router.get('/exchanges', getExchanges);

// 銘柄一覧API
router.get('/symbols', getSymbols);

// 戦略一覧API
router.get('/strategies', getStrategiesList);

// 戦略パラメータAPI
router.get('/parameters', parametersController.getParameters); // parametersController を追加
router.post('/parameters', parametersController.updateParameters); // parametersController を追加

// 全戦略パラメータ取得API
router.get('/all-parameters', parametersController.getAllParameters); // 新しいエンドポイントを追加

// リスク管理API
router.get('/risk-positions', riskManagementController.getRiskPositions);
router.get('/risk-stats', riskManagementController.getRiskStats);
router.get('/filled-positions', riskManagementController.getFilledPositions);

// エラー統計API
router.get('/error-stats', errorStatsController.getErrorStats);
router.post('/error-stats/reset', errorStatsController.resetErrorStats);

// ヘルスチェックAPI
router.get('/health', async (req, res) => {
  try {
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
    }

    // すべてのサービスが利用できない場合はエラー
    if (healthStatus.services.redis === 'error' && healthStatus.services.mongodb === 'error') {
      healthStatus.status = 'error';
      res.status(503).json(healthStatus);
    } else {
      res.json(healthStatus);
    }
  } catch (error) {
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// システムヘルスAPI (Phase 3: リアルタイム監視システム)
router.get('/system-health', systemHealthController.getSystemHealth);

module.exports = router;