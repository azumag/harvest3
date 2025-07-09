const { listOrders } = require('../../database/manager');

/**
 * 注文履歴をリスト取得するAPIエンドポイント
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getOrders(req, res) {
  try {
    // クエリパラメータからフィルタ条件を取得
    const { exchange, symbol, side, startDate, endDate } = req.query;

    const filter = {};
    if (exchange) {
      filter.exchange = exchange;
    }
    if (symbol) {
      filter.symbol = symbol;
    }
    if (side) {
      filter.side = side;
    }
    if (startDate || endDate) {
      filter.timestamp = {};
      if (startDate) {
        filter.timestamp.$gte = new Date(startDate).getTime();
      }
      if (endDate) {
        filter.timestamp.$lte = new Date(endDate).getTime();
      }
    }

    // listOrders関数を呼び出し
    const orders = await listOrders(filter);

    res.json(orders);
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
}

module.exports = {
  getOrders
};