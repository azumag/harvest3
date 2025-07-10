/**
 *取引の集計サマリーを取得するコントローラー
 */
const { getAllTradeSummaries } = require('../../database/manager');

/**
 * 利用可能残高を計算する
 * @param {Object} summaryData - サマリーデータ
 * @returns {Object} 利用可能残高の計算結果
 */
async function calculateAvailableAmounts(summaryData) {
  // 簡単な利用可能残高計算ロジック
  // 実際の残高データから利用可能な金額を計算
  try {
    if (!summaryData) {
      return null;
    }

    // summaryDataから利用可能残高を計算
    const availableAmounts = {};
    if (summaryData.balance) {
      Object.keys(summaryData.balance).forEach(currency => {
        // 保守的に90%を利用可能とする
        availableAmounts[currency] = summaryData.balance[currency] * 0.9;
      });
    }

    return availableAmounts;
  } catch (error) {
    console.error('利用可能残高計算エラー:', error);
    return null;
  }
}

/**
 * 取引の集計サマリーを取得するコントローラー
 *
 */
async function getTradeSummary(req, res) {
  try {
    // サマリー情報を取得
    const summaryData = await getAllTradeSummaries();

    // 利用可能残高の計算（有効化）
    let availableAmounts = null;
    try {
      availableAmounts = await calculateAvailableAmounts(summaryData);
    } catch (error) {
      console.error('利用可能残高の計算に失敗しました。基本サマリーのみ返します:', error.message);
    }

    // サマリーデータがオブジェクトか配列かを判定
    let enhancedSummaryData;
    if (Array.isArray(summaryData)) {
      // 配列の場合はオブジェクトでラップ
      enhancedSummaryData = {
        positions: summaryData,
        ...(availableAmounts && { availableAmounts })
      };
    } else {
      // オブジェクトの場合はそのまま返す
      enhancedSummaryData = {
        ...summaryData,
        ...(availableAmounts && { availableAmounts })
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