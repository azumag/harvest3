// 取引記録を保存するオブジェクト
const tradeRecords = {
  // 取引所ごとの記録
  // 例: { 'bitbank': { 'BTC/JPY': { amount: 0.1, totalCost: 500000 } } }
};

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
  // 取引所の記録がなければ初期化
  if (!tradeRecords[exchangeId]) {
    tradeRecords[exchangeId] = {};
  }
  
  // 通貨ペアの記録がなければ初期化
  if (!tradeRecords[exchangeId][symbol]) {
    tradeRecords[exchangeId][symbol] = {};
  }
  
  // 戦略の記録がなければ初期化
  if (!tradeRecords[exchangeId][symbol][strategyKey]) {
    tradeRecords[exchangeId][symbol][strategyKey] = {
      buyAmount: 0,
      sellAmount: 0,
      totalBuyCost: 0,
      totalSellValue: 0,
      netPosition: 0, // 実際の保有量を表す新しいフィールド
      trades: [] // 取引履歴を保存する配列
    };
  }
  
  const record = tradeRecords[exchangeId][symbol][strategyKey];
  
  // 取引情報を記録
  const tradeInfo = {
    timestamp: Date.now(),
    side,
    amount,
    price,
    value: amount * price
  };
  
  record.trades.push(tradeInfo);
  
  // 最大100件の取引履歴を保持
  if (record.trades.length > 100) {
    record.trades.shift();
  }
  
  // 買いの場合
  if (side === 'buy') {
    record.buyAmount += amount;
    record.totalBuyCost += amount * price;
    record.netPosition += amount; // 保有量を増やす
  }
  // 売りの場合
  else if (side === 'sell') {
    record.sellAmount += amount;
    record.totalSellValue += amount * price;
    
    // 買った量から売った量を減らす（0未満にならないように）
    const deductAmount = Math.min(record.buyAmount, amount);
    record.buyAmount -= deductAmount;
    record.netPosition -= amount; // 保有量を減らす
  }
  
  console.log(`取引記録更新: ${exchangeId} - ${symbol} - ${strategyKey} - ${side} - 数量: ${amount}, 価格: ${price}`);
  console.log(`現在の記録: 買い量: ${record.buyAmount}, 売り量: ${record.sellAmount}, 実際の保有量: ${record.netPosition}`);
}

module.exports = {
  tradeRecords,
  updateTradeRecord
};