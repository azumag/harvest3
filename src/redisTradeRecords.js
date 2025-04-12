/**
 * Redis版の取引記録を管理するモジュール
 * SQLiteからRedisへの移行の一部として実装
 */
const { addTrade, getTradeRecordsAsObject } = require('./redisDatabase');

// インメモリキャッシュ（パフォーマンス向上のため）
let tradeRecordsCache = {};

// 初期化時にキャッシュを読み込む
async function initializeCache() {
  try {
    tradeRecordsCache = await getTradeRecordsAsObject();
    console.log('取引記録キャッシュが初期化されました');
  } catch (error) {
    console.error('取引記録キャッシュの初期化エラー:', error);
    tradeRecordsCache = {};
  }
}

// 初期化を実行
initializeCache();

/**
 * 取引記録を更新する関数
 * @param {String} exchangeId - 取引所ID
 * @param {String} symbol - 通貨ペア
 * @param {Number} amount - 取引量
 * @param {Number} price - 取引価格
 * @param {String} side - 取引方向（'buy'または'sell'）
 * @param {String} strategyKey - 使用した戦略のキー（オプション）
 * @returns {Promise} 処理完了時に解決されるPromise
 */
async function updateTradeRecord(exchangeId, symbol, amount, price, side, strategyKey = 'unknown', orderId, orderType) {
  // 値を計算
  const value = amount * price;
  
  // データベースに追加
  await addTrade(exchangeId, symbol, strategyKey, side, amount, price, value, orderId, orderType);
  
  // キャッシュを更新
  tradeRecordsCache = await getTradeRecordsAsObject();
  
  // 現在の記録を取得（既存のログ出力を維持）
  const record = tradeRecordsCache[exchangeId]?.[symbol]?.[strategyKey] || { 
    buyAmount: 0, 
    sellAmount: 0, 
    netPosition: 0 
  };
  
  console.log(`取引記録更新: ${exchangeId} - ${symbol} - ${strategyKey} - ${side} - 数量: ${amount}, 価格: ${price}`);
  console.log(`現在の記録: 買い量: ${record.buyAmount}, 売り量: ${record.sellAmount}, 実際の保有量: ${record.netPosition}`);
  
  return true;
}

// tradeRecordsをプロキシとして実装し、常に最新のキャッシュを提供
const tradeRecords = new Proxy({}, {
  get: (target, prop) => {
    return tradeRecordsCache[prop];
  },
  ownKeys: () => {
    return Reflect.ownKeys(tradeRecordsCache);
  },
  getOwnPropertyDescriptor: (target, prop) => {
    return {
      configurable: true,
      enumerable: true,
      value: tradeRecordsCache[prop]
    };
  }
});

// キャッシュを手動で更新する関数（必要に応じて使用）
async function refreshCache() {
  tradeRecordsCache = await getTradeRecordsAsObject();
  return tradeRecordsCache;
}

module.exports = {
  tradeRecords,
  updateTradeRecord,
  refreshCache,
  initializeCache
};