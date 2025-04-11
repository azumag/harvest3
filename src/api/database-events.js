const { db } = require('../database');

// データ変更イベントリスナー
const eventListeners = [];

/**
 * イベントリスナー登録関数
 * @param {Function} callback - イベント発生時に呼び出されるコールバック関数
 */
function addEventListner(callback) {
  eventListeners.push(callback);
}

/**
 * 取引追加イベントを発火する関数
 * @param {Object} tradeData - 追加された取引データ
 */
function notifyTradeAdded(tradeData) {
  const event = {
    type: 'trade_added',
    data: tradeData
  };
  
  eventListeners.forEach(callback => {
    try {
      callback(event);
    } catch (error) {
      console.error('イベントリスナー呼び出しエラー:', error);
    }
  });
}

// SQLiteトリガーを使用してデータベース変更を監視する関数（将来的な拡張用）
function setupDatabaseTriggers() {
  // 現時点では実装しない
  // 将来的にはSQLiteのトリガーを使ってtrade_historyの更新を監視可能
}

// データベース監視定期チェック（代替手段）
let lastCheckedId = 0;
const checkInterval = 5000; // 5秒ごとにチェック

function startPeriodicCheck() {
  // 最新の取引IDを取得
  try {
    const result = db.prepare('SELECT MAX(id) as maxId FROM trade_history').get();
    if (result && result.maxId) {
      lastCheckedId = result.maxId;
      console.log(`初期lastCheckedId: ${lastCheckedId}`);
    }
  } catch (error) {
    console.error('初期取引ID取得エラー:', error);
  }
  
  // 定期的に新しい取引をチェック
  setInterval(() => {
    try {
      const query = `
        SELECT 
          th.id,
          th.timestamp,
          tr.exchange_id as exchangeId,
          tr.symbol,
          tr.strategy_key as strategyKey,
          th.side,
          th.amount,
          th.price,
          th.value
        FROM trade_history th
        JOIN trade_records tr ON th.record_id = tr.id
        WHERE th.id > ?
        ORDER BY th.id ASC
      `;
      
      const newTrades = db.prepare(query).all(lastCheckedId);
      
      if (newTrades.length > 0) {
        // 新しい取引があれば通知
        newTrades.forEach(trade => {
          notifyTradeAdded(trade);
          lastCheckedId = Math.max(lastCheckedId, trade.id);
        });
        console.log(`${newTrades.length}件の新規取引を検出`);
      }
    } catch (error) {
      console.error('取引チェック中にエラー:', error);
    }
  }, checkInterval);
}

// 監視を開始
startPeriodicCheck();

module.exports = {
  addEventListner,
  notifyTradeAdded
};