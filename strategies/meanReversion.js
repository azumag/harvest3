/**
 * 逆張り戦略
 */
const { 
  calculateSMA, 
  calculateRSI, 
  calculateBollingerBands 
} = require('./indicators');

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
  try {
    // オプションから値を取得
    const { pricePrecision, amountPrecision, minTradeAmount, postOrderToDiscord } = options;
    
    // 過去のローソク足データを取得
    const ohlcv = await exchange.fetchOHLCV(symbol, '1h', undefined, period + 10);
    
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
    
    // 取引量を計算
    const tradeAmount = Math.max(minTradeAmount, amount);
    const formattedAmount = parseFloat(tradeAmount.toFixed(amountPrecision));
    
    // 買いシグナル: 価格が移動平均線から下に大きく乖離
    const buySignal = deviation <= -deviationThreshold;
    
    // 売りシグナル: 価格が移動平均線から上に大きく乖離
    const sellSignal = deviation >= deviationThreshold;
    
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
      
      if (availableFunds >= currentPrice * formattedAmount) {
        // 買い注文を作成
        await exchange.createMarketBuyOrder(symbol, formattedAmount);
        if (postOrderToDiscord) {
          await postOrderToDiscord(`[平均回帰戦略] 買い注文実行: ${exchange.id} - ${symbol} - 価格: ${currentPrice}, 数量: ${formattedAmount}`);
        }
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
        await postOrderToDiscord(`[平均回帰戦略] 売りシグナル: ${exchange.id} - ${symbol} - 価格: ${currentPrice}, SMA: ${currentSMA}, 乖離率: ${deviation.toFixed(2)}%`);
      }
      
      // 利用可能な資産を確認
      const balance = await exchange.fetchBalance();
      const quoteCurrency = symbol.split('/')[0];
      const availableAsset = balance.free[quoteCurrency];
      
      if (availableAsset >= formattedAmount) {
        // 売り注文を作成
        await exchange.createMarketSellOrder(symbol, formattedAmount);
        if (postOrderToDiscord) {
          await postOrderToDiscord(`[平均回帰戦略] 売り注文実行: ${exchange.id} - ${symbol} - 価格: ${currentPrice}, 数量: ${formattedAmount}`);
        }
      } else {
        console.log(`資産不足のため注文をスキップ: ${symbol} - 必要: ${formattedAmount}, 利用可能: ${availableAsset}`);
        if (postOrderToDiscord) {
          await postOrderToDiscord(`[平均回帰戦略] 資産不足のため売り注文をスキップ: ${exchange.id} - ${symbol} - 必要: ${formattedAmount}, 利用可能: ${availableAsset}`);
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
      await options.postErrorToDiscord(`[平均回帰戦略] エラー: ${exchange.id} - ${symbol} - ${error.message}`);
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
  try {
    // オプションから値を取得
    const { pricePrecision, amountPrecision, minTradeAmount, postOrderToDiscord } = options;
    
    // 過去のローソク足データを取得
    const ohlcv = await exchange.fetchOHLCV(symbol, '1h', undefined, period + 10);
    
    // 終値の配列を作成
    const closes = ohlcv.map(candle => candle[4]);
    
    // RSIを計算
    const rsiValues = calculateRSI(closes, period);
    
    // 最新のRSI値を取得
    const currentRSI = rsiValues[rsiValues.length - 1];
    
    // 現在の価格を取得
    const ticker = await exchange.fetchTicker(symbol);
    const currentPrice = ticker.last;
    
    // 取引量を計算
    const tradeAmount = Math.max(minTradeAmount, amount);
    const formattedAmount = parseFloat(tradeAmount.toFixed(amountPrecision));
    
    // 買いシグナル: RSIが極端に低い（売られすぎ）
    const buySignal = currentRSI <= oversoldThreshold;
    
    // 売りシグナル: RSIが極端に高い（買われすぎ）
    const sellSignal = currentRSI >= overboughtThreshold;
    
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
      
      if (availableFunds >= currentPrice * formattedAmount) {
        // 買い注文を作成
        await exchange.createMarketBuyOrder(symbol, formattedAmount);
        if (postOrderToDiscord) {
          await postOrderToDiscord(`[オシレーター戦略] 買い注文実行: ${exchange.id} - ${symbol} - 価格: ${currentPrice}, 数量: ${formattedAmount}`);
        }
      } else {
        console.log(`資金不足のため注文をスキップ: ${symbol} - 必要: ${currentPrice * formattedAmount}, 利用可能: ${availableFunds}`);
        if (postOrderToDiscord) {
          await postOrderToDiscord(`[オシレーター戦略] 資金不足のため買い注文をスキップ: ${exchange.id} - ${symbol} - 必要: ${currentPrice * formattedAmount}, 利用可能: ${availableFunds}`);
        }
      }
    } else if (sellSignal) {
      // 売りシグナル
      console.log(`オシレーター売りシグナル: ${symbol} - RSI: ${currentRSI} (閾値: ${overboughtThreshold})`);
      if (postOrderToDiscord) {
        await postOrderToDiscord(`[オシレーター戦略] 売りシグナル: ${exchange.id} - ${symbol} - RSI: ${currentRSI} (閾値: ${overboughtThreshold})`);
      }
      
      // 利用可能な資産を確認
      const balance = await exchange.fetchBalance();
      const quoteCurrency = symbol.split('/')[0];
      const availableAsset = balance.free[quoteCurrency];
      
      if (availableAsset >= formattedAmount) {
        // 売り注文を作成
        await exchange.createMarketSellOrder(symbol, formattedAmount);
        if (postOrderToDiscord) {
          await postOrderToDiscord(`[オシレーター戦略] 売り注文実行: ${exchange.id} - ${symbol} - 価格: ${currentPrice}, 数量: ${formattedAmount}`);
        }
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