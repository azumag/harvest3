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
  safeValidateStrategyParametersData: strategyParametersValidator.safeValidate
};