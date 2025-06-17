/**
 * リスク管理API コントローラー
 */
const { getAllPositionsRedis, calculatePeriodPnLRedis, getTickerRedis } = require('../../database/redisDatabase');
const { getTradeSummary, listTrades, listFilledPositions } = require('../../database/manager');

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
 * 約定済みポジションのみを取得するAPIエンドポイント
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getFilledPositions(req, res) {
  try {
    // クエリパラメータからフィルタ条件を取得
    const { exchange, symbol, strategy } = req.query;

    // フィルタ条件を構築
    const filter = {};
    if (exchange) {
      filter.exchangeId = exchange;
    }
    if (symbol) {
      filter.symbol = symbol;
    }
    if (strategy) {
      filter.strategyKey = strategy;
    }

    console.log('getFilledPositions filter:', filter);

    // MongoDBから約定済みポジションを取得
    let filledPositions = await listFilledPositions(filter);
    
    console.log(`getFilledPositions received ${filledPositions.length} positions`);

    // 各ポジションに追加情報を付与
    const enrichedPositions = await Promise.all(
      filledPositions.map(async (position) => {
        try {
          // 現在価格を取得
          let currentPrice = position.entryPrice || 0;
          
          try {
            const ticker = await getTickerRedis(position.exchangeId, position.symbol);
            if (ticker && ticker.last && ticker.last > 0) {
              currentPrice = ticker.last;
            }
          } catch (tickerError) {
            console.warn(`Failed to get ticker for ${position.exchangeId}:${position.symbol}:`, tickerError.message);
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

          // 保有時間を計算（時間単位）
          let holdingTimeHours = 0;
          if (position.createdAt && position.closedAt) {
            const createdTime = new Date(position.createdAt).getTime();
            const closedTime = new Date(position.closedAt).getTime();
            holdingTimeHours = (closedTime - createdTime) / (1000 * 60 * 60);
          }

          return {
            ...position,
            exchange: position.exchangeId, // WebUIの互換性のため
            strategy: position.strategyKey, // WebUIの互換性のため
            currentPrice,
            unrealizedPnL,
            unrealizedPnLPercent,
            holdingTimeHours, // 保有時間（時間単位）
            createdAt: position.createdAt ? new Date(position.createdAt).toISOString() : null,
            closedAt: position.closedAt ? new Date(position.closedAt).toISOString() : null,
            filled: true // 約定済みフラグ
          };
        } catch (error) {
          console.error(`Error enriching filled position ${position.positionKey}:`, error);
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
        enrichedPositions.reduce((sum, p) => {
          const createdAt = p.createdAt ? new Date(p.createdAt).getTime() : Date.now();
          const closedAt = p.closedAt ? new Date(p.closedAt).getTime() : Date.now();
          return sum + ((closedAt - createdAt) / (1000 * 60 * 60));
        }, 0) / enrichedPositions.length : 0
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