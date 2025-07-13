const { z } = require('zod');

/**
 * Zod schema for trade data validation
 * Based on the trade object structure used throughout the harvest3 trading system
 */
const TradeSchema = z.object({
  // Core identifiers
  tradeId: z.string().min(1, 'Trade ID is required'),
  orderId: z.string().min(1, 'Order ID is required'),

  // Exchange and trading pair
  exchange: z.string().min(1, 'Exchange is required'),
  symbol: z.string().min(1, 'Symbol is required'),

  // Strategy information
  strategy: z.string().min(1, 'Strategy is required'),

  // Trade details
  side: z.enum(['buy', 'sell'], {
    errorMap: () => ({ message: "Side must be 'buy' or 'sell'" })
  }),
  amount: z.number().positive('Amount must be positive'),
  price: z.number().positive('Price must be positive'),
  value: z.number().positive('Value must be positive'),

  // Order type and fees
  orderType: z.string().default('market'),
  fee: z.number().default(0), // Allow negative fees for rebates

  // Timestamps
  timestamp: z.number().int().positive('Timestamp must be a positive integer'),
  filledAt: z.number().int().positive('FilledAt timestamp must be a positive integer').optional(),

  // MongoDB internal ID (optional, added by MongoDB)
  _id: z.any().optional()
});

/**
 * Validate trade data using the TradeSchema
 * @param {Object} tradeData - The trade data to validate
 * @returns {Object} - Validation result with success/error information
 */
function validateTradeData(tradeData) {
  try {
    const validatedData = TradeSchema.parse(tradeData);
    return {
      success: true,
      data: validatedData,
      error: null
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      error: error.errors || error.message
    };
  }
}

/**
 * Safely validate trade data with detailed error logging
 * @param {Object} tradeData - The trade data to validate
 * @param {string} context - Context for logging (e.g., function name)
 * @returns {Object|null} - Returns validated data or null if validation fails
 */
function safeValidateTradeData(tradeData, context = 'Unknown') {
  const validation = validateTradeData(tradeData);

  if (!validation.success) {
    console.error(`[${context}] Trade data validation failed:`, {
      errors: validation.error,
      data: tradeData
    });
    return null;
  }

  return validation.data;
}

/**
 * Zod schema for order data validation
 */
const OrderSchema = z.object({
  orderId: z.string().min(1, 'Order ID is required'),
  exchange: z.string().min(1, 'Exchange is required'),
  symbol: z.string().min(1, 'Symbol is required'),
  side: z.enum(['buy', 'sell'], {
    errorMap: () => ({ message: "Side must be 'buy' or 'sell'" })
  }),
  amount: z.number().positive('Amount must be positive'),
  price: z.number().positive('Price must be positive'),
  orderType: z.string().min(1, 'Order type is required'),
  strategy: z.string().min(1, 'Strategy is required'),
  timestamp: z.number().int().positive('Timestamp must be a positive integer'),
  status: z.string().optional(),
  _id: z.any().optional()
});

/**
 * Zod schemas for Redis parameter validation
 */
const RedisParameterSchemas = {
  // 戦略パラメータスキーマ
  StrategyParams: z.record(z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.any()),
    z.null()
  ])),

  // 取引サマリースキーマ
  TradeSummary: z.object({
    exchange: z.string(),
    symbol: z.string(),
    strategy: z.string(),
    totalAmount: z.number().default(0),
    totalValue: z.number().default(0),
    count: z.number().int().default(0),
    lastUpdate: z.number().int().positive(),
    avgPrice: z.number().optional(),
    profit: z.number().optional()
  }),

  // 残高データスキーマ
  Balance: z.object({
    currency: z.string(),
    free: z.number().nonnegative(),
    used: z.number().nonnegative(),
    total: z.number().nonnegative(),
    timestamp: z.number().int().positive()
  }),

  // ポジションスキーマ
  Position: z.object({
    id: z.string(),
    exchange: z.string(),
    symbol: z.string(),
    side: z.enum(['buy', 'sell']),
    amount: z.number().positive(),
    price: z.number().positive(),
    timestamp: z.number().int().positive(),
    strategy: z.string(),
    status: z.enum(['open', 'closed', 'pending']).default('open'),
    stopLoss: z.number().positive().optional(),
    takeProfit: z.number().positive().optional()
  }),

  // OHLCVデータスキーマ
  OHLCV: z.object({
    timestamp: z.number().int().positive(),
    open: z.number().positive(),
    high: z.number().positive(),
    low: z.number().positive(),
    close: z.number().positive(),
    volume: z.number().nonnegative()
  })
};

