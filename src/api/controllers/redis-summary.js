/**
 * Redis版の取引の集計サマリーを取得するコントローラー
 */
const { getTradeSummary } = require('../../redisDatabase');

/**
 * 取引の集計サマリーを取得するコントローラー
 * 
 * クエリパラメータ:
 * - period: 期間 (daily, weekly, monthly, yearly, all) (デフォルト: all)
 */
async function getSummary(req, res) {
  try {
    // 期間パラメータを取得
    const { period = 'all' } = req.query;
    
    // サマリー情報を取得
    const summaryData = await getTradeSummary(period);
    
    // 結果をJSON形式で返す
    res.json(summaryData);
  } catch (error) {
    console.error('サマリー情報取得エラー:', error);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
}

module.exports = {
  getSummary
};