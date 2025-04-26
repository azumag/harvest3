/**
 * 取引所一覧コントローラー
 */
const { getTradeKeys } = require('../../database/manager');
const { get } = require('../routes');

/**
 */
async function getTradeKeyList(req, res) {
  try {
    const tradeKeys = await getTradeKeys();
    
    // 応答を返す
    res.json(tradeKeys);
  } catch (error) {
    console.error('keys一覧API処理中にエラーが発生しました:', error);
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  getTradeKeyList
};