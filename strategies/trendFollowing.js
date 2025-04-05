/**
 * トレンドフォロー戦略
 */
const {
  calculateSMA,
  calculateEMA,
  calculateMACD,
  calculateRSI,
  calculateBollingerBands
} = require('./indicators');
const strategies = require('./index');

/**
 * 移動平均線クロス戦略
 * 短期移動平均線が長期移動平均線を上抜けたら買い、下抜けたら売り
 * @param {Object} exchange - ccxtの取引所オブジェクト
 * @param {String} symbol - 通貨ペア
 * @param {Number} shortPeriod - 短期移動平均線の期間
 * @param {Number} longPeriod - 長期移動平均線の期間
 * @param {Number} amount - 取引量
 * @param {Object} options - その他のオプション
 */
async function maStrategy(exchange, symbol, shortPeriod = 5, longPeriod = 20, amount, options = {}) {
  try {
    // オプションから値を取得
    const {
      pricePrecision,
      amountPrecision,
      minTradeAmount,
      postOrderToDiscord,
      tradePercentage = 0.02,
      addBuyRecord,
      getSellAmount
    } = options;
    
    // 過去のローソク足データを取得
    const ohlcv = await exchange.fetchOHLCV(symbol, '1h', undefined, longPeriod + 10);
    
    // 終値の配列を作成
    const closes = ohlcv.map(candle => candle[4]);
    
    // 短期と長期の移動平均線を計算
    const shortMA = calculateSMA(closes, shortPeriod);
    const longMA = calculateSMA(closes, longPeriod);
    
    // 最新と1つ前の値を取得
    const currentShortMA = shortMA[shortMA.length - 1];
    const previousShortMA = shortMA[shortMA.length - 2];
    const currentLongMA = longMA[longMA.length - 1];
    const previousLongMA = longMA[longMA.length - 2];
    
    // 現在の価格を取得
    const ticker = await exchange.fetchTicker(symbol);
    const currentPrice = ticker.last;
    
    // クロスを検出
    const crossUp = previousShortMA < previousLongMA && currentShortMA > currentLongMA;
    const crossDown = previousShortMA > previousLongMA && currentShortMA < currentLongMA;
    
    // 注文を作成
    if (crossUp) {
      // 買いシグナル
      console.log(`移動平均線クロス（上抜け）: ${symbol} - 短期MA: ${currentShortMA}, 長期MA: ${currentLongMA}`);
      if (postOrderToDiscord) {
        await postOrderToDiscord(`[MA戦略] 買いシグナル: ${exchange.id} - ${symbol} - 短期MA: ${currentShortMA}, 長期MA: ${currentLongMA}`);
      }
      
      // 利用可能な資金を確認
      const balance = await exchange.fetchBalance();
      const baseCurrency = symbol.split('/')[1];
      const availableFunds = balance.free[baseCurrency];
      
      // 取引量を計算（利用可能資金の割合）
      const maxBuyAmount = (availableFunds * tradePercentage) / currentPrice;
      const tradeAmount = Math.max(minTradeAmount, maxBuyAmount);
      // 精度を考慮して、最小精度以上の値を確保
      let formattedAmount = parseFloat(tradeAmount.toFixed(amountPrecision));
      // 最小精度（0.0001）を下回らないようにする
      formattedAmount = Math.max(formattedAmount, 0.0001);
      
      if (availableFunds >= currentPrice * formattedAmount) {
        // 買い注文を作成
        // 注文数をチェックし、必要に応じて古い注文をキャンセル
        await strategies.orderCheckCancel(exchange, symbol, 30, postOrderToDiscord);
        // 指値注文に変更
        await exchange.createLimitBuyOrder(symbol, formattedAmount, currentPrice);
        // 購入記録を追加
        if (addBuyRecord) {
          addBuyRecord(formattedAmount);
        }
        if (postOrderToDiscord) {
          await postOrderToDiscord(`[MA戦略] 買い注文実行: ${exchange.id} - ${symbol} - 価格: ${currentPrice}, 数量: ${formattedAmount}`);
        }
      } else {
        console.log(`資金不足のため注文をスキップ: ${symbol} - 必要: ${currentPrice * formattedAmount}, 利用可能: ${availableFunds}`);
        if (postOrderToDiscord) {
          await postOrderToDiscord(`[MA戦略] 資金不足のため買い注文をスキップ: ${exchange.id} - ${symbol} - 必要: ${currentPrice * formattedAmount}, 利用可能: ${availableFunds}`);
        }
      }
    } else if (crossDown) {
      // 売りシグナル
      console.log(`移動平均線クロス（下抜け）: ${symbol} - 短期MA: ${currentShortMA}, 長期MA: ${currentLongMA}`);
      if (postOrderToDiscord) {
        await postOrderToDiscord(`[MA戦略] 売りシグナル: ${exchange.id} - ${symbol} - 短期MA: ${currentShortMA}, 長期MA: ${currentLongMA}`);
      }
      
      // 利用可能な資産を確認
      const balance = await exchange.fetchBalance();
      const quoteCurrency = symbol.split('/')[0];
      const availableAsset = balance.free[quoteCurrency];
      
      // 売却可能量を取得
      let sellAmount = availableAsset;
      if (getSellAmount) {
        sellAmount = getSellAmount(availableAsset);
      }
      
      // 精度を考慮して、最小精度以上の値を確保
      let formattedAmount = parseFloat(Math.max(minTradeAmount, sellAmount).toFixed(amountPrecision));
      // 最小精度（0.0001）を下回らないようにする
      formattedAmount = Math.max(formattedAmount, 0.0001);
      
      if (availableAsset >= formattedAmount) {
        // 売り注文を作成
        // 注文数をチェックし、必要に応じて古い注文をキャンセル
        await strategies.orderCheckCancel(exchange, symbol, 30, postOrderToDiscord);
        // 指値注文に変更
        await exchange.createLimitSellOrder(symbol, formattedAmount, currentPrice);
        if (postOrderToDiscord) {
          await postOrderToDiscord(`[MA戦略] 売り注文実行: ${exchange.id} - ${symbol} - 価格: ${currentPrice}, 数量: ${formattedAmount}`);
        }
      } else {
        console.log(`資産不足のため注文をスキップ: ${symbol} - 必要: ${formattedAmount}, 利用可能: ${availableAsset}`);
        if (postOrderToDiscord) {
          await postOrderToDiscord(`[MA戦略] 資産不足のため売り注文をスキップ: ${exchange.id} - ${symbol} - 必要: ${formattedAmount}, 利用可能: ${availableAsset}`);
        }
      }
    } else {
      console.log(`移動平均線クロスなし: ${symbol} - 短期MA: ${currentShortMA}, 長期MA: ${currentLongMA}`);
    }
    
    return {
      strategy: 'MA Cross',
      symbol,
      shortMA: currentShortMA,
      longMA: currentLongMA,
      currentPrice,
      signal: crossUp ? 'buy' : (crossDown ? 'sell' : 'none')
    };
  } catch (error) {
    console.error(`移動平均線戦略でエラーが発生しました: ${symbol}`, error);
    if (options.postErrorToDiscord) {
      await options.postErrorToDiscord(`[MA戦略] エラー: ${exchange.id} - ${symbol} - ${error.message}`);
    }
    return {
      strategy: 'MA Cross',
      symbol,
      error: error.message
    };
  }
}

