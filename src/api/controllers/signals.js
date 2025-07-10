const { listSignals, countSignals } = require('../../database/manager'); // countSignals をインポートに追加

const getSignals = async (req, res) => {
  try {
    const { exchange, symbol, strategy, side, startDate, endDate, start, length } = req.query; // ページングパラメータを追加

    // ページングパラメータを数値に変換
    const skip = parseInt(start) || 0;
    const limit = parseInt(length) || 0;

    const filter = {};
    if (exchange) {
      filter.exchange = exchange;
    }
    if (symbol) {
      filter.symbol = symbol;
    }
    if (strategy) {
      filter.strategy = strategy;
    }
    if (side) {
      filter.side = side;
    }

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
    // フィルタリングされたシグナルデータを取得 (ページング適用)
    const signals = await listSignals(filter, skip, limit, { timestamp: -1 }); // skip, limit, sort を追加

    // フィルタリング条件に一致するシグナルデータの総件数を取得
    const totalFiltered = await countSignals(filter);

    // DataTablesが期待する形式でレスポンスを返す
    res.json({
      data: signals,
      recordsTotal: totalFiltered, // フィルタリングなしの総件数 (今回はフィルタリング後と同じとする)
      recordsFiltered: totalFiltered // フィルタリング後の総件数
    });

  } catch (error) {
    console.error('Error fetching signals:', error);
    res.status(500).json({ error: 'Failed to fetch signals' });
  }
};

module.exports = {
  getSignals
};