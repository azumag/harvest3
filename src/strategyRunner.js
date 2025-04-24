const strategies = require('../strategies');
const { config, bitflyerMinTradeAmounts } = require('./config');
const { updateTradeRecord, tradeRecords } = require('./redisTradeRecords');
const { postErrorToDiscord, postOrderToDiscord } = require('./notifications');
const { getMarketParameters } = require('./utils');
// const { getStrategyParameters, saveStrategyParameters } = require('./redisDatabase'); // getStrategyParametersをインポート
const { getStrategyParameters, saveStrategyParameters } = require('./database/manager');

/**
 * 指定された戦略を実行する関数
 * @param {String} strategyKey - 戦略のキー
 * @param {Object} exchange - 取引所オブジェクト
 * @param {String} symbol - 通貨ペア
 * @param {Object} options - オプション
 */
async function runStrategy(strategyKey, exchange, symbol, options = {}) {
  try {
    // configからデフォルトの戦略設定を取得
    const defaultConfig = config.strategies[strategyKey];
    
    if (!defaultConfig || !defaultConfig.enabled) {
      return null;
    }

    // データベースから戦略パラメータを取得
    const dbParams = await getStrategyParameters(exchange.id, symbol, strategyKey);

    const strategyConfig = (() => {
      if (dbParams) {
        // デフォルト設定とデータベースのパラメータをマージ（データベース優先）
        return { ...defaultConfig, ...dbParams };
      } else {
        // DBにパラメータがない場合はデフォルト設定を使用
        // デフォルト設定をDBに保存
        saveStrategyParameters(exchange.id, symbol, strategyKey, defaultConfig);
        return defaultConfig;
      }
    })();
    
    // 戦略に応じたパラメータを設定
    const params = [];
    
    switch (strategyKey) {
      case 'MA':
        params.push(exchange, symbol, strategyConfig.shortPeriod, strategyConfig.longPeriod, strategyConfig.amount, { ...options, tradePercentage: strategyConfig.tradePercentage });
        break;
      case 'MACD':
        params.push(exchange, symbol, strategyConfig.fastPeriod, strategyConfig.slowPeriod, strategyConfig.signalPeriod, strategyConfig.amount, { ...options, tradePercentage: strategyConfig.tradePercentage });
        break;
      case 'RSI':
        params.push(exchange, symbol, strategyConfig.period, strategyConfig.oversoldThreshold, strategyConfig.overboughtThreshold, strategyConfig.amount, { ...options, tradePercentage: strategyConfig.tradePercentage });
        break;
      case 'BOLLINGER_BANDS':
        params.push(exchange, symbol, strategyConfig.period, strategyConfig.stdDev, strategyConfig.amount, { ...options, tradePercentage: strategyConfig.tradePercentage });
        break;
      case 'MEAN_REVERSION':
        params.push(exchange, symbol, strategyConfig.period, strategyConfig.deviationThreshold, strategyConfig.amount, { ...options, tradePercentage: strategyConfig.tradePercentage});
        break;
      case 'OSCILLATOR':
        params.push(exchange, symbol, strategyConfig.period, strategyConfig.oversoldThreshold, strategyConfig.overboughtThreshold, strategyConfig.amount, { ...options, tradePercentage: strategyConfig.tradePercentage });
        break;
      case 'INTER_EXCHANGE_ARBITRAGE':
        // アービトラージは複数の取引所を必要とするため、別途処理
        // アービトラージ戦略のパラメータは runArbitrageStrategy で処理するため、ここではスキップ
        return null;
      case 'HFT':
        params.push(exchange, symbol, strategyConfig.interval, strategyConfig.priceThreshold, strategyConfig.amount, { ...options, tradePercentage: strategyConfig.tradePercentage });
        break;
      case 'MARKET_MAKING':
        params.push(exchange, symbol, strategyConfig.rangePeriod, strategyConfig.rangeThreshold, strategyConfig.spreadWidth, strategyConfig.amount, {
          ...options,
          tradePercentage: strategyConfig.tradePercentage,
          reorderInterval: strategyConfig.reorderInterval,
          maxPositionCount: strategyConfig.maxPositionCount,
          adjustmentValue: strategyConfig.adjustmentValue
        });
        break;
      case 'INYO':
        params.push(exchange, symbol, {
          ...options,
        });
        break;
      // case 'SCALPING':
      //   params.push(exchange, symbol, options.spreadHistory || {}, { ...options, tradePercentage: strategyConfig.tradePercentage, updateTradeRecord: updateTradeRecordWithStrategy, tradeRecords });
      //   break;
      default:
        console.log(`未知の戦略: ${strategyKey}`);
        return null;
    }
    
    // 戦略を実行
    return strategies.executeStrategy(strategyKey, params);
  } catch (error) {
    console.error(`戦略の実行中にエラーが発生しました: ${strategyKey} - ${symbol}`, error);
    if (options.postErrorToDiscord) {
      await options.postErrorToDiscord(`戦略の実行中にエラーが発生しました: ${strategyKey} - ${exchange.id} - ${symbol} - ${error.message}`);
    }
    return null;
  }
}

