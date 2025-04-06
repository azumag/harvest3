const strategies = require('../strategies');
const { config, bitflyerMinTradeAmounts } = require('./config');
const { updateTradeRecord, tradeRecords } = require('./tradeRecords');
const { postErrorToDiscord, postOrderToDiscord } = require('./notifications');
const { getMarketParameters } = require('./utils');

/**
 * 指定された戦略を実行する関数
 * @param {String} strategyKey - 戦略のキー
 * @param {Object} exchange - 取引所オブジェクト
 * @param {String} symbol - 通貨ペア
 * @param {Object} options - オプション
 */
async function runStrategy(strategyKey, exchange, symbol, options = {}) {
  try {
    const strategyConfig = config.strategies[strategyKey];
    if (!strategyConfig || !strategyConfig.enabled) {
      return null;
    }
    
    // 戦略に応じたパラメータを設定
    const params = [];
    
    // updateTradeRecordに戦略キーを渡すラッパー関数
    const updateTradeRecordWithStrategy = (exchangeId, symbol, amount, price, side) => {
      updateTradeRecord(exchangeId, symbol, amount, price, side, strategyKey);
    };
    
    switch (strategyKey) {
      case 'MA':
        params.push(exchange, symbol, strategyConfig.shortPeriod, strategyConfig.longPeriod, config.amount, { ...options, tradePercentage: config.tradePercentage, updateTradeRecord: updateTradeRecordWithStrategy, tradeRecords });
        break;
      case 'MACD':
        params.push(exchange, symbol, strategyConfig.fastPeriod, strategyConfig.slowPeriod, strategyConfig.signalPeriod, config.amount, { ...options, tradePercentage: config.tradePercentage, updateTradeRecord: updateTradeRecordWithStrategy, tradeRecords });
        break;
      case 'RSI':
        params.push(exchange, symbol, strategyConfig.period, strategyConfig.oversoldThreshold, strategyConfig.overboughtThreshold, config.amount, { ...options, tradePercentage: config.tradePercentage, updateTradeRecord: updateTradeRecordWithStrategy, tradeRecords });
        break;
      case 'BOLLINGER_BANDS':
        params.push(exchange, symbol, strategyConfig.period, strategyConfig.stdDev, config.amount, { ...options, tradePercentage: config.tradePercentage, updateTradeRecord: updateTradeRecordWithStrategy, tradeRecords });
        break;
      case 'MEAN_REVERSION':
        params.push(exchange, symbol, strategyConfig.period, strategyConfig.deviationThreshold, config.amount, { ...options, tradePercentage: config.tradePercentage, updateTradeRecord: updateTradeRecordWithStrategy, tradeRecords });
        break;
      case 'OSCILLATOR':
        params.push(exchange, symbol, strategyConfig.period, strategyConfig.oversoldThreshold, strategyConfig.overboughtThreshold, config.amount, { ...options, tradePercentage: config.tradePercentage, updateTradeRecord: updateTradeRecordWithStrategy, tradeRecords });
        break;
      case 'INTER_EXCHANGE_ARBITRAGE':
        // アービトラージは複数の取引所を必要とするため、別途処理
        return null;
      case 'HFT':
        params.push(exchange, symbol, strategyConfig.interval, strategyConfig.priceThreshold, config.amount, { ...options, tradePercentage: config.tradePercentage, updateTradeRecord: updateTradeRecordWithStrategy, tradeRecords });
        break;
      case 'SCALPING':
        params.push(exchange, symbol, options.spreadHistory || {}, { ...options, tradePercentage: config.tradePercentage, updateTradeRecord: updateTradeRecordWithStrategy, tradeRecords });
        break;
      default:
        console.log(`未知の戦略: ${strategyKey}`);
        return null;
    }
    
    // 戦略を実行
    return await strategies.executeStrategy(strategyKey, params);
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
    const strategyConfig = config.strategies.INTER_EXCHANGE_ARBITRAGE;
    if (!strategyConfig || !strategyConfig.enabled) {
      return null;
    }
    
    // updateTradeRecordに戦略キーを渡すラッパー関数
    const updateTradeRecordWithStrategy = (exchangeId, symbol, amount, price, side) => {
      updateTradeRecord(exchangeId, symbol, amount, price, side, 'INTER_EXCHANGE_ARBITRAGE');
    };
    
    const params = [
      exchanges,
      symbol,
      strategyConfig.minProfitPercent,
      config.amount, // 固定値（tradePercentageが優先される）
      {
        ...options,
        bitflyerMinTradeAmounts,
        tradePercentage: config.tradePercentage,
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
    if (config.strategies.MA.enabled) {
      const result = await runStrategy('MA', exchange, symbol, commonOptions);
      if (result) results.push(result);
    }
    
    if (config.strategies.MACD.enabled) {
      const result = await runStrategy('MACD', exchange, symbol, commonOptions);
      if (result) results.push(result);
    }
    
    if (config.strategies.RSI.enabled) {
      const result = await runStrategy('RSI', exchange, symbol, commonOptions);
      if (result) results.push(result);
    }
    
    if (config.strategies.BOLLINGER_BANDS.enabled) {
      const result = await runStrategy('BOLLINGER_BANDS', exchange, symbol, commonOptions);
      if (result) results.push(result);
    }
    
    // 逆張り戦略
    if (config.strategies.MEAN_REVERSION.enabled) {
      const result = await runStrategy('MEAN_REVERSION', exchange, symbol, commonOptions);
      if (result) results.push(result);
    }

    // オシレーター戦略: bitflyerではfetchOHLCVがサポートされていないため実行しない
    if (config.strategies.OSCILLATOR.enabled && exchange.id !== 'bitflyer') {
      const result = await runStrategy('OSCILLATOR', exchange, symbol, commonOptions);
      if (result) results.push(result);
    } else if (config.strategies.OSCILLATOR.enabled && exchange.id === 'bitflyer') {
      // bitflyerの場合、戦略をスキップしログを出力
      console.log(`オシレーター戦略はbitflyerではサポートされていないためスキップします: ${symbol}`);
      // 必要であればDiscord通知を追加
      // if (postErrorToDiscord) {
      //   await postErrorToDiscord(`[INFO] オシレーター戦略はbitflyerではサポートされていないためスキップします: ${exchange.id} - ${symbol}`);
      // }
    }

    // 高頻度取引戦略
    if (config.strategies.SCALPING.enabled) {
      const result = await runStrategy('SCALPING', exchange, symbol, commonOptions);
      if (result) results.push(result);
    }
    
    return results;
  } catch (error) {
    console.error(`戦略の実行中にエラーが発生しました: ${symbol} ${exchange.id}`, error);
    await postErrorToDiscord(`戦略の実行中にエラーが発生しました: ${symbol} ${exchange.id} - ${error.message}`);
    return [];
  }
}

module.exports = {
  runStrategy,
  runArbitrageStrategy,
  runStrategies
};