/**
 * MACD戦略
 * MACDがシグナルラインを上抜けたら買い、下抜けたら売り
 * @param {Object} exchange - ccxtの取引所オブジェクト
 * @param {String} symbol - 通貨ペア
 * @param {Number} fastPeriod - 短期EMAの期間
 * @param {Number} slowPeriod - 長期EMAの期間
 * @param {Number} signalPeriod - シグナルラインの期間
 * @param {Number} amount - 取引量
 * @param {Object} options - その他のオプション
 */
async function macdStrategy(exchange, symbol, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9, amount, options = {}) {
  try {
    // オプションから値を取得
    const {
      pricePrecision,
      amountPrecision,
      minTradeAmount,
      postOrderToDiscord,
      tradePercentage = 0.02,
      addBuyRecord,
      getSellAmount
    } = options;
    
    // 過去のローソク足データを取得
    const ohlcv = await exchange.fetchOHLCV(symbol, '1h', undefined, slowPeriod + signalPeriod + 10);
    
    // 終値の配列を作成
    const closes = ohlcv.map(candle => candle[4]);
    
    // MACDを計算
    const macdData = calculateMACD(closes, fastPeriod, slowPeriod, signalPeriod);
    
    // 最新と1つ前の値を取得
    const currentMACD = macdData.macd[macdData.macd.length - 1];
    const previousMACD = macdData.macd[macdData.macd.length - 2];
    const currentSignal = macdData.signal[macdData.signal.length - 1];
    const previousSignal = macdData.signal[macdData.signal.length - 2];
    
    // 現在の価格を取得
    const ticker = await exchange.fetchTicker(symbol);
    const currentPrice = ticker.last;
    
    // クロスを検出
    const crossUp = previousMACD < previousSignal && currentMACD > currentSignal;
    const crossDown = previousMACD > previousSignal && currentMACD < currentSignal;
    
    // 注文を作成
    if (crossUp) {
      // 買いシグナル
      console.log(`MACDクロス（上抜け）: ${symbol} - MACD: ${currentMACD}, シグナル: ${currentSignal}`);
      if (postOrderToDiscord) {
        await postOrderToDiscord(`[MACD戦略] 買いシグナル: ${exchange.id} - ${symbol} - MACD: ${currentMACD}, シグナル: ${currentSignal}`);
      }
      
      // 利用可能な資金を確認
      const balance = await exchange.fetchBalance();
      const baseCurrency = symbol.split('/')[1];
      const availableFunds = balance.free[baseCurrency];
      
      // 取引量を計算（利用可能資金の割合）
      const maxBuyAmount = (availableFunds * tradePercentage) / currentPrice;
      const tradeAmount = Math.max(minTradeAmount, maxBuyAmount);
      // 精度を考慮して、最小精度以上の値を確保
      let formattedAmount = parseFloat(tradeAmount.toFixed(amountPrecision));
      // 最小精度（0.0001）を下回らないようにする
      formattedAmount = Math.max(formattedAmount, 0.0001);
      
      if (availableFunds >= currentPrice * formattedAmount) {
        // 買い注文を作成
        // 注文数をチェックし、必要に応じて古い注文をキャンセル
        await strategies.orderCheckCancel(exchange, symbol, 30, postOrderToDiscord);
        // 指値注文に変更
        await exchange.createLimitBuyOrder(symbol, formattedAmount, currentPrice);
        // 購入記録を追加
        if (addBuyRecord) {
          addBuyRecord(formattedAmount);
        }
        if (postOrderToDiscord) {
          await postOrderToDiscord(`[MACD戦略] 買い注文実行: ${exchange.id} - ${symbol} - 価格: ${currentPrice}, 数量: ${formattedAmount}`);
        }
      } else {
        console.log(`資金不足のため注文をスキップ: ${symbol} - 必要: ${currentPrice * formattedAmount}, 利用可能: ${availableFunds}`);
        if (postOrderToDiscord) {
          await postOrderToDiscord(`[MACD戦略] 資金不足のため買い注文をスキップ: ${exchange.id} - ${symbol} - 必要: ${currentPrice * formattedAmount}, 利用可能: ${availableFunds}`);
        }
      }
    } else if (crossDown) {
      // 売りシグナル
      console.log(`MACDクロス（下抜け）: ${symbol} - MACD: ${currentMACD}, シグナル: ${currentSignal}`);
      if (postOrderToDiscord) {
        await postOrderToDiscord(`[MACD戦略] 売りシグナル: ${exchange.id} - ${symbol} - MACD: ${currentMACD}, シグナル: ${currentSignal}`);
      }
      
      // 利用可能な資産を確認
      const balance = await exchange.fetchBalance();
      const quoteCurrency = symbol.split('/')[0];
      const availableAsset = balance.free[quoteCurrency];
      
      // 売却可能量を取得
      let sellAmount = availableAsset;
      if (getSellAmount) {
        sellAmount = getSellAmount(availableAsset);
      }
      
      // 精度を考慮して、最小精度以上の値を確保
      let formattedAmount = parseFloat(Math.max(minTradeAmount, sellAmount).toFixed(amountPrecision));
      // 最小精度（0.0001）を下回らないようにする
      formattedAmount = Math.max(formattedAmount, 0.0001);
      
      if (availableAsset >= formattedAmount) {
        // 売り注文を作成
        // 注文数をチェックし、必要に応じて古い注文をキャンセル
        await strategies.orderCheckCancel(exchange, symbol, 30, postOrderToDiscord);
        // 指値注文に変更
        await exchange.createLimitSellOrder(symbol, formattedAmount, currentPrice);
        if (postOrderToDiscord) {
          await postOrderToDiscord(`[MACD戦略] 売り注文実行: ${exchange.id} - ${symbol} - 価格: ${currentPrice}, 数量: ${formattedAmount}`);
        }
      } else {
        console.log(`資産不足のため注文をスキップ: ${symbol} - 必要: ${formattedAmount}, 利用可能: ${availableAsset}`);
        if (postOrderToDiscord) {
          await postOrderToDiscord(`[MACD戦略] 資産不足のため売り注文をスキップ: ${exchange.id} - ${symbol} - 必要: ${formattedAmount}, 利用可能: ${availableAsset}`);
        }
      }
    } else {
      console.log(`MACDクロスなし: ${symbol} - MACD: ${currentMACD}, シグナル: ${currentSignal}`);
    }
    
    return {
      strategy: 'MACD',
      symbol,
      macd: currentMACD,
      signal: currentSignal,
      currentPrice,
      signal: crossUp ? 'buy' : (crossDown ? 'sell' : 'none')
    };
  } catch (error) {
    console.error(`MACD戦略でエラーが発生しました: ${symbol}`, error);
    if (options.postErrorToDiscord) {
      await options.postErrorToDiscord(`[MACD戦略] エラー: ${exchange.id} - ${symbol} - ${error.message}`);
    }
    return {
      strategy: 'MACD',
      symbol,
      error: error.message
    };
  }
}

