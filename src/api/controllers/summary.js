const { db } = require('../../database');

/**
 * 取引の集計サマリーを取得するコントローラー
 * 
 * クエリパラメータ:
 * - period: 期間 (daily, weekly, monthly, yearly, all) (デフォルト: all)
 */
function getSummary(req, res) {
  try {
    // 期間パラメータを取得
    const { period = 'all' } = req.query;
    
    // 現在の時刻（ミリ秒）
    const now = Date.now();
    
    // 期間に応じた開始時間を計算
    let startTime = 0;
    if (period === 'daily') {
      startTime = now - 24 * 60 * 60 * 1000; // 24時間前
    } else if (period === 'weekly') {
      startTime = now - 7 * 24 * 60 * 60 * 1000; // 7日前
    } else if (period === 'monthly') {
      startTime = now - 30 * 24 * 60 * 60 * 1000; // 30日前
    } else if (period === 'yearly') {
      startTime = now - 365 * 24 * 60 * 60 * 1000; // 365日前
    }
    
    // 集計データを取得するクエリ（全体サマリー）
    const summaryQuery = `
      SELECT
        SUM(CASE WHEN th.side = 'buy' THEN th.amount ELSE 0 END) as totalBuyAmount,
        SUM(CASE WHEN th.side = 'sell' THEN th.amount ELSE 0 END) as totalSellAmount,
        SUM(CASE WHEN th.side = 'buy' THEN th.value ELSE 0 END) as totalBuyCost,
        SUM(CASE WHEN th.side = 'sell' THEN th.value ELSE 0 END) as totalSellValue
      FROM trade_history th
      WHERE th.timestamp >= ?
    `;
    
    // 取引所別集計を取得するクエリ
    const byExchangeQuery = `
      SELECT
        tr.exchange_id as exchangeId,
        SUM(CASE WHEN th.side = 'buy' THEN th.amount ELSE 0 END) as totalBuyAmount,
        SUM(CASE WHEN th.side = 'sell' THEN th.amount ELSE 0 END) as totalSellAmount,
        SUM(CASE WHEN th.side = 'buy' THEN th.value ELSE 0 END) as totalBuyCost,
        SUM(CASE WHEN th.side = 'sell' THEN th.value ELSE 0 END) as totalSellValue
      FROM trade_history th
      JOIN trade_records tr ON th.record_id = tr.id
      WHERE th.timestamp >= ?
      GROUP BY tr.exchange_id
    `;
    
    // 戦略別集計を取得するクエリ
    const byStrategyQuery = `
      SELECT
        tr.strategy_key as strategyKey,
        SUM(CASE WHEN th.side = 'buy' THEN th.amount ELSE 0 END) as totalBuyAmount,
        SUM(CASE WHEN th.side = 'sell' THEN th.amount ELSE 0 END) as totalSellAmount,
        SUM(CASE WHEN th.side = 'buy' THEN th.value ELSE 0 END) as totalBuyCost,
        SUM(CASE WHEN th.side = 'sell' THEN th.value ELSE 0 END) as totalSellValue
      FROM trade_history th
      JOIN trade_records tr ON th.record_id = tr.id
      WHERE th.timestamp >= ?
      GROUP BY tr.strategy_key
    `;
    
    // 現在のポジション情報を取得するクエリ
    const positionsQuery = `
      SELECT
        SUM(net_position) as currentPositions,
        SUM(buy_amount) as currentBuyAmount,
        SUM(sell_amount) as currentSellAmount,
        SUM(total_buy_cost) as currentBuyCost,
        SUM(total_sell_value) as currentSellValue
      FROM trade_records
    `;
    
    // クエリ実行
    const summary = db.prepare(summaryQuery).get(startTime);
    const byExchange = db.prepare(byExchangeQuery).all(startTime);
    const byStrategy = db.prepare(byStrategyQuery).all(startTime);
    const positions = db.prepare(positionsQuery).get();
    
    // 実現済み損益を計算
    const realizedPnL = summary.totalSellValue - summary.totalBuyCost;
    
    // 取引所別データを整形
    const byExchangeData = {};
    byExchange.forEach(item => {
      byExchangeData[item.exchangeId] = {
        totalBuyAmount: item.totalBuyAmount,
        totalSellAmount: item.totalSellAmount,
        totalBuyCost: item.totalBuyCost,
        totalSellValue: item.totalSellValue,
        realizedPnL: item.totalSellValue - item.totalBuyCost
      };
    });
    
    // 戦略別データを整形
    const byStrategyData = {};
    byStrategy.forEach(item => {
      byStrategyData[item.strategyKey] = {
        totalBuyAmount: item.totalBuyAmount,
        totalSellAmount: item.totalSellAmount,
        totalBuyCost: item.totalBuyCost,
        totalSellValue: item.totalSellValue,
        realizedPnL: item.totalSellValue - item.totalBuyCost
      };
    });
    
    // 結果をJSON形式で返す
    res.json({
      period,
      summary: {
        totalBuyAmount: summary.totalBuyAmount || 0,
        totalSellAmount: summary.totalSellAmount || 0,
        totalBuyCost: summary.totalBuyCost || 0,
        totalSellValue: summary.totalSellValue || 0,
        realizedPnL: realizedPnL || 0,
        currentPositions: positions.currentPositions || 0,
        currentPositionValue: positions.currentBuyCost - positions.currentSellValue || 0
      },
      byExchange: byExchangeData,
      byStrategy: byStrategyData
    });
  } catch (error) {
    console.error('サマリー情報取得エラー:', error);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
}

module.exports = {
  getSummary
};