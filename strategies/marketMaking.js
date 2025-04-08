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
      maxPositionCount = 10, // 最大ポジション数
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
    const baseMinTradeAmount = (exchange.id === 'bitflyer' && bitflyerMinTradeAmounts && bitflyerMinTradeAmounts[symbol])
      ? bitflyerMinTradeAmounts[symbol]
      : (market.limits?.amount?.min || minTradeAmount || 0.0001);

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
          
          // 既存の注文をキャンセル
          try {
            // アクティブな注文を取得
            const openOrders = await exchange.fetchOpenOrders(symbol);
            
            // 既存の注文をキャンセル
            for (const order of openOrders) {
              await exchange.cancelOrder(order.id, symbol);
              console.log(`注文をキャンセルしました: ${symbol} - 注文ID: ${order.id}, 価格: ${order.price}, 数量: ${order.amount}, タイプ: ${order.side}`);
              if (postOrderToDiscord) {
                await postOrderToDiscord(`[MM] 注文をキャンセルしました: ${exchange.id} - ${symbol} - 注文ID: ${order.id}, 価格: ${order.price}, 数量: ${order.amount}, タイプ: ${order.side}`);
              }
            }
            
            // アクティブな注文をリセット
            activeOrders.buy = null;
            activeOrders.sell = null;
          } catch (error) {
            console.error(`注文のキャンセル中にエラーが発生しました: ${symbol}`, error);
            if (postErrorToDiscord) {
              await postErrorToDiscord(`[MM] 注文のキャンセル中にエラーが発生しました: ${exchange.id} - ${symbol} - ${error.message}`);
            }
          }
          
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
          const maxBuyAmount = availableFunds * tradePercentage / formattedBuyPrice;
          const amountPrecisionToUse = amountPrecision || 8;
          let formattedAmount = parseFloat(Math.max(baseMinTradeAmount, maxBuyAmount).toFixed(amountPrecisionToUse));
          formattedAmount = Math.max(formattedAmount, baseMinTradeAmount);
          
          // 買い注文を発注（ポジション数が最大値未満の場合のみ）
          if (currentPositions < maxPositionCount && availableFunds >= formattedBuyPrice * formattedAmount) {
            try {
              const buyOrder = await exchange.createLimitBuyOrder(symbol, formattedAmount, formattedBuyPrice);
              activeOrders.buy = buyOrder;
              
              console.log(`買い注文を発注しました: ${symbol} - 価格: ${formattedBuyPrice}, 数量: ${formattedAmount}`);
              if (postOrderToDiscord) {
                await postOrderToDiscord(`[MM] 買い注文を発注しました: ${exchange.id} - ${symbol} - 価格: ${formattedBuyPrice}, 数量: ${formattedAmount}`);
              }
              
              // 注文履歴に追加
              orderHistory.push({
                time: now,
                type: 'buy',
                price: formattedBuyPrice,
                amount: formattedAmount,
                orderId: buyOrder.id
              });
            } catch (error) {
              console.error(`買い注文の発注中にエラーが発生しました: ${symbol}`, error);
              if (postErrorToDiscord) {
                await postErrorToDiscord(`[MM] 買い注文の発注中にエラーが発生しました: ${exchange.id} - ${symbol} - ${error.message}`);
              }
            }
          } else {
            console.log(`買い注文をスキップします: ${symbol} - ポジション数: ${currentPositions}/${maxPositionCount}, 利用可能資金: ${availableFunds}`);
          }
          
          // 売り注文を発注（保有資産がある場合のみ）
          if (availableAsset >= formattedAmount) {
            try {
              const sellOrder = await exchange.createLimitSellOrder(symbol, formattedAmount, formattedSellPrice);
              activeOrders.sell = sellOrder;
              
              console.log(`売り注文を発注しました: ${symbol} - 価格: ${formattedSellPrice}, 数量: ${formattedAmount}`);
              if (postOrderToDiscord) {
                await postOrderToDiscord(`[MM] 売り注文を発注しました: ${exchange.id} - ${symbol} - 価格: ${formattedSellPrice}, 数量: ${formattedAmount}`);
              }
              
              // 注文履歴に追加
              orderHistory.push({
                time: now,
                type: 'sell',
                price: formattedSellPrice,
                amount: formattedAmount,
                orderId: sellOrder.id
              });
            } catch (error) {
              console.error(`売り注文の発注中にエラーが発生しました: ${symbol}`, error);
              if (postErrorToDiscord) {
                await postErrorToDiscord(`[MM] 売り注文の発注中にエラーが発生しました: ${exchange.id} - ${symbol} - ${error.message}`);
              }
            }
          } else {
            console.log(`売り注文をスキップします: ${symbol} - 利用可能資産: ${availableAsset}, 必要: ${formattedAmount}`);
          }
          
          // 最後の注文時間を更新
          lastOrderTime = now;
        }
        
        // 約定した注文の確認と記録
        try {
          // 完了した注文を取得（過去24時間）
          const completedOrders = await exchange.fetchClosedOrders(symbol);
          
          // 新しく約定した注文を処理
          for (const order of completedOrders) {
            // 既に処理済みの注文はスキップ
            if (orderHistory.some(historyOrder => historyOrder.orderId === order.id && historyOrder.processed)) {
              continue;
            }
            
            // 約定した注文のみ処理
            if (order.status === 'closed' || order.status === 'filled') {
              console.log(`注文が約定しました: ${symbol} - 注文ID: ${order.id}, 価格: ${order.price}, 数量: ${order.amount}, タイプ: ${order.side}`);
              if (postOrderToDiscord) {
                await postOrderToDiscord(`[MM] 注文が約定しました: ${exchange.id} - ${symbol} - 注文ID: ${order.id}, 価格: ${order.price}, 数量: ${order.amount}, タイプ: ${order.side}`);
              }
              
              // 取引記録を更新
              if (updateTradeRecord) {
                updateTradeRecord(exchange.id, symbol, order.amount, order.price, order.side);
              }
              
              // 注文履歴を更新（処理済みとしてマーク）
              const historyOrderIndex = orderHistory.findIndex(historyOrder => historyOrder.orderId === order.id);
              if (historyOrderIndex !== -1) {
                orderHistory[historyOrderIndex].processed = true;
              }
              
              // 約定した注文のタイプに応じてアクティブな注文を更新
              if (order.side === 'buy') {
                activeOrders.buy = null;
                currentPositions++;
              } else if (order.side === 'sell') {
                activeOrders.sell = null;
                currentPositions = Math.max(0, currentPositions - 1);
              }
            }
          }
        } catch (error) {
          console.error(`約定した注文の確認中にエラーが発生しました: ${symbol}`, error);
          if (postErrorToDiscord) {
            await postErrorToDiscord(`[MM] 約定した注文の確認中にエラーが発生しました: ${exchange.id} - ${symbol} - ${error.message}`);
          }
        }
        
        // 次のループまで待機
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`マーケットメイキング処理中にエラーが発生しました: ${symbol}`, error);
        if (postErrorToDiscord) {
          await postErrorToDiscord(`[MM] エラー: ${exchange.id} - ${symbol} - ${error.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, 5000)); // エラー時は5秒待機
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