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
router.get('/health', (req, res) => {
  res.json({ status: 'ok', database: 'redis' });
});

module.exports = router;