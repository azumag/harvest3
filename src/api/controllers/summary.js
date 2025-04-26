/**
 *取引の集計サマリーを取得するコントローラー
 */
const { getTradeSummaries } = require('../../database/manager');

/**
 * 取引の集計サマリーを取得するコントローラー
 * 
 */
async function getTradeSummary(req, res) {
  try {
    // 期間パラメータを取得
    const { exchangeId } = req.query;
    
    // サマリー情報を取得
    const summaryData = await getTradeSummaries(exchangeId);
    
    // 結果をJSON形式で返す
    res.json(summaryData);
  } catch (error) {
    console.error('サマリー情報取得エラー:', error);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
}

module.exports = {
  getTradeSummary
};