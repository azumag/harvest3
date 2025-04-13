/**
 * Redis版の約定履歴を取得するコントローラー
 */
const { getFilledHistory } = require('../../redisDatabase');

/**
 * 約定履歴を取得するコントローラー
 * 
 * クエリパラメータ:
 * - exchangeId: 取引所ID (オプション)
 * - symbol: 通貨ペア (オプション)
 * - strategyKey: 戦略キー (オプション)
 * - startDate: 開始日時 (オプション、ミリ秒タイムスタンプ)
 * - endDate: 終了日時 (オプション、ミリ秒タイムスタンプ)
 * - limit: 取得件数 (デフォルト: 100)
 * - offset: オフセット (デフォルト: 0)
 */
async function getFilledHistoryController(req, res) {
  try {
    // クエリパラメータを取得
    const {
      exchangeId,
      symbol,
      strategyKey,
      startDate,
      endDate,
      limit = 100,
      offset = 0
    } = req.query;
    
    // フィルター条件を構築
    const filters = {};
    
    if (exchangeId) filters.exchangeId = exchangeId;
    if (symbol) filters.symbol = symbol;
    if (strategyKey) filters.strategyKey = strategyKey;
    if (startDate) filters.startDate = parseInt(startDate, 10);
    if (endDate) filters.endDate = parseInt(endDate, 10);
    
    // デバッグログ: 約定履歴APIが呼び出されたことを記録
    console.log('約定履歴API呼び出し:', {
      filters,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10)
    });
    
    // 約定履歴を取得
    const { history, total } = await getFilledHistory(
      filters,
      parseInt(limit, 10),
      parseInt(offset, 10)
    );
    
    // データベース層からのデータを必ずソートする
    if (history && history.length > 0) {
      // タイムスタンプを数値に変換
      history.forEach(item => {
        if (typeof item.timestamp === 'string') {
          item.timestamp = parseInt(item.timestamp, 10);
        }
        // 念のため、数値であることを確認
        item.timestamp = Number(item.timestamp);
      });
      
      // 詳細なデバッグログ
      console.log('ソート前の約定履歴データ:');
      history.slice(0, 5).forEach((item, index) => {
        console.log(`${index}: ${item.timestamp} (${typeof item.timestamp}), ${item.exchangeId}, ${item.symbol}`);
      });
      
      // 降順にソート（新しい順）
      history.sort((a, b) => b.timestamp - a.timestamp);
      
      // ソート後のデバッグログ
      console.log('ソート後の約定履歴データ:');
      history.slice(0, 5).forEach((item, index) => {
        console.log(`${index}: ${item.timestamp} (${typeof item.timestamp}), ${item.exchangeId}, ${item.symbol}`);
      });
      
      console.log(`取得データ数: ${history.length}`);
    } else {
      console.log('取得データなし');
    }
    
    // 結果をJSON形式で返す
    res.json({
      history,
      total,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10)
    });
  } catch (error) {
    console.error('約定履歴取得エラー:', error);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
}

module.exports = {
  getFilledHistory: getFilledHistoryController
};