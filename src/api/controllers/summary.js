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

    // 緊急対応：calculateAvailableAmountsを一時的に無効化
    // const availableAmounts = await calculateAvailableAmounts(summaryData);

    // サマリーデータがオブジェクトか配列かを判定
    let enhancedSummaryData;
    if (Array.isArray(summaryData)) {
      // 配列の場合はオブジェクトでラップ
      enhancedSummaryData = {
        positions: summaryData
        // availableAmounts  // 一時的にコメントアウト
      };
    } else {
      // オブジェクトの場合はそのまま返す
      enhancedSummaryData = {
        ...summaryData
        // availableAmounts  // 一時的にコメントアウト
      };
    }

    // 結果をJSON形式で返す
    res.json(enhancedSummaryData);
  } catch (error) {
    console.error('サマリー情報取得エラー:', error);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
}


module.exports = {
  getTradeSummary
};