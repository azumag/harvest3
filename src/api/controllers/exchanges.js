const { config } = require('../../config');

/**
 * 取引所リストを取得するAPIエンドポイント
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getExchanges(req, res) {
  try {
    // config.exchangesから取引所リストを取得
    const exchanges = Object.keys(config.exchanges);
    res.json(exchanges);
  } catch (error) {
    console.error('Error fetching exchanges:', error);
    res.status(500).json({ error: 'Failed to fetch exchanges' });
  }
}

/**
 * 取引所の銘柄リストを取得するAPIエンドポイント
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getSymbols(req, res) {
  const { exchange } = req.query;

  if (!exchange) {
    return res.status(400).json({ error: 'Exchange parameter is required' });
  }

  try {
    // configから該当する取引所のインスタンスを取得
    const exchangeConfig = config.exchanges[exchange];
    if (!exchangeConfig || !exchangeConfig.instance) {
      return res.status(404).json({ error: `Exchange '${exchange}' not found` });
    }

    const exchangeInstance = exchangeConfig.instance;

    // 取引所から銘柄リストを取得
    console.log(`Fetching markets for exchange: ${exchangeInstance.id}`); // ログ追加
    const markets = await exchangeInstance.fetchMarkets();
    console.log(`Markets fetched for ${exchangeInstance.id}:`, markets); // ログ追加

    const symbols = markets.map(market => market.symbol);
    console.log(`Symbols extracted for ${exchangeInstance.id}:`, symbols); // ログ追加

    res.json(symbols);
  } catch (error) {
    console.error(`Error fetching symbols for ${exchange}:`, error); // ログ修正
    res.status(500).json({ error: `Failed to fetch symbols for ${exchange}` }); // エラーメッセージ修正
  }
}

module.exports = {
  getExchanges,
  getSymbols,
  getTradeKeyList: (req, res) => {
    res.json([]);
  } // routes.jsで参照されているため実装
};