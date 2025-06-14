/**
 * リスク管理API コントローラー
 */
const { getAllPositionsRedis, calculatePeriodPnLRedis } = require('../../database/redisDatabase');
const { getTradeSummary } = require('../../database/manager');

/**
 * リスク管理ポジション情報を取得するAPIエンドポイント
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getRiskPositions(req, res) {
  try {
    // クエリパラメータからフィルタ条件を取得
    const { exchange, symbol, strategy } = req.query;

    // 全ての戦略ポジションを取得
    const allPositions = await getAllPositionsRedis();
    
    // フィルタ条件を適用
    let filteredPositions = allPositions;
    
    if (exchange) {
      filteredPositions = filteredPositions.filter(pos => pos.exchange === exchange);
    }
    if (symbol) {
      filteredPositions = filteredPositions.filter(pos => pos.symbol === symbol);
    }
    if (strategy) {
      filteredPositions = filteredPositions.filter(pos => pos.strategy === strategy);
    }

    // 各ポジションに追加情報を付与
    const enrichedPositions = filteredPositions.map((position) => {
      try {
        // 現在の損益を計算
        const currentPrice = position.currentPrice || position.entryPrice || 0;
        const entryPrice = position.entryPrice || 0;
        const amount = position.amount || 0;
        const unrealizedPnL = amount > 0 ? (currentPrice - entryPrice) * amount : 0;
        const unrealizedPnLPercent = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;

        // ストップロス条件のチェック（固定2%のストップロス）
        const defaultStopLossPercent = 2; // 2%のストップロス
        const stopLossTriggered = unrealizedPnLPercent <= -defaultStopLossPercent;

        // 経過時間の計算
        const elapsedTime = Date.now() - position.timestamp;
        const elapsedHours = elapsedTime / (1000 * 60 * 60);
        const defaultTimeBasedStopHours = 24; // 24時間のタイムストップ
        const timeStopTriggered = elapsedHours >= defaultTimeBasedStopHours;

        return {
          ...position,
          // 現在価格を更新
          currentPrice,
          
          // 損益計算
          unrealizedPnL,
          unrealizedPnLPercent,
          
          // リスク管理状態
          stopLossTriggered,
          timeStopTriggered,
          elapsedHours: Math.round(elapsedHours * 100) / 100,
          
          // 日時情報
          createdAt: new Date(position.timestamp).toISOString(),
          
          // ポジション状態
          status: (stopLossTriggered || timeStopTriggered) ? 'at_risk' : 'active'
        };
      } catch (error) {
        console.error(`Error enriching position ${position.positionKey}:`, error);
        return {
          ...position,
          error: 'Failed to enrich position data'
        };
      }
    });

    // 統計情報を計算
    const stats = {
      totalPositions: enrichedPositions.length,
      activePositions: enrichedPositions.filter(p => p.status === 'active').length,
      atRiskPositions: enrichedPositions.filter(p => p.status === 'at_risk').length,
      totalUnrealizedPnL: enrichedPositions.reduce((sum, p) => sum + (p.unrealizedPnL || 0), 0),
      averageHoldingTime: enrichedPositions.length > 0 ? 
        enrichedPositions.reduce((sum, p) => sum + (p.elapsedHours || 0), 0) / enrichedPositions.length : 0
    };

    res.json({
      positions: enrichedPositions,
      stats,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error fetching risk positions:', error);
    res.status(500).json({ 
      error: 'Failed to fetch risk positions',
      message: error.message 
    });
  }
}

/**
 * リスク管理統計情報を取得するAPIエンドポイント
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getRiskStats(req, res) {
  try {
    const { period = 'daily' } = req.query;
    
    // 期間別損益を取得
    const periodPnL = await calculatePeriodPnLRedis(period);
    
    // 全ポジション取得
    const allPositions = await getAllPositionsRedis();
    
    // 取引所別統計
    const exchangeStats = {};
    allPositions.forEach(position => {
      if (!exchangeStats[position.exchange]) {
        exchangeStats[position.exchange] = {
          positions: 0,
          totalAmount: 0,
          unrealizedPnL: 0
        };
      }
      exchangeStats[position.exchange].positions++;
      exchangeStats[position.exchange].totalAmount += position.amount || 0;
      
      // 簡易的な未実現損益計算
      const currentPrice = position.currentPrice || 0;
      const entryPrice = position.entryPrice || 0;
      const amount = position.amount || 0;
      const unrealizedPnL = amount > 0 ? (currentPrice - entryPrice) * amount : 0;
      exchangeStats[position.exchange].unrealizedPnL += unrealizedPnL;
    });

    res.json({
      period,
      periodPnL,
      exchangeStats,
      totalPositions: allPositions.length,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error fetching risk stats:', error);
    res.status(500).json({ 
      error: 'Failed to fetch risk stats',
      message: error.message 
    });
  }
}

module.exports = {
  getRiskPositions,
  getRiskStats
};