/**
 * RSI戦略
 * RSIが指定された閾値を下回ったら買い、上回ったら売り
 * @param {Object} exchange - ccxtの取引所オブジェクト
 * @param {String} symbol - 通貨ペア
 * @param {Number} period - RSIの期間
 * @param {Number} oversoldThreshold - 買いシグナルの閾値（デフォルト30）
 * @param {Number} overboughtThreshold - 売りシグナルの閾値（デフォルト70）
 * @param {Number} amount - 取引量
 * @param {Object} options - その他のオプション
 */
async function rsiStrategy(exchange, symbol, period = 14, oversoldThreshold = 30, overboughtThreshold = 70, amount, options = {}) {
  try {
    // オプションから値を取得
    const {
      pricePrecision,
      amountPrecision,
      minTradeAmount,
      postOrderToDiscord,
      tradePercentage = 0.02,
      addBuyRecord,
      getSellAmount
    } = options;
    
    // 過去のローソク足データを取得
    const ohlcv = await exchange.fetchOHLCV(symbol, '1h', undefined, period + 10);
    
    // 終値の配列を作成
    const closes = ohlcv.map(candle => candle[4]);
    
    // RSIを計算
    const rsiValues = calculateRSI(closes, period);
    
    // 最新のRSI値を取得
    const currentRSI = rsiValues[rsiValues.length - 1];
    const previousRSI = rsiValues[rsiValues.length - 2];
    
    // 現在の価格を取得
    const ticker = await exchange.fetchTicker(symbol);
    const currentPrice = ticker.last;
    formattedAmount = Math.max(formattedAmount, 0.0001);
    
    // 買いシグナル: RSIが閾値を下回り、前回のRSIが閾値以上
    const buySignal = currentRSI < oversoldThreshold && previousRSI >= oversoldThreshold;
    
    // 売りシグナル: RSIが閾値を上回り、前回のRSIが閾値以下
    const sellSignal = currentRSI > overboughtThreshold && previousRSI <= overboughtThreshold;
    
    // 注文を作成
    if (buySignal) {
      // 買いシグナル
      console.log(`RSI買いシグナル: ${symbol} - RSI: ${currentRSI} (閾値: ${oversoldThreshold})`);
      if (postOrderToDiscord) {
        await postOrderToDiscord(`[RSI戦略] 買いシグナル: ${exchange.id} - ${symbol} - RSI: ${currentRSI} (閾値: ${oversoldThreshold})`);
      }
      
      // 利用可能な資金を確認
      const balance = await exchange.fetchBalance();
      const baseCurrency = symbol.split('/')[1];
      const availableFunds = balance.free[baseCurrency];
      
      // 取引量を計算（利用可能資金の割合）
      const maxBuyAmount = (availableFunds * tradePercentage) / currentPrice;
      const tradeAmount = Math.max(minTradeAmount, maxBuyAmount);
      // 精度を考慮して、最小精度以上の値を確保
      let formattedAmount = parseFloat(tradeAmount.toFixed(amountPrecision));
      // 最小精度（0.0001）を下回らないようにする
      formattedAmount = Math.max(formattedAmount, 0.0001);
      
      if (availableFunds >= currentPrice * formattedAmount) {
        // 買い注文を作成
        // 注文数をチェックし、必要に応じて古い注文をキャンセル
        await strategies.orderCheckCancel(exchange, symbol, 30, postOrderToDiscord);
        // 指値注文に変更
        await exchange.createLimitBuyOrder(symbol, formattedAmount, currentPrice);
        // 購入記録を追加
        if (addBuyRecord) {
          addBuyRecord(formattedAmount);
        }
        if (postOrderToDiscord) {
          await postOrderToDiscord(`[RSI戦略] 買い注文実行: ${exchange.id} - ${symbol} - 価格: ${currentPrice}, 数量: ${formattedAmount}`);
        }
      } else {
        console.log(`資金不足のため注文をスキップ: ${symbol} - 必要: ${currentPrice * formattedAmount}, 利用可能: ${availableFunds}`);
        if (postOrderToDiscord) {
          await postOrderToDiscord(`[RSI戦略] 資金不足のため買い注文をスキップ: ${exchange.id} - ${symbol} - 必要: ${currentPrice * formattedAmount}, 利用可能: ${availableFunds}`);
        }
      }
    } else if (sellSignal) {
      // 売りシグナル
      console.log(`RSI売りシグナル: ${symbol} - RSI: ${currentRSI} (閾値: ${overboughtThreshold})`);
      if (postOrderToDiscord) {
        await postOrderToDiscord(`[RSI戦略] 売りシグナル: ${exchange.id} - ${symbol} - RSI: ${currentRSI} (閾値: ${overboughtThreshold})`);
      }
      
      // 利用可能な資産を確認
      const balance = await exchange.fetchBalance();
      const quoteCurrency = symbol.split('/')[0];
      const availableAsset = balance.free[quoteCurrency];
      
      // 売却可能量を取得
      let sellAmount = availableAsset;
      if (getSellAmount) {
        sellAmount = getSellAmount(availableAsset);
      }
      
      // 精度を考慮して、最小精度以上の値を確保
      let formattedAmount = parseFloat(Math.max(minTradeAmount, sellAmount).toFixed(amountPrecision));
      // 最小精度（0.0001）を下回らないようにする
      formattedAmount = Math.max(formattedAmount, 0.0001);
      
      if (availableAsset >= formattedAmount) {
        // 売り注文を作成
        // 注文数をチェックし、必要に応じて古い注文をキャンセル
        await strategies.orderCheckCancel(exchange, symbol, 30, postOrderToDiscord);
        // 指値注文に変更
        await exchange.createLimitSellOrder(symbol, formattedAmount, currentPrice);
        if (postOrderToDiscord) {
          await postOrderToDiscord(`[RSI戦略] 売り注文実行: ${exchange.id} - ${symbol} - 価格: ${currentPrice}, 数量: ${formattedAmount}`);
        }
      } else {
        console.log(`資産不足のため注文をスキップ: ${symbol} - 必要: ${formattedAmount}, 利用可能: ${availableAsset}`);
        if (postOrderToDiscord) {
          await postOrderToDiscord(`[RSI戦略] 資産不足のため売り注文をスキップ: ${exchange.id} - ${symbol} - 必要: ${formattedAmount}, 利用可能: ${availableAsset}`);
        }
      }
    } else {
      console.log(`RSIシグナルなし: ${symbol} - RSI: ${currentRSI}`);
    }
    
    return {
      strategy: 'RSI',
      symbol,
      rsi: currentRSI,
      currentPrice,
      signal: buySignal ? 'buy' : (sellSignal ? 'sell' : 'none')
    };
  } catch (error) {
    console.error(`RSI戦略でエラーが発生しました: ${symbol}`, error);
    if (options.postErrorToDiscord) {
      await options.postErrorToDiscord(`[RSI戦略] エラー: ${exchange.id} - ${symbol} - ${error.message}`);
    }
    return {
      strategy: 'RSI',
      symbol,
      error: error.message
    };
  }
}

