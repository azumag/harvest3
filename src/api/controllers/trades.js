const { listTrades } = require('../../database/manager');

const getTrades = async (req, res) => {
    try {
        const { exchange, symbol, side, startDate, endDate } = req.query;
        const trades = await listTrades({ exchange, symbol, side, startDate, endDate });
        res.json(trades);
    } catch (error) {
        console.error('Error fetching trades:', error);
        res.status(500).json({ error: 'Failed to fetch trades' });
    }
};

module.exports = {
    getTrades,
};