/**
 * 高頻度取引（HFT）戦略
 */

const { formattedAvailableAmount } = require("../src/utils");
const { getOrderStrategyKeyByOrderId } = require("../src/redisDatabase");

// 循環参照を避けるため、直接インポートしない

/**
 * 高頻度取引戦略
 * 短期間の小さな価格変動を利用して頻繁に取引を行う
 * @param {Object} exchange - ccxtの取引所オブジェクト
 * @param {String} symbol - 通貨ペア
 * @param {Number} interval - 取引間隔（ミリ秒）
 * @param {Number} priceThreshold - 価格変動閾値（%）
 * @param {Number} amount - 取引量
 * @param {Object} options - その他のオプション
 */
async function highFrequencyTrading(exchange, symbol, interval, priceThreshold, amount, options = {}) {
  try {
    // オプションから値を取得
    const { pricePrecision, amountPrecision, postOrderToDiscord, maxOrdersPerMinute, tradePercentage = 0.01, updateTradeRecord, tradeRecords } = options; // tradeRecords を追加
    
    // 取引履歴を保持する配列
    const tradeHistory = [];
    // 最後の取引時間
    let lastTradeTime = 0;
    // 1分間の注文数をカウント
    let ordersInLastMinute = 0;
    let lastMinuteReset = Date.now();
    
    // 現在の市場情報を取得
    const market = exchange.markets[symbol];
    if (!market) {
      throw new Error(`マーケットデータが取得できませんでした: ${symbol}`);
    }
    
    // 最小取引量を取得
    const minAmount = (exchange.id === 'bitflyer' && options.bitflyerMinTradeAmounts && options.bitflyerMinTradeAmounts[symbol]) 
      ? options.bitflyerMinTradeAmounts[symbol] 
      : (market.limits?.amount?.min || amount);
    
    // 取引量は後で利用可能な資金に基づいて計算するため、ここでは計算しない
    // 最小取引量だけ記録しておく
    const baseMinTradeAmount = Math.max(minAmount, amount);
    
    // 前回の価格を保存
    let previousPrice = null;
    
    // 注文ブックの深さを取得
    const orderBookDepth = 5; // 注文ブックの深さ（上位5件）
    
    console.log(`高頻度取引を開始: ${symbol} - 間隔: ${interval}ms, 閾値: ${priceThreshold}%, 最小取引量: ${baseMinTradeAmount}`);
    // if (postOrderToDiscord) {
    //   await postOrderToDiscord(`[HFT] 高頻度取引を開始: ${exchange.id} - ${symbol} - 間隔: ${interval}ms, 閾値: ${priceThreshold}%, 最小取引量: ${baseMinTradeAmount}`);
    // }
    
    // 高頻度取引ループ
    while (true) {
      try {
        // 1分間の注文数をリセット
        const now = Date.now();
        if (now - lastMinuteReset >= 60000) {
          ordersInLastMinute = 0;
          lastMinuteReset = now;
        }
        
        // 注文数が上限に達した場合はスキップ
        if (ordersInLastMinute >= maxOrdersPerMinute) {
          console.log(`1分間の注文上限に達しました: ${symbol} - ${ordersInLastMinute}/${maxOrdersPerMinute}`);
          await new Promise(resolve => setTimeout(resolve, 1000)); // 1秒待機
          continue;
        }
        
        // 注文ブックを取得
        const orderBook = await exchange.fetchOrderBook(symbol, orderBookDepth);
        const bids = orderBook.bids; // 買い注文
        const asks = orderBook.asks; // 売り注文
        
        // 現在の最良価格を取得
        const bestBid = bids.length > 0 ? bids[0][0] : null;
        const bestAsk = asks.length > 0 ? asks[0][0] : null;
        
        if (!bestBid || !bestAsk) {
          console.log(`注文ブックが空です: ${symbol}`);
          await new Promise(resolve => setTimeout(resolve, interval));
          continue;
        }
        
        // 現在の中間価格を計算
        const midPrice = (bestBid + bestAsk) / 2;
        
        // 注文ブックの厚みを分析
        const bidVolume = bids.reduce((sum, bid) => sum + bid[1], 0);
        const askVolume = asks.reduce((sum, ask) => sum + ask[1], 0);
        const volumeImbalance = bidVolume / (bidVolume + askVolume); // 0.5が均衡、>0.5は買い圧力、<0.5は売り圧力
        // threshold
        // 買いすぎで売りが少ない場合はこれをあげる
        // 売りが多い場合はこれを下げる
        // 利確時に損が多い場合は早く売りすぎているのでこれを下げる
        const volumeThreshold = 0.6; // 60%の閾値
        
        // 前回の価格がある場合、価格変動を計算
        if (previousPrice !== null) {
          const priceChange = ((midPrice - previousPrice) / previousPrice) * 100;
          const absPriceChange = Math.abs(priceChange);
          
          // 価格変動が閾値を超えた場合に取引を実行
          if (absPriceChange >= priceThreshold) {
            // 前回の取引から十分な時間が経過しているか確認
            const timeSinceLastTrade = now - lastTradeTime;
            if (timeSinceLastTrade >= interval) {
              // 取引方向を決定（価格上昇なら売り、下落なら買い）
              const isBuy = priceChange < 0;
              
              // 買い注文の場合
              if (isBuy) {
                // 買い圧力が強い場合は買い注文を実行
                if (volumeImbalance > volumeThreshold) {
                  // 利用可能な資金を確認
                  const balance = await exchange.fetchBalance();
                  const baseCurrency = symbol.split('/')[1];
                  const availableFunds = balance.free[baseCurrency];
                  
                  const tradeAmount = baseMinTradeAmount;
                  // 精度を考慮して、最小精度以上の値を確保
                  // amountPrecisionのデフォルト値を設定
                  const precisionToUse = amountPrecision || 8;
                  let formattedAmount = parseFloat(tradeAmount.toFixed(precisionToUse));
                  // 最小取引量を下回らないようにする
                  formattedAmount = Math.max(formattedAmount, baseMinTradeAmount);

                  // console.log({symbol, maxBuyAmount, tradeAmount, precisionToUse, formattedAmount});
                  
                  if (availableFunds >= midPrice * formattedAmount) {
                    try {
                      // 買い注文を作成
                      // await orderCheckCancel(exchange, symbol, 'HFT', options.cancelOrderThreshold);
                      const order = await exchange.createLimitBuyOrder(symbol, formattedAmount, midPrice, { 'post_only': true });
                      
                      // 約定情報を取得して実際の約定価格を取得
                      // let executedPrice;
                      // try {
                      //   const orderDetails = await exchange.fetchOrder(order.id, symbol);
                      //   executedPrice = orderDetails.price || orderDetails.average || midPrice; // 約定価格を取得、取得できない場合はmidPriceを使用
                      // } catch (fetchError) {
                      //   console.error(`約定情報の取得に失敗しました: ${symbol}`, fetchError);
                      //   executedPrice = midPrice; // 取得に失敗した場合はmidPriceを使用
                      // }
                      
                      // console.log(`HFT買い注文実行: ${symbol} - 約定価格: ${executedPrice}, 数量: ${formattedAmount}, 変動: ${priceChange.toFixed(2)}%`);
                      console.log(`HFT買い注文実行: ${symbol} - 価格: ${midPrice}, 数量: ${formattedAmount}, 変動: ${priceChange.toFixed(2)}%`);

                      
                      // 取引記録を更新（実際の約定価格を使用）
                      // if (updateTradeRecord) {
                      //   updateTradeRecord(exchange.id, symbol, formattedAmount, executedPrice, 'buy', );
                      // }
                      // updateFilledHistory();
                      updateTradeRecord(exchange.id, symbol, formattedAmount, midPrice, 'buy', order.id, 'limit');

                      if (postOrderToDiscord) {
                        await postOrderToDiscord(`[HFT] 買い注文実行: ${exchange.id} - ${symbol} - 約定価格: ${executedPrice}, 数量: ${formattedAmount}, 変動: ${priceChange.toFixed(2)}%`);
                      }
                      // 取引履歴に追加（実際の約定価格を使用）
                      // tradeHistory.push({
                      //   time: now,
                      //   type: 'buy',
                      //   price: executedPrice,
                      //   amount: formattedAmount,
                      //   priceChange
                      // });
                      
                      // 最後の取引時間を更新
                      lastTradeTime = now;
                      ordersInLastMinute++;
                    } catch (error) {
                      console.error(`HFT買い注文の実行に失敗しました: ${symbol}`, error);
                      if (options.postErrorToDiscord) {
                        await options.postErrorToDiscord(`[HFT] 買い注文の実行に失敗しました: ${exchange.id} - ${symbol} - ${error.message}`);
                      }
                    }
                  } else {
                    console.log(`資金不足のため買い注文をスキップ: ${symbol} - 必要: ${midPrice * formattedAmount}, 利用可能: ${availableFunds}`);
                  }
                }
              } else {
                // 売り圧力が強い場合は売り注文を実行
                if (volumeImbalance < volumeThreshold) {
                  // 利用可能な資産を確認
                  const balance = await exchange.fetchBalance();
                  const quoteCurrency = symbol.split('/')[0];
                  const availableAsset = balance.free[quoteCurrency];

                  // 最小取引量を下回らないようにする
                  let formattedAmount = await formattedAvailableAmount(exchange, symbol, 'HFT', amountPrecision);
                  
                  if (availableAsset >= baseMinTradeAmount && formattedAmount >= baseMinTradeAmount) {
                    try {
                      // 売り注文を作成
                      // await orderCheckCancel(exchange, symbol, 'HFT', options.cancelOrderThreshold);
                      const order = await exchange.createLimitSellOrder(symbol, baseMinTradeAmount, midPrice, { 'post_only': true });
                      
                      console.log(`HFT売り注文実行: ${symbol} - 価格: ${midPrice}, 数量: ${formattedAmount}, 変動: ${priceChange.toFixed(2)}%`);
                      
                      // 取引記録を更新（実際の約定価格を使用）
                      updateTradeRecord(exchange.id, symbol, baseMinTradeAmount, midPrice, 'sell', order.id, 'limit');

                      if (postOrderToDiscord) {
                        await postOrderToDiscord(`[HFT] 売り注文実行: ${exchange.id} - ${symbol} - 約定価格: ${midPrice}, 数量: ${formattedAmount}, 変動: ${priceChange.toFixed(2)}%`);
                      }
                      
                      // 最後の取引時間を更新
                      lastTradeTime = now;
                      ordersInLastMinute++;
                    } catch (error) {
                      console.error(`HFT売り注文の実行に失敗しました: ${symbol}`, error);
                      if (options.postErrorToDiscord) {
                        await options.postErrorToDiscord(`[HFT] 売り注文の実行に失敗しました: ${exchange.id} - ${symbol} - ${error.message}`);
                      }
                    }
                  } else {
                    console.log(`資産不足のため売り注文をスキップ: ${symbol} - 必要: ${formattedAmount}, 利用可能: ${availableAsset}`);
                  }
                }
              }
            }
          } else {
            console.log(`価格変動が閾値を超えませんでした: ${symbol} - 変動: ${priceChange.toFixed(2)}%`);
            await cancelAllOrders(exchange, symbol, 'HFT');
          }
        } else {
          console.log(`最初の価格を取得中: ${symbol}`);
        }
        
        // 現在の価格を保存
        previousPrice = midPrice;
        
        // 次の取引まで待機
        await new Promise(resolve => setTimeout(resolve, interval));
      } catch (error) {
        console.error(`HFT処理中にエラーが発生しました: ${symbol}`, error);
        if (options.postErrorToDiscord) {
          await options.postErrorToDiscord(`[HFT] エラー: ${exchange.id} - ${symbol} - ${error.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, interval * 2)); // エラー時は通常の2倍待機
      }
    }
  } catch (error) {
    console.error(`高頻度取引戦略でエラーが発生しました: ${symbol}`, error);
    if (options.postErrorToDiscord) {
      await options.postErrorToDiscord(`[HFT] エラー: ${exchange.id} - ${symbol} - ${error.message}`);
    }
    return {
      strategy: 'High Frequency Trading',
      symbol,
      error: error.message
    };
  }
}

/**
 * スキャルピング戦略（既存のbot.jsから移植）
 * スプレッド（買値と売値の差）に基づいて取引を行う
 * @param {Object} exchange - ccxtの取引所オブジェクト
 * @param {String} symbol - 通貨ペア
 * @param {Object} spreadHistory - スプレッド履歴を保持するオブジェクト
 * @param {Object} options - その他のオプション
 */
async function scalpingStrategy(exchange, symbol, spreadHistory, options = {}) {
  try {
    // オプションから値を取得
    const {
      profitMargin = 0.003,
      maxHistoryLength = 100,
      tradePercentage = 0.01,
      sellPercentage = 0.1,
      tradeCost = 0.0012,
      safetyJPYAmount = 2000,
      cancelOrderThreshold = 30,
      postOrderToDiscord,
      postErrorToDiscord,
      bitflyerMinTradeAmounts,
      updateTradeRecord,
      tradeRecords // tradeRecords を追加
    } = options;
    
    spreadHistory[symbol] = spreadHistory[symbol] || [];
    const market = exchange.markets[symbol];
    
    if (!market) {
      const errorMessage = `マーケットデータが取得できませんでした: ${symbol} ${exchange.name}`;
      console.error(errorMessage);
      if (postErrorToDiscord) {
        await postErrorToDiscord(errorMessage);
      }
      return;
    }
    
    const minTradeAmount = (exchange.id === 'bitflyer' && bitflyerMinTradeAmounts && bitflyerMinTradeAmounts[symbol]) 
      ? bitflyerMinTradeAmounts[symbol] 
      : (market.limits?.amount?.min || 0.0001);
      
    let pricePrecision = market.precision ? market.precision.price : undefined;
    
    if (!pricePrecision) {
      try {
        const ticker = await exchange.fetchTicker(symbol);
        const lastPrice = ticker.last;
        
        if (lastPrice) {
          const priceDecimals = (lastPrice.toString().split('.')[1] || '').length;
          pricePrecision = priceDecimals;
        } else {
          const errorMessage = `ティッカーのlast価格が取得できませんでした: ${symbol} ${exchange.name}`;
          console.error(errorMessage);
          if (postErrorToDiscord) {
            await postErrorToDiscord(errorMessage);
          }
          return;
        }
      } catch (error) {
        const errorMessage = `価格精度が取得できず、ティッカーの取得にも失敗しました: ${symbol} ${exchange.name}`;
        console.error(errorMessage, error);
        if (postErrorToDiscord) {
          await postErrorToDiscord(errorMessage);
        }
        return;
      }
    }
    
    if (pricePrecision > 0 && pricePrecision < 1) {
      const priceDecimals = (pricePrecision.toString().split('.')[1] || '').length;
      pricePrecision = priceDecimals;
    }
    
    let amountPrecision = market.precision ? market.precision.amount : undefined;
    
    if (!minTradeAmount) {
      const errorMessage = `最小取引単位が取得できませんでした: ${symbol} ${exchange.name}`;
      console.error(errorMessage);
      if (postErrorToDiscord) {
        await postErrorToDiscord(errorMessage);
      }
      return;
    }
    
    if (!amountPrecision) {
      const minTradeAmountDecimals = (minTradeAmount.toString().split('.')[1] || '').length;
      amountPrecision = minTradeAmountDecimals;
    }
    
    if (amountPrecision > 0 && amountPrecision < 1) {
      const amountDecimals = (amountPrecision.toString().split('.')[1] || '').length;
      amountPrecision = amountDecimals;
    }
    
    // オーダーブックを取得
    const orderBook = await exchange.fetchOrderBook(symbol);
    const bid = orderBook.bids.length ? orderBook.bids[0][0] : undefined;
    const ask = orderBook.asks.length ? orderBook.asks[0][0] : undefined;
    
    if (!bid || !ask) {
      console.log(`オーダーブックが空です: ${symbol}: ${exchange.name}`);
      return;
    }
    
    // スプレッドを計算
    const currentSpread = ask - bid;
    
    // スプレッド履歴に追加
    spreadHistory[symbol].push(currentSpread);
    if (spreadHistory[symbol].length > maxHistoryLength) {
      spreadHistory[symbol].shift();
    }
    
    // スプレッドの平均値を計算
    const averageSpread = spreadHistory[symbol].reduce((a, b) => a + b, 0) / spreadHistory[symbol].length;
    
    // BFは手数料が高いので高い利益率を設定
    const adjustedProfitMargin = (exchange.id === 'bitflyer' ? profitMargin * 1.5 : profitMargin);
    
    console.log(`${symbol}: ${exchange.name} 想定利益率: ${ask/bid}`);
    
    if ((ask/bid) > (1 + adjustedProfitMargin)) {
      const ticker = await exchange.fetchTicker(symbol);
      const lastPrice = ticker.last;
      
      const buyPrice = parseFloat(lastPrice - (lastPrice * (adjustedProfitMargin / 2))).toFixed(pricePrecision);
      const sellPrice = parseFloat(lastPrice + (lastPrice * (adjustedProfitMargin / 2))).toFixed(pricePrecision);
      
      // 利用可能な資金を取得
      const balance = await exchange.fetchBalance();
      const quoteCurrency = symbol.split('/')[0];
      const baseCurrency = symbol.split('/')[1];
      const availableFunds = balance.free[baseCurrency];
      const availableQuoteCurrency = balance.free[quoteCurrency];
      
      // 購入に必要な資金を計算
      const maxBuyAmount = availableFunds * tradePercentage / buyPrice;
      // 取引記録から買った量を取得
      let recordedBuyAmount = 0;
      // tradeRecords (optionsから渡されたもの) を使用
      const exchangeRecords = tradeRecords && tradeRecords[exchange.id];
      if (exchangeRecords && exchangeRecords[symbol]) {
          recordedBuyAmount = (exchangeRecords[symbol].buyAmount || 0) - (exchangeRecords[symbol].sellAmount || 0);
          if (recordedBuyAmount < 0) recordedBuyAmount = 0; // 負の値にならないように
      } // Corrected closing brace for the inner if

      // 売却量を計算（買った分だけを売却）
      let maxSellAmount = recordedBuyAmount;
      
      // 買った記録がなくても、利用可能な資産があれば残高 * sellPercentageと最小単位の大きい方を売却
      if (maxSellAmount <= 0 && availableQuoteCurrency >= minTradeAmount) {
        maxSellAmount = Math.max(minTradeAmount, availableQuoteCurrency * sellPercentage);
      }
      
      // 利用可能な資産を超えないようにする
      maxSellAmount = Math.min(maxSellAmount, availableQuoteCurrency);
      // 購入に必要な資金を計算
      // amountPrecisionのデフォルト値を設定
      const buyPrecisionToUse = amountPrecision || 8;
      let buyAmount = parseFloat(Math.max(minTradeAmount, maxBuyAmount).toFixed(buyPrecisionToUse));
      // 最小精度（0.0001）を下回らないようにする
      buyAmount = Math.max(buyAmount, 0.0001);
      
      // 売却に必要な資産を計算
      // amountPrecisionのデフォルト値を設定
      const sellPrecisionToUse = amountPrecision || 8;
      let sellAmount = parseFloat(Math.max(minTradeAmount, maxSellAmount).toFixed(sellPrecisionToUse));
      // 最小精度（0.0001）を下回らないようにする
      sellAmount = Math.max(sellAmount, 0.0001);
      
      const buyCost = buyAmount * buyPrice * tradeCost;
      const sellCost = sellAmount * sellPrice * tradeCost;
      
      // JPY残高が設定以下の場合、購入注文をスキップ
      if (availableFunds <= safetyJPYAmount && sellAmount <= 0) {
        console.log(`JPY残高不足のため、購入注文をスキップします: ${symbol}: ${exchange.name}, 残高: ${availableFunds}`);
        if (postOrderToDiscord) {
          await postOrderToDiscord(`JPY残高不足のため、購入注文をスキップします: ${symbol}: ${exchange.name}, 残高: ${availableFunds}`);
        }
      } else if (availableFunds >= buyPrice * buyAmount) {
        // await orderCheckCancel(exchange, symbol, cancelOrderThreshold, postOrderToDiscord);
        console.log(`購入価格: ${buyPrice}, 売却価格: ${sellPrice} (${symbol}), 取引量: ${buyAmount}`);
        if (postOrderToDiscord) {
          await postOrderToDiscord(`* 注文: ${exchange.name}: 購入価格: ${buyPrice}, 売却価格: ${sellPrice} (${symbol}), 取引量: ${buyAmount}`);
        }
        const buyOrder = await exchange.createLimitBuyOrder(symbol, buyAmount, buyPrice);
        
        // 取引記録を更新
        if (updateTradeRecord) {
          updateTradeRecord(exchange.id, symbol, buyAmount, buyPrice, 'buy', buyOrder.id, 'limit');
        }
      } else {
        console.log(`資金不足のため、購入注文をスキップします: ${symbol}: ${exchange.name}, 資金: ${availableFunds}, 購入価格: ${buyPrice}, 取引量: ${buyAmount}`);
        if (postOrderToDiscord) {
          await postOrderToDiscord(`資金不足のため、購入注文をスキップします: ${symbol}: ${exchange.name}, 資金: ${availableFunds}, 購入価格: ${buyPrice}, 取引量: ${buyAmount}`);
        }
      }
      
      // 売却注文を送信
      if (availableQuoteCurrency >= sellAmount) {
        // await orderCheckCancel(exchange, symbol, cancelOrderThreshold, postOrderToDiscord);
        if (postOrderToDiscord) {
          await postOrderToDiscord(`& 売却注文作成: ${exchange.name}: ${symbol}: ${sellPrice}: ${sellAmount}`);
        }
        const sellOrder = await exchange.createLimitSellOrder(symbol, sellAmount, sellPrice);
        
        // 取引記録を更新
        if (updateTradeRecord) {
          updateTradeRecord(exchange.id, symbol, sellAmount, sellPrice, 'sell', sellOrder.id, 'limit');
        }
      } else {
        console.log(`資産不足のため、売却注文をスキップします: ${symbol}: ${exchange.name}, 資産: ${availableQuoteCurrency}, 売却量: ${sellAmount}`);
        if (postOrderToDiscord) {
          await postOrderToDiscord(`資産不足のため、売却注文をスキップします: ${symbol}: ${exchange.name}, 資産: ${availableQuoteCurrency}, 売却量: ${sellAmount}`);
        }
      }
    } else {
      console.log(`取引をスキップします: ${symbol}: ${exchange.name}`);
    }
    
    return {
      strategy: 'Scalping',
      symbol,
      bid,
      ask,
      spread: currentSpread,
      averageSpread,
      signal: (ask/bid) > (1 + adjustedProfitMargin) ? 'execute' : 'none'
    };
  } catch (error) {
    console.error(`スキャルピング戦略でエラーが発生しました: ${symbol}`, error);
    if (options.postErrorToDiscord) {
      await options.postErrorToDiscord(`[スキャルピング] エラー: ${exchange.id} - ${symbol} - ${error.message}`);
    }
    return {
      strategy: 'Scalping',
      symbol,
      error: error.message
    };
  }
}


async function cancelAllOrders(exchange, symbol, strategyKey) {
  try {
    const orders = await exchange.fetchOpenOrders(symbol);
    for (const order of orders) {
      const _strategyKey = await getOrderStrategyKeyByOrderId(order.id);
      if (_strategyKey === strategyKey) {
        await exchange.cancelOrder(order.id, symbol);
        console.log(`注文キャンセル: ${exchange.id} - ${symbol} - 注文ID: ${order.id}`);
      }
    }
  } catch (error) {
    console.error(`注文キャンセル処理でエラーが発生しました: ${symbol}`, error);
  }
}

/**
 * 古い注文をキャンセルする関数
 * @param {Object} exchange - ccxtの取引所オブジェクト
 * @param {String} symbol - 通貨ペア
 * @param {String} strategyKey - ストラテジーのキー
 * @param {Number} cancelOrderThreshold - キャンセルする閾値（デフォルト30）
 * @param {Function} postOrderToDiscord - Discord通知関数
 */
async function orderCheckCancel(exchange, symbol, strategyKey, cancelOrderThreshold = 30) {
  try {
    // 通貨ペアの注文を取得
    const orders = await exchange.fetchOpenOrders(symbol);
    
    // 通貨ごとに注文数が超えたら、最も古い注文をキャンセル
    if (orders.length >= cancelOrderThreshold) {
      const targetOrder = await findFirstOrderByStrategyKey(orders, strategyKey);
      if (targetOrder) {
        await exchange.cancelOrder(targetOrder.id, symbol);
        console.log(`注文数が${cancelOrderThreshold}を超えたため、最も古い注文をキャンセルしました: ${exchange.id} - ${symbol} : ${oldestOrder.id}`);
      }
    }
    
    return orders.length;
  } catch (error) {
    console.error(`注文キャンセル処理でエラーが発生しました: ${symbol}`, error);
    if (postOrderToDiscord) {
      await postOrderToDiscord(`[注文キャンセル] エラー: ${exchange.id} - ${symbol} - ${error.message}`);
    }
    return 0;
  }
}

async function findFirstOrderByStrategyKey(openOrders, strategyKey) {
  for (const order of openOrders) {
    const _strategyKey = await getOrderStrategyKeyByOrderId(order.id);
    if (_strategyKey === strategyKey) {
      return order;
    }
  }
  return null;
}


module.exports = {
  highFrequencyTrading,
  scalpingStrategy,
  orderCheckCancel
};
