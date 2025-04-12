/**
 * Redis版の取引履歴を取得するコントローラー
 */
const { getOrderHistory } = require('../../redisDatabase');

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
async function getHistory(req, res) {
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
    
    // フィルター条件を構築
    const filters = {};
    
    if (exchangeId) filters.exchangeId = exchangeId;
    if (symbol) filters.symbol = symbol;
    if (strategyKey) filters.strategyKey = strategyKey;
    if (startDate) filters.startDate = parseInt(startDate, 10);
    if (endDate) filters.endDate = parseInt(endDate, 10);
    
    // デバッグログ: 取引履歴APIが呼び出されたことを記録
    console.log('取引履歴API呼び出し:', {
      filters,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10)
    });
    
    // 取引履歴を取得
    const { history, total } = await getOrderHistory(
      filters,
      parseInt(limit, 10),
      parseInt(offset, 10)
    );
    
    // デバッグログ: 取得されたデータの最初の項目を表示
    if (history && history.length > 0) {
      console.log('取引履歴の最初のアイテム:', history[0]);
    }
    
    // 結果をJSON形式で返す
    res.json({
      history,
      total,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10)
    });
  } catch (error) {
    console.error('取引履歴取得エラー:', error);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
}

module.exports = {
  getHistory
};