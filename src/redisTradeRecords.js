/**
 * Redis版の取引記録を管理するモジュール
 */
const { addTrade, getTradeRecordsAsObject } = require('./database/redisDatabase'); // パスを修正

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
  
  // 現在の記録を取得（ログ出力用）
  const records = await getTradeRecordsAsObject();
  const record = records[exchangeId]?.[symbol]?.[strategyKey] || { 
    buyAmount: 0, 
    sellAmount: 0, 
    netPosition: 0 
  };
  
  console.log(`取引記録更新: ${exchangeId} - ${symbol} - ${strategyKey} - ${side} - 数量: ${amount}, 価格: ${price}`);
  console.log(`現在の記録: 買い量: ${record.buyAmount}, 売り量: ${record.sellAmount}, 実際の保有量: ${record.netPosition}`);
  
  return true;
}

// tradeRecordsをゲッター関数として実装し、常に最新のデータを提供
const tradeRecords = new Proxy({}, {
  get: async (target, prop) => {
    const records = await getTradeRecordsAsObject();
    return records[prop];
  },
  ownKeys: async () => {
    const records = await getTradeRecordsAsObject();
    return Reflect.ownKeys(records);
  },
  getOwnPropertyDescriptor: async (target, prop) => {
    const records = await getTradeRecordsAsObject();
    return {
      configurable: true,
      enumerable: true,
      value: records[prop]
    };
  }
});

// 現在のデータを取得する関数
async function getLatestRecords() {
  return await getTradeRecordsAsObject();
}

module.exports = {
  tradeRecords,
  updateTradeRecord,
  getLatestRecords
};