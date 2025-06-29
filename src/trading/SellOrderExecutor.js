/**
 * Sell Order Executor - Refactored from executeSellOrder
 * Eliminates 320+ lines of duplicate code by extending TradingEngine
 */

const TradingEngine = require('./TradingEngine');
const { formattedAvailableAmount } = require('../database/manager');
const { backtestCreateLimitSellOrder } = require('../database/manager');
const { createLimitSellOrder } = require('../strategies/utils/common');

class SellOrderExecutor extends TradingEngine {
  constructor(exchange, symbol, strategyKey, config, marketParameters, options = {}) {
    super(exchange, symbol, strategyKey, config, marketParameters, options);
  }

  /**
   * Execute sell order with all extracted common logic
   */
  async execute(currentPrice, signalInfo, _globalConfig = null) {
    try {
      // Perform common risk management checks
      const riskCheck = await this.performRiskManagement(currentPrice);
      if (!riskCheck.allowed) {
        return this.handleValidationFailure('Risk management check failed', { currentPrice });
      }

      // Get available balance using extracted common logic
      const balance = await this.getAvailableBalance();
      const quoteCurrency = this.symbol.split('/')[0];
      const availableAsset = balance.free[quoteCurrency];

      // Get formatted available amount for selling
      const { amountPrecision, minTradeAmount } = this.getSafeMarketParameters();
      const formattedAmount = await formattedAvailableAmount(
        this.exchange, 
        this.symbol, 
        this.strategyKey, 
        amountPrecision, 
        this.options
      );

      // Validate sell amount
      if (formattedAmount < minTradeAmount) {
        return this.handleValidationFailure(
          'Adjusted amount below minimum trade amount',
          {
            adjustedAmount: formattedAmount,
            minTradeAmount,
            currentPrice
          }
        );
      }

      // Check if sufficient assets are available (skip for backtest)
      if (!this.isBacktest && (availableAsset < formattedAmount || formattedAmount <= 0)) {
        return this.handleValidationFailure(
          'Insufficient assets for sell order',
          {
            availableAsset,
            formattedAmount,
            currentPrice
          }
        );
      }

      // Get realized P&L using extracted common logic
      const realizedPnL = await this.getRealizedPnL();

      // Execute the sell order
      const orderResult = await this.executeSellOrder(
        formattedAmount,
        currentPrice,
        signalInfo,
        realizedPnL
      );

      return orderResult;

    } catch (error) {
      console.error(`[${this.strategyName}] Sell order execution error:`, error);
      return this.handleValidationFailure('Execution error', { error: error.message });
    }
  }

  /**
   * Execute the actual sell order (backtest vs live)
   */
  async executeSellOrder(amount, currentPrice, signalInfo, realizedPnL) {
    const { orderType } = this.config;
    
    try {
      let order;
      
      if (this.isBacktest) {
        // Backtest mode
        order = await backtestCreateLimitSellOrder(
          this.symbol,
          amount,
          currentPrice,
          this.options
        );
      } else {
        // Live trading mode
        order = await createLimitSellOrder(
          this.exchange,
          this.symbol,
          this.strategyKey,
          amount,
          currentPrice,
          orderType || 'limit',
          this.options
        );
      }

      // Create success result with extracted common formatting
      const _message = `✅ [${this.strategyName}] Sell order executed\n` +
                            `Exchange: ${this.exchange.id}\n` +
                            `Symbol: ${this.symbol}\n` +
                            `Amount: ${amount}\n` +
                            `Price: ${currentPrice.toLocaleString()}円\n` +
                            `P&L: ${realizedPnL?.toFixed(2) || 'N/A'}円`;

      await this.sendNotification(_message);

      return this.createOrderResult(true, {
        order,
        amount,
        price: currentPrice,
        type: 'sell',
        realizedPnL,
        signal: 'sell',
        ...signalInfo
      });

    } catch (orderError) {
      console.error(`[${this.strategyName}] Order creation failed:`, orderError);
      return this.handleValidationFailure('Order creation failed', { 
        error: orderError.message,
        amount,
        currentPrice 
      });
    }
  }
}

module.exports = SellOrderExecutor;