/**
 * Redis パラメータ値の型安全な解析
 * @param {any} value - 解析する値
 * @param {string} type - 期待する型 ('string', 'number', 'boolean', 'array', 'object')
 * @returns {any} - 解析された値
 */
function parseRedisValue(value, type = 'auto') {
  // null/undefined チェック
  if (value === null || value === undefined || value === 'null') {
    return null;
  }

  // 文字列化されたnull
  if (typeof value === 'string' && value.toLowerCase() === 'null') {
    return null;
  }

  try {
    switch (type) {
    case 'string':
      return z.string().parse(String(value));
    
    case 'number':
      if (typeof value === 'number') return value;
      const num = parseFloat(value);
      return z.number().parse(num);
    
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') {
        return z.boolean().parse(value.toLowerCase() === 'true');
      }
      return z.boolean().parse(Boolean(value));
    
    case 'array':
      if (Array.isArray(value)) return value;
      if (typeof value === 'string') {
        return z.array(z.any()).parse(JSON.parse(value));
      }
      return [value];
    
    case 'object':
      if (typeof value === 'object' && value !== null) return value;
      if (typeof value === 'string') {
        return z.object({}).parse(JSON.parse(value));
      }
      return {};
    
    case 'auto':
    default:
      // 自動型判定
      if (typeof value === 'string') {
        // JSONオブジェクト/配列の判定
        if ((value.startsWith('{') && value.endsWith('}')) || 
            (value.startsWith('[') && value.endsWith(']'))) {
          try {
            return JSON.parse(value);
          } catch {
            return value;
          }
        }
        
        // 数値の判定
        if (/^-?\d+\.?\d*$/.test(value.trim())) {
          const num = parseFloat(value);
          return isNaN(num) ? value : num;
        }
        
        // 真偽値の判定
        if (['true', 'false'].includes(value.toLowerCase())) {
          return value.toLowerCase() === 'true';
        }
      }
      
      return value;
    }
  } catch (error) {
    console.warn(`Failed to parse Redis value: ${value} as ${type}:`, error.message);
    return value; // フォールバック: 元の値を返す
  }
}

/**
 * Redis データの検証と型変換
 * @param {any} data - 検証するデータ
 * @param {string} schemaType - スキーマタイプ
 * @returns {Object} - 検証結果
 */
function validateRedisData(data, schemaType) {
  if (!RedisParameterSchemas[schemaType]) {
    return {
      success: false,
      data: null,
      error: `Unknown schema type: ${schemaType}`
    };
  }

  try {
    const validatedData = RedisParameterSchemas[schemaType].parse(data);
    return {
      success: true,
      data: validatedData,
      error: null
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      error: error.errors || error.message
    };
  }
}

/**
 * Zod schema for position data validation
 */
const PositionSchema = z.object({
  exchangeId: z.string().min(1, 'Exchange ID is required'),
  symbol: z.string().min(1, 'Symbol is required'),
  strategyKey: z.string().min(1, 'Strategy key is required'),
  orderId: z.string().min(1, 'Order ID is required'),
  side: z.enum(['buy', 'sell'], {
    errorMap: () => ({ message: "Side must be 'buy' or 'sell'" })
  }),
  amount: z.number().positive('Amount must be positive'),
  entryPrice: z.number().positive('Entry price must be positive'),
  highestPrice: z.number().positive('Highest price must be positive').optional(),
  status: z.string().min(1, 'Status is required'),
  createdAt: z.number().int().positive('CreatedAt must be a positive integer'),
  updatedAt: z.number().int().positive('UpdatedAt must be a positive integer').optional(),
  _id: z.any().optional()
});

