// 取引記録を管理するモジュール
const { addTrade, getTradeRecordsAsObject } = require('./database');

// インメモリキャッシュ（パフォーマンス向上のため）
let tradeRecordsCache = getTradeRecordsAsObject();

/**
 * 取引記録を更新する関数
 * @param {String} exchangeId - 取引所ID
 * @param {String} symbol - 通貨ペア
 * @param {Number} amount - 取引量
 * @param {Number} price - 取引価格
 * @param {String} side - 取引方向（'buy'または'sell'）
 * @param {String} strategyKey - 使用した戦略のキー（オプション）
 */
function updateTradeRecord(exchangeId, symbol, amount, price, side, strategyKey = 'unknown') {
  // 値を計算
  const value = amount * price;
  
  // データベースに追加
  addTrade(exchangeId, symbol, strategyKey, side, amount, price, value);
  
  // キャッシュを更新
  tradeRecordsCache = getTradeRecordsAsObject();
  
  // 現在の記録を取得（既存のログ出力を維持）
  const record = tradeRecordsCache[exchangeId]?.[symbol]?.[strategyKey] || { 
    buyAmount: 0, 
    sellAmount: 0, 
    netPosition: 0 
  };
  
  console.log(`取引記録更新: ${exchangeId} - ${symbol} - ${strategyKey} - ${side} - 数量: ${amount}, 価格: ${price}`);
  console.log(`現在の記録: 買い量: ${record.buyAmount}, 売り量: ${record.sellAmount}, 実際の保有量: ${record.netPosition}`);
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

module.exports = {
  tradeRecords,
  updateTradeRecord
};