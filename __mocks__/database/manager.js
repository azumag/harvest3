/**
 * Mock for database/manager module
 * Prevents MongoDB connections during unit tests
 */

module.exports = {
  // Mock functions from manager.js
  formattedAvailableAmount: jest.fn().mockResolvedValue(0),
  getRealizedPnL: jest.fn().mockResolvedValue({ totalPnL: 0, trades: 0 }),
  addSignal: jest.fn().mockResolvedValue(true),
  backtestCreateLimitBuyOrder: jest.fn().mockResolvedValue({
    id: 'mock-order-id',
    symbol: 'BTC/JPY',
    side: 'buy',
    amount: 0.001,
    price: 5000000,
    status: 'open'
  }),
  backtestCreateLimitSellOrder: jest.fn().mockResolvedValue({
    id: 'mock-order-id',
    symbol: 'BTC/JPY',
    side: 'sell',
    amount: 0.001,
    price: 5100000,
    status: 'open'
  }),
  addOrder: jest.fn().mockResolvedValue(true),
  fetchOHLCVData: jest.fn().mockResolvedValue([]),
  getAvailableFund: jest.fn().mockResolvedValue(100000),
  checkBuyOrderAllowance: jest.fn().mockResolvedValue({ allowed: true }),
  getStrategyParameters: jest.fn().mockResolvedValue({}),
  saveStrategyParameters: jest.fn().mockResolvedValue(true),
  getTradeCurrentPosition: jest.fn().mockResolvedValue(null),
  getOrderStrategyKeyByOrderId: jest.fn().mockResolvedValue('test-strategy'),
  updateFilledTrades: jest.fn().mockResolvedValue(true),
  fetchTicker: jest.fn().mockResolvedValue({
    symbol: 'BTC/JPY',
    last: 5000000,
    bid: 4999000,
    ask: 5001000,
    timestamp: Date.now()
  }),

  // Add any other functions that might be imported from manager.js
  connectDB: jest.fn().mockResolvedValue(true),
  listOrders: jest.fn().mockResolvedValue([]),
  listTrades: jest.fn().mockResolvedValue([]),
  listSignals: jest.fn().mockResolvedValue([]),
  countSignals: jest.fn().mockResolvedValue(0),
  updateOrderByOrderId: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
  deleteOrderByOrderId: jest.fn().mockResolvedValue(true),
  getOrderByOrderId: jest.fn().mockResolvedValue(null),

  // Mock Redis-related functions
  getTradeSummary: jest.fn().mockResolvedValue(null),
  updateTradeSummary: jest.fn().mockResolvedValue(true),
  getStrategyParametersRedis: jest.fn().mockResolvedValue({}),
  saveStrategyParametersRedis: jest.fn().mockResolvedValue(true),
  getCurrentOrderPairRedis: jest.fn().mockResolvedValue(null),
  setCurrentOrderPairRedis: jest.fn().mockResolvedValue(true),
  getTradeSummaryTimestamp: jest.fn().mockResolvedValue(0),
  updateTradeSummaryTimestamp: jest.fn().mockResolvedValue(true),
  getTradeSummaries: jest.fn().mockResolvedValue([]),
  initialize: jest.fn().mockResolvedValue(true),
  getTradeKeys: jest.fn().mockResolvedValue([]),
  getAllTradeSummaries: jest.fn().mockResolvedValue([]),
  getAllStrategyParametersRedis: jest.fn().mockResolvedValue({}),
  getOHLCVRedisTimestamp: jest.fn().mockResolvedValue(0),
  getOHLCVRedis: jest.fn().mockResolvedValue([]),
  updateOHLCVRedis: jest.fn().mockResolvedValue(true),
  getTickerRedis: jest.fn().mockResolvedValue(null),
  updateTickerRedis: jest.fn().mockResolvedValue(true),
  updateBacktestOHLCVRedisSortedSet: jest.fn().mockResolvedValue(true),
  getBacktestOHLCVRedisBeforeTimestamp: jest.fn().mockResolvedValue([]),
  deleteKey: jest.fn().mockResolvedValue(true),

  // Market parameters function
  getMarketParametersByExchangeSymbol: jest.fn().mockImplementation((symbolByExchange) => {
    const result = {};
    for (const [exchange, symbols] of Object.entries(symbolByExchange)) {
      result[exchange] = {};
      for (const symbol of symbols) {
        if (symbol === 'APE/JPY' || symbol === 'BTC/JPY') {
          result[exchange][symbol] = {
            success: true,
            minTradeAmount: 1,
            pricePrecision: 2,
            amountPrecision: 3,
            timestamp: Date.now()
          };
        } else {
          result[exchange][symbol] = {
            success: false,
            error: true,
            errorType: 'UNSUPPORTED_PAIR',
            errorMessage: `Symbol ${symbol} not supported`,
            timestamp: Date.now()
          };
        }
      }
    }
    return Promise.resolve(result);
  }),

  // Add backtest mode functions
  timeframeToTimestamp: jest.fn().mockImplementation((timeframe) => {
    const value = parseInt(timeframe);
    const unit = timeframe.slice(value.toString().length);
    const ms = unit === 'm' ? value * 60 * 1000 :
      unit === 'h' ? value * 60 * 60 * 1000 :
        unit === 'd' ? value * 24 * 60 * 60 * 1000 : 0;
    return Date.now() - ms;
  }),

  // Issue #2790 & #2856: Add missing functions for tests
  validateTradeData: jest.fn().mockImplementation((trade) => {
    if (!trade || typeof trade !== 'object') {
      return { valid: false, errors: ['トレードオブジェクトが無効'] };
    }
    
    const errors = [];
    
    // 必須フィールドの存在チェック
    if (!trade.amount || !trade.value || !trade.price) {
      errors.push('必須フィールド (amount, value, price) が不足');
    }
    
    // 数値の有効性チェック
    if (typeof trade.amount !== 'number' || !Number.isFinite(trade.amount) || trade.amount <= 0) {
      errors.push(`無効なamount値: ${trade.amount}`);
    }
    
    if (typeof trade.value !== 'number' || !Number.isFinite(trade.value) || trade.value <= 0) {
      errors.push(`無効なvalue値: ${trade.value}`);
    }
    
    if (typeof trade.price !== 'number' || !Number.isFinite(trade.price) || trade.price <= 0) {
      errors.push(`無効なprice値: ${trade.price}`);
    }
    
    // 極端な値のチェック
    const MAX_TRADE_VALUE = 1e15;
    if (trade.amount > MAX_TRADE_VALUE || 
        trade.value > MAX_TRADE_VALUE || 
        trade.price > MAX_TRADE_VALUE) {
      errors.push('トレード値が上限を超過');
    }
    
    return {
      valid: errors.length === 0,
      errors: errors
    };
  }),

  prepareRedisOperations: jest.fn().mockImplementation(async (transaction, trade) => {
    const validationErrors = [];
    
    // 必須フィールドの検証
    if (!trade.exchange || typeof trade.exchange !== 'string') {
      validationErrors.push('無効なexchange値');
    }
    if (!trade.symbol || typeof trade.symbol !== 'string') {
      validationErrors.push('無効なsymbol値');
    }
    if (!trade.strategy || typeof trade.strategy !== 'string') {
      validationErrors.push('無効なstrategy値');
    }
    if (!trade.side || !['buy', 'sell'].includes(trade.side)) {
      validationErrors.push('無効なside値');
    }
    
    // 数値フィールドの再検証
    if (typeof trade.amount !== 'number' || !Number.isFinite(trade.amount) || trade.amount <= 0) {
      validationErrors.push(`Redis操作のためのamount値が無効: ${trade.amount}`);
    }
    if (typeof trade.value !== 'number' || !Number.isFinite(trade.value) || trade.value <= 0) {
      validationErrors.push(`Redis操作のためのvalue値が無効: ${trade.value}`);
    }
    
    if (validationErrors.length > 0) {
      throw new Error(`Redis操作準備時のバリデーションエラー: ${validationErrors.join(', ')}`);
    }
    
    // Mock Redis operations
    return Promise.resolve();
  }),

  executeDistributedTransaction: jest.fn().mockResolvedValue(true)
};