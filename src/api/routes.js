/**
 *APIルート定義
 */
const express = require('express');
const router = express.Router();

const { getTradeKeyList, getExchanges, getSymbols } = require('./controllers/exchanges');
const { getTradeSummary } = require('./controllers/summary');
const { getOrders } = require('./controllers/orders');

// const { getOhlcv } = require('./controllers/ohlcv');

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

// 取引所一覧API
router.get('/exchanges', getExchanges);

// 銘柄一覧API
router.get('/symbols', getSymbols);

// // 戦略一覧API
// router.get('/strategies', getStrategiesList);

// ヘルスチェックAPI
router.get('/health', (req, res) => {
  res.json({ status: 'ok', database: 'redis' });
});

module.exports = router;