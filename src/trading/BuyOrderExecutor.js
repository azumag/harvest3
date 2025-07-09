/**
 * Buy Order Executor - Refactored from executeBuyOrder
 * Eliminates 320+ lines of duplicate code by extending TradingEngine
 */

const TradingEngine = require('./TradingEngine');
const { checkPositionLimits } = require('../strategies/utils/riskManagement');
const { backtestCreateLimitBuyOrder } = require('../database/manager');
const { createLimitBuyOrder } = require('../strategies/utils/common');

class BuyOrderExecutor extends TradingEngine {
  constructor(exchange, symbol, strategyKey, config, marketParameters, options = {}) {
    super(exchange, symbol, strategyKey, config, marketParameters, options);
  }

  /**
   * Execute buy order with all extracted common logic
   */
  async execute(currentPrice, signalInfo, _globalConfig = null) {
    try {
      // Perform common risk management checks
      const riskCheck = await this.performRiskManagement(currentPrice);
      if (!riskCheck.allowed) {
        return this.handleValidationFailure('Risk management check failed', { currentPrice });
      }

      // Check position limits (buy-specific)
      if (!this.isBacktest && this.config.enableRiskManagement !== false) {
        const positionLimitCheck = await checkPositionLimits(
          this.exchange,
          this.symbol,
          this.strategyKey,
          this.config.riskSettings
        );

        if (!positionLimitCheck.allowed) {
          const message = '⛔ [Risk Management] Position limit reached ⛔\n' +
                         `Exchange: ${this.exchange.id}\n` +
                         `Symbol: ${this.symbol}\n` +
                         `Strategy: ${this.strategyName}\n` +
                         `Reason: ${positionLimitCheck.reason}\n` +
                         `Current Price: ${currentPrice.toLocaleString()}円\n` +
                         '🛑 Skipping new buy order';

          await this.sendNotification(message);
          return this.handleValidationFailure(positionLimitCheck.reason, { currentPrice });
        }
      }

      // Get available balance using extracted common logic
      const balance = await this.getAvailableBalance();
      const baseCurrency = this.symbol.split('/')[1];
      const availableFunds = balance.free[baseCurrency];

      // Calculate trade amount using extracted common logic
      const tradeCalculation = this.calculateTradeAmount(
        availableFunds,
        currentPrice,
        this.config.tradePercentage
      );

      if (!tradeCalculation.isValid) {
        return this.handleValidationFailure(
          'Insufficient funds or amount below minimum',
          {
            availableFunds,
            calculatedAmount: tradeCalculation.amount,
            currentPrice,
            message: tradeCalculation.validationMessage
          }
        );
      }

      // Get realized P&L using extracted common logic
      const realizedPnL = await this.getRealizedPnL();

      // Execute the buy order
      const orderResult = await this.executeBuyOrder(
        tradeCalculation.amount,
        currentPrice,
        signalInfo,
        realizedPnL
      );

      return orderResult;

    } catch (error) {
      console.error(`[${this.strategyName}] Buy order execution error:`, error);
      return this.handleValidationFailure('Execution error', { error: error.message });
    }
  }

  /**
   * Execute the actual buy order (backtest vs live)
   */
  async executeBuyOrder(amount, currentPrice, signalInfo, realizedPnL) {
    const { orderType } = this.config;

    try {
      let order;

      if (this.isBacktest) {
        // Backtest mode
        order = await backtestCreateLimitBuyOrder(
          this.symbol,
          amount,
          currentPrice,
          this.options
        );
      } else {
        // Live trading mode
        order = await createLimitBuyOrder(
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
      const successMessage = `✅ [${this.strategyName}] Buy order executed\n` +
                            `Exchange: ${this.exchange.id}\n` +
                            `Symbol: ${this.symbol}\n` +
                            `Amount: ${amount}\n` +
                            `Price: ${currentPrice.toLocaleString()}円\n` +
                            `P&L: ${realizedPnL?.toFixed(2) || 'N/A'}円`;

      await this.sendNotification(successMessage);

      return this.createOrderResult(true, {
        order,
        amount,
        price: currentPrice,
        type: 'buy',
        realizedPnL,
        signal: 'buy',
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

module.exports = BuyOrderExecutor;