/**
 * ボリンジャーバンド戦略
 * 価格がバンドの上限に達したら売り、下限に達したら買い
 * @param {Object} exchange - ccxtの取引所オブジェクト
 * @param {String} symbol - 通貨ペア
 * @param {Number} period - 期間
 * @param {Number} stdDev - 標準偏差の乗数
 * @param {Number} amount - 取引量
 * @param {Object} options - その他のオプション
 */
async function bollingerBandsStrategy(exchange, symbol, period = 20, stdDev = 2, amount, options = {}) {
  try {
    // オプションから値を取得
    const {
      pricePrecision,
      amountPrecision,
      minTradeAmount,
      postOrderToDiscord,
      tradePercentage = 0.02,
      addBuyRecord,
      getSellAmount
    } = options;
    
    // 過去のローソク足データを取得
    const ohlcv = await exchange.fetchOHLCV(symbol, '1h', undefined, period + 10);
    
    // 終値の配列を作成
    const closes = ohlcv.map(candle => candle[4]);
    
    // ボリンジャーバンドを計算
    const bands = calculateBollingerBands(closes, period, stdDev);
    
    // 最新の値を取得
    const currentUpper = bands.upper[bands.upper.length - 1];
    const currentMiddle = bands.middle[bands.middle.length - 1];
    const currentLower = bands.lower[bands.lower.length - 1];
    
    // 現在の価格を取得
    const ticker = await exchange.fetchTicker(symbol);
    const currentPrice = ticker.last;
    
    // バンド幅を計算（ボラティリティの指標）
    const bandWidth = (currentUpper - currentLower) / currentMiddle;
    
    // 買いシグナル: 価格がバンドの下限に近づいた場合
    const buySignal = currentPrice <= currentLower * 1.01; // 下限の1%以内
    
    // 売りシグナル: 価格がバンドの上限に近づいた場合
    const sellSignal = currentPrice >= currentUpper * 0.99; // 上限の1%以内
    
    // 注文を作成
    if (buySignal) {
      // 買いシグナル
      console.log(`ボリンジャーバンド買いシグナル: ${symbol} - 価格: ${currentPrice}, 下限: ${currentLower}`);
      if (postOrderToDiscord) {
        await postOrderToDiscord(`[BB戦略] 買いシグナル: ${exchange.id} - ${symbol} - 価格: ${currentPrice}, 下限: ${currentLower}`);
      }
      
      // 利用可能な資金を確認
      const balance = await exchange.fetchBalance();
      const baseCurrency = symbol.split('/')[1];
      const availableFunds = balance.free[baseCurrency];
      
      // 取引量を計算（利用可能資金の割合）
      const maxBuyAmount = (availableFunds * tradePercentage) / currentPrice;
      const tradeAmount = Math.max(minTradeAmount, maxBuyAmount);
      // 精度を考慮して、最小精度以上の値を確保
      let formattedAmount = parseFloat(tradeAmount.toFixed(amountPrecision));
      // 最小精度（0.0001）を下回らないようにする
      formattedAmount = Math.max(formattedAmount, 0.0001);
      
      if (availableFunds >= currentPrice * formattedAmount) {
        // 買い注文を作成
        // 注文数をチェックし、必要に応じて古い注文をキャンセル
        await strategies.orderCheckCancel(exchange, symbol, 30, postOrderToDiscord);
        // 指値注文に変更
        await exchange.createLimitBuyOrder(symbol, formattedAmount, currentPrice);
        // 購入記録を追加
        if (addBuyRecord) {
          addBuyRecord(formattedAmount);
        }
        if (postOrderToDiscord) {
          await postOrderToDiscord(`[BB戦略] 買い注文実行: ${exchange.id} - ${symbol} - 価格: ${currentPrice}, 数量: ${formattedAmount}`);
        }
      } else {
        console.log(`資金不足のため注文をスキップ: ${symbol} - 必要: ${currentPrice * formattedAmount}, 利用可能: ${availableFunds}`);
        if (postOrderToDiscord) {
          await postOrderToDiscord(`[BB戦略] 資金不足のため買い注文をスキップ: ${exchange.id} - ${symbol} - 必要: ${currentPrice * formattedAmount}, 利用可能: ${availableFunds}`);
        }
      }
    } else if (sellSignal) {
      // 売りシグナル
      console.log(`ボリンジャーバンド売りシグナル: ${symbol} - 価格: ${currentPrice}, 上限: ${currentUpper}`);
      if (postOrderToDiscord) {
        await postOrderToDiscord(`[BB戦略] 売りシグナル: ${exchange.id} - ${symbol} - 価格: ${currentPrice}, 上限: ${currentUpper}`);
      }
      
      // 利用可能な資産を確認
      const balance = await exchange.fetchBalance();
      const quoteCurrency = symbol.split('/')[0];
      const availableAsset = balance.free[quoteCurrency];
      
      // 売却可能量を取得
      let sellAmount = availableAsset;
      if (getSellAmount) {
        sellAmount = getSellAmount(availableAsset);
      }
      
      // 精度を考慮して、最小精度以上の値を確保
      let formattedAmount = parseFloat(Math.max(minTradeAmount, sellAmount).toFixed(amountPrecision));
      // 最小精度（0.0001）を下回らないようにする
      formattedAmount = Math.max(formattedAmount, 0.0001);
      
      if (availableAsset >= formattedAmount) {
        // 売り注文を作成
        // 注文数をチェックし、必要に応じて古い注文をキャンセル
        await strategies.orderCheckCancel(exchange, symbol, 30, postOrderToDiscord);
        // 指値注文に変更
        await exchange.createLimitSellOrder(symbol, formattedAmount, currentPrice);
        if (postOrderToDiscord) {
          await postOrderToDiscord(`[BB戦略] 売り注文実行: ${exchange.id} - ${symbol} - 価格: ${currentPrice}, 数量: ${formattedAmount}`);
        }
      } else {
        console.log(`資産不足のため注文をスキップ: ${symbol} - 必要: ${formattedAmount}, 利用可能: ${availableAsset}`);
        if (postOrderToDiscord) {
          await postOrderToDiscord(`[BB戦略] 資産不足のため売り注文をスキップ: ${exchange.id} - ${symbol} - 必要: ${formattedAmount}, 利用可能: ${availableAsset}`);
        }
      }
    } else {
      console.log(`ボリンジャーバンドシグナルなし: ${symbol} - 価格: ${currentPrice}, 上限: ${currentUpper}, 下限: ${currentLower}`);
    }
    
    return {
      strategy: 'Bollinger Bands',
      symbol,
      price: currentPrice,
      upper: currentUpper,
      middle: currentMiddle,
      lower: currentLower,
      bandWidth,
      signal: buySignal ? 'buy' : (sellSignal ? 'sell' : 'none')
    };
  } catch (error) {
    console.error(`ボリンジャーバンド戦略でエラーが発生しました: ${symbol}`, error);
    if (options.postErrorToDiscord) {
      await options.postErrorToDiscord(`[BB戦略] エラー: ${exchange.id} - ${symbol} - ${error.message}`);
    }
    return {
      strategy: 'Bollinger Bands',
      symbol,
      error: error.message
    };
  }
}

module.exports = {
  maStrategy,
  macdStrategy,
  rsiStrategy,
  bollingerBandsStrategy
};