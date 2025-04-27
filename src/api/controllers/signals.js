const { listSignals } = require('../../database/manager');

const getSignals = async (req, res) => {
    try {
        const { exchange, symbol, side, startDate, endDate } = req.query;
        const signals = await listSignals({ exchange, symbol, side, startDate, endDate });
        res.json(signals);
    } catch (error) {
        console.error('Error fetching signals:', error);
        res.status(500).json({ error: 'Failed to fetch signals' });
    }
};

module.exports = {
    getSignals,
};