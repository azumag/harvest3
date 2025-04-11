const express = require('express');
const router = express.Router();

// コントローラーをインポート（これから作成）
const positionsController = require('./controllers/positions');
const historyController = require('./controllers/history');
const summaryController = require('./controllers/summary');
const eventsController = require('./controllers/events');

// ポジション情報のエンドポイント
router.get('/positions', positionsController.getPositions);

// 取引履歴のエンドポイント
router.get('/history', historyController.getHistory);

// 集計サマリーのエンドポイント
router.get('/summary', summaryController.getSummary);

// リアルタイムイベントのエンドポイント（SSE）
router.get('/events', eventsController.eventsHandler);

module.exports = router;