const express = require('express');
const router = express.Router();
const { client } = require('../database/redisClient'); // Redisクライアント
const { config } = require('../config');

/**
 * ローソク足データを取得するAPI
 *
 * @param {string} exchange 取引所ID
 * @param {string} symbol 通貨ペア
 * @param {string} interval 時間足 (例: '1m', '5m', '1h', '1d')
 * @param {number} limit データ数 (最大値: 取引所の制限に依存)
 * @param {number} startTime 開始時刻 (Unix timestamp, ミリ秒)
 * @param {number} endTime 終了時刻 (Unix timestamp, ミリ秒)
 */
router.get('/', async (req, res) => {
  try {
    const { exchange, symbol, interval, limit = 100, startTime, endTime } = req.query;

    if (!exchange || !symbol || !interval) {
      return res.status(400).json({ error: 'exchange, symbol, and interval are required' });
    }

    const exchangeConfig = config.exchanges[exchange];
    if (!exchangeConfig) {
      return res.status(400).json({ error: `Exchange "${exchange}" not found in config` });
    }

    const exchangeInstance = require(exchangeConfig.module); // 取引所インスタンスを動的にrequire
    if (!exchangeInstance) {
      return res.status(500).json({ error: `Failed to load exchange module for "${exchange}"` });
    }

    // startTime と endTime が指定されていればミリ秒単位の数値に変換
    const startTimeMs = startTime ? parseInt(startTime, 10) : undefined;
    const endTimeMs = endTime ? parseInt(endTime, 10) : undefined;

    // OHLCVデータを取得
    const ohlcv = await exchangeInstance.fetchOHLCV(symbol, interval, startTimeMs, endTimeMs, parseInt(limit, 10));

    // 取得したOHLCVデータをJSONで返す
    res.json(ohlcv);
  } catch (error) {
    console.error('ローソク足データAPI処理中にエラーが発生しました:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;