/**
 * アービトラージ戦略を実行する関数
 * @param {Array} exchanges - 取引所オブジェクトの配列
 * @param {String} symbol - 通貨ペア
 * @param {Object} options - オプション
 */
async function runArbitrageStrategy(exchanges, symbol, options = {}) {
  try {
    // configからデフォルトの戦略設定を取得
    const defaultConfig = config.strategies.INTER_EXCHANGE_ARBITRAGE;
    
    if (!defaultConfig || !defaultConfig.enabled) {
      return null;
    }

    // データベースから戦略パラメータを取得
    // アービトラージ戦略は取引所ペアと通貨ペアでパラメータを持つ可能性があるため、exchange.idは使用しない
    const dbParams = await getStrategyParameters('arbitrage', symbol, 'INTER_EXCHANGE_ARBITRAGE');

    const strategyConfig = (() => {
      if (dbParams) {
        // デフォルト設定とデータベースのパラメータをマージ（データベース優先）
        return { ...defaultConfig, ...dbParams };
      } else {
        // DBにパラメータがない場合はデフォルト設定を使用
        // デフォルト設定をDBに保存
        saveStrategyParameters(exchange.id, symbol, strategyKey, defaultConfig);
        return defaultConfig;
      }
    })();
    
    const params = [
      exchanges,
      symbol,
      strategyConfig.minProfitPercent,
      strategyConfig.amount, // データベースまたはconfigから取得したamountを使用
      {
        ...options,
        bitflyerMinTradeAmounts,
        tradePercentage: strategyConfig.tradePercentage, // データベースまたはconfigから取得したtradePercentageを使用
        updateTradeRecord: updateTradeRecordWithStrategy,
        tradeRecords
      }
    ];
    
    return await strategies.executeStrategy('INTER_EXCHANGE_ARBITRAGE', params);
  } catch (error) {
    console.error(`アービトラージ戦略の実行中にエラーが発生しました: ${symbol}`, error);
    if (options.postErrorToDiscord) {
      await options.postErrorToDiscord(`アービトラージ戦略の実行中にエラーが発生しました: ${symbol} - ${error.message}`);
    }
    return null;
  }
}

/**
 * 複数の戦略を実行する関数
 * @param {Object} exchange - 取引所オブジェクト
 * @param {String} symbol - 通貨ペア
 * @param {Object} options - オプション
 */
