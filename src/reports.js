const { postResultToDiscord, postErrorToDiscord } = require('./notifications');
const { tradeRecords } = require('./tradeRecords');
const strategies = require('../strategies');

/**
 * 総JPY評価額を計算する関数（トレード履歴のみから計算）
 * @param {Object} exchange - 取引所オブジェクト
 * @returns {Number} - 総JPY評価額
 */
async function calculateTotalJPYValue(exchange) {
  // トレード履歴から損益を計算する
  const exchangeId = exchange.id;
  let totalJPYValue = 0;
  
  // JPY残高を取得
  try {
    const balance = await exchange.fetchBalance();
    totalJPYValue = balance.total['JPY'] || 0;
  } catch (error) {
    console.error('JPY残高の取得に失敗しました:', error);
    await postErrorToDiscord(`JPY残高の取得に失敗しました: ${error.message}`);
  }
  
  // トレード記録から損益を計算
  if (tradeRecords[exchangeId]) {
    for (const symbol in tradeRecords[exchangeId]) {
      for (const strategyKey in tradeRecords[exchangeId][symbol]) {
        const record = tradeRecords[exchangeId][symbol][strategyKey];
        // 実現損益のみを計算（評価額は計算しない）
        const profit = record.totalSellValue - record.totalBuyCost;
        totalJPYValue += profit;
      }
    }
  }
  
  return totalJPYValue; // トレード履歴から計算した総JPY評価額を返す
}

/**
 * 総資産レポートを投稿する関数
 * @param {Object} exchange - 取引所オブジェクト
 */
async function postReport(exchange) {
  const totalJPYValue = await calculateTotalJPYValue(exchange);
  postResultToDiscord(`=== TOTAL: ${exchange.id} ${totalJPYValue} ===`);
}

/**
 * 戦略と銘柄ごとの損益レポートを計算する関数
 * @param {Object} exchange - 取引所オブジェクト
 * @returns {String} - レポート文字列
 */
async function calculateStrategyProfitReport(exchange) {
  const exchangeId = exchange.id;
  if (!tradeRecords[exchangeId]) {
    return `${exchangeId}の取引記録がありません。`;
  }
  
  let report = `=== ${exchangeId} 戦略・銘柄別損益レポート ===\n`;
  
  // 戦略タイプごとの集計
  const strategyTypeTotals = {};
  for (const type in strategies.STRATEGY_TYPES) {
    strategyTypeTotals[strategies.STRATEGY_TYPES[type]] = 0;
  }
  
  // 各銘柄ごとに処理
  for (const symbol in tradeRecords[exchangeId]) {
    report += `\n【${symbol}】\n`;
    let symbolTotal = 0;
    
    // 各戦略ごとに処理
    for (const strategyKey in tradeRecords[exchangeId][symbol]) {
      const record = tradeRecords[exchangeId][symbol][strategyKey];
      
      // 損益計算
      const totalBuy = record.totalBuyCost;
      const totalSell = record.totalSellValue;
      const profit = totalSell - totalBuy;
      
      // 評価額の計算をスキップし、実現損益のみを使用
      let currentHoldingValue = 0;
      // 実現損益のみを総損益とする
      const totalProfit = profit;
      
      // 戦略名を取得
      let strategyName = strategyKey;
      let strategyType = 'unknown';
      if (strategies.STRATEGIES && strategies.STRATEGIES[strategyKey]) {
        strategyName = strategies.STRATEGIES[strategyKey].name;
        strategyType = strategies.STRATEGIES[strategyKey].type;
      }
      
      // 戦略タイプの合計に加算
      if (strategyType && strategyTypeTotals[strategyType] !== undefined) {
        strategyTypeTotals[strategyType] += totalProfit;
      }
      
      // レポートに追加（評価額の情報を表示しない）
      report += `  ${strategyName}: ${totalProfit.toFixed(2)} JPY`;
      if (record.netPosition > 0) {
        report += ` (保有: ${record.netPosition} ${symbol.split('/')[0]})`;
      }
      report += '\n';
      
      symbolTotal += totalProfit;
    }
    
    report += `  銘柄合計: ${symbolTotal.toFixed(2)} JPY\n`;
  }
  
  // 戦略タイプごとの合計を追加
  report += '\n【戦略タイプ別合計】\n';
  for (const type in strategyTypeTotals) {
    // 戦略タイプの日本語名を取得
    let typeName = type;
    switch (type) {
      case strategies.STRATEGY_TYPES.TREND_FOLLOWING:
        typeName = 'トレンドフォロー';
        break;
      case strategies.STRATEGY_TYPES.MEAN_REVERSION:
        typeName = '逆張り';
        break;
      case strategies.STRATEGY_TYPES.ARBITRAGE:
        typeName = 'アービトラージ';
        break;
      case strategies.STRATEGY_TYPES.HIGH_FREQUENCY:
        typeName = '高頻度取引';
        break;
    }
    report += `  ${typeName}: ${strategyTypeTotals[type].toFixed(2)} JPY\n`;
  }
  
  return report;
}

/**
 * 戦略と銘柄ごとの損益レポートを投稿する関数
 * @param {Object} exchange - 取引所オブジェクト
 */
async function postStrategyProfitReport(exchange) {
  const report = await calculateStrategyProfitReport(exchange);
  await postResultToDiscord(report);
}

module.exports = {
  calculateTotalJPYValue,
  postReport,
  calculateStrategyProfitReport,
  postStrategyProfitReport
};