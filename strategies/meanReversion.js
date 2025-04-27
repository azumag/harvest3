/**
 * 逆張り戦略
 */
const {
  calculateSMA,
  calculateRSI,
  calculateBollingerBands,
} = require('./indicators');

// const { formattedAvailableAmount, getRealizedPnL } = require('../src/utils');
// const { addStrategySignal } = require('../src/redisDatabase');
const { formattedAvailableAmount, getRealizedPnL, addSignal, addOrder, fetchOHLCVData } = require('../src/database/manager');

/**
 * 平均回帰戦略
 * 価格が移動平均線から大きく乖離した場合に、平均に戻ると予測して取引
 * @param {Object} exchange - ccxtの取引所オブジェクト
 * @param {String} symbol - 通貨ペア
 * @param {Number} period - 移動平均線の期間
 * @param {Number} deviationThreshold - 乖離率の閾値（%）
 * @param {Number} amount - 取引量
 * @param {Object} options - その他のオプション
 */
async function meanReversionStrategy(exchange, symbol, period = 20, deviationThreshold = 3, amount, options = {}) {
  const strategyKey = 'MEAN_REVERSION';
  try {
    // オプションから値を取得
    const { pricePrecision, amountPrecision, minTradeAmount, postOrderToDiscord, tradePercentage = 0.01, sellPercentage = 0.1, updateTradeRecord, tradeRecords } = options;

    // 過去のローソク足データを取得
    const ohlcv = await fetchOHLCVData(exchange, symbol, '15m', period + 10);
    if (ohlcv.length < period) {
      console.log(`平均回帰戦略のデータが不足しています: ${symbol} ${ohlcv.length}/${period}`);
      return;
    }

    // 終値の配列を作成
    const closes = ohlcv.map(candle => candle[4]);

    // 移動平均線を計算
    const sma = calculateSMA(closes, period);
    const currentSMA = sma[sma.length - 1];

    // 現在の価格を取得
    const ticker = await exchange.fetchTicker(symbol);
    const currentPrice = ticker.last;

    // 乖離率を計算（%）
    const deviation = ((currentPrice - currentSMA) / currentSMA) * 100;

    // 買いシグナル: 価格が移動平均線から下に大きく乖離
    const buySignal = deviation <= -deviationThreshold;

    // 売りシグナル: 価格が移動平均線から上に大きく乖離
    const sellSignal = deviation >= deviationThreshold;

    // シグナルタイプを決定
    const signalType = buySignal ? 'buy' : (sellSignal ? 'sell' : 'none');
    
    // 戦略固有の計算結果
    const strategyResults = {
      sma: currentSMA,
      deviation
    };
    
    // シグナルがある場合のみ保存
    if (signalType !== 'none') {
      // 戦略シグナルを保存
      addSignal(
        exchange,
        symbol,
        strategyKey,
        signalType,
        currentPrice,
        strategyResults
      );
    }

    // 注文を作成
    if (buySignal) {
      // 買いシグナル
      console.log(`平均回帰買いシグナル: ${symbol} - 価格: ${currentPrice}, SMA: ${currentSMA}, 乖離率: ${deviation.toFixed(2)}%`);
      if (postOrderToDiscord) {
        await postOrderToDiscord(`[平均回帰戦略] 買いシグナル: ${exchange.id} - ${symbol} - 価格: ${currentPrice}, SMA: ${currentSMA}, 乖離率: ${deviation.toFixed(2)}%`);
      }

      // 利用可能な資金を確認
      const balance = await exchange.fetchBalance();
      const baseCurrency = symbol.split('/')[1];
      const availableFunds = balance.free[baseCurrency];

      // 損益を取得
      const realizedPnL = await getRealizedPnL(exchange, symbol, 'MEAN_REVERSION')

      // 利用可能な資金の割合に基づいて取引量を計算
      const maxBuyAmount = ((availableFunds * tradePercentage) + realizedPnL) / currentPrice;
      // 取引量を計算（最小取引量と計算した最大取引量の大きい方を使用）
      const tradeAmount = Math.max(minTradeAmount, maxBuyAmount);
      // 精度を考慮して、最小精度以上の値を確保
      let formattedAmount = parseFloat(tradeAmount.toFixed(amountPrecision));
      // 最小精度（0.0001）を下回らないようにする
      formattedAmount = Math.max(formattedAmount, 0.0001);

      if (availableFunds >= currentPrice * formattedAmount) {
        // 買い注文を作成
        // 注文数をチェックし、必要に応じて古い注文をキャンセル
        // await orderCheckCancel(exchange, symbol, config.cancelOrderThreshold, postOrderToDiscord);
        // 指値注文に変更
        const params = { 'post_only': true };
        const order = await exchange.createLimitBuyOrder(symbol, formattedAmount, currentPrice, params);
        if (postOrderToDiscord) {
          postOrderToDiscord(`[平均回帰戦略] 買い注文実行: ${exchange.id} - ${symbol} - 価格: ${currentPrice}, 数量: ${formattedAmount}`);
        }

        // 取引記録を更新
        addOrder(exchange, symbol, strategyKey, 'buy', formattedAmount, currentPrice, order.id, 'limit');
      } else {
        console.log(`資金不足のため注文をスキップ: ${symbol} - 必要: ${currentPrice * formattedAmount}, 利用可能: ${availableFunds}`);
        if (postOrderToDiscord) {
          await postOrderToDiscord(`[平均回帰戦略] 資金不足のため買い注文をスキップ: ${exchange.id} - ${symbol} - 必要: ${currentPrice * formattedAmount}, 利用可能: ${availableFunds}`);
        }
      }
    } else if (sellSignal) {
      // 売りシグナル
      console.log(`平均回帰売りシグナル: ${symbol} - 価格: ${currentPrice}, SMA: ${currentSMA}, 乖離率: ${deviation.toFixed(2)}%`);
      if (postOrderToDiscord) {
        postOrderToDiscord(`[平均回帰戦略] 売りシグナル: ${exchange.id} - ${symbol} - 価格: ${currentPrice}, SMA: ${currentSMA}, 乖離率: ${deviation.toFixed(2)}%`);
      }

      // 利用可能な資産を確認
      const balance = await exchange.fetchBalance();
      const quoteCurrency = symbol.split('/')[0];
      const availableAsset = balance.free[quoteCurrency];

      const formattedAmount = await formattedAvailableAmount(exchange, symbol, 'MEAN_REVERSION', amountPrecision);

      if (formattedAmount < minTradeAmount) {
        console.log(`調整後の売却量が最小取引量より小さいため、売り注文は発注しません: ${symbol} - 調整後: ${formattedAmount}, 最小: ${minTradeAmount}`);
        if (postOrderToDiscord) {
          postOrderToDiscord(`[平均回帰戦略] 調整後の売却量が最小取引量より小さいため、売り注文をスキップ: ${exchange.id} - ${symbol} - 調整後: ${formattedAmount}, 最小: ${minTradeAmount}`);
        }
        return {
          strategy: 'Mean Reversion',
          symbol,
          price: currentPrice,
          sma: currentSMA,
          deviation,
          signal: 'none',
          reason: 'adjusted amount below minimum trade amount'
        };
      }
      
      if (availableAsset >= formattedAmount && formattedAmount > 0) {
        // 売り注文を作成
        // 注文数をチェックし、必要に応じて古い注文をキャンセル
        // await orderCheckCancel(exchange, symbol, config.cancelOrderThreshold, postOrderToDiscord);
        // 指値注文に変更
        const params = { 'post_only': true };
        const order = await exchange.createLimitSellOrder(symbol, formattedAmount, currentPrice, params);
        if (postOrderToDiscord) {
          postOrderToDiscord(`[平均回帰戦略] 売り注文実行: ${exchange.id} - ${symbol} - 価格: ${currentPrice}, 数量: ${formattedAmount}`);
        }

        addOrder(exchange, symbol, strategyKey, 'sell', formattedAmount, currentPrice, order.id, 'limit');
      } else {
        console.log(`資産不足のため注文をスキップ: ${symbol} - 必要: ${formattedAmount}, 利用可能: ${availableAsset}`);
        if (postOrderToDiscord) {
          postOrderToDiscord(`[平均回帰戦略] 資産不足のため売り注文をスキップ: ${exchange.id} - ${symbol} - 必要: ${formattedAmount}, 利用可能: ${availableAsset}`);
        }
      }
    } else {
      console.log(`平均回帰シグナルなし: ${symbol} - 価格: ${currentPrice}, SMA: ${currentSMA}, 乖離率: ${deviation.toFixed(2)}%`);
    }

    return {
      strategy: 'Mean Reversion',
      symbol,
      price: currentPrice,
      sma: currentSMA,
      deviation,
      signal: buySignal ? 'buy' : (sellSignal ? 'sell' : 'none')
    };
  } catch (error) {
    console.error(`平均回帰戦略でエラーが発生しました: ${symbol}`, error);
    if (options.postErrorToDiscord) {
      options.postErrorToDiscord(`[平均回帰戦略] エラー: ${exchange.id} - ${symbol} - ${error.message}`);
    }
    return {
      strategy: 'Mean Reversion',
      symbol,
      error: error.message
    };
  }
}

