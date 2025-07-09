const { listTrades } = require('../../database/manager');

const getTrades = async (req, res) => {
  try {
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

    // 日付フィルタの追加
    if (startDate || endDate) {
      filter.timestamp = {};
      if (startDate) {
        // startDateはすでにタイムスタンプなので直接使用（文字列の場合は数値に変換）
        filter.timestamp.$gte = Number(startDate);
      }
      if (endDate) {
        // endDateはすでにタイムスタンプなので直接使用（文字列の場合は数値に変換）
        // 日の終わり（23:59:59.999）を含めるには86400000ミリ秒（1日分）を加算して1ミリ秒引く
        filter.timestamp.$lte = Number(endDate) + 86400000 - 1;
      }
    }

    const trades = await listTrades(filter);
    res.json(trades);
  } catch (error) {
    console.error('Error fetching trades:', error);
    res.status(500).json({ error: 'Failed to fetch trades' });
  }
};

module.exports = {
  getTrades
};