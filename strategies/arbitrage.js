/**
 * アービトラージ戦略
 */
const strategies = require('./index');

/**
 * 価格差取引（取引所間アービトラージ）
 * 複数の取引所間で同じ通貨ペアの価格差を利用して利益を得る
 * @param {Array} exchanges - ccxtの取引所オブジェクトの配列
 * @param {String} symbol - 通貨ペア
 * @param {Number} minProfitPercent - 最小利益率（%）
 * @param {Number} amount - 取引量
 * @param {Object} options - その他のオプション
 */
async function interExchangeArbitrage(exchanges, symbol, minProfitPercent = 1.0, amount, options = {}) {
  try {
    // オプションから値を取得
    const { postOrderToDiscord, postErrorToDiscord } = options;
    
    // 各取引所の価格情報を取得
    const exchangePrices = [];
    for (const exchange of exchanges) {
      try {
        // 取引所の情報を取得
        const ticker = await exchange.fetchTicker(symbol);
        const market = exchange.markets[symbol];
        
        // 手数料を取得
        let takerFee = 0.002; // デフォルト値
        if (exchange.has['fetchTradingFees']) {
          try {
            const fees = await exchange.fetchTradingFees();
            takerFee = fees[symbol]?.taker || 0.002;
          } catch (error) {
            console.log(`手数料の取得に失敗しました: ${exchange.id}`, error.message);
          }
        } else if (market.taker) {
          takerFee = market.taker;
        }
        
        // 最小取引量を取得
        let minTradeAmount = market.limits?.amount?.min || amount;
        if (exchange.id === 'bitflyer' && options.bitflyerMinTradeAmounts && options.bitflyerMinTradeAmounts[symbol]) {
          minTradeAmount = options.bitflyerMinTradeAmounts[symbol];
        }
        
        // 精度を取得
        const pricePrecision = market.precision?.price || 8;
        const amountPrecision = market.precision?.amount || 8;
        
        exchangePrices.push({
          exchange,
          id: exchange.id,
          bid: ticker.bid, // 買値
          ask: ticker.ask, // 売値
          takerFee,
          minTradeAmount,
          pricePrecision,
          amountPrecision
        });
      } catch (error) {
        console.error(`${exchange.id}の価格取得に失敗しました: ${symbol}`, error);
        if (postErrorToDiscord) {
          await postErrorToDiscord(`[アービトラージ] ${exchange.id}の価格取得に失敗しました: ${symbol} - ${error.message}`);
        }
      }
    }
    
    // 価格情報が2つ以上ない場合は終了
    if (exchangePrices.length < 2) {
      console.log(`アービトラージに必要な取引所情報が不足しています: ${symbol}`);
      return {
        strategy: 'Inter-Exchange Arbitrage',
        symbol,
        error: '取引所情報が不足しています'
      };
    }
    
    // 最も高い買値と最も低い売値を見つける
    let highestBid = { price: 0, exchange: null };
    let lowestAsk = { price: Number.MAX_VALUE, exchange: null };
    
    for (const priceInfo of exchangePrices) {
      if (priceInfo.bid > highestBid.price) {
        highestBid = { price: priceInfo.bid, exchange: priceInfo };
      }
      if (priceInfo.ask < lowestAsk.price) {
        lowestAsk = { price: priceInfo.ask, exchange: priceInfo };
      }
    }
    
    // 同じ取引所の場合はアービトラージできない
    if (highestBid.exchange.id === lowestAsk.exchange.id) {
      console.log(`同じ取引所内ではアービトラージできません: ${symbol}`);
      return {
        strategy: 'Inter-Exchange Arbitrage',
        symbol,
        highestBid: highestBid.exchange.id,
        lowestAsk: lowestAsk.exchange.id,
        signal: 'none'
      };
    }
    
    // 利益率を計算（手数料を考慮）
    const buyFee = lowestAsk.price * lowestAsk.exchange.takerFee;
    const sellFee = highestBid.price * highestBid.exchange.takerFee;
    const grossProfit = highestBid.price - lowestAsk.price;
    const netProfit = grossProfit - buyFee - sellFee;
    const profitPercent = (netProfit / lowestAsk.price) * 100;
    
    // 最小取引量を考慮
    const maxMinTradeAmount = Math.max(
      lowestAsk.exchange.minTradeAmount,
      highestBid.exchange.minTradeAmount
    );
    const tradeAmount = Math.max(maxMinTradeAmount, amount);
    
    // 精度に合わせて丸める
    let formattedAmount = parseFloat(tradeAmount.toFixed(
      Math.min(lowestAsk.exchange.amountPrecision, highestBid.exchange.amountPrecision)
    ));
    
    // 最小精度（0.0001）を下回らないようにする
    formattedAmount = Math.max(formattedAmount, 0.0001);
    
    // 利益率が閾値を超えた場合に取引を実行
    if (profitPercent >= minProfitPercent) {
      console.log(`アービトラージ機会検出: ${symbol} - 買い: ${lowestAsk.exchange.id} (${lowestAsk.price}), 売り: ${highestBid.exchange.id} (${highestBid.price}), 利益率: ${profitPercent.toFixed(2)}%`);
      if (postOrderToDiscord) {
        await postOrderToDiscord(`[アービトラージ] 機会検出: ${symbol} - 買い: ${lowestAsk.exchange.id} (${lowestAsk.price}), 売り: ${highestBid.exchange.id} (${highestBid.price}), 利益率: ${profitPercent.toFixed(2)}%`);
      }
      
      // 買い注文を実行
      const buyExchange = lowestAsk.exchange.exchange;
      const buyPrice = lowestAsk.price;
      
      // 利用可能な資金を確認
      const buyBalance = await buyExchange.fetchBalance();
      const baseCurrency = symbol.split('/')[1];
      const availableFunds = buyBalance.free[baseCurrency];
      
      // 取引量を計算（利用可能資金の割合）
      const maxBuyAmount = (availableFunds * options.tradePercentage) / buyPrice;
      const tradeAmount = Math.max(maxMinTradeAmount, Math.min(maxBuyAmount, amount));
      // 精度を考慮して、最小精度以上の値を確保
      let formattedAmount = parseFloat(tradeAmount.toFixed(
        Math.min(lowestAsk.exchange.amountPrecision, highestBid.exchange.amountPrecision)
      ));
      // 最小精度（0.0001）を下回らないようにする
      formattedAmount = Math.max(formattedAmount, 0.0001);
      
      if (availableFunds >= buyPrice * formattedAmount) {
        try {
          // 買い注文を作成
          // 注文数をチェックし、必要に応じて古い注文をキャンセル
          await strategies.orderCheckCancel(buyExchange, symbol, 30, postOrderToDiscord);
          // 指値注文に変更
          const buyOrder = await buyExchange.createLimitBuyOrder(symbol, formattedAmount, buyPrice);
          // 購入記録を追加
          if (options.addBuyRecord) {
            options.addBuyRecord(lowestAsk.exchange.id, formattedAmount);
          }
          if (postOrderToDiscord) {
            await postOrderToDiscord(`[アービトラージ] 買い注文実行: ${lowestAsk.exchange.id} - ${symbol} - 価格: ${buyPrice}, 数量: ${formattedAmount}`);
          }
          
          // 売り注文を実行
          const sellExchange = highestBid.exchange.exchange;
          const sellPrice = highestBid.price;
          
          // 利用可能な資産を確認
          const sellBalance = await sellExchange.fetchBalance();
          const quoteCurrency = symbol.split('/')[0];
          const availableAsset = sellBalance.free[quoteCurrency];
          
          // 売却可能量を取得
          let sellAmount = availableAsset;
          if (options.getSellAmount) {
            sellAmount = options.getSellAmount(highestBid.exchange.id, availableAsset);
          }
          
          // 精度を考慮して、最小精度以上の値を確保
          let sellFormattedAmount = parseFloat(Math.max(maxMinTradeAmount, sellAmount).toFixed(
            Math.min(lowestAsk.exchange.amountPrecision, highestBid.exchange.amountPrecision)
          ));
          // 最小精度（0.0001）を下回らないようにする
          sellFormattedAmount = Math.max(sellFormattedAmount, 0.0001);
          
          if (availableAsset >= sellFormattedAmount) {
            try {
              // 売り注文を作成
              // 注文数をチェックし、必要に応じて古い注文をキャンセル
              await strategies.orderCheckCancel(sellExchange, symbol, 30, postOrderToDiscord);
              // 指値注文に変更
              const sellOrder = await sellExchange.createLimitSellOrder(symbol, sellFormattedAmount, sellPrice);
              if (postOrderToDiscord) {
                await postOrderToDiscord(`[アービトラージ] 売り注文実行: ${highestBid.exchange.id} - ${symbol} - 価格: ${sellPrice}, 数量: ${sellFormattedAmount}`);
              }
              
              // 取引結果を報告
              const totalProfit = netProfit * formattedAmount;
              if (postOrderToDiscord) {
                await postOrderToDiscord(`[アービトラージ] 取引完了: ${symbol} - 純利益: ${totalProfit.toFixed(8)} ${baseCurrency} (${profitPercent.toFixed(2)}%)`);
              }
            } catch (error) {
              console.error(`売り注文の実行に失敗しました: ${highestBid.exchange.id} - ${symbol}`, error);
              if (postErrorToDiscord) {
                await postErrorToDiscord(`[アービトラージ] 売り注文の実行に失敗しました: ${highestBid.exchange.id} - ${symbol} - ${error.message}`);
              }
            }
          } else {
            console.log(`資産不足のため売り注文をスキップ: ${highestBid.exchange.id} - ${symbol} - 必要: ${formattedAmount}, 利用可能: ${availableAsset}`);
            if (postOrderToDiscord) {
              await postOrderToDiscord(`[アービトラージ] 資産不足のため売り注文をスキップ: ${highestBid.exchange.id} - ${symbol} - 必要: ${formattedAmount}, 利用可能: ${availableAsset}`);
            }
          }
        } catch (error) {
          console.error(`買い注文の実行に失敗しました: ${lowestAsk.exchange.id} - ${symbol}`, error);
          if (postErrorToDiscord) {
            await postErrorToDiscord(`[アービトラージ] 買い注文の実行に失敗しました: ${lowestAsk.exchange.id} - ${symbol} - ${error.message}`);
          }
        }
      } else {
        console.log(`資金不足のため買い注文をスキップ: ${lowestAsk.exchange.id} - ${symbol} - 必要: ${buyPrice * formattedAmount}, 利用可能: ${availableFunds}`);
        if (postOrderToDiscord) {
          await postOrderToDiscord(`[アービトラージ] 資金不足のため買い注文をスキップ: ${lowestAsk.exchange.id} - ${symbol} - 必要: ${buyPrice * formattedAmount}, 利用可能: ${availableFunds}`);
        }
      }
      
      return {
        strategy: 'Inter-Exchange Arbitrage',
        symbol,
        buyExchange: lowestAsk.exchange.id,
        sellExchange: highestBid.exchange.id,
        buyPrice: lowestAsk.price,
        sellPrice: highestBid.price,
        profitPercent,
        amount: formattedAmount,
        signal: 'execute'
      };
    } else {
      console.log(`アービトラージ機会なし: ${symbol} - 最高買値: ${highestBid.exchange.id} (${highestBid.price}), 最低売値: ${lowestAsk.exchange.id} (${lowestAsk.price}), 利益率: ${profitPercent.toFixed(2)}%`);
      return {
        strategy: 'Inter-Exchange Arbitrage',
        symbol,
        buyExchange: lowestAsk.exchange.id,
        sellExchange: highestBid.exchange.id,
        buyPrice: lowestAsk.price,
        sellPrice: highestBid.price,
        profitPercent,
        signal: 'none'
      };
    }
  } catch (error) {
    console.error(`アービトラージ戦略でエラーが発生しました: ${symbol}`, error);
    if (options.postErrorToDiscord) {
      await options.postErrorToDiscord(`[アービトラージ] エラー: ${symbol} - ${error.message}`);
    }
    return {
      strategy: 'Inter-Exchange Arbitrage',
      symbol,
      error: error.message
    };
  }
}

module.exports = {
  interExchangeArbitrage
};