const { db } = require('../../database');

/**
 * 取引履歴を取得するコントローラー
 * 
 * クエリパラメータ:
 * - exchangeId: 取引所ID (オプション)
 * - symbol: 通貨ペア (オプション)
 * - strategyKey: 戦略キー (オプション)
 * - startDate: 開始日時 (オプション、ミリ秒タイムスタンプ)
 * - endDate: 終了日時 (オプション、ミリ秒タイムスタンプ)
 * - limit: 取得件数 (デフォルト: 100)
 * - offset: オフセット (デフォルト: 0)
 */
function getHistory(req, res) {
  try {
    // クエリパラメータを取得
    const { 
      exchangeId, 
      symbol, 
      strategyKey, 
      startDate, 
      endDate, 
      limit = 100, 
      offset = 0 
    } = req.query;
    
    // SQL条件とパラメータを組み立てるための配列
    const conditions = [];
    const params = [];
    
    // 取引所IDフィルタリング
    if (exchangeId) {
      conditions.push('tr.exchange_id = ?');
      params.push(exchangeId);
    }
    
    // 通貨ペアフィルタリング
    if (symbol) {
      conditions.push('tr.symbol = ?');
      params.push(symbol);
    }
    
    // 戦略キーフィルタリング
    if (strategyKey) {
      conditions.push('tr.strategy_key = ?');
      params.push(strategyKey);
    }
    
    // 開始日時フィルタリング
    if (startDate) {
      conditions.push('th.timestamp >= ?');
      params.push(parseInt(startDate, 10));
    }
    
    // 終了日時フィルタリング
    if (endDate) {
      conditions.push('th.timestamp <= ?');
      params.push(parseInt(endDate, 10));
    }
    
    // WHERE句を構築
    const whereClause = conditions.length > 0 
      ? `WHERE ${conditions.join(' AND ')}` 
      : '';
    
    // 合計数を取得するクエリ
    const countQuery = `
      SELECT COUNT(*) as total
      FROM trade_history th
      JOIN trade_records tr ON th.record_id = tr.id
      ${whereClause}
    `;
    
    // 取引履歴を取得するクエリ
    const historyQuery = `
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
      ${whereClause}
      ORDER BY th.timestamp DESC
      LIMIT ? OFFSET ?
    `;
    
    // 合計数の取得
    const totalCount = db.prepare(countQuery).get(...params)?.total || 0;
    
    // ページネーションパラメータの追加
    const limitInt = parseInt(limit, 10);
    const offsetInt = parseInt(offset, 10);
    params.push(limitInt, offsetInt);
    
    // 取引履歴の取得
    const history = db.prepare(historyQuery).all(...params);
    
    // 結果をJSON形式で返す
    res.json({
      history,
      total: totalCount,
      limit: limitInt,
      offset: offsetInt
    });
  } catch (error) {
    console.error('取引履歴取得エラー:', error);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
}

module.exports = {
  getHistory
};