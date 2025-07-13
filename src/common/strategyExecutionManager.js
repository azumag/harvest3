const Logger = require('../hft/utils/Logger');
const { API_CACHE_SETTINGS } = require('../config/settings');
const logger = new Logger({ service: 'StrategyExecutionManager' });
const { globalAPIDataCache } = require('./apiDataCache');

class StrategyExecutionManager {
  constructor(options = {}) {
    this.executionSlots = [];
    this.slotDuration = options.slotDuration || API_CACHE_SETTINGS.SLOT_DURATION; // 設定ファイルから取得
    this.maxConcurrentStrategies = options.maxConcurrentStrategies || API_CACHE_SETTINGS.MAX_CONCURRENT_STRATEGIES; // 設定ファイルから取得
    this.staggerInterval = options.staggerInterval || API_CACHE_SETTINGS.STAGGER_INTERVAL; // 設定ファイルから取得
  }

  async scheduleStrategyExecution(allExchangeSymbolPairs, config) {
    const strategyGroups = this.groupStrategiesByPriority(allExchangeSymbolPairs, config);
    
    logger.info(`[戦略実行管理] ${strategyGroups.length}グループの実行をスケジュール`);
    
    const results = [];
    const groupPromises = [];
    let delayOffset = 0;

    for (const [groupIndex, group] of strategyGroups.entries()) {
      const delay = delayOffset;
      delayOffset += this.staggerInterval;

      logger.info(`[戦略実行管理] グループ${groupIndex + 1}を${delay}ms後に実行 (${group.length}戦略)`);

      const groupPromise = new Promise((resolve, reject) => {
        setTimeout(async () => {
          try {
            const groupResults = await this.executeStrategyGroup(group);
            results.push(...groupResults);
            resolve(groupResults);
          } catch (error) {
            logger.error(`[戦略実行管理] グループ${groupIndex + 1}実行エラー:`, error.message);
            reject(error);
          }
        }, delay);
      });

      groupPromises.push(groupPromise);
    }

    // すべてのグループの実行完了を待機
    try {
      await Promise.allSettled(groupPromises);
      this.logExecutionSummary(results);
      return results;
    } catch (error) {
      logger.error(`[戦略実行管理] 実行エラー:`, error.message);
      this.logExecutionSummary(results);
      return results;
    }
  }

  groupStrategiesByPriority(allExchangeSymbolPairs, config) {
    const strategyPairs = [];

    for (const { exchangeId, symbol, marketParameters } of allExchangeSymbolPairs) {
      const exchangeConfig = config.exchanges[exchangeId];
      if (!exchangeConfig) {continue;}

      for (const strategyKey of Object.keys(config.strategies)) {
        const strategy = config.strategies[strategyKey];
        if (!strategy.enabled) {continue;}

        const supportedExchange = strategy.exchanges?.find(e => e.id === exchangeId);
        if (!supportedExchange) {continue;}

        strategyPairs.push({
          exchangeId,
          symbol,
          strategyKey,
          strategy,
          exchangeConfig,
          marketParameters,
          supportedExchange,
          allExchangeSymbolPairs,
          config,
          priority: this.getStrategyPriority(strategyKey, strategy)
        });
      }
    }

    strategyPairs.sort((a, b) => b.priority - a.priority);

    const groups = [];
    for (let i = 0; i < strategyPairs.length; i += this.maxConcurrentStrategies) {
      groups.push(strategyPairs.slice(i, i + this.maxConcurrentStrategies));
    }

    return groups;
  }

  getStrategyPriority(strategyKey, strategy) {
    const priorityMap = {
      'BOLLINGER_BANDS': 10,  // 高優先度
      'MA': 8,
      'RSI': 7,
      'MACD': 6,
      'HFT': 5,
      'DEFAULT': 3
    };

    return priorityMap[strategyKey] || priorityMap.DEFAULT;
  }

  async executeStrategyGroup(strategyGroup) {
    const promises = strategyGroup.map(async (strategyData) => {
      try {
        return await this.executeStrategyWithCache(strategyData);
      } catch (error) {
        logger.error(`[戦略実行] エラー: ${strategyData.strategyKey}/${strategyData.symbol} - ${error.message}`);
        return {
          success: false,
          strategyKey: strategyData.strategyKey,
          symbol: strategyData.symbol,
          error: error.message
        };
      }
    });

    return await Promise.allSettled(promises);
  }

  async executeStrategyWithCache(strategyData) {
    const { exchangeConfig, symbol, strategy, strategyKey, marketParameters, supportedExchange } = strategyData;
    const exchangeInstance = exchangeConfig.instance;

    try {
      logger.info(`[戦略実行] 開始: ${strategyKey}/${symbol} (${exchangeInstance.id})`);

      // Ticker データを取得（キャッシュ経由）
      const tickerData = await globalAPIDataCache.queueRequest(
        exchangeInstance, 
        'fetchTicker', 
        symbol
      );

      // OHLCV データを取得（戦略に必要な場合のみ）
      const ohlcvData = strategy.ohlcvInterval ? 
        await globalAPIDataCache.queueRequest(
          exchangeInstance,
          'fetchOHLCV',
          symbol,
          { 
            timeframe: strategy.ohlcvInterval, 
            limit: strategy.period || 20 
          }
        ) : null;

      logger.info(`[戦略実行] データ取得完了: ${strategyKey}/${symbol}`);

      // 戦略関数の実行（従来の引数形式を維持）
      const result = await strategy.function(
        supportedExchange,
        symbol,
        strategyKey,
        strategy,
        marketParameters,
        {
          allExchangeSymbolPairs: strategyData.allExchangeSymbolPairs,
          config: strategyData.config,
          strategyConfig: strategyData.strategyConfig,
          tickerData,
          ohlcvData
        }
      );

      logger.info(`[戦略実行] 完了: ${strategyKey}/${symbol}`);

      return {
        success: true,
        strategyKey,
        symbol,
        result
      };
    } catch (error) {
      logger.error(`[戦略実行] エラー: ${strategyKey}/${symbol} - ${error.message}`);
      return {
        success: false,
        strategyKey,
        symbol,
        error: error.message
      };
    }
  }

  logExecutionSummary(results) {
    const successCount = results.filter(r => r.value?.success).length;
    const errorCount = results.length - successCount;
    const cacheStats = globalAPIDataCache.getStats();

    logger.info(`[戦略実行管理] 実行完了サマリー:`);
    logger.info(`  成功: ${successCount}件`);
    logger.info(`  エラー: ${errorCount}件`);
    logger.info(`  キャッシュヒット率: ${cacheStats.hitRate}`);
    logger.info(`  API呼び出し数: ${cacheStats.requests}件`);
    logger.info(`  キャッシュサイズ: ${cacheStats.cacheSize}件`);

    if (errorCount > 0) {
      logger.warn(`[戦略実行管理] エラー詳細:`);
      results.forEach((result, index) => {
        if (!result.value?.success) {
          logger.warn(`  ${index + 1}. ${result.value?.strategyKey}/${result.value?.symbol}: ${result.value?.error || '不明なエラー'}`);
        }
      });
    }
  }
}

const globalStrategyExecutionManager = new StrategyExecutionManager();

module.exports = {
  StrategyExecutionManager,
  globalStrategyExecutionManager
};