/**
 * Zod schema for pending order data validation
 */
const PendingOrderSchema = z.object({
  exchangeId: z.string().min(1, 'Exchange ID is required'),
  symbol: z.string().min(1, 'Symbol is required'),
  strategyKey: z.string().min(1, 'Strategy key is required'),
  orderId: z.string().min(1, 'Order ID is required'),
  side: z.enum(['buy', 'sell'], {
    errorMap: () => ({ message: "Side must be 'buy' or 'sell'" })
  }),
  amount: z.number().positive('Amount must be positive'),
  price: z.number().positive('Price must be positive'),
  orderType: z.string().min(1, 'Order type is required'),
  timestamp: z.number().int().positive('Timestamp must be a positive integer'),
  status: z.string().min(1, 'Status is required'),
  _id: z.any().optional()
});

/**
 * Zod schema for trade summary data validation
 */
const TradeSummarySchema = z.object({
  exchange: z.string().min(1, 'Exchange is required'),
  symbol: z.string().min(1, 'Symbol is required'),
  strategy: z.string().min(1, 'Strategy is required'),
  amount: z.number().positive('Amount must be positive'),
  value: z.number().positive('Value must be positive'),
  side: z.enum(['buy', 'sell'], {
    errorMap: () => ({ message: "Side must be 'buy' or 'sell'" })
  }),
  fee: z.number().default(0) // Allow negative fees for rebates
});

/**
 * Zod schema for strategy parameters validation
 */
const StrategyParametersSchema = z.object({
  exchangeId: z.string().min(1, 'Exchange ID is required'),
  symbol: z.string().min(1, 'Symbol is required'),
  strategyKey: z.string().min(1, 'Strategy key is required'),
  params: z.record(z.any()) // Dynamic parameters object
}).passthrough(); // Allow additional fields for strategy-specific params

/**
 * Generic validation function factory
 */
function createValidator(schema, schemaName) {
  return {
    validate: (data) => {
      try {
        const validatedData = schema.parse(data);
        return {
          success: true,
          data: validatedData,
          error: null
        };
      } catch (error) {
        return {
          success: false,
          data: null,
          error: error.errors || error.message
        };
      }
    },
    safeValidate: (data, context = 'Unknown') => {
      try {
        const validatedData = schema.parse(data);
        return validatedData;
      } catch (error) {
        console.error(`[${context}] ${schemaName} validation failed:`, {
          errors: error.errors || error.message,
          data: data
        });
        return null;
      }
    }
  };
}

// Create validators for each schema
const tradeValidator = createValidator(TradeSchema, 'Trade');
const orderValidator = createValidator(OrderSchema, 'Order');
const positionValidator = createValidator(PositionSchema, 'Position');
const pendingOrderValidator = createValidator(PendingOrderSchema, 'PendingOrder');
const tradeSummaryValidator = createValidator(TradeSummarySchema, 'TradeSummary');
const strategyParametersValidator = createValidator(StrategyParametersSchema, 'StrategyParameters');

module.exports = {
  // Schemas
  TradeSchema,
  OrderSchema,
  PositionSchema,
  PendingOrderSchema,
  TradeSummarySchema,
  StrategyParametersSchema,

  // Legacy validation functions (for backward compatibility)
  validateTradeData: tradeValidator.validate,
  safeValidateTradeData: tradeValidator.safeValidate,

  // New validation functions
  validateOrderData: orderValidator.validate,
  safeValidateOrderData: orderValidator.safeValidate,
  validatePositionData: positionValidator.validate,
  safeValidatePositionData: positionValidator.safeValidate,
  validatePendingOrderData: pendingOrderValidator.validate,
  safeValidatePendingOrderData: pendingOrderValidator.safeValidate,
  validateTradeSummaryData: tradeSummaryValidator.validate,
  safeValidateTradeSummaryData: tradeSummaryValidator.safeValidate,
  validateStrategyParametersData: strategyParametersValidator.validate,
  safeValidateStrategyParametersData: strategyParametersValidator.safeValidate,

  // Redis validation functions
  RedisParameterSchemas,
  parseRedisValue,
  validateRedisData
};