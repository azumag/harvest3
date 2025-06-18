/**
 * リスク管理API コントローラー
 */
const { getAllPositionsRedis, calculatePeriodPnLRedis, getTickerRedis } = require('../../database/redisDatabase');
const { getTradeSummary, listTrades, listFilledPositions } = require('../../database/manager');

/**
 * リスク管理ポジション情報を取得するAPIエンドポイント
 * 約定済みかどうかに関わらず、現在クローズしていない全ての管理ポジションを表示
 * 未実現損益とリスク状態（ストップロス・時間ベース停止）を評価
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

    // 各ポジションに追加情報を付与（ティッカーデータから現在価格を取得）
    const enrichedPositions = await Promise.all(
      filteredPositions.map(async (position) => {
        try {
          // Redisからティッカーデータを取得して現在価格を更新
          let currentPrice = position.entryPrice || 0; // フォールバック値
          
          try {
            const ticker = await getTickerRedis(position.exchange, position.symbol);
            if (ticker && ticker.last && ticker.last > 0) {
              currentPrice = ticker.last;
            }
          } catch (tickerError) {
            console.warn(`Failed to get ticker for ${position.exchange}:${position.symbol}:`, tickerError.message);
            // フォールバック値を使用
          }

          const entryPrice = position.entryPrice || 0;
          const amount = position.amount || 0;
          
          // 正しい未実現損益計算（ポジションの売買方向を考慮）
          let unrealizedPnL = 0;
          let unrealizedPnLPercent = 0;
          
          if (position.side === 'buy') {
            unrealizedPnL = (currentPrice - entryPrice) * amount;
            unrealizedPnLPercent = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;
          } else if (position.side === 'sell') {
            unrealizedPnL = (entryPrice - currentPrice) * amount;
            unrealizedPnLPercent = entryPrice > 0 ? ((entryPrice - currentPrice) / entryPrice) * 100 : 0;
          }

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
            // Redisのティッカーデータから取得した現在価格
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
      })
    );

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
      
      // 正しい未実現損益計算（ポジションの売買方向を考慮）
      const currentPrice = position.currentPrice || 0;
      const entryPrice = position.entryPrice || 0;
      const amount = position.amount || 0;
      let unrealizedPnL = 0;
      
      if (position.side === 'buy') {
        unrealizedPnL = (currentPrice - entryPrice) * amount;
      } else if (position.side === 'sell') {
        unrealizedPnL = (entryPrice - currentPrice) * amount;
      }
      
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

/**
 * 約定済み未売却ポジション（アクティブポジション）を取得するAPIエンドポイント
 * 買い注文が約定済みだが、まだ売却していないポジションを表示
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getFilledPositions(req, res) {
  try {
    // クエリパラメータからフィルタ条件を取得
    const { exchange, symbol, strategy } = req.query;

    // Redisから全ての未売却ポジション（アクティブポジション）を取得
    const allActivePositions = await getAllPositionsRedis();
    
    console.log(`getFilledPositions received ${allActivePositions.length} active positions from Redis`);

    // フィルタ条件を適用
    let filteredPositions = allActivePositions;
    
    if (exchange) {
      filteredPositions = filteredPositions.filter(pos => pos.exchange === exchange);
    }
    if (symbol) {
      filteredPositions = filteredPositions.filter(pos => pos.symbol === symbol);
    }
    if (strategy) {
      filteredPositions = filteredPositions.filter(pos => pos.strategy === strategy);
    }

    // 各ポジションに追加情報を付与（現在価格と未実現損益）
    const enrichedPositions = await Promise.all(
      filteredPositions.map(async (position) => {
        try {
          // 現在価格を取得
          let currentPrice = position.entryPrice || 0;
          
          try {
            const ticker = await getTickerRedis(position.exchange, position.symbol);
            if (ticker && ticker.last && ticker.last > 0) {
              currentPrice = ticker.last;
            }
          } catch (tickerError) {
            console.warn(`Failed to get ticker for ${position.exchange}:${position.symbol}:`, tickerError.message);
          }

          const entryPrice = position.entryPrice || 0;
          const amount = position.amount || 0;
          
          // 未実現損益計算（現在価格で売った場合の損益）
          let unrealizedPnL = 0;
          let unrealizedPnLPercent = 0;
          
          if (position.side === 'buy') {
            unrealizedPnL = (currentPrice - entryPrice) * amount;
            unrealizedPnLPercent = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;
          } else if (position.side === 'sell') {
            unrealizedPnL = (entryPrice - currentPrice) * amount;
            unrealizedPnLPercent = entryPrice > 0 ? ((entryPrice - currentPrice) / entryPrice) * 100 : 0;
          }

          // 保有時間を計算（エントリーからの経過時間）
          const elapsedTime = Date.now() - position.timestamp;
          const holdingTimeHours = elapsedTime / (1000 * 60 * 60);

          return {
            ...position,
            currentPrice,
            unrealizedPnL,
            unrealizedPnLPercent,
            holdingTimeHours,
            createdAt: new Date(position.timestamp).toISOString(),
            closedAt: null, // 未売却なのでnull
            filled: true, // 約定済みフラグ
            status: 'active' // アクティブ状態
          };
        } catch (error) {
          console.error(`Error enriching active position ${position.positionKey || position.key}:`, error);
          return {
            ...position,
            error: 'Failed to enrich position data'
          };
        }
      })
    );

    // 統計情報を計算
    const stats = {
      totalFilledPositions: enrichedPositions.length,
      totalUnrealizedPnL: enrichedPositions.reduce((sum, p) => sum + (p.unrealizedPnL || 0), 0),
      averageHoldingTime: enrichedPositions.length > 0 ? 
        enrichedPositions.reduce((sum, p) => sum + (p.holdingTimeHours || 0), 0) / enrichedPositions.length : 0
    };

    res.json({
      positions: enrichedPositions,
      stats,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error fetching filled positions:', error);
    res.status(500).json({ 
      error: 'Failed to fetch filled positions',
      message: error.message 
    });
  }
}

module.exports = {
  getRiskPositions,
  getRiskStats,
  getFilledPositions
};