/**
 * Redis版の現在のポジション情報を取得するコントローラー
 */
const { getTradeRecordsAsObject } = require('../../redisDatabase');

/**
 * 現在のポジション情報を取得するコントローラー
 * 
 * クエリパラメータ:
 * - exchangeId: 取引所ID (オプション)
 * - symbol: 通貨ペア (オプション)
 * - strategyKey: 戦略キー (オプション)
 */
async function getPositions(req, res) {
  try {
    // データベースから全ての取引記録を取得
    const allRecords = await getTradeRecordsAsObject();
    
    // クエリパラメータを取得
    const { exchangeId, symbol, strategyKey } = req.query;
    
    // 応答用のポジションリストを格納する配列
    const positions = [];
    
    // 取引記録から現在のポジション情報を抽出
    Object.keys(allRecords).forEach(exId => {
      // exchangeIdフィルタリング
      if (exchangeId && exId !== exchangeId) return;
      
      Object.keys(allRecords[exId]).forEach(sym => {
        // symbolフィルタリング
        if (symbol && sym !== symbol) return;
        
        Object.keys(allRecords[exId][sym]).forEach(strat => {
          // strategyKeyフィルタリング
          if (strategyKey && strat !== strategyKey) return;
          
          const record = allRecords[exId][sym][strat];
          
          // recordが存在することを確認
          if (!record) {
            console.warn(`レコードが見つかりません: ${exId}/${sym}/${strat}`);
            return;
          }
          
          // 平均購入価格と平均販売価格を計算
          const averageBuyPrice = record.buyAmount > 0
            ? record.totalBuyCost / record.buyAmount
            : 0;
          
          const averageSellPrice = record.sellAmount > 0
            ? record.totalSellValue / record.sellAmount
            : 0;
          
          // 実現済みの損益を計算
          const realizedPnL = record.totalSellValue - (record.sellAmount / record.buyAmount * record.totalBuyCost);
          
          // ポジション情報をリストに追加
          positions.push({
            exchangeId: exId,
            symbol: sym,
            strategyKey: strat,
            buyAmount: record.buyAmount || 0,
            sellAmount: record.sellAmount || 0,
            netPosition: record.netPosition || 0,
            averageBuyPrice,
            averageSellPrice,
            totalBuyCost: record.totalBuyCost || 0,
            totalSellValue: record.totalSellValue || 0,
            realizedPnL: isNaN(realizedPnL) ? 0 : realizedPnL,
            // 最新の数件の取引を含める（tradesプロパティが存在する場合のみ）
            recentTrades: Array.isArray(record.trades) ? record.trades.slice(0, 5) : []
          });
        });
      });
    });
    
    // 結果をJSON形式で返す
    res.json({ positions });
  } catch (error) {
    console.error('ポジション情報取得エラー:', error);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
}

module.exports = {
  getPositions
};