/**
 * Backtest Executor - Refactored from runBacktestForSymbol
 * Eliminates 339+ lines of duplicate code by extending TradingEngine
 */

const TradingEngine = require('./TradingEngine');
const SellOrderExecutor = require('./SellOrderExecutor');
const { OHLCVTimeFrames } = require('../common/const');
const { timeframeToMs } = require('../common/utils');
const { getStrategyConfig, getStrategyParameters } = require('../database/manager');
const { 
  extractNumericParameterKeys, 
  generateParameterCombinations, 
  generateRandomParameterCombinations 
} = require('../strategies/utils/common');

class BacktestExecutor extends TradingEngine {
  constructor(exchange, symbol, strategy, strategyKey, marketParametersByExchange, options = {}) {
    const marketParameters = marketParametersByExchange[exchange.id][symbol];
    const config = { strategyName: strategyKey, ...options };
    
    super(exchange, symbol, strategyKey, config, marketParameters, { backtest: true, ...options });
    
    this.strategy = strategy;
    this.marketParametersByExchange = marketParametersByExchange;
    this.startDate = options.startDate;
    this.endDate = options.endDate;
    this.retryCount = options.retryCount || 0;
    this.autoUpdate = options.autoUpdate || false;
    this.gridSearch = options.gridSearch || false;
    this.allExchangeSymbolPairs = options.allExchangeSymbolPairs || [];
  }

  /**
   * Run comprehensive backtest across all timeframes
   */
  async runBacktest() {
    console.log(`${this.symbol} のバックテストを開始...`);
    
    let allTimeframeResults = [];
    
    // Process all timeframes in parallel using extracted common logic
    const timeframePromises = OHLCVTimeFrames.map(async (timeframe) => {
      return this.runTimeframeBacktest(timeframe);
    });

    const allTimeframeResultsArrays = await Promise.all(timeframePromises);
    allTimeframeResults = allTimeframeResultsArrays.flat();
    
    // Rank and return results using extracted common logic
    return this.processBacktestResults(allTimeframeResults);
  }

  /**
   * Run backtest for a specific timeframe - extracted from duplicate logic
   */
  async runTimeframeBacktest(timeframe) {
    console.log(`  ${timeframe} タイムフレームのバックテストを開始...`);
    
    // Get strategy configuration using extracted common logic
    const { strategyConfig, parameterCombinations } = await this.prepareTimeframeConfig(timeframe);
    
    const testResults = [];
    
    // Test each parameter combination
    for (const paramCombination of parameterCombinations) {
      const result = await this.runParameterTest(timeframe, paramCombination, strategyConfig);
      testResults.push(result);
    }
    
    // Rank results and add timeframe info
    const rankedResults = this.rankResults(testResults);
    this.displayTimeframeResults(timeframe, rankedResults);
    
    return rankedResults.map(result => ({ ...result, timeframe }));
  }

  /**
   * Prepare configuration for timeframe - extracted from duplicate config logic
   */
  async prepareTimeframeConfig(timeframe) {
    const globalConfig = require('../config');
    const strategyConfig = await getStrategyConfig(this.exchange, this.symbol, this.strategyKey, globalConfig);
    const dbParams = await getStrategyParameters(this.exchange.id, this.symbol, this.strategyKey);
    
    // Extract numeric parameters using common logic
    const numericParameterKeys = extractNumericParameterKeys(dbParams);
    console.log(`数値パラメータ: ${numericParameterKeys.join(', ')}`);
    
    // Generate parameter combinations using extracted logic
    let parameterCombinations;
    if (this.gridSearch) {
      console.log(`${timeframe}: グリッドサーチを実行します...`);
      parameterCombinations = generateParameterCombinations(
        dbParams,
        numericParameterKeys,
        0.1 + (this.retryCount * 0.1),
        10
      );
    } else {
      console.log(`${timeframe}: 正規乱数を使ったランダムサーチを実行します`);
      parameterCombinations = generateRandomParameterCombinations(
        dbParams, 
        numericParameterKeys,
        10 + (this.retryCount * 10),
        0.1 + (this.retryCount * 0.1)
      );
    }

    // Remove duplicates using extracted logic
    parameterCombinations = this.removeDuplicateParameters(parameterCombinations);
    
    return { strategyConfig, parameterCombinations };
  }

