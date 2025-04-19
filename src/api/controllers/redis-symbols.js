/**
 * 銘柄一覧コントローラー
 */
const { getSymbols } = require('../../redisDatabase');

/**
 * 銘柄一覧を取得するAPI
 */
async function getSymbolsList(req, res) {
  try {
    const { exchange } = req.query;

    // 取引所が指定されていない場合はエラー
    if (!exchange) {
      return res.status(400).json({ error: '取引所を指定してください' });
    }

    // 銘柄一覧を取得
    const symbols = await getSymbols(exchange);
    
    // 応答を返す
    res.json(symbols);
  } catch (error) {
    console.error('銘柄一覧API処理中にエラーが発生しました:', error);
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  getSymbolsList
};