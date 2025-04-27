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
  try {
    const { exchange } = req.query;
    
    if (!exchange) {
      return res.status(400).json({ error: 'Exchange parameter is required' });
    }

    // configから該当する取引所のインスタンスを取得
    const exchangeConfig = config.exchanges[exchange];
    if (!exchangeConfig || !exchangeConfig.instance) {
      return res.status(404).json({ error: `Exchange '${exchange}' not found` });
    }

    const exchangeInstance = exchangeConfig.instance;
    
    // 取引所から銘柄リストを取得
    const markets = await exchangeInstance.fetchMarkets();
    const symbols = markets.map(market => market.symbol);
    
    res.json(symbols);
  } catch (error) {
    console.error('Error fetching symbols:', error);
    res.status(500).json({ error: 'Failed to fetch symbols' });
  }
}

module.exports = {
  getExchanges,
  getSymbols,
  getTradeKeyList: (req, res) => { res.json([]); } // routes.jsで参照されているため実装
};