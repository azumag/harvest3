/**
 * Base Trading Engine - Extracted from duplicate code patterns
 * Eliminates 320+ lines of duplication across executeBuyOrder, executeSellOrder, and runBacktestForSymbol
 */

const { getAvailableFund, getRealizedPnL, updateFilledTrades } = require('../database/manager');
const { checkStopLoss, executeStopLoss } = require('../strategies/utils/riskManagement');
const { postOrderToDiscord } = require('../common/notifications');

class TradingEngine {
  constructor(exchange, symbol, strategyKey, config, marketParameters, options = {}) {
    this.exchange = exchange;
    this.symbol = symbol;
    this.strategyKey = strategyKey;
    this.config = config;
    this.marketParameters = marketParameters;
    this.options = options;
    
    // Extract common properties
    this.isBacktest = options.backtest || false;
    this.strategyName = config.strategyName || strategyKey;
    
    // Validate required parameters
    this.validateInputs();
  }

  /**
   * Validate common inputs - extracted from duplicate validation logic
   */
  validateInputs() {
    if (!this.marketParameters) {
      throw new Error(`[${this.strategyName}] marketParameters is undefined: ${this.symbol}`);
    }
    
    const { amountPrecision, minTradeAmount } = this.marketParameters;
    if (amountPrecision === undefined || minTradeAmount === undefined) {
      throw new Error(`[${this.strategyName}] Invalid marketParameters for ${this.symbol}`);
    }
  }

  /**
   * Get safe market parameters - extracted from duplicate safety logic
   */
  getSafeMarketParameters() {
    return {
      amountPrecision: this.marketParameters.amountPrecision || 4,
      pricePrecision: this.marketParameters.pricePrecision || 2, // _pricePrecision
      minTradeAmount: this.marketParameters.minTradeAmount || 0.0001,
      maxTradeAmount: this.marketParameters.maxTradeAmount || 1000000,
      ...this.marketParameters
    };
  }

  /**
   * Perform common risk management checks - extracted from duplicate risk logic
   */
  async performRiskManagement(currentPrice) {
    if (this.isBacktest || this.config.enableRiskManagement === false) {
      return { allowed: true };
    }

    // Update filled trades before risk checks
    console.log(`[Risk Management] Updating filled trades for ${this.symbol}...`);
    const tradeUpdateStart = Date.now();
    const updatedCount = await updateFilledTrades(this.exchange, this.symbol);
    const tradeUpdateTime = Date.now() - tradeUpdateStart;
    console.log(`[Risk Management] Trade update completed: ${updatedCount} records (${tradeUpdateTime}ms)`);

    // Stop loss check
    const stopLossPositions = await checkStopLoss(
      this.exchange, 
      this.symbol, 
      this.strategyKey, 
      currentPrice, 
      this.config.riskSettings
    );

    // Process stop loss positions
    for (const position of stopLossPositions) {
      const safeMarketParameters = this.getSafeMarketParameters();
      await executeStopLoss(
        this.exchange, 
        this.symbol, 
        this.strategyKey, 
        position, 
        safeMarketParameters
      );
    }

    return { allowed: true };
  }

  /**
   * Get available balance - extracted from duplicate balance logic
   */
  async getAvailableBalance() {
    const balance = await getAvailableFund(this.exchange, this.symbol, this.options);
    return balance;
  }

  /**
   * Get realized P&L - extracted from duplicate P&L logic
   */
  async getRealizedPnL() {
    return await getRealizedPnL(this.exchange, this.symbol, this.strategyKey, this.options);
  }

  /**
   * Log debug information - extracted from duplicate logging logic
   */
  logDebugInfo(operation, data) {
    if (!this.isBacktest) {
      console.log(`[${operation} DEBUG] ${this.symbol}:`, JSON.stringify(data, null, 2));
    }
  }

  /**
   * Handle trade amount calculations - extracted from duplicate calculation logic
   */
  calculateTradeAmount(availableFunds, currentPrice, tradePercentage) {
    const safeAvailableFunds = availableFunds !== null && availableFunds !== undefined ? availableFunds : 0;
    const safeTradePercentage = tradePercentage !== null && tradePercentage !== undefined ? tradePercentage : 0;
    
    const rawAmount = (safeAvailableFunds * safeTradePercentage) / currentPrice;
    const { amountPrecision, minTradeAmount } = this.getSafeMarketParameters();
    
    // Apply precision
    const formattedAmount = parseFloat(rawAmount.toFixed(amountPrecision));
    
    this.logDebugInfo('Trade Amount Calculation', {
      availableFunds: safeAvailableFunds,
      tradePercentage: safeTradePercentage,
      currentPrice,
      rawAmount,
      formattedAmount,
      minTradeAmount
    });

    return {
      amount: formattedAmount,
      isValid: formattedAmount >= minTradeAmount,
      validationMessage: formattedAmount < minTradeAmount 
        ? `Amount ${formattedAmount} below minimum ${minTradeAmount}` 
        : 'Valid'
    };
  }

  /**
   * Create standardized order result - extracted from duplicate result formatting
   */
  createOrderResult(success, data = {}, reason = null) {
    const baseResult = {
      success,
      strategy: this.strategyName,
      symbol: this.symbol,
      timestamp: Date.now(),
      ...data
    };

    if (!success && reason) {
      baseResult.reason = reason;
    }

    return baseResult;
  }

  /**
   * Send Discord notification - extracted from duplicate notification logic
   */
  async sendNotification(message) {
    if (postOrderToDiscord && !this.isBacktest) {
      await postOrderToDiscord(message);
    }
  }

  /**
   * Handle order validation failure - extracted from duplicate error handling
   */
  async handleValidationFailure(reason, data = {}) {
    const message = `[${this.strategyName}] Order validation failed: ${reason} - ${this.symbol}`;
    console.log(message);
    
    await this.sendNotification(`❌ ${message}`);
    
    return this.createOrderResult(false, {
      earlyReturn: true,
      returnValue: {
        signal: 'none',
        reason,
        ...data
      }
    }, reason);
  }
}

module.exports = TradingEngine;