/**
 *APIルート定義
 */
const express = require('express');
const router = express.Router();

const { getTradeKeyList } = require('./controllers/exchanges');
const { getTradeSummary } = require('./controllers/summary');

// const { getHistory } = require('./controllers/redis-history');
// const { getFilledHistory } = require('./controllers/redis-filled-history');
// const { getPositions } = require('./controllers/redis-positions');
// const { getOrderPairs } = require('./controllers/redis-order-pairs');
// const { getCurrentOrderPairs } = require('./controllers/redis-current-order-pairs');
// const { eventsHandler } = require('./controllers/redis-events');
// const { getStrategySignals } = require('./controllers/redis-strategy-signals');
// const { getOhlcv } = require('./controllers/redis-ohlcv');
// const { getStrategiesList } = require('./controllers/redis-strategies');
// const { getSymbolsList } = require('./controllers/redis-symbols');
// const { addEventListner } = require('./database-events');
// const { sendEventToAll } = require('./controllers/redis-events');

// イベントリスナーを登録
// addEventListner((event) => {
//   sendEventToAll(event);
// });

// // 取引履歴API
// router.get('/history', getHistory);

// // 約定履歴API
// router.get('/filled-history', getFilledHistory);

// // ポジション情報API
// router.get('/positions', getPositions);

// サマリー情報API
router.get('/trade-summary', getTradeSummary);

// イベントストリームAPI
// router.get('/events', eventsHandler);

// // 注文ペアAPI
// router.get('/order-pairs', getOrderPairs);

// // 現在の注文ペアAPI
// router.get('/current-order-pairs', getCurrentOrderPairs);

// // 戦略シグナル履歴API
// router.get('/strategy-signals', getStrategySignals);

// // ローソク足データAPI
// router.get('/ohlcv', getOhlcv);

// 取引キー一覧取得API
router.get('/trade-keys', getTradeKeyList);

// // 戦略一覧API
// router.get('/strategies', getStrategiesList);

// // 銘柄一覧API
// router.get('/symbols', getSymbolsList);

// ヘルスチェックAPI
router.get('/health', (req, res) => {
  res.json({ status: 'ok', database: 'redis' });
});

module.exports = router;