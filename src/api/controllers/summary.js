/**
 *取引の集計サマリーを取得するコントローラー
 */
const { getAllTradeSummaries } = require('../../database/manager');

/**
 * 取引の集計サマリーを取得するコントローラー
 * 
 */
async function getTradeSummary(req, res) {
  try {
    // サマリー情報を取得
    const summaryData = await getAllTradeSummaries();

    // console.log({summaryData})
    
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