/**
 * オシレーター系指標を利用した逆張り戦略
 * RSIが極端な値を示した場合に、反転を予測して取引
 * @param {Object} exchange - ccxtの取引所オブジェクト
 * @param {String} symbol - 通貨ペア
 * @param {Number} period - RSIの期間
 * @param {Number} oversoldThreshold - 買いシグナルの閾値（デフォルト20）
 * @param {Number} overboughtThreshold - 売りシグナルの閾値（デフォルト80）
 * @param {Number} amount - 取引量
 * @param {Object} options - その他のオプション
 */
async function oscillatorStrategy(exchange, symbol, period = 14, oversoldThreshold = 20, overboughtThreshold = 80, amount, options = {}) {
  const strategyKey = 'OSCILLATOR';
  try {
    // オプションから値を取得
    const { pricePrecision, amountPrecision, minTradeAmount, postOrderToDiscord, tradePercentage = 0.01, sellPercentage = 0.1, updateTradeRecord, tradeRecords } = options;

    // 過去のローソク足データを取得
    const ohlcv = await fetchOHLCVData(exchange, symbol, '15m', period + 10);
    if (ohlcv.length < period) {
      return;
    }

    // 終値の配列を作成
    const closes = ohlcv.map(candle => candle[4]);

    // RSIを計算
    const rsiValues = calculateRSI(closes, period);

    // 最新のRSI値を取得
    const currentRSI = rsiValues[rsiValues.length - 1];

    // 現在の価格を取得
    const ticker = await exchange.fetchTicker(symbol);
    const currentPrice = ticker.last;

    // 買いシグナル: RSIが極端に低い（売られすぎ）
    const buySignal = currentRSI <= oversoldThreshold;

    // 売りシグナル: RSIが極端に高い（買われすぎ）
    const sellSignal = currentRSI >= overboughtThreshold;

    // シグナルタイプを決定
    const signalType = buySignal ? 'buy' : (sellSignal ? 'sell' : 'none');
    
    // 戦略固有の計算結果
    const strategyResults = {
      rsi: currentRSI,
      oversoldThreshold,
      overboughtThreshold
    };
    
    // シグナルがある場合のみ保存
    if (signalType !== 'none') {
      // 戦略シグナルを保存
      addSignal(
        exchange,
        symbol,
        strategyKey,
        signalType,
        currentPrice,
        strategyResults
      );
    }

    // 注文を作成
    if (buySignal) {
      // 買いシグナル
      console.log(`オシレーター買いシグナル: ${symbol} - RSI: ${currentRSI} (閾値: ${oversoldThreshold})`);
      if (postOrderToDiscord) {
        await postOrderToDiscord(`[オシレーター戦略] 買いシグナル: ${exchange.id} - ${symbol} - RSI: ${currentRSI} (閾値: ${oversoldThreshold})`);
      }

      // 利用可能な資金を確認
      const balance = await exchange.fetchBalance();
      const baseCurrency = symbol.split('/')[1];
      const availableFunds = balance.free[baseCurrency];

      const realizedPnL = await getRealizedPnL(exchange, symbol, 'OSCILLATOR')

      // 利用可能な資金の割合に基づいて取引量を計算
      const maxBuyAmount = ((availableFunds * tradePercentage) + realizedPnL) / currentPrice;
      // 取引量を計算（最小取引量と計算した最大取引量の大きい方を使用）
      const tradeAmount = Math.max(minTradeAmount, maxBuyAmount);
      // 精度を考慮して、最小精度以上の値を確保
      let formattedAmount = parseFloat(tradeAmount.toFixed(amountPrecision));
      // 最小精度（0.0001）を下回らないようにする
      formattedAmount = Math.max(formattedAmount, 0.0001);

      if (availableFunds >= currentPrice * formattedAmount) {
        // 買い注文を作成
        // 注文数をチェックし、必要に応じて古い注文をキャンセル
        // await orderCheckCancel(exchange, symbol, config.cancelOrderThreshold, postOrderToDiscord);
        // 指値注文に変更
        const params = { 'post_only': true };
        const order = await exchange.createLimitBuyOrder(symbol, formattedAmount, currentPrice, params);
        if (postOrderToDiscord) {
          await postOrderToDiscord(`[オシレーター戦略] 買い注文実行: ${exchange.id} - ${symbol} - 価格: ${currentPrice}, 数量: ${formattedAmount}`);
        }

        // 取引記録を更新
        addOrder(exchange, symbol, strategyKey, 'buy', formattedAmount, currentPrice, order.id, 'limit');
      } else {
        console.log(`資金不足のため注文をスキップ: ${symbol} - 必要: ${currentPrice * formattedAmount}, 利用可能: ${availableFunds}`);
        if (postOrderToDiscord) {
          postOrderToDiscord(`[オシレーター戦略] 資金不足のため買い注文をスキップ: ${exchange.id} - ${symbol} - 必要: ${currentPrice * formattedAmount}, 利用可能: ${availableFunds}`);
        }
      }
    } else if (sellSignal) {
      // 売りシグナル
      console.log(`オシレーター売りシグナル: ${symbol} - RSI: ${currentRSI} (閾値: ${overboughtThreshold})`);
      if (postOrderToDiscord) {
        postOrderToDiscord(`[オシレーター戦略] 売りシグナル: ${exchange.id} - ${symbol} - RSI: ${currentRSI} (閾値: ${overboughtThreshold})`);
      }

      // 利用可能な資産を確認
      const balance = await exchange.fetchBalance();
      const quoteCurrency = symbol.split('/')[0];
      const availableAsset = balance.free[quoteCurrency];

      // 取引記録から買った量を取得
      // tradeRecordsパラメータを追加し、awaitを使用
      const formattedAmount = await formattedAvailableAmount(exchange, symbol, 'OSCILLATOR', amountPrecision);
      
      if (availableAsset >= formattedAmount) {
        // 売り注文を作成
        // 注文数をチェックし、必要に応じて古い注文をキャンセル
        // await orderCheckCancel(exchange, symbol, config.cancelOrderThreshold, postOrderToDiscord);
        // 指値注文に変更
        const params = { 'post_only': true };
        const order = await exchange.createLimitSellOrder(symbol, formattedAmount, currentPrice, params);
        if (postOrderToDiscord) {
          await postOrderToDiscord(`[オシレーター戦略] 売り注文実行: ${exchange.id} - ${symbol} - 価格: ${currentPrice}, 数量: ${formattedAmount}`);
        }

        // 取引記録を更新
        addOrder(exchange, symbol, strategyKey, 'sell', formattedAmount, currentPrice, order.id, 'limit');
      } else {
        console.log(`資産不足のため注文をスキップ: ${symbol} - 必要: ${formattedAmount}, 利用可能: ${availableAsset}`);
        if (postOrderToDiscord) {
          await postOrderToDiscord(`[オシレーター戦略] 資産不足のため売り注文をスキップ: ${exchange.id} - ${symbol} - 必要: ${formattedAmount}, 利用可能: ${availableAsset}`);
        }
      }
    } else {
      console.log(`オシレーターシグナルなし: ${symbol} - RSI: ${currentRSI}`);
    }

    return {
      strategy: 'Oscillator',
      symbol,
      rsi: currentRSI,
      currentPrice,
      signal: buySignal ? 'buy' : (sellSignal ? 'sell' : 'none')
    };
  } catch (error) {
    console.error(`オシレーター戦略でエラーが発生しました: ${symbol}`, error);
    if (options.postErrorToDiscord) {
      await options.postErrorToDiscord(`[オシレーター戦略] エラー: ${exchange.id} - ${symbol} - ${error.message}`);
    }
    return {
      strategy: 'Oscillator',
      symbol,
      error: error.message
    };
  }
}

module.exports = {
  meanReversionStrategy,
  oscillatorStrategy
};