  /**
   * Remove duplicate parameter combinations - extracted from duplicate logic
   */
  removeDuplicateParameters(parameterCombinations) {
    const originalCount = parameterCombinations.length;
    const uniqueCombinationsMap = new Map();
    
    parameterCombinations.forEach(combo => {
      const key = JSON.stringify(combo);
      if (!uniqueCombinationsMap.has(key)) {
        uniqueCombinationsMap.set(key, combo);
      }
    });
    
    const uniqueCombinations = Array.from(uniqueCombinationsMap.values());
    console.log(`重複排除: ${originalCount} → ${uniqueCombinations.length}`);
    
    return uniqueCombinations;
  }

  /**
   * Run test for specific parameter combination - extracted from duplicate test logic
   */
  async runParameterTest(timeframe, paramCombination, strategyConfig) {
    const timeframeMs = timeframeToMs('1m'); // Always use 1m intervals for backtest
    
    // Initialize backtest state
    const backtestOptions = {
      ...this.options,
      backtest: {
        baseFund: 10000,
        currentAmount: 0,
        currentPrice: 0,
        buySignalCount: 0,
        sellSignalCount: 0,
        buyOrderCount: 0,
        sellOrderCount: 0,
        lastSignal: null,
        timestamp: this.startDate.getTime()
      }
    };

    // Calculate total iterations
    const totalIterations = Math.floor((this.endDate.getTime() - this.startDate.getTime()) / timeframeMs) + 1;

    // Run backtest loop
    for (let timestamp = this.startDate.getTime(); timestamp <= this.endDate.getTime(); timestamp += timeframeMs) {
      backtestOptions.backtest.timestamp = timestamp;

      try {
        await this.strategy.function(
          this.exchange, 
          this.symbol, 
          this.strategyKey, 
          { ...strategyConfig, ...paramCombination }, 
          this.marketParameters, 
          backtestOptions
        );
      } catch (error) {
        console.error(`${timeframe}: バックテスト中にエラーが発生しました: ${error.message}`);
      }
    }

    // Handle final position
    if (backtestOptions.backtest.lastSignal === 'buy') {
      const sellExecutor = new SellOrderExecutor(
        this.exchange, 
        this.symbol, 
        this.strategyKey, 
        strategyConfig, 
        this.marketParameters, 
        backtestOptions
      );
      
      await sellExecutor.execute(backtestOptions.backtest.currentPrice, {});
      console.log(`  ${timeframe}: 最後のシグナルが買いでした。売り注文を実行`);
    }

    console.log(`${timeframe}: バックテスト完了: 全${totalIterations}回の処理を実行しました`);

    return {
      parameters: paramCombination,
      finalBaseFund: backtestOptions.backtest.baseFund,
      timeframe: timeframe,
      buySignalCount: backtestOptions.backtest.buySignalCount,
      sellSignalCount: backtestOptions.backtest.sellSignalCount,
      buyOrderCount: backtestOptions.backtest.buyOrderCount,
      sellOrderCount: backtestOptions.backtest.sellOrderCount
    };
  }

  /**
   * Rank results by performance - extracted from duplicate ranking logic
   */
  rankResults(results) {
    return results.sort((a, b) => b.finalBaseFund - a.finalBaseFund);
  }

  /**
   * Display timeframe results - extracted from duplicate display logic
   */
  displayTimeframeResults(timeframe, rankedResults) {
    const rankingTitle = `===== ${this.symbol} (${timeframe}) ${this.strategyKey} パラメータ最適化結果 =====`;
    console.log(rankingTitle);

    for (let index = 0; index < Math.min(rankedResults.length, 10); index++) {
      const result = rankedResults[index];
      console.log(`${index + 1}位: ${result.finalBaseFund.toFixed(2)} - パラメータ: ${JSON.stringify(result.parameters)}`);
    }
  }

  /**
   * Process final backtest results - extracted from duplicate processing logic
   */
  processBacktestResults(allTimeframeResults) {
    // Rank all results across timeframes
    const rankedAllResults = this.rankResults(allTimeframeResults);
    
    // Display final ranking
    const finalTitle = `===== ${this.symbol} ${this.strategyKey} パラメータ最適化結果 =====`;
    console.log(finalTitle);
    
    for (let index = 0; index < Math.min(rankedAllResults.length, 10); index++) {
      const result = rankedAllResults[index];
      console.log(`${index + 1}位: ${result.finalBaseFund.toFixed(2)} - タイムフレーム: ${result.timeframe} - パラメータ: ${JSON.stringify(result.parameters)}`);
    }

    return {
      allResults: allTimeframeResults,
      rankedResults: rankedAllResults,
      bestResult: rankedAllResults[0],
      symbol: this.symbol,
      strategyKey: this.strategyKey,
      totalTests: allTimeframeResults.length
    };
  }
}

module.exports = BacktestExecutor;