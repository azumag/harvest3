/**
 * 陰陽戦略
 * 過去の１分足のローソク足をみて、陰線が２連続なら売り、陽線が2連続なら買い
 */

const { config } = require('../../config');
const { orderCheckCancel } = require('./highFrequencyTrading');
const marketDataProvider = require('../../data/marketDataProvider');

/**
 * 陰陽戦略
 * 陰線が2連続なら売り、陽線が2連続なら買い
 * @param {Object} exchange - ccxtの取引所オブジェクト
 * @param {String} symbol - 通貨ペア
 * @param {Object} options - その他のオプション
 */
async function inyoStrategy(exchange, symbol, options = {}) {
  try {
    // MONA/JPYは除外
    if (symbol === 'MONA/JPY') {
      console.log('MONA/JPY は陰陽戦略の対象外です');
      return {
        strategy: 'Inyo',
        symbol,
        signal: 'none',
        reason: 'MONA/JPY excluded'
      };
    }

    // オプションから値を取得
    const { pricePrecision, amountPrecision, minTradeAmount, postOrderToDiscord, tradePercentage = 0.01, sellPercentage = 0.1, updateTradeRecord, tradeRecords } = options;

    // 過去のローソク足データを取得（過去3本分のローソク足）
    const ohlcv = await exchange.fetchOHLCV(symbol, '1m', undefined, 3);

    if (ohlcv.length < 3) {
      console.log(`十分なローソク足データがありません: ${symbol}`);
      return {
        strategy: 'Inyo',
        symbol,
        signal: 'none',
        reason: 'insufficient data'
      };
    }

    // 直近の3本のローソク足を取得
    const candle1 = ohlcv[ohlcv.length - 1]; // 最新
    const candle2 = ohlcv[ohlcv.length - 2]; // 1つ前
    const candle3 = ohlcv[ohlcv.length - 3]; // 2つ前

    // ローソク足の始値と終値を取得
    const open1 = candle1[1];
    const close1 = candle1[4];
    const open2 = candle2[1];
    const close2 = candle2[4];

    // 陰線か陽線かを判定
    const isRed1 = close1 < open1; // 陰線: 終値 < 始値
    const isRed2 = close2 < open2; // 陰線: 終値 < 始値
    const isGreen1 = close1 > open1; // 陽線: 終値 > 始値
    const isGreen2 = close2 > open2; // 陽線: 終値 > 始値

    // 価格変化がない場合は除外
    if (close1 === open1 || close2 === open2) {
      console.log(`価格変化がないため、シグナルなし: ${symbol}`);
      return {
        strategy: 'Inyo',
        symbol,
        signal: 'none',
        reason: 'no price change'
      };
    }

    // 現在の価格を取得
    const ticker = await marketDataProvider.fetchTicker(exchange, symbol);
    const currentPrice = ticker.last;

    // シグナルを判定
    // const buySignal = isGreen1 && isGreen2;  // 2連続の陽線
    // const sellSignal = isRed1 && isRed2;    // 2連続の陰線
    const buySignal = isGreen1;  // 陽線
    const sellSignal = isRed1;    // 陰線

    // 戦略キー
    const strategyKey = 'INYO';

    // 銘柄ごとの前回のシグナルを確認
    const hasTradeRecords = tradeRecords &&
                           tradeRecords[exchange.id] &&
                           tradeRecords[exchange.id][symbol] &&
                           tradeRecords[exchange.id][symbol][strategyKey];

    // 注文を作成
    if (buySignal) {
      // 既にこの戦略で売りが決まるまで買わない
      if (hasTradeRecords && tradeRecords[exchange.id][symbol][strategyKey].lastSignal === 'buy') {
        console.log(`既に買いポジションを保有しているため、買いシグナルをスキップ: ${symbol}`);
        return {
          strategy: 'Inyo',
          symbol,
          signal: 'none',
          reason: 'already has buy position'
        };
      }

      // 買いシグナル
      console.log(`陰陽戦略 買いシグナル: ${symbol} - 陽線を検出`);
      if (postOrderToDiscord) {
        await postOrderToDiscord(`[陰陽戦略] 買いシグナル: ${exchange.id} - ${symbol} - 陽線を検出`);
      }

      // 利用可能な資金を確認
      const balance = await exchange.fetchBalance();
      const baseCurrency = symbol.split('/')[1];
      const availableFunds = balance.free[baseCurrency];

      // 利用可能な資金の割合に基づいて取引量を計算
      const maxBuyAmount = availableFunds * tradePercentage / currentPrice;
      // 取引量を計算（最小取引量と計算した最大取引量の大きい方を使用）
      const tradeAmount = Math.max(minTradeAmount, maxBuyAmount);
      // 精度を考慮して、最小精度以上の値を確保
      let formattedAmount = parseFloat(tradeAmount.toFixed(amountPrecision));
      // 0.0001 単位を下回らない
      formattedAmount = Math.max(formattedAmount, 0.0001);

      if (availableFunds >= currentPrice * formattedAmount) {
        // 買い注文を作成
        // 注文数をチェックし、必要に応じて古い注文をキャンセル
        // await orderCheckCancel(exchange, symbol, config.cancelOrderThreshold, postOrderToDiscord);
        // 成行注文
        const order = await exchange.createMarketBuyOrder(symbol, formattedAmount);
        if (postOrderToDiscord) {
          await postOrderToDiscord(`[陰陽戦略] 買い注文実行: ${exchange.id} - ${symbol} - 数量: ${formattedAmount}`);
        }

        // 取引記録を更新
        if (updateTradeRecord) {
          updateTradeRecord(exchange.id, symbol, formattedAmount, currentPrice, 'buy', strategyKey, order.id, 'market');

          // 最後のシグナルを記録
          if (!tradeRecords[exchange.id][symbol][strategyKey].lastSignal) {
            tradeRecords[exchange.id][symbol][strategyKey].lastSignal = 'buy';
          } else {
            tradeRecords[exchange.id][symbol][strategyKey].lastSignal = 'buy';
          }
        }
      } else {
        console.log(`資金不足のため注文をスキップ: ${symbol} - 必要: ${currentPrice * formattedAmount}, 利用可能: ${availableFunds}`);
        if (postOrderToDiscord) {
          await postOrderToDiscord(`[陰陽戦略] 資金不足のため買い注文をスキップ: ${exchange.id} - ${symbol} - 必要: ${currentPrice * formattedAmount}, 利用可能: ${availableFunds}`);
        }
      }
    } else if (sellSignal) {
      // 既にこの戦略で買いが決まるまで売らない
      if (hasTradeRecords && tradeRecords[exchange.id][symbol][strategyKey].lastSignal === 'sell') {
        console.log(`既に売りポジションを保有しているため、売りシグナルをスキップ: ${symbol}`);
        return {
          strategy: 'Inyo',
          symbol,
          signal: 'none',
          reason: 'already has sell position'
        };
      }

      // 売りシグナル
      console.log(`陰陽戦略 売りシグナル: ${symbol} - 陰線を検出`);
      if (postOrderToDiscord) {
        await postOrderToDiscord(`[陰陽戦略] 売りシグナル: ${exchange.id} - ${symbol} - 陰線を検出`);
      }

      // 利用可能な資産を確認
      const balance = await exchange.fetchBalance();
      const quoteCurrency = symbol.split('/')[0];
      const availableAsset = balance.free[quoteCurrency];

      // 取引記録から買った量を取得
      let buyAmount = 0;
      if (updateTradeRecord && hasTradeRecords) {
        buyAmount = tradeRecords[exchange.id][symbol][strategyKey].netPosition;
        if (Number.isNaN(buyAmount)) {
          buyAmount = 0;
        } // NaNの場合は0にする
        if (buyAmount < 0) {
          buyAmount = 0;
        } // 負の値にならないように
      }

      // 売却量を計算（買った分だけを売却）
      let sellAmount = buyAmount;

      // 買った記録がなくても、利用可能な資産があれば残高 * sellPercentageと最小単位の大きい方を売却
      if (sellAmount <= 0 && availableAsset >= minTradeAmount) {
        sellAmount = Math.max(minTradeAmount, availableAsset * sellPercentage);
      }

      // 利用可能な資産を超えないようにする
      sellAmount = Math.min(sellAmount, availableAsset);

      // 取引量を計算（最小取引量と計算した売却量の大きい方を使用）
      const tradeAmount = Math.max(minTradeAmount, sellAmount);
      // 精度を考慮して、最小精度以上の値を確保
      let formattedAmount = parseFloat(tradeAmount.toFixed(amountPrecision));
      // 0.0001 単位で取引
      formattedAmount = Math.max(formattedAmount, 0.0001);

      if (availableAsset >= formattedAmount) {
        // 売り注文を作成
        // 注文数をチェックし、必要に応じて古い注文をキャンセル
        // await orderCheckCancel(exchange, symbol, config.cancelOrderThreshold, postOrderToDiscord);
        // 成行注文
        const order = await exchange.createMarketSellOrder(symbol, formattedAmount);
        if (postOrderToDiscord) {
          await postOrderToDiscord(`[陰陽戦略] 売り注文実行: ${exchange.id} - ${symbol} - 数量: ${formattedAmount}`);
        }

        // 取引記録を更新
        if (updateTradeRecord) {
          updateTradeRecord(exchange.id, symbol, formattedAmount, currentPrice, 'sell', strategyKey, order.id, 'market');

          // 最後のシグナルを記録
          if (!tradeRecords[exchange.id][symbol][strategyKey].lastSignal) {
            tradeRecords[exchange.id][symbol][strategyKey].lastSignal = 'sell';
          } else {
            tradeRecords[exchange.id][symbol][strategyKey].lastSignal = 'sell';
          }
        }
      } else {
        console.log(`資産不足のため注文をスキップ: ${symbol} - 必要: ${formattedAmount}, 利用可能: ${availableAsset}`);
        if (postOrderToDiscord) {
          await postOrderToDiscord(`[陰陽戦略] 資産不足のため売り注文をスキップ: ${exchange.id} - ${symbol} - 必要: ${formattedAmount}, 利用可能: ${availableAsset}`);
        }
      }
    } else {
      console.log(`陰陽戦略 シグナルなし: ${symbol} - 条件を満たしませんでした`);
    }

    return {
      strategy: 'Inyo',
      symbol,
      isRed1,
      isRed2,
      isGreen1,
      isGreen2,
      currentPrice,
      signal: buySignal ? 'buy' : (sellSignal ? 'sell' : 'none')
    };
  } catch (error) {
    console.error(`陰陽戦略でエラーが発生しました: ${symbol}`, error);
    if (options.postErrorToDiscord) {
      await options.postErrorToDiscord(`[陰陽戦略] エラー: ${exchange.id} - ${symbol} - ${error.message}`);
    }
    return {
      strategy: 'Inyo',
      symbol,
      error: error.message
    };
  }
}

module.exports = {
  inyoStrategy
};
