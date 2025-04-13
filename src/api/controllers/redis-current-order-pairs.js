/**
 * Redis版の現在の注文ペアを取得するコントローラー
 */
const { getCurrentOrderPair } = require('../../redisDatabase');
const { client } = require('../../redisClient');

/**
 * 現在の注文ペアを取得するコントローラー
 */
async function getCurrentOrderPairsController(req, res) {
  try {
    // 結果を格納する配列
    const allPairs = [];
    
    // currentOrderPairキーのパターンを使用して全てのキーを取得
    const keys = await client.keys('currentOrderPair:*');
    
    // 各キーから注文ペアを取得
    for (const key of keys) {
      // キーから取引所、通貨ペア、戦略を抽出
      const parts = key.split(':');
      if (parts.length !== 4) continue;
      
      const exchangeId = parts[1];
      const symbol = parts[2];
      const strategyKey = parts[3];
      
      // 注文ペアを取得
      const pair = await getCurrentOrderPair(exchangeId, symbol, strategyKey);
      
      // データがある場合のみ追加
      if (pair && Object.keys(pair).length > 0) {
        allPairs.push({
          exchangeId,
          symbol,
          strategyKey,
          pair
        });
      }
    }
    
    // 結果をJSON形式で返す
    res.json({
      currentOrderPairs: allPairs,
      total: allPairs.length
    });
  } catch (error) {
    console.error('現在の注文ペア取得エラー:', error);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
}

module.exports = {
  getCurrentOrderPairs: getCurrentOrderPairsController
};