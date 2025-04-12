/**
 * アービトラージ戦略
 */
const { orderCheckCancel } = require('./highFrequency');
const { config } = require('../src/config');
const { getInyoBuyAmount } = require('./indicators');


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
  if (symbol === 'MONA/JPY') {
    console.log(`MONA/JPY はアービトラージ戦略の対象外です`);
    return {
      strategy: 'Inter-Exchange Arbitrage',
      symbol,
      signal: 'none',
      reason: 'MONA/JPY excluded'
    };
  }
  try {
    // オプションから値を取得
    const { postOrderToDiscord, postErrorToDiscord, tradePercentage = 0.01, updateTradeRecord } = options;
    
    // 各取引所の価格情報を取得
    const exchangePrices = [];
    for (const exchange of exchanges) {
      try {
        // リトライロジックを追加
        let retryCount = 0;
        const maxRetries = 3;
        let success = false;
        let ticker, market;
        
        while (!success && retryCount < maxRetries) {
          try {
            // 取引所の情報を取得
            ticker = await exchange.fetchTicker(symbol);
            market = exchange.markets[symbol];
            success = true;
          } catch (error) {
            retryCount++;
            if (error.message.includes('throttle queue is over maxCapacity')) {
              console.log(`${exchange.id}のスロットル制限に達しました。${retryCount}回目のリトライ...`);
              // スロットル制限に達した場合は、より長く待機
              await new Promise(resolve => setTimeout(resolve, 5000 * retryCount));
            } else if (retryCount < maxRetries) {
              console.log(`${exchange.id}の価格取得に失敗しました。${retryCount}回目のリトライ...`);
              await new Promise(resolve => setTimeout(resolve, 2000 * retryCount));
            } else {
              throw error; // 最大リトライ回数に達したら、エラーを投げる
            }
          }
        }
        
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
    // 固定の取引量ではなく、利用可能な資金の割合に基づいて計算する
    // ただし、最小取引量は確保する
    const tradeAmount = Math.max(maxMinTradeAmount, amount);
    
    // 精度に合わせて丸める
    // amountPrecisionのデフォルト値を設定
    const lowestAskPrecision = lowestAsk.exchange.amountPrecision || 8;
    const highestBidPrecision = highestBid.exchange.amountPrecision || 8;
    
    let formattedAmount = parseFloat(tradeAmount.toFixed(
      Math.min(lowestAskPrecision, highestBidPrecision)
    ));
    
    // 最小精度（0.0001）を下回らないようにする
    formattedAmount = Math.max(formattedAmount, 0.0001);
    
    // 利益率が閾値を超えた場合に取引を実行
    if (profitPercent >= minProfitPercent) {
      console.log(`アービトラージ機会検出: ${symbol} - 買い: ${lowestAsk.exchange.id} (${lowestAsk.price}), 売り: ${highestBid.exchange.id} (${highestBid.price}), 利益率: ${profitPercent.toFixed(2)}%`);
      if (postOrderToDiscord) {
        await postOrderToDiscord(`[アービトラージ] 機会検出: ${symbol} - 買い: ${lowestAsk.exchange.id} (${lowestAsk.price}), 売り: ${highestBid.exchange.id} (${highestBid.price}), 利益率: ${profitPercent.toFixed(2)}%`);
      }
      
      // 取引所A（最低売値）での注文実行
      const exchangeA = lowestAsk.exchange.exchange;
      const exchangeAId = lowestAsk.exchange.id;
      const buyPriceA = lowestAsk.price;
      const sellPriceA = highestBid.price;
      
      // 取引所B（最高買値）での注文実行
      const exchangeB = highestBid.exchange.exchange;
      const exchangeBId = highestBid.exchange.id;
      const buyPriceB = lowestAsk.price;
      const sellPriceB = highestBid.price;
      
      // 通貨情報を取得
      const baseCurrency = symbol.split('/')[1];
      const quoteCurrency = symbol.split('/')[0];
      
      // 精度情報を設定
      const lowestAskPrecision = lowestAsk.exchange.amountPrecision || 8;
      const highestBidPrecision = highestBid.exchange.amountPrecision || 8;
      const amountPrecision = Math.min(lowestAskPrecision, highestBidPrecision);
      
      // 取引所Aでの注文処理
      try {
        // 利用可能な資金を確認
        const balanceA = await exchangeA.fetchBalance();
        const availableFundsA = balanceA.free[baseCurrency];
        const availableAssetA = balanceA.free[quoteCurrency];
        
        // 利用可能な資金の割合に基づいて取引量を計算
        const maxBuyAmountA = availableFundsA * tradePercentage / buyPriceA;
        let adjustedAmountA = Math.max(formattedAmount, maxBuyAmountA);
        
        // 精度を考慮して調整
        adjustedAmountA = parseFloat(adjustedAmountA.toFixed(amountPrecision));
        adjustedAmountA = Math.max(adjustedAmountA, 0.0001);
        
        // 取引所Aでの買い注文
        if (availableFundsA >= buyPriceA * adjustedAmountA) {
          try {
            // 注文数をチェックし、必要に応じて古い注文をキャンセル
            await orderCheckCancel(exchangeA, symbol, config.cancelOrderThreshold, postOrderToDiscord);
            
            // 買い注文を作成
            const buyOrderA = await exchangeA.createLimitBuyOrder(symbol, adjustedAmountA, buyPriceA);
            if (postOrderToDiscord) {
              await postOrderToDiscord(`[アービトラージ] 買い注文実行: ${exchangeAId} - ${symbol} - 価格: ${buyPriceA}, 数量: ${adjustedAmountA}`);
            }
            
            // 取引記録を更新
            if (updateTradeRecord) {
              updateTradeRecord(exchangeAId, symbol, adjustedAmountA, buyPriceA, 'buy', buyOrderA.id, 'limit');
            }
          } catch (error) {
            console.error(`買い注文の実行に失敗しました: ${exchangeAId} - ${symbol}`, error);
            if (postErrorToDiscord) {
              await postErrorToDiscord(`[アービトラージ] 買い注文の実行に失敗しました: ${exchangeAId} - ${symbol} - ${error.message}`);
            }
          }
        } else {
          console.log(`資金不足のため買い注文をスキップ: ${exchangeAId} - ${symbol} - 必要: ${buyPriceA * adjustedAmountA}, 利用可能: ${availableFundsA}`);
          if (postOrderToDiscord) {
            await postOrderToDiscord(`[アービトラージ] 資金不足のため買い注文をスキップ: ${exchangeAId} - ${symbol} - 必要: ${buyPriceA * adjustedAmountA}, 利用可能: ${availableFundsA}`);
          }
        }
        
        // 取引所Aでの売り注文
        // MM戦略で買った額を取得
        const inyoBuyAmountA = getInyoBuyAmount(tradeRecords, exchangeA, symbol, updateTradeRecord);
        
        // 売却後の残高をチェック（MMで買った分以上残るようにする）
        const remainingAfterSellA = availableAssetA - adjustedAmountA;
        
        if (remainingAfterSellA < inyoBuyAmountA && availableAssetA > inyoBuyAmountA) {
          // MMで買った分を残して売る
          const originalAmountA = adjustedAmountA;
          adjustedAmountA = parseFloat((availableAssetA - inyoBuyAmountA).toFixed(amountPrecision));
          console.log(`売却量を調整しました: ${exchangeAId} - ${symbol} - MM買い分: ${inyoBuyAmountA}, 元の売却量: ${originalAmountA}, 調整後: ${adjustedAmountA}`);
          if (postOrderToDiscord) {
            await postOrderToDiscord(`[アービトラージ] 売却量を調整しました: ${exchangeAId} - ${symbol} - MM買い分: ${inyoBuyAmountA}, 元の売却量: ${originalAmountA}, 調整後: ${adjustedAmountA}`);
          }
        }
        
        if (adjustedAmountA < 0.0001) {
          console.log(`調整後の売却量が最小取引量より小さいため、売り注文はスキップします: ${exchangeAId} - ${symbol} - 調整後: ${adjustedAmountA}`);
          if (postOrderToDiscord) {
            await postOrderToDiscord(`[アービトラージ] 調整後の売却量が最小取引量より小さいため、売り注文をスキップ: ${exchangeAId} - ${symbol} - 調整後: ${adjustedAmountA}`);
          }
        } else if (availableAssetA >= adjustedAmountA) {
          try {
            // 注文数をチェックし、必要に応じて古い注文をキャンセル
            await orderCheckCancel(exchangeA, symbol, config.cancelOrderThreshold, postOrderToDiscord);
            
            // 売り注文を作成
            const sellOrderA = await exchangeA.createLimitSellOrder(symbol, adjustedAmountA, sellPriceA);
            if (postOrderToDiscord) {
              await postOrderToDiscord(`[アービトラージ] 売り注文実行: ${exchangeAId} - ${symbol} - 価格: ${sellPriceA}, 数量: ${adjustedAmountA}`);
            }
            
            // 取引記録を更新
            if (updateTradeRecord) {
              updateTradeRecord(exchangeAId, symbol, adjustedAmountA, sellPriceA, 'sell', sellOrderA.id, 'limit');
            }
          } catch (error) {
            console.error(`売り注文の実行に失敗しました: ${exchangeAId} - ${symbol}`, error);
            if (postErrorToDiscord) {
              await postErrorToDiscord(`[アービトラージ] 売り注文の実行に失敗しました: ${exchangeAId} - ${symbol} - ${error.message}`);
            }
          }
        } else {
          console.log(`資産不足のため売り注文をスキップ: ${exchangeAId} - ${symbol} - 必要: ${adjustedAmountA}, 利用可能: ${availableAssetA}`);
          if (postOrderToDiscord) {
            await postOrderToDiscord(`[アービトラージ] 資産不足のため売り注文をスキップ: ${exchangeAId} - ${symbol} - 必要: ${adjustedAmountA}, 利用可能: ${availableAssetA}`);
          }
        }
      } catch (error) {
        console.error(`取引所Aでの注文処理に失敗しました: ${exchangeAId} - ${symbol}`, error);
        if (postErrorToDiscord) {
          await postErrorToDiscord(`[アービトラージ] 取引所Aでの注文処理に失敗しました: ${exchangeAId} - ${symbol} - ${error.message}`);
        }
      }
      
      // 取引所Bでの注文処理
      try {
        // 利用可能な資金を確認
        const balanceB = await exchangeB.fetchBalance();
        const availableFundsB = balanceB.free[baseCurrency];
        const availableAssetB = balanceB.free[quoteCurrency];
        
        // 利用可能な資金の割合に基づいて取引量を計算
        const maxBuyAmountB = availableFundsB * tradePercentage / buyPriceB;
        let adjustedAmountB = Math.max(formattedAmount, maxBuyAmountB);
        
        // 精度を考慮して調整
        adjustedAmountB = parseFloat(adjustedAmountB.toFixed(amountPrecision));
        adjustedAmountB = Math.max(adjustedAmountB, 0.0001);
        
        // 取引所Bでの買い注文
        if (availableFundsB >= buyPriceB * adjustedAmountB) {
          try {
            // 注文数をチェックし、必要に応じて古い注文をキャンセル
            await orderCheckCancel(exchangeB, symbol, config.cancelOrderThreshold, postOrderToDiscord);
            
            // 買い注文を作成
            const buyOrderB = await exchangeB.createLimitBuyOrder(symbol, adjustedAmountB, buyPriceB);
            if (postOrderToDiscord) {
              await postOrderToDiscord(`[アービトラージ] 買い注文実行: ${exchangeBId} - ${symbol} - 価格: ${buyPriceB}, 数量: ${adjustedAmountB}`);
            }
            
            // 取引記録を更新
            if (updateTradeRecord) {
              updateTradeRecord(exchangeBId, symbol, adjustedAmountB, buyPriceB, 'buy', buyOrderB.id, 'limit');
            }
          } catch (error) {
            console.error(`買い注文の実行に失敗しました: ${exchangeBId} - ${symbol}`, error);
            if (postErrorToDiscord) {
              await postErrorToDiscord(`[アービトラージ] 買い注文の実行に失敗しました: ${exchangeBId} - ${symbol} - ${error.message}`);
            }
          }
        } else {
          console.log(`資金不足のため買い注文をスキップ: ${exchangeBId} - ${symbol} - 必要: ${buyPriceB * adjustedAmountB}, 利用可能: ${availableFundsB}`);
          if (postOrderToDiscord) {
            await postOrderToDiscord(`[アービトラージ] 資金不足のため買い注文をスキップ: ${exchangeBId} - ${symbol} - 必要: ${buyPriceB * adjustedAmountB}, 利用可能: ${availableFundsB}`);
          }
        }
        
        // 取引所Bでの売り注文
        // MM戦略で買った額を取得
        const inyoBuyAmountB = getInyoBuyAmount(tradeRecords, exchangeB, symbol, updateTradeRecord);
        
        // 売却後の残高をチェック（MMで買った分以上残るようにする）
        const remainingAfterSellB = availableAssetB - adjustedAmountB;
        
        if (remainingAfterSellB < inyoBuyAmountB && availableAssetB > inyoBuyAmountB) {
          // MMで買った分を残して売る
          const originalAmountB = adjustedAmountB;
          adjustedAmountB = parseFloat((availableAssetB - inyoBuyAmountB).toFixed(amountPrecision));
          console.log(`売却量を調整しました: ${exchangeBId} - ${symbol} - MM買い分: ${inyoBuyAmountB}, 元の売却量: ${originalAmountB}, 調整後: ${adjustedAmountB}`);
          if (postOrderToDiscord) {
            await postOrderToDiscord(`[アービトラージ] 売却量を調整しました: ${exchangeBId} - ${symbol} - MM買い分: ${inyoBuyAmountB}, 元の売却量: ${originalAmountB}, 調整後: ${adjustedAmountB}`);
          }
        }
        
        if (adjustedAmountB < 0.0001) {
          console.log(`調整後の売却量が最小取引量より小さいため、売り注文はスキップします: ${exchangeBId} - ${symbol} - 調整後: ${adjustedAmountB}`);
          if (postOrderToDiscord) {
            await postOrderToDiscord(`[アービトラージ] 調整後の売却量が最小取引量より小さいため、売り注文をスキップ: ${exchangeBId} - ${symbol} - 調整後: ${adjustedAmountB}`);
          }
        } else if (availableAssetB >= adjustedAmountB) {
          try {
            // 注文数をチェックし、必要に応じて古い注文をキャンセル
            await orderCheckCancel(exchangeB, symbol, config.cancelOrderThreshold, postOrderToDiscord);
            
            // 売り注文を作成
            const sellOrderB = await exchangeB.createLimitSellOrder(symbol, adjustedAmountB, sellPriceB);
            if (postOrderToDiscord) {
              await postOrderToDiscord(`[アービトラージ] 売り注文実行: ${exchangeBId} - ${symbol} - 価格: ${sellPriceB}, 数量: ${adjustedAmountB}`);
            }
            
            // 取引記録を更新
            if (updateTradeRecord) {
              updateTradeRecord(exchangeBId, symbol, adjustedAmountB, sellPriceB, 'sell', sellOrderB.id, 'limit');
            }
          } catch (error) {
            console.error(`売り注文の実行に失敗しました: ${exchangeBId} - ${symbol}`, error);
            if (postErrorToDiscord) {
              await postErrorToDiscord(`[アービトラージ] 売り注文の実行に失敗しました: ${exchangeBId} - ${symbol} - ${error.message}`);
            }
          }
        } else {
          console.log(`資産不足のため売り注文をスキップ: ${exchangeBId} - ${symbol} - 必要: ${adjustedAmountB}, 利用可能: ${availableAssetB}`);
          if (postOrderToDiscord) {
            await postOrderToDiscord(`[アービトラージ] 資産不足のため売り注文をスキップ: ${exchangeBId} - ${symbol} - 必要: ${adjustedAmountB}, 利用可能: ${availableAssetB}`);
          }
        }
        
        // 取引結果を報告
        const totalProfit = netProfit * Math.min(adjustedAmountA || 0, adjustedAmountB || 0);
        if (postOrderToDiscord) {
          await postOrderToDiscord(`[アービトラージ] 取引完了: ${symbol} - 純利益: ${totalProfit.toFixed(8)} ${baseCurrency} (${profitPercent.toFixed(2)}%)`);
        }
      } catch (error) {
        console.error(`取引所Bでの注文処理に失敗しました: ${exchangeBId} - ${symbol}`, error);
        if (postErrorToDiscord) {
          await postErrorToDiscord(`[アービトラージ] 取引所Bでの注文処理に失敗しました: ${exchangeBId} - ${symbol} - ${error.message}`);
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
        amount: adjustedAmount || formattedAmount,
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
