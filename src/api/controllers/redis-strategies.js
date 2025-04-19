/**
 * 戦略一覧コントローラー
 */
const { getStrategies } = require('../../redisDatabase');

/**
 * 戦略一覧を取得するAPI
 */
async function getStrategiesList(req, res) {
  try {
    // 戦略一覧を取得
    const strategies = await getStrategies();
    
    // 応答を返す
    res.json(strategies);
  } catch (error) {
    console.error('戦略一覧API処理中にエラーが発生しました:', error);
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  getStrategiesList
};