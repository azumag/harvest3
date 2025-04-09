/**
 * レンジ相場向け受動的マーケットメイキング戦略
 */

/**
 * レンジ相場向け受動的マーケットメイキング戦略
 * 価格が大きく変動していないレンジ相場において、買い指値注文と売り指値注文を同時に発注し、
 * 約定時にメイカー手数料を得ることを目的とした戦略
 * @param {Object} exchange - ccxtの取引所オブジェクト
 * @param {String} symbol - 通貨ペア
 * @param {Number} rangePeriod - レンジ判定期間（ミリ秒）
 * @param {Number} rangeThreshold - レンジ判定閾値（%）
 * @param {Number} spreadWidth - スプレッド幅（%）
 * @param {Number} amount - 取引量
 * @param {Object} options - その他のオプション
 */
async function passiveMarketMaking(exchange, symbol, rangePeriod = 300000, rangeThreshold = 1.0, spreadWidth = 0.5, amount, options = {}) {
  try {
    // オプションから値を取得
    const {
      pricePrecision,
      amountPrecision,
      minTradeAmount,
      postOrderToDiscord,
      postErrorToDiscord,
      bitflyerMinTradeAmounts,
      reorderInterval = 60000, // 再発注間隔（ミリ秒）
      maxPositionCount = 2, // 最大ポジション数
      adjustmentValue = 0, // 微調整値
      tradePercentage = 0.01, // 資金の何%を使用するか
      updateTradeRecord,
      tradeRecords
    } = options;

    // 注文履歴を保持する配列
    const orderHistory = [];
    // アクティブな注文を保持するオブジェクト
    const activeOrders = {
      buy: null,
      sell: null
    };
    // 注文ペアを管理するための配列
    const orderPairs = [];
    // 最後の注文時間
    let lastOrderTime = 0;
    // ポジション管理
    let currentPositions = 0;

    // 現在の市場情報を取得
    const market = exchange.markets[symbol];
    if (!market) {
      throw new Error(`マーケットデータが取得できませんでした: ${symbol}`);
    }

    // 最小取引量を取得
    // const baseMinTradeAmount = (exchange.id === 'bitflyer' && bitflyerMinTradeAmounts && bitflyerMinTradeAmounts[symbol])
    //   ? bitflyerMinTradeAmounts[symbol]
    //   : (market.limits?.amount?.min || minTradeAmount || 0.0001);

    // 設定を無視して、最小取引量を0.001に固定
    let baseMinTradeAmount = 0.001;

    if (symbol === 'BTC/JPY') {
      baseMinTradeAmount = 0.0001; // BTC/JPYの場合は最小取引量を0.0001に設定
      // return; // いったん BTC/JPYは除外
    }

    console.log(`レンジ相場向け受動的マーケットメイキング戦略を開始: ${symbol} - レンジ判定期間: ${rangePeriod}ms, 閾値: ${rangeThreshold}%, スプレッド幅: ${spreadWidth}%, 最小取引量: ${baseMinTradeAmount}`);
    if (postOrderToDiscord) {
      await postOrderToDiscord(`[MM] レンジ相場向け受動的マーケットメイキング戦略を開始: ${exchange.id} - ${symbol} - レンジ判定期間: ${rangePeriod}ms, 閾値: ${rangeThreshold}%, スプレッド幅: ${spreadWidth}%, 最小取引量: ${baseMinTradeAmount}`);
    }

    // 価格履歴を保持する配列
    const priceHistory = [];
    // 最後の価格履歴更新時間
    let lastPriceHistoryUpdate = 0;
    // 価格履歴の更新間隔（ミリ秒）
    const priceHistoryUpdateInterval = 10000; // 10秒ごとに更新

    // 注文状態の直接確認間隔（ミリ秒）
    const orderStatusCheckInterval = 30000; // 30秒ごとに確認
    // 最後の注文状態確認時間
    let lastOrderStatusCheck = 0;

    // マーケットメイキングループ
    while (true) {
      try {
        const now = Date.now();

        // 価格履歴を更新
        if (now - lastPriceHistoryUpdate >= priceHistoryUpdateInterval) {
          try {
            const ticker = await exchange.fetchTicker(symbol);
            if (ticker && ticker.last) {
              priceHistory.push({
                time: now,
                price: ticker.last
              });
              
              // レンジ判定期間を超える古い価格履歴を削除
              while (priceHistory.length > 0 && now - priceHistory[0].time > rangePeriod) {
                priceHistory.shift();
              }
              
              lastPriceHistoryUpdate = now;
            }
          } catch (error) {
            console.error(`価格履歴の更新中にエラーが発生しました: ${symbol}`, error);
            if (postErrorToDiscord) {
              await postErrorToDiscord(`[MM] 価格履歴の更新中にエラーが発生しました: ${exchange.id} - ${symbol} - ${error.message}`);
            }
          }
        }

        // レンジ相場の判定
        let isRangeMarket = false;
        if (priceHistory.length >= 2) {
          const prices = priceHistory.map(item => item.price);
          const highPrice = Math.max(...prices);
          const lowPrice = Math.min(...prices);
          const priceRange = ((highPrice - lowPrice) / lowPrice) * 100;
          
          isRangeMarket = priceRange <= rangeThreshold;
          
          if (isRangeMarket) {
            console.log(`レンジ相場を検出: ${symbol} - 価格変動: ${priceRange.toFixed(2)}% (閾値: ${rangeThreshold}%)`);
          } else {
            console.log(`レンジ相場ではありません: ${symbol} - 価格変動: ${priceRange.toFixed(2)}% (閾値: ${rangeThreshold}%)`);
          }
        } else {
          console.log(`価格履歴が不足しています: ${symbol} - ${priceHistory.length}件`);
        }

        // 注文ステータスの直接確認（定期的に実行）
        if (now - lastOrderStatusCheck >= orderStatusCheckInterval) {
          try {
            // アクティブな注文リストを取得
            const openOrders = await exchange.fetchOpenOrders(symbol);
            const activeOrderIds = openOrders.map(order => order.id);
            
            console.log(`${symbol}の注文状態チェック - アクティブな注文数: ${openOrders.length}`);
            
            // 各注文ペアの状態を確認
            for (let i = orderPairs.length - 1; i >= 0; i--) {
              const pair = orderPairs[i];
              
              // 買い注文のステータスチェック
              if (pair.buyOrder && !pair.buyFilled) {
                // 買い注文がアクティブリストにない場合
                if (!activeOrderIds.includes(pair.buyOrder.id)) {
                  // 個別に注文状態を確認（サポートされている場合）
                  try {
                    if (exchange.has && exchange.has['fetchOrder']) {
                      const orderStatus = await exchange.fetchOrder(pair.buyOrder.id, symbol);
                      
                      // 正常に約定した場合
                      if (orderStatus.status === 'closed' || orderStatus.status === 'filled') {
                        console.log(`買い注文(${pair.buyOrder.id})が約定しました - 個別確認`);
                        pair.buyFilled = true;
                        continue;
                      }
                    }
                  } catch (orderCheckError) {
                    // エラーが発生した場合も注文が存在しない可能性が高い
                    console.log(`買い注文(${pair.buyOrder.id})のステータス確認中にエラー: ${orderCheckError.message}`);
                  }
                  
                  // 注文がキャンセルされたか存在しない場合
                  console.log(`買い注文(${pair.buyOrder.id})はアクティブではありません - キャンセルとして処理`);
                  
                  // 注文履歴を更新
                  const historyOrderIndex = orderHistory.findIndex(
                    historyOrder => historyOrder.orderId === pair.buyOrder.id
                  );
                  if (historyOrderIndex !== -1) {
                    orderHistory[historyOrderIndex].processedCancel = true;
                  }
                  
                  // ペアを削除せず、注文状態だけをリセット
                  console.log(`買い注文がキャンセルされました。次回の実行時に新しい買い注文を発注します - ペア(${pair.id})`);
                  pair.buyOrder = null;
                  pair.buyFilled = false;
                  activeOrders.buy = null;
                }
              }
              
              // 売り注文のステータスチェック
              if (pair.sellOrder && !pair.sellFilled) {
                // 売り注文がアクティブリストにない場合
                if (!activeOrderIds.includes(pair.sellOrder.id)) {
                  // 個別に注文状態を確認（サポートされている場合）
                  try {
                    if (exchange.has && exchange.has['fetchOrder']) {
                      const orderStatus = await exchange.fetchOrder(pair.sellOrder.id, symbol);
                      
                      // 正常に約定した場合
                      if (orderStatus.status === 'closed' || orderStatus.status === 'filled') {
                        console.log(`売り注文(${pair.sellOrder.id})が約定しました - 個別確認`);
                        pair.sellFilled = true;
                        continue;
                      }
                    }
                  } catch (orderCheckError) {
                    // エラーが発生した場合も注文が存在しない可能性が高い
                    console.log(`売り注文(${pair.sellOrder.id})のステータス確認中にエラー: ${orderCheckError.message}`);
                  }
                  
                  // 注文がキャンセルされたか存在しない場合
                  console.log(`売り注文(${pair.sellOrder.id})はアクティブではありません - キャンセルとして処理`);
                  
                  // 注文履歴を更新
                  const historyOrderIndex = orderHistory.findIndex(
                    historyOrder => historyOrder.orderId === pair.sellOrder.id
                  );
                  if (historyOrderIndex !== -1) {
                    orderHistory[historyOrderIndex].processedCancel = true;
                  }
                  
                  // 買い注文の状態に関わらず、売り注文状態だけをリセット
                  if (pair.buyFilled) {
                    console.log(`買い注文が約定済みで売り注文がキャンセルされました。次回の実行時に新しい売り注文を発注します - ペア(${pair.id})`);
                  } else {
                    console.log(`売り注文がキャンセルされました。買い注文も未約定ですが、ペアを維持します - ペア(${pair.id})`);
                  }
                  pair.sellOrder = null;
                  pair.sellFilled = false;
                  
                  activeOrders.sell = null;
                }
              }
              
              // 両方の注文が約定している場合、完了としてログ記録
              if (pair.buyFilled && pair.sellFilled) {
                console.log(`注文ペア(${pair.id})が完了しました`);
              }
            }
            
            lastOrderStatusCheck = now;
          } catch (statusCheckError) {
            console.error(`注文状態の定期確認中にエラーが発生しました: ${symbol}`, statusCheckError);
          }
        }

        // レンジ相場の場合、または最後の注文から一定時間経過した場合に注文を発注/更新
        if (isRangeMarket || (now - lastOrderTime >= reorderInterval)) {
          // 注文ブックを取得
          const orderBook = await exchange.fetchOrderBook(symbol);
          const bids = orderBook.bids; // 買い注文
          const asks = orderBook.asks; // 売り注文
          
          // 現在の最良価格を取得
          const bestBid = bids.length > 0 ? bids[0][0] : null;
          const bestAsk = asks.length > 0 ? asks[0][0] : null;
          
          if (!bestBid || !bestAsk) {
            console.log(`注文ブックが空です: ${symbol}`);
            await new Promise(resolve => setTimeout(resolve, 1000));
            continue;
          }
          
          // 現在の中間価格を計算（基準価格）
          const midPrice = (bestBid + bestAsk) / 2;
          
          // 買い注文と売り注文の価格を計算
          const halfSpread = (spreadWidth / 100) / 2;
          const buyPrice = midPrice * (1 - halfSpread) - adjustmentValue;
          const sellPrice = midPrice * (1 + halfSpread) + adjustmentValue;
          
          // 価格の精度を調整
          const precisionToUse = pricePrecision || 8;
          const formattedBuyPrice = parseFloat(buyPrice.toFixed(precisionToUse));
          const formattedSellPrice = parseFloat(sellPrice.toFixed(precisionToUse));
          
          // 利用可能な資金と資産を確認
          const balance = await exchange.fetchBalance();
          const baseCurrency = symbol.split('/')[1]; // 例: BTC/JPY の JPY
          const quoteCurrency = symbol.split('/')[0]; // 例: BTC/JPY の BTC
          const availableFunds = balance.free[baseCurrency];
          const availableAsset = balance.free[quoteCurrency];
          
          // 取引記録から買った量と売った量を取得
          let buyAmount = 0;
          let sellAmount = 0;
          if (tradeRecords && tradeRecords[exchange.id] && tradeRecords[exchange.id][symbol]) {
            buyAmount = tradeRecords[exchange.id][symbol].buyAmount || 0;
            sellAmount = tradeRecords[exchange.id][symbol].sellAmount || 0;
          }
          
          // 現在のポジション数を計算
          currentPositions = Math.max(0, buyAmount - sellAmount);
          
          // 取引量を計算
          const maxBuyAmount = baseMinTradeAmount;
          const amountPrecisionToUse = amountPrecision || 8;
          let formattedAmount = parseFloat(Math.max(baseMinTradeAmount, maxBuyAmount).toFixed(amountPrecisionToUse));
          formattedAmount = Math.max(formattedAmount, baseMinTradeAmount);
          
          // 注文ペアの管理
          const pendingPairs = orderPairs.filter(pair =>
            (pair.buyOrder && !pair.buyFilled) || (pair.sellOrder && !pair.sellFilled)
          );
          
          const hasBuyWithSellFilled = pendingPairs.some(pair => pair.buyOrder && !pair.buyFilled && pair.sellOrder && pair.sellFilled);
          const hasBothPending = pendingPairs.some(pair => pair.buyOrder && !pair.buyFilled && pair.sellOrder && !pair.sellFilled);
          const hasSellWithBuyFilled = pendingPairs.some(pair => pair.sellOrder && !pair.sellFilled && pair.buyOrder && pair.buyFilled);
          const hasSellOnly = pendingPairs.some(pair => pair.sellOrder && !pair.sellFilled && (!pair.buyOrder || pair.buyFilled));
          const hasBuyOnly = pendingPairs.some(pair => pair.buyOrder && !pair.buyFilled && (!pair.sellOrder || pair.sellFilled));

          const shouldDoNothing = hasBuyWithSellFilled || hasBothPending || hasSellWithBuyFilled;
          const shouldPlaceBuyOnly = hasSellOnly &&
                                     currentPositions < maxPositionCount &&
                                     availableFunds >= formattedBuyPrice * formattedAmount;
          const shouldPlaceSellOnly = hasBuyOnly &&
                                      availableAsset >= formattedAmount;

          if (shouldDoNothing) {
            console.log(`次のパターンにより、新規注文を見送ります: ${symbol}`);
            if (hasBuyWithSellFilled) console.log(`- 以前の買いが残っていて売りが決まっています`);
            if (hasBothPending) console.log(`- 以前の買いも売りも残っています`);
            if (hasSellWithBuyFilled) console.log(`- 以前の売りが残っていて買いが決まっています`);
          } else if (shouldPlaceBuyOnly) {
            try {
              let adjustedAmount = formattedAmount;
              const buyPrice = formattedBuyPrice * formattedAmount;
              const remainingAfterBuy = availableFunds - buyPrice;
              
              // if (Math.abs(remainingAfterBuy - 0.0001) < 0.00001) {
              //   adjustedAmount = formattedAmount + 0.0001;
              //   console.log(`買った後の残高が0.0001になるため、注文量を調整: ${formattedAmount} → ${adjustedAmount}`);
              // }
              
              const newPair = {
                id: Date.now().toString(),
                buyOrder: null,
                sellOrder: null,
                buyFilled: false,
                sellFilled: false,
                amount: adjustedAmount
              };

              const buyOrder = await exchange.createLimitBuyOrder(symbol, adjustedAmount, formattedBuyPrice);
              activeOrders.buy = buyOrder;
              newPair.buyOrder = buyOrder;

              console.log(`-- 買い注文のみを発注しました: ${symbol} - 価格: ${formattedBuyPrice}, 数量: ${adjustedAmount}, ペアID: ${newPair.id}`);
              if (postOrderToDiscord) {
                // await postOrderToDiscord(`[MM] 買い注文のみを発注しました: ${exchange.id} - ${symbol} - 価格: ${formattedBuyPrice}, 数量: ${formattedAmount}`);
              }

              if (updateTradeRecord) {
                updateTradeRecord(exchange.id, symbol, adjustedAmount, formattedBuyPrice, 'buy');
              }

              orderHistory.push({
                time: now,
                type: 'buy',
                price: formattedBuyPrice,
                amount: formattedAmount,
                orderId: buyOrder.id,
                pairId: newPair.id
              });

              orderPairs.push(newPair);

            } catch (buyError) {
              console.error(`買い注文の発注中にエラーが発生しました: ${symbol}`, buyError);
              if (postErrorToDiscord) {
                await postErrorToDiscord(`[MM] 買い注文の発注中にエラーが発生しました: ${exchange.id} - ${symbol} - ${buyError.message}`);
              }
            }
          } else if (shouldPlaceSellOnly) {
            const remainingAfterSell = availableAsset - formattedAmount;
            // if (remainingAfterSell < 0.0001) {
            //   console.log(`売却後の残高が0.0001以下になるため、売り注文は発注しません: ${symbol} - 現在の残高: ${availableAsset}, 売却後: ${remainingAfterSell}`);
            //   continue;
            // }

            try {
              const newPair = {
                id: Date.now().toString(),
                buyOrder: null,
                sellOrder: null,
                buyFilled: false,
                sellFilled: false,
                amount: formattedAmount
              };

              const sellOrder = await exchange.createLimitSellOrder(symbol, formattedAmount, formattedSellPrice);
              activeOrders.sell = sellOrder;
              newPair.sellOrder = sellOrder;

              console.log(`-- 売り注文のみを発注しました: ${symbol} - 価格: ${formattedSellPrice}, 数量: ${formattedAmount}, ペアID: ${newPair.id}, 売却後残高: ${remainingAfterSell}`);
              if (postOrderToDiscord) {
                // await postOrderToDiscord(`[MM] 売り注文のみを発注しました: ${exchange.id} - ${symbol} - 価格: ${formattedSellPrice}, 数量: ${formattedAmount}`);
              }

              if (updateTradeRecord) {
                updateTradeRecord(exchange.id, symbol, formattedAmount, formattedSellPrice, 'sell');
              }

              orderHistory.push({
                time: now,
                type: 'sell',
                price: formattedSellPrice,
                amount: formattedAmount,
                orderId: sellOrder.id,
                pairId: newPair.id
              });

              orderPairs.push(newPair);

            } catch (sellError) {
              console.error(`売り注文の発注中にエラーが発生しました: ${symbol}`, sellError);
              if (postErrorToDiscord) {
                await postErrorToDiscord(`[MM] 売り注文の発注中にエラーが発生しました: ${exchange.id} - ${symbol} - ${sellError.message}`);
              }
            }
          } else if (pendingPairs.length === 0 && currentPositions < maxPositionCount && availableFunds >= formattedBuyPrice * formattedAmount) {
            try {
              let adjustedAmount = formattedAmount;
              const buyPrice = formattedBuyPrice * formattedAmount;
              const remainingAfterBuy = availableFunds - buyPrice;
              
              // if (Math.abs(remainingAfterBuy - 0.0001) < 0.00001) {
              //   adjustedAmount = formattedAmount + 0.0001;
              //   console.log(`買った後の残高が0.0001になるため、注文量を調整: ${formattedAmount} → ${adjustedAmount}`);
              // }
              
              const newPair = {
                id: Date.now().toString(),
                buyOrder: null,
                sellOrder: null,
                buyFilled: false,
                sellFilled: false,
                amount: adjustedAmount
              };

              const buyOrder = await exchange.createLimitBuyOrder(symbol, adjustedAmount, formattedBuyPrice);
              activeOrders.buy = buyOrder;
              newPair.buyOrder = buyOrder;

              console.log(`-- 買い注文を発注しました: ${symbol} - 価格: ${formattedBuyPrice}, 数量: ${adjustedAmount}, ペアID: ${newPair.id}`);
              if (postOrderToDiscord) {
                // await postOrderToDiscord(`[MM] 買い注文を発注しました: ${exchange.id} - ${symbol} - 価格: ${formattedBuyPrice}, 数量: ${formattedAmount}`);
              }

              if (updateTradeRecord) {
                updateTradeRecord(exchange.id, symbol, adjustedAmount, formattedBuyPrice, 'buy');
              }

              orderHistory.push({
                time: now,
                type: 'buy',
                price: formattedBuyPrice,
                amount: adjustedAmount,
                orderId: buyOrder.id,
                pairId: newPair.id
              });

              if (availableAsset >= adjustedAmount) {
                const remainingAfterSell = availableAsset - adjustedAmount;
                // if (remainingAfterSell < 0.0001) {
                //   console.log(`売却後の残高が0.0001以下になるため、売り注文は発注しません: ${symbol} - 現在の残高: ${availableAsset}, 売却後: ${remainingAfterSell}`);
                //   console.log(`買い注文のみを維持します: ${symbol} - ペアID: ${newPair.id}`);
                // } else {
                const sellOrder = await exchange.createLimitSellOrder(symbol, adjustedAmount, formattedSellPrice);
                activeOrders.sell = sellOrder;
                newPair.sellOrder = sellOrder;

                console.log(`-- 売り注文を発注しました: ${symbol} - 価格: ${formattedSellPrice}, 数量: ${adjustedAmount}, ペアID: ${newPair.id}, 売却後残高: ${remainingAfterSell}`);
                if (postOrderToDiscord) {
                  // await postOrderToDiscord(`[MM] 売り注文を発注しました: ${exchange.id} - ${symbol} - 価格: ${formattedSellPrice}, 数量: ${adjustedAmount}`);
                }
                if (updateTradeRecord) {
                  updateTradeRecord(exchange.id, symbol, adjustedAmount, formattedSellPrice, 'sell');
                }
                
                orderHistory.push({
                  time: now,
                  type: 'sell',
                  price: formattedSellPrice,
                  amount: adjustedAmount,
                  orderId: sellOrder.id,
                  pairId: newPair.id
                });
                // }

              }
              orderPairs.push(newPair);

            } catch (error) {
              console.error(`注文の発注中にエラーが発生しました: ${symbol}`, error);
              if (postErrorToDiscord) {
                await postErrorToDiscord(`[MM] 注文の発注中にエラーが発生しました: ${exchange.id} - ${symbol} - ${error.message}`);
              }
            }
          } else {
            console.log(`現在の状態に合致する注文パターンがないため、注文を見送ります: ${symbol}`);
            console.log(`- hasSellOnly: ${hasSellOnly} - hasBuyOnly: ${hasBuyOnly}`);
            console.log(`- 現在のポジション数: ${currentPositions}/${maxPositionCount}`);
            console.log(`- 利用可能資金: ${availableFunds}, 必要: ${formattedBuyPrice * formattedAmount}`);
            console.log(`- 利用可能資産: ${availableAsset}, 必要: ${formattedAmount}`);
          }
          
          lastOrderTime = now;
        }
        
        // 完了した注文ペアのクリーンアップ
        for (let i = orderPairs.length - 1; i >= 0; i--) {
          const pair = orderPairs[i];
          if (pair.buyFilled && pair.sellFilled) {
            // 両方の注文が約定していれば、注文ペアを削除
            console.log(`完了した注文ペア(${pair.id})をクリーンアップします`);
            orderPairs.splice(i, 1);
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`マーケットメイキング処理中にエラーが発生しました: ${symbol}`, error);
        if (postErrorToDiscord) {
          await postErrorToDiscord(`[MM] エラー: ${exchange.id} - ${symbol} - ${error.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  } catch (error) {
    console.error(`レンジ相場向け受動的マーケットメイキング戦略でエラーが発生しました: ${symbol}`, error);
    if (options.postErrorToDiscord) {
      await options.postErrorToDiscord(`[MM] エラー: ${exchange.id} - ${symbol} - ${error.message}`);
    }
    return {
      strategy: 'Passive Market Making',
      symbol,
      error: error.message
    };
  }
}

module.exports = {
  passiveMarketMaking
};
