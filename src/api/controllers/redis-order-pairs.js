/**
 * Redis版の注文ペアを取得するコントローラー
 */
const { getOrderPairs } = require('../../redisDatabase');
const { client } = require('../../database/redisClient');

/**
 * 注文ペアを取得するコントローラー
 *
 * クエリパラメータ:
 * - exchangeId: 取引所ID (オプション)
 * - symbol: 通貨ペア (オプション)
 * - strategyKey: 戦略キー (オプション)
 * - limit: 取得件数 (デフォルト: 100)
 */
async function getOrderPairsController(req, res) {
  try {
    // クエリパラメータを取得
    const {
      exchangeId,
      symbol,
      strategyKey,
      limit = 100
    } = req.query;
    
    // デバッグログ: 注文ペアAPIが呼び出されたことを記録
    console.log('注文ペアAPI呼び出し:', {
      exchangeId,
      symbol,
      strategyKey,
      limit
    });
    
    // 特定の取引所、通貨ペア、戦略が指定されている場合
    if (exchangeId && symbol && strategyKey) {
      // 特定の注文ペアを取得
      const orderPairs = await getOrderPairs(exchangeId, symbol, strategyKey);
      
      // 結果をJSON形式で返す
      return res.json({
        orderPairs,
        exchangeId,
        symbol,
        strategyKey,
        total: orderPairs.length
      });
    }
    
    // フィルターなしの場合、最新の注文ペアを取得
    const allPairs = [];
    const limitNum = parseInt(limit, 10);
    
    // orderPairキーのパターンを使用して全ての注文ペアキーを取得
    const keys = await client.keys('orderPair:*');
    
    // 各キーから注文ペアを取得
    for (const key of keys) {
      // キーから取引所、通貨ペア、戦略を抽出
      const parts = key.split(':');
      if (parts.length !== 4) continue;
      
      const keyExchangeId = parts[1];
      const keySymbol = parts[2];
      const keyStrategyKey = parts[3];
      
      // フィルターが指定されている場合、一致するものだけを取得
      if (exchangeId && keyExchangeId !== exchangeId) continue;
      if (symbol && keySymbol !== symbol) continue;
      if (strategyKey && keyStrategyKey !== strategyKey) continue;
      
      // 注文ペアを取得
      const pairs = await getOrderPairs(keyExchangeId, keySymbol, keyStrategyKey);
      
      // メタデータを追加
      pairs.forEach(pair => {
        allPairs.push({
          ...pair,
          exchangeId: keyExchangeId,
          symbol: keySymbol,
          strategyKey: keyStrategyKey
        });
      });
      
      // 指定された件数に達したら終了
      if (allPairs.length >= limitNum) break;
    }
    
    // 結果をJSON形式で返す
    res.json({
      orderPairs: allPairs.slice(0, limitNum),
      total: allPairs.length,
      limit: limitNum
    });
  } catch (error) {
    console.error('注文ペア取得エラー:', error);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
}

module.exports = {
  getOrderPairs: getOrderPairsController
};