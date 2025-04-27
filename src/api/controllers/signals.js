const { listSignals } = require('../../database/manager');

const getSignals = async (req, res) => {
    try {
        const { exchange, symbol, side, startDate, endDate } = req.query;
        
        const filter = {};
        if (exchange) filter.exchange = exchange;
        if (symbol) filter.symbol = symbol;
        if (side) filter.side = side;

        // 日付フィルタの追加
        if (startDate || endDate) {
            filter.timestamp = {};
            if (startDate) {
                // startDateをミリ秒のタイムスタンプに変換し、$gteを使用
                filter.timestamp.$gte = new Date(startDate).getTime();
            }
            if (endDate) {
                // endDateをミリ秒のタイムスタンプに変換し、$lteを使用
                // endDateの終わり（23:59:59.999）を含めるために1日加算してgetTime()を使用
                const end = new Date(endDate);
                end.setDate(end.getDate() + 1);
                filter.timestamp.$lte = end.getTime() - 1;
            }
        }

        const signals = await listSignals(filter);
        res.json(signals);
    } catch (error) {
        console.error('Error fetching signals:', error);
        res.status(500).json({ error: 'Failed to fetch signals' });
    }
};

module.exports = {
    getSignals,
};