async function runStrategies(exchange, symbol, options = {}) {
  try {
    // マーケットパラメータを取得
    const params = await getMarketParameters(exchange, symbol);
    if (!params) return;
    
    const { minTradeAmount, pricePrecision, amountPrecision } = params;
    
    // 共通オプションを設定
    const commonOptions = {
      pricePrecision,
      amountPrecision,
      minTradeAmount,
      postOrderToDiscord,
      postErrorToDiscord,
      spreadHistory: options.spreadHistory || {},
      bitflyerMinTradeAmounts
    };
    
    // 各戦略を実行
    const results = [];
    
    // 戦略を実行
    
    // トレンドフォロー戦略
    // 移動平均線戦略: bitflyerではfetchOHLCVがサポートされていないため実行しない
    // runStrategy関数内でパラメータ読み込みを行うため、ここではenabledチェックのみ
    if (config.strategies.MA.enabled && exchange.id !== 'bitflyer') {
      const result = runStrategy('MA', exchange, symbol, commonOptions);
      if (result) results.push(result);
    } else if (config.strategies.MA.enabled && exchange.id === 'bitflyer') {
      console.log(`移動平均線戦略はbitflyerではサポートされていないためスキップします: ${symbol}`);
    }
    
    // MACD戦略: bitflyerではfetchOHLCVがサポートされていないため実行しない
    if (config.strategies.MACD.enabled && exchange.id !== 'bitflyer') {
      const result = runStrategy('MACD', exchange, symbol, commonOptions);
      if (result) results.push(result);
    } else if (config.strategies.MACD.enabled && exchange.id === 'bitflyer') {
      console.log(`MACD戦略はbitflyerではサポートされていないためスキップします: ${symbol}`);
    }
    
    // RSI戦略: bitflyerではfetchOHLCVがサポートされていないため実行しない
    if (config.strategies.RSI.enabled && exchange.id !== 'bitflyer') {
      const result = runStrategy('RSI', exchange, symbol, commonOptions);
      if (result) results.push(result);
    } else if (config.strategies.RSI.enabled && exchange.id === 'bitflyer') {
      console.log(`RSI戦略はbitflyerではサポートされていないためスキップします: ${symbol}`);
    }
    
    // ボリンジャーバンド戦略: bitflyerではfetchOHLCVがサポートされていないため実行しない
    if (config.strategies.BOLLINGER_BANDS.enabled && exchange.id !== 'bitflyer') {
      const result = runStrategy('BOLLINGER_BANDS', exchange, symbol, commonOptions);
      if (result) results.push(result);
    } else if (config.strategies.BOLLINGER_BANDS.enabled && exchange.id === 'bitflyer') {
      console.log(`ボリンジャーバンド戦略はbitflyerではサポートされていないためスキップします: ${symbol}`);
    }
    
    // 逆張り戦略
    // 平均回帰戦略: bitflyerではfetchOHLCVがサポートされていないため実行しない
    if (config.strategies.MEAN_REVERSION.enabled && exchange.id !== 'bitflyer') {
      const result = runStrategy('MEAN_REVERSION', exchange, symbol, commonOptions);
      if (result) results.push(result);
    } else if (config.strategies.MEAN_REVERSION.enabled && exchange.id === 'bitflyer') {
      console.log(`平均回帰戦略はbitflyerではサポートされていないためスキップします: ${symbol}`);
    }
    
    // オシレーター戦略: bitflyerではfetchOHLCVがサポートされていないため実行しない
    if (config.strategies.OSCILLATOR.enabled && exchange.id !== 'bitflyer') {
      const result = runStrategy('OSCILLATOR', exchange, symbol, commonOptions);
      if (result) results.push(result);
    } else if (config.strategies.OSCILLATOR.enabled && exchange.id === 'bitflyer') {
      console.log(`オシレーター戦略はbitflyerではサポートされていないためスキップします: ${symbol}`);
    }
    
    // 高頻度取引戦略
    if (config.strategies.SCALPING.enabled) {
      const result = runStrategy('SCALPING', exchange, symbol, commonOptions);
      if (result) results.push(result);
    }
    
    // 陰陽戦略: bitflyerではfetchOHLCVがサポートされていないため実行しない
    if (config.strategies.INYO.enabled && exchange.id !== 'bitflyer') {
      const result = runStrategy('INYO', exchange, symbol, commonOptions);
      if (result) results.push(result);
    } else if (config.strategies.INYO.enabled && exchange.id === 'bitflyer') {
      console.log(`陰陽戦略はbitflyerではサポートされていないためスキップします: ${symbol}`);
    }
    
    return results;
  } catch (error) {
    console.error(`戦略の実行中にエラーが発生しました: ${symbol} ${exchange.id}`, error);
    postErrorToDiscord(`戦略の実行中にエラーが発生しました: ${symbol} ${exchange.id} - ${error.message}`);
    return [];
  }
}

module.exports = {
  runStrategy,
  runArbitrageStrategy,
  runStrategies
};
