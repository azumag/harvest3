/**
 * トレンドフォロー戦略
 */
const {
  calculateSMA,
  calculateEMA,
  calculateMACD,
  calculateRSI,
  calculateBollingerBands,
} = require('../common/indicators');

const { formattedAvailableAmount, getRealizedPnL, addSignal} = require('../database/manager');
const { addOrder, fetchOHLCVData } = require('../database/manager');

const { postOrderToDiscord, postErrorToDiscord } = require('../common/notifications');

const { checkBuyOrderAllowance } = require('../common/utils');

/**
 * 移動平均線クロス戦略
 * 短期移動平均線が長期移動平均線を上抜けたら買い、下抜けたら売り
 */
async function maStrategy(exchange, symbol, strategyKey, config, marketParameters) {

  const { tradePercentage } = config;
  const { shortPeriod = 5, longPeriod = 20, amount, ohlcvInterval } = config;
  const { amountPrecision, minTradeAmount, } = marketParameters;

  try {

    // 過去のローソク足データを取得
    const ohlcv = await fetchOHLCVData(exchange, symbol, ohlcvInterval, longPeriod + 10);
    if (ohlcv.length < longPeriod) {
      return;
    }
    
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
    
    // 取引量は後で利用可能な資金に基づいて計算するため、ここでは計算しない
    
    // クロスを検出
    const crossUp = previousShortMA < previousLongMA && currentShortMA > currentLongMA;
    const crossDown = previousShortMA > previousLongMA && currentShortMA < currentLongMA;

    // シグナルタイプを決定
    const signalType = crossUp ? 'buy' : (crossDown ? 'sell' : 'none');
    
    // 戦略固有の計算結果
    const strategyResults = {
      shortMA: currentShortMA,
      longMA: currentLongMA
    };
    
    // シグナルがある場合のみ保存
    if (signalType !== 'none') {
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
    if (crossUp) {
      // 買いシグナル
      console.log(`移動平均線クロス（上抜け）: ${symbol} - 短期MA: ${currentShortMA}, 長期MA: ${currentLongMA}`);
      if (postOrderToDiscord) {
        postOrderToDiscord(`[MA戦略] 買いシグナル: ${exchange.id} - ${symbol} - 短期MA: ${currentShortMA}, 長期MA: ${currentLongMA}`);
      }
      
      // 利用可能な資金を確認
      const balance = await exchange.fetchBalance();
      const baseCurrency = symbol.split('/')[1];
      const availableFunds = balance.free[baseCurrency];

      const realizedPnL = await getRealizedPnL(exchange, symbol, strategyKey)
      
      // 利用可能な資金の割合に基づいて取引量を計算
      const maxBuyAmount = ((availableFunds * tradePercentage) + realizedPnL) / currentPrice;
      // 取引量を計算（最小取引量と計算した最大取引量の大きい方を使用）
      const tradeAmount = Math.max(minTradeAmount, maxBuyAmount);
      // 精度を考慮して、最小精度以上の値を確保
      let formattedAmount = parseFloat(tradeAmount.toFixed(amountPrecision));
      // 最小精度（0.0001）を下回らないようにする
      formattedAmount = Math.max(formattedAmount, 0.0001);
      
      // 買い注文が許可されるかチェック
      const allowanceCheck = await checkBuyOrderAllowance(
        exchange, 
        symbol, 
        strategyKey, 
        currentPrice, 
        formattedAmount, 
        availableFunds, 
        tradePercentage, 
        realizedPnL,
        minTradeAmount
      );

      if (allowanceCheck.allowed) {
        // 買い注文を作成
        const params = { 'post_only': true };
        const order = await exchange.createLimitBuyOrder(symbol, formattedAmount, currentPrice, params);
        if (postOrderToDiscord) {
          postOrderToDiscord(`[MA戦略] 買い注文実行: ${exchange.id} - ${symbol} - 価格: ${currentPrice}, 数量: ${formattedAmount}`);
        }
        
        addOrder(exchange.id, symbol, strategyKey, 'buy', formattedAmount, currentPrice, order.id, 'limit');
      } else {
        console.log(allowanceCheck.reason);
        if (postOrderToDiscord) {
          await postOrderToDiscord(`[MA戦略] ${allowanceCheck.reason}`);
        }
      }
    } else if (crossDown) {
      // 売りシグナル
      console.log(`移動平均線クロス（下抜け）: ${symbol} - 短期MA: ${currentShortMA}, 長期MA: ${currentLongMA}`);
      if (postOrderToDiscord) {
        postOrderToDiscord(`[MA戦略] 売りシグナル: ${exchange.id} - ${symbol} - 短期MA: ${currentShortMA}, 長期MA: ${currentLongMA}`);
      }
      
      // 利用可能な資産を確認
      const balance = await exchange.fetchBalance();
      const quoteCurrency = symbol.split('/')[0];
      const availableAsset = balance.free[quoteCurrency];

      // 取引記録から買った量を取得
      // tradeRecordsパラメータを追加し、awaitを使用
      const formattedAmount = await formattedAvailableAmount(exchange, symbol, strategyKey, amountPrecision);

      if (availableAsset >= formattedAmount && formattedAmount > 0) {
        // 売り注文を作成
        // 注文数をチェックし、必要に応じて古い注文をキャンセル
        // await orderCheckCancel(exchange, symbol, config.cancelOrderThreshold, postOrderToDiscord);
        // 指値注文に変更
        const order = await exchange.createLimitSellOrder(symbol, formattedAmount, currentPrice, { 'post_only': true });
        if (postOrderToDiscord) {
          postOrderToDiscord(`[MA戦略] 売り注文実行: ${exchange.id} - ${symbol} - 価格: ${currentPrice}, 数量: ${formattedAmount}`);
        }
        
        // 取引記録を更新
        addOrder(exchange.id, symbol, strategyKey, 'sell', formattedAmount, currentPrice, order.id, 'limit');
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
    if (postErrorToDiscord) {
      await postErrorToDiscord(`[MA戦略] エラー: ${exchange.id} - ${symbol} - ${error.message}`);
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
 */
async function macdStrategy(exchange, symbol, strategyKey, config, marketParameters) {

  const { tradePercentage } = config;
  const { fastPeriod = 12, slowPeriod = 26, signalPeriod = 9, amount, ohlcvInterval } = config;
  const { pricePrecision, amountPrecision, minTradeAmount, } = marketParameters;

  try {
    // オプションから値を取得

    // 過去のローソク足データを取得
    const ohlcv = await fetchOHLCVData(exchange, symbol, ohlcvInterval, slowPeriod + signalPeriod + 10);
    if (ohlcv.length < slowPeriod+signalPeriod) {
      return;
    }
    
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
    
    // 取引量は後で利用可能な資金に基づいて計算するため、ここでは計算しない
    
    // クロスを検出
    const crossUp = previousMACD < previousSignal && currentMACD > currentSignal;
    const crossDown = previousMACD > previousSignal && currentMACD < currentSignal;
    
    // シグナルタイプを決定
    const signalType = crossUp ? 'buy' : (crossDown ? 'sell' : 'none');
    
    // 戦略固有の計算結果
    const strategyResults = {
      macd: currentMACD,
      signal: currentSignal
    };
    
    // シグナルがある場合のみ保存
    if (signalType !== 'none') {
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

      const realizedPnL = await getRealizedPnL(exchange, symbol, strategyKey);
      
      // 利用可能な資金の割合に基づいて取引量を計算
      const maxBuyAmount = ((availableFunds * tradePercentage) + realizedPnL) / currentPrice;
      // 取引量を計算（最小取引量と計算した最大取引量の大きい方を使用）
      const tradeAmount = Math.max(minTradeAmount, maxBuyAmount);
      // 精度を考慮して、最小精度以上の値を確保
      let formattedAmount = parseFloat(tradeAmount.toFixed(amountPrecision));
      // 最小精度（0.0001）を下回らないようにする
      formattedAmount = Math.max(formattedAmount, 0.0001);
      
      // 買い注文が許可されるかチェック
      const allowanceCheck = await checkBuyOrderAllowance(
        exchange, 
        symbol, 
        strategyKey, 
        currentPrice, 
        formattedAmount, 
        availableFunds, 
        tradePercentage, 
        realizedPnL,
        minTradeAmount
      );

      if (allowanceCheck.allowed) {
        // 買い注文を作成
        const params = { 'post_only': true };
        const order = await exchange.createLimitBuyOrder(symbol, formattedAmount, currentPrice, params);
        if (postOrderToDiscord) {
          await postOrderToDiscord(`[MACD戦略] 買い注文実行: ${exchange.id} - ${symbol} - 価格: ${currentPrice}, 数量: ${formattedAmount}`);
        }
        
        addOrder(exchange.id, symbol, strategyKey, 'buy', formattedAmount, currentPrice, order.id, 'limit');
      } else {
        console.log(allowanceCheck.reason);
        if (postOrderToDiscord) {
          await postOrderToDiscord(`[MACD戦略] ${allowanceCheck.reason}`);
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

      // 取引記録から買った量を取得
      // tradeRecordsパラメータを追加し、awaitを使用
      const formattedAmount = await formattedAvailableAmount(exchange, symbol, strategyKey, amountPrecision);

      if (availableAsset >= formattedAmount && formattedAmount > 0) {
        // 売り注文を作成
        // 注文数をチェックし、必要に応じて古い注文をキャンセル
        // await orderCheckCancel(exchange, symbol, config.cancelOrderThreshold, postOrderToDiscord);
        // 指値注文に変更
        const order = await exchange.createLimitSellOrder(symbol, formattedAmount, currentPrice, { 'post_only': true });
        if (postOrderToDiscord) {
          postOrderToDiscord(`[MACD戦略] 売り注文実行: ${exchange.id} - ${symbol} - 価格: ${currentPrice}, 数量: ${formattedAmount}`);
        }
        
        addOrder(exchange.id, symbol, strategyKey, 'sell', formattedAmount, currentPrice, order.id, 'limit');
      } else {
        console.log(`資産不足のため注文をスキップ: ${symbol} - 必要: ${formattedAmount}, 利用可能: ${availableAsset}`);
        if (postOrderToDiscord) {
          postOrderToDiscord(`[MACD戦略] 資産不足のため売り注文をスキップ: ${exchange.id} - ${symbol} - 必要: ${formattedAmount}, 利用可能: ${availableAsset}`);
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
    if (postErrorToDiscord) {
      await postErrorToDiscord(`[MACD戦略] エラー: ${exchange.id} - ${symbol} - ${error.message}`);
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
 */
async function rsiStrategy(exchange, symbol, strategyKey, config, marketParameters) {
  const { tradePercentage } = config; 
  const { period = 14, oversoldThreshold = 30, overboughtThreshold = 70, amount, ohlcvInterval } = config;
  const { pricePrecision, amountPrecision, minTradeAmount } = marketParameters;
  try {

    // 過去のローソク足データを取得
    const ohlcv = await fetchOHLCVData(exchange, symbol, ohlcvInterval, period + 10);
    if (ohlcv.length < period) {
      return;
    }
    
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
    
    // 取引量は後で利用可能な資金に基づいて計算するため、ここでは計算しない
    
    // 買いシグナル: RSIが閾値を下回り、前回のRSIが閾値以上
    const buySignal = currentRSI < oversoldThreshold && previousRSI >= oversoldThreshold;
    
    // 売りシグナル: RSIが閾値を上回り、前回のRSIが閾値以下
    const sellSignal = currentRSI > overboughtThreshold && previousRSI <= overboughtThreshold;
    
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
      console.log(`RSI買いシグナル: ${symbol} - RSI: ${currentRSI} (閾値: ${oversoldThreshold})`);
      if (postOrderToDiscord) {
        await postOrderToDiscord(`[RSI戦略] 買いシグナル: ${exchange.id} - ${symbol} - RSI: ${currentRSI} (閾値: ${oversoldThreshold})`);
      }
      
      // 利用可能な資金を確認
      const balance = await exchange.fetchBalance();
      const baseCurrency = symbol.split('/')[1];
      const availableFunds = balance.free[baseCurrency];

      const realizedPnL = await getRealizedPnL(exchange, symbol, strategyKey)
      
      // 利用可能な資金の割合に基づいて取引量を計算
      const maxBuyAmount = ((availableFunds * tradePercentage) + realizedPnL) / currentPrice;
      // 取引量を計算（最小取引量と計算した最大取引量の大きい方を使用）
      const tradeAmount = Math.max(minTradeAmount, maxBuyAmount);
      // 精度を考慮して、最小精度以上の値を確保
      let formattedAmount = parseFloat(tradeAmount.toFixed(amountPrecision));
      // 最小精度（0.0001）を下回らないようにする
      formattedAmount = Math.max(formattedAmount, 0.0001);
      
      // 買い注文が許可されるかチェック
      const allowanceCheck = await checkBuyOrderAllowance(
        exchange, 
        symbol, 
        strategyKey, 
        currentPrice, 
        formattedAmount, 
        availableFunds, 
        tradePercentage, 
        realizedPnL,
        minTradeAmount
      );

      if (allowanceCheck.allowed) {
        // 買い注文を作成
        const params = { 'post_only': true };
        const order = await exchange.createLimitBuyOrder(symbol, formattedAmount, currentPrice, params);
        if (postOrderToDiscord) {
          postOrderToDiscord(`[RSI戦略] 買い注文実行: ${exchange.id} - ${symbol} - 価格: ${currentPrice}, 数量: ${formattedAmount}`);
        }
        
        addOrder(exchange.id, symbol, strategyKey, 'buy', formattedAmount, currentPrice, order.id, 'limit');
      } else {
        console.log(allowanceCheck.reason);
        if (postOrderToDiscord) {
          await postOrderToDiscord(`[RSI戦略] ${allowanceCheck.reason}`);
        }
      }
    } else if (sellSignal) {
      // 売りシグナル
      console.log(`RSI売りシグナル: ${symbol} - RSI: ${currentRSI} (閾値: ${overboughtThreshold})`);
      if (postOrderToDiscord) {
        postOrderToDiscord(`[RSI戦略] 売りシグナル: ${exchange.id} - ${symbol} - RSI: ${currentRSI} (閾値: ${overboughtThreshold})`);
      }
      
      // 利用可能な資産を確認
      const balance = await exchange.fetchBalance();
      const quoteCurrency = symbol.split('/')[0];
      const availableAsset = balance.free[quoteCurrency];

      // 取引記録から買った量を取得
      // tradeRecordsパラメータを追加し、awaitを使用
      const formattedAmount = await formattedAvailableAmount(exchange, symbol, strategyKey, amountPrecision);
      
      if (availableAsset >= formattedAmount && formattedAmount > 0) {
        // 売り注文を作成
        // 注文数をチェックし、必要に応じて古い注文をキャンセル
        // await orderCheckCancel(exchange, symbol, config.cancelOrderThreshold, postOrderToDiscord);
        // 指値注文に変更
        const order = await exchange.createLimitSellOrder(symbol, formattedAmount, currentPrice, { 'post_only': true });
        if (postOrderToDiscord) {
          postOrderToDiscord(`[RSI戦略] 売り注文実行: ${exchange.id} - ${symbol} - 価格: ${currentPrice}, 数量: ${formattedAmount}`);
        }
        
        addOrder(exchange.id, symbol, strategyKey, 'sell', formattedAmount, currentPrice, order.id, 'limit');
      } else {
        console.log(`資産不足のため注文をスキップ: ${symbol} - 必要: ${formattedAmount}, 利用可能: ${availableAsset}`);
        if (postOrderToDiscord) {
          postOrderToDiscord(`[RSI戦略] 資産不足のため売り注文をスキップ: ${exchange.id} - ${symbol} - 必要: ${formattedAmount}, 利用可能: ${availableAsset}`);
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
    if (postErrorToDiscord) {
      await postErrorToDiscord(`[RSI戦略] エラー: ${exchange.id} - ${symbol} - ${error.message}`);
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
 */
async function bollingerBandsStrategy(exchange, symbol, strategyKey, config, marketParameters) {

  const { tradePercentage } = config;
  const { period = 20, stdDev = 2, amount, ohlcvInterval } = config;
  const { pricePrecision, amountPrecision, minTradeAmount, } = marketParameters;

  try {

    // 過去のローソク足データを取得
    const ohlcv = await fetchOHLCVData(exchange, symbol, ohlcvInterval, period + 10);
    if (ohlcv.length < period) {
      return;
    }
    
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
    
    // 取引量は後で利用可能な資金に基づいて計算するため、ここでは計算しない
    
    // バンド幅を計算（ボラティリティの指標）
    const bandWidth = (currentUpper - currentLower) / currentMiddle;
    
    // 買いシグナル: 価格がバンドの下限に近づいた場合
    const buySignal = currentPrice <= currentLower * 1.01; // 下限の1%以内
    
    // 売りシグナル: 価格がバンドの上限に近づいた場合
    const sellSignal = currentPrice >= currentUpper * 0.99; // 上限の1%以内
    
    // シグナルタイプを決定
    const signalType = buySignal ? 'buy' : (sellSignal ? 'sell' : 'none');
    
    // 戦略固有の計算結果
    const strategyResults = {
      upper: currentUpper,
      middle: currentMiddle,
      lower: currentLower,
      bandWidth
    };
    
    // シグナルがある場合のみ保存
    if (signalType !== 'none') {
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
      console.log(`ボリンジャーバンド買いシグナル: ${symbol} - 価格: ${currentPrice}, 下限: ${currentLower}`);
      if (postOrderToDiscord) {
        postOrderToDiscord(`[BB戦略] 買いシグナル: ${exchange.id} - ${symbol} - 価格: ${currentPrice}, 下限: ${currentLower}`);
      }
      
      // 利用可能な資金を確認
      const balance = await exchange.fetchBalance();
      const baseCurrency = symbol.split('/')[1];
      const availableFunds = balance.free[baseCurrency];

      const realizedPnL = await getRealizedPnL(exchange, symbol, strategyKey)
      
      // 利用可能な資金の割合に基づいて取引量を計算
      // const maxBuyAmount = availableFunds * tradePercentage / currentPrice;
      const maxBuyAmount = ((availableFunds * tradePercentage) + realizedPnL) / currentPrice;
      // 取引量を計算（最小取引量と計算した最大取引量の大きい方を使用）
      const tradeAmount = Math.max(minTradeAmount, maxBuyAmount);
      // 精度を考慮して、最小精度以上の値を確保
      let formattedAmount = parseFloat(tradeAmount.toFixed(amountPrecision));
      // 最小精度（0.0001）を下回らないようにする
      formattedAmount = Math.max(formattedAmount, 0.0001);
      
      const allowanceCheck = await checkBuyOrderAllowance(
        exchange, 
        symbol, 
        strategyKey, 
        currentPrice, 
        formattedAmount, 
        availableFunds, 
        tradePercentage, 
        realizedPnL,
        minTradeAmount
      );

      if (allowanceCheck.allowed) {
        // 買い注文を作成
        const params = { 'post_only': true };
        const order = await exchange.createLimitBuyOrder(symbol, formattedAmount, currentPrice, params);
        if (postOrderToDiscord) {
          postOrderToDiscord(`[BB戦略] 買い注文実行: ${exchange.id} - ${symbol} - 価格: ${currentPrice}, 数量: ${formattedAmount}`);
        }
        
        // 取引記録を更新
        addOrder(exchange.id, symbol, strategyKey, 'buy', formattedAmount, currentPrice, order.id, 'limit');
      } else {
        console.log(allowanceCheck.reason);
        if (postOrderToDiscord) {
          postOrderToDiscord(`[BB戦略] ${allowanceCheck.reason}`);
        }
      }
    } else if (sellSignal) {
      // 売りシグナル
      console.log(`ボリンジャーバンド売りシグナル: ${symbol} - 価格: ${currentPrice}, 上限: ${currentUpper}`);
      if (postOrderToDiscord) {
        postOrderToDiscord(`[BB戦略] 売りシグナル: ${exchange.id} - ${symbol} - 価格: ${currentPrice}, 上限: ${currentUpper}`);
      }
      
      // 利用可能な資産を確認
      const balance = await exchange.fetchBalance();
      const quoteCurrency = symbol.split('/')[0];
      const availableAsset = balance.free[quoteCurrency];

      // 取引記録から買った量を取得
      const formattedAmount = await formattedAvailableAmount(exchange, symbol, strategyKey, amountPrecision);
      
      if (availableAsset >= formattedAmount && formattedAmount > 0) {
        // 売り注文を作成
        // 注文数をチェックし、必要に応じて古い注文をキャンセル
        // await orderCheckCancel(exchange, symbol, config.cancelOrderThreshold, postOrderToDiscord);
        // 指値注文に変更
        const order = await exchange.createLimitSellOrder(symbol, formattedAmount, currentPrice, { 'post_only': true });
        if (postOrderToDiscord) {
          postOrderToDiscord(`[BB戦略] 売り注文実行: ${exchange.id} - ${symbol} - 価格: ${currentPrice}, 数量: ${formattedAmount}`);
        }
        
        // 取引記録を更新
        addOrder(exchange.id, symbol, strategyKey, 'sell', formattedAmount, currentPrice, order.id, 'limit');
      } else {
        console.log(`資産不足のため注文をスキップ: ${symbol} - 必要: ${formattedAmount}, 利用可能: ${availableAsset}`);
        if (postOrderToDiscord) {
          postOrderToDiscord(`[BB戦略] 資産不足のため売り注文をスキップ: ${exchange.id} - ${symbol} - 必要: ${formattedAmount}, 利用可能: ${availableAsset}`);
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
    if (postErrorToDiscord) {
      await postErrorToDiscord(`[BB戦略] エラー: ${exchange.id} - ${symbol} - ${error.message}`);
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
