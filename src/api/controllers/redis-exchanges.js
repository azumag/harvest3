/**
 * 取引所一覧コントローラー
 */
const { getExchanges } = require('../../redisDatabase');

/**
 * 取引所一覧を取得するAPI
 */
async function getExchangesList(req, res) {
  try {
    // 取引所一覧を取得
    const exchanges = await getExchanges();
    
    // 応答を返す
    res.json(exchanges);
  } catch (error) {
    console.error('取引所一覧API処理中にエラーが発生しました:', error);
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  getExchangesList
};