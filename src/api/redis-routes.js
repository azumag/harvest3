/**
 * Redis版のAPIルート定義
 */
const express = require('express');
const router = express.Router();

// Redis版のコントローラーをインポート
const { getHistory } = require('./controllers/redis-history');
const { getFilledHistory } = require('./controllers/redis-filled-history');
const { getPositions } = require('./controllers/redis-positions');
const { getSummary } = require('./controllers/redis-summary');
const { getOrderPairs } = require('./controllers/redis-order-pairs');
const { eventsHandler } = require('./controllers/redis-events');

// Redis版のデータベースイベントモジュールをインポート
const { addEventListner } = require('./redis-database-events');
const { sendEventToAll } = require('./controllers/redis-events');

// イベントリスナーを登録
addEventListner((event) => {
  sendEventToAll(event);
});

// 取引履歴API
router.get('/history', getHistory);

// 約定履歴API
router.get('/filled-history', getFilledHistory);

// ポジション情報API
router.get('/positions', getPositions);

// サマリー情報API
router.get('/summary', getSummary);

// イベントストリームAPI
router.get('/events', eventsHandler);

// 注文ペアAPI
router.get('/order-pairs', getOrderPairs);

// ヘルスチェックAPI
router.get('/health', (req, res) => {
  res.json({ status: 'ok', database: 'redis' });
});

module.exports = router;