/**
 * 戦略シグナル履歴コントローラー
 */
const { getStrategySignalHistory } = require('../../redisDatabase');

/**
 * 戦略シグナル履歴を取得するAPI
 */
async function getStrategySignals(req, res) {
  try {
    const { 
      exchange, 
      symbol, 
      strategy, 
      start_time, 
      end_time, 
      signal_type,
      limit = 100, 
      offset = 0 
    } = req.query;
    
    // フィルターの作成
    const filters = {};
    if (exchange) filters.exchangeId = exchange;
    if (symbol) filters.symbol = symbol;
    if (strategy) filters.strategyKey = strategy;
    if (signal_type) filters.signalType = signal_type;
    
    // 時間範囲の設定
    if (start_time) {
      // Unix時間（ミリ秒）かISO文字列かを自動判別
      filters.startDate = !isNaN(start_time) ? 
        parseInt(start_time) : 
        new Date(start_time).getTime();
    }
    
    if (end_time) {
      // Unix時間（ミリ秒）かISO文字列かを自動判別
      filters.endDate = !isNaN(end_time) ? 
        parseInt(end_time) : 
        new Date(end_time).getTime();
    }
    
    // 戦略シグナル履歴を取得
    const result = await getStrategySignalHistory(
      filters, 
      parseInt(limit), 
      parseInt(offset)
    );
    
    // 応答を返す
    res.json(result);
  } catch (error) {
    console.error('戦略シグナル履歴API処理中にエラーが発生しました:', error);
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  getStrategySignals
};