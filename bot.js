const ccxt = require('ccxt');
const dotenv = require('dotenv');
const axios = require('axios');
dotenv.config(); // .envファイルから環境変数を読み込む
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// APIキーとシークレットを設定（bitbankのAPI）
const BBApiKey = process.env.BB_API_KEY;
const BBApiSecret = process.env.BB_API_SECRET;

const BFApiKey = process.env.BF_API_KEY;
const BFApiSecret = process.env.BF_API_SECRET;

const discordErrorWebhookUrl = process.env.DISCORD_ERROR_WEBHOOK_URL; // Discord Webhook URL
const discordOrderWebhookUrl = process.env.DISCORD_ORDER_WEBHOOK_URL; // Discord Webhook URL
const discordResultWebhookUrl = process.env.DISCORD_RESULT_WEBHOOK_URL; // Discord Webhook URL

const exchangeBB = new ccxt.bitbank({
    apiKey: BBApiKey,
    secret: BBApiSecret,
});

const exchangeBF = new ccxt.bitflyer({
    apiKey: BFApiKey,
    secret: BFApiSecret,
});

const bitflyerMinTradeAmounts = {
  'BTC/JPY': 0.001,
  'ELF/JPY': 0.01,
  'ETH/BTC': 0.01,
  'BCH/BTC': 0.01,
  'ETH/JPY': 0.01,
  'XRP/JPY': 0.1,
  'XLM/JPY': 0.1,
  'MONA/JPY': 0.1,
};

const amount = 0.0001;  // 注文するBTCの量
const profitMargin = 0.003;  // 目標利益率（取引料を考慮）
const maxHistoryLength = 100;  // スプレッド履歴の最大長
const tradePercentage = 0.02;  // 資金の%で取引
const tradeCost = 0.0012; // 手数料暫定（bitbank)
const cancelOrderThreshold = 30; // 一銘柄ごとの注文限度数

async function postErrorToDiscord(message) {
  if (discordErrorWebhookUrl) {
    try {
      await axios.post(discordErrorWebhookUrl, { content: message });
    } catch (error) {
      console.error('Discordへの通知に失敗しました: ', error);
    }
  } else {
    console.error('Discord Webhook URLが設定されていません');
  }
}

async function postOrderToDiscord(message) {
  if (discordOrderWebhookUrl) {
    try {
      await axios.post(discordOrderWebhookUrl, { content: message });
    } catch (error) {
      console.error('Discordへの通知に失敗しました: ', error);
    }
  } else {
    console.error('Discord Webhook URLが設定されていません');
  }
}

async function postResultToDiscord(message) {
  if (discordResultWebhookUrl) {
    try {
      await axios.post(discordResultWebhookUrl, { content: message });
    } catch (error) {
      console.error('Discordへの通知に失敗しました: ', error);
    }
  } else {
    console.error('Discord Webhook URLが設定されていません');
  }
}

function weightedAverage(prices, amounts) {
  const totalAmount = amounts.reduce((acc, val) => acc + val, 0);
  return prices.reduce((acc, price, index) => acc + (price * amounts[index]), 0) / totalAmount;
}

async function scalpingBot(symbol, exchange, spreadHistory) {
  spreadHistory[symbol] = spreadHistory[symbol] || [];
  const market = exchange.markets[symbol];

  if (!market) {
    const errorMessage = `マーケットデータが取得できませんでした: ${symbol} ${exchange.name}`;
    console.error(errorMessage);
    await postErrorToDiscord(errorMessage);
    return;
  }

  // 手数料を取得 (取引所によって異なるため分岐)
  // let takerFee = 0;
  // if (exchange.has['fetchTradingFees']) {
  //   try {
  //     const fees = await exchange.fetchTradingFees();
  //     takerFee = fees[symbol]?.taker || 0; // taker手数料を取得、なければ0
  //   } catch (error) {
  //     console.error(`手数料の取得に失敗しました: ${symbol} ${exchange.name}`, error);
  //     await postErrorToDiscord(`手数料の取得に失敗しました: ${symbol} ${exchange.name}`);
  //   }
  // } else if (market.taker) {
  //   takerFee = market.taker; // マーケットから手数料を取得
  // }

  const minTradeAmount = (exchange.id === 'bitflyer' ? bitflyerMinTradeAmounts[symbol] : market.limits.amount.min) || amount; // bitflyerの場合は最小取引単位を設定
  let pricePrecision = market.precision ? market.precision.price : undefined; // 価格の精度を取得

  if (!pricePrecision) {
    try {
      // tickerを取得して価格精度を計算
      const ticker = await exchange.fetchTicker(symbol);
      const lastPrice = ticker.last;

      if (lastPrice) {
        const priceDecimals = (lastPrice.toString().split('.')[1] || '').length;
        pricePrecision = priceDecimals;
      } else {
        const errorMessage = `ティッカーのlast価格が取得できませんでした: ${symbol} ${exchange.name}`;
        console.error(errorMessage);
        await postErrorToDiscord(errorMessage);
        return;
      }
    } catch (error) {
      const errorMessage = `価格精度が取得できず、ティッカーの取得にも失敗しました: ${symbol} ${exchange.name}`;
      console.error(errorMessage, error);
      await postErrorToDiscord(errorMessage);
      return;
    }
  }

  // 手数料を考慮した目標利益率を設定
  // const totalProfitMargin = profitMargin + takerFee * 2; // 買いと売りの手数料両方を加算
  // console.log(`手数料を考慮した目標利益率: ${totalProfitMargin} (${symbol})`);

  if (pricePrecision > 0 && pricePrecision < 1) {
    const priceDecimals = (pricePrecision.toString().split('.')[1] || '').length;
    console.log(` 価格精度変換: ${pricePrecision} -> ${priceDecimals}`);
    pricePrecision = priceDecimals;
  }

  let amountPrecision = market.precision ? market.precision.amount : undefined; // 取引量の精度を取得

  if (!minTradeAmount) {
    const errorMessage = `最小取引単位が取得できませんでした: ${symbol} ${exchange.name}`;
    console.error(errorMessage);
    await postErrorToDiscord(errorMessage);
    return;
  } else {
    // console.log(`最小取引単位: ${symbol}: ${minTradeAmount}: ${exchange.name}`);
  }

  if (!amountPrecision) {
    const minTradeAmountDecimals = (minTradeAmount.toString().split('.')[1] || '').length;
    amountPrecision = minTradeAmountDecimals;
  }

  if (amountPrecision > 0 && amountPrecision < 1) {
    const amountDecimals = (amountPrecision.toString().split('.')[1] || '').length;
    console.log(` 量精度変換: ${amountPrecision} -> ${amountDecimals}`);
    amountPrecision = amountDecimals;
  }

  // console.log({pricePrecision, amountPrecision});

  while (true) {
    try {
      // オーダーブックを取得
      const orderBook = await exchange.fetchOrderBook(symbol);
      const bid = orderBook.bids.length ? orderBook.bids[0][0] : undefined;  // 買い注文の最高値
      const ask = orderBook.asks.length ? orderBook.asks[0][0] : undefined;  // 売り注文の最安値
      
      if (!bid || !ask) {
        console.log(`オーダーブックが空です: ${symbol}: ${exchange.name}`);
        await sleep(1000); // 1秒待機
        continue;
      }

      // スプレッドを計算
      const currentSpread = ask - bid;
   
      // スプレッド履歴に追加
      spreadHistory[symbol].push(currentSpread);
      if (spreadHistory[symbol].length > maxHistoryLength) {
        spreadHistory[symbol].shift();  // 履歴が最大長を超えたら古いデータを削除
      }

      // スプレッドの平均値を計算
      const averageSpread = spreadHistory[symbol].reduce((a, b) => a + b, 0) / spreadHistory[symbol].length;

      // BFは手数料が高いので高い利益率を設定しないと損をする
      const adjustedProfitMargin = (exchange.id === 'bitflyer' ? profitMargin * 1.5 : profitMargin);

      // 価格差（スプレッド）が基準スプレッドより広い場合のみ取引を行う
      // console.log(`${symbol}: ${exchange.name} スプレッド: ${currentSpread}, 平均スプレッド: ${averageSpread}, 想定利益率: ${ask/bid}, 加重売平均 ${ask}, 加重買平均 ${bid}`);
      console.log(`${symbol}: ${exchange.name} 想定利益率: ${ask/bid}`);
      
      if ((ask/bid) > (1 + adjustedProfitMargin)) {
        const ticker = await exchange.fetchTicker(symbol);
        const lastPrice = ticker.last;
        
        const buyPrice = parseFloat(lastPrice - (lastPrice * (adjustedProfitMargin / 2))).toFixed(pricePrecision);  // 価格を精度に基づいて丸める
        const sellPrice = parseFloat(lastPrice + (lastPrice * (adjustedProfitMargin / 2))).toFixed(pricePrecision);

        // 利用可能な資金を取得
        const balance = await exchange.fetchBalance();
        const baseCurrency = symbol.split('/')[0];
        const quoteCurrency = symbol.split('/')[1];
        const availableFunds = balance.free[quoteCurrency];
        const availableBaseCurrency = balance.free[baseCurrency];

        // 購入に必要な資金を計算
        const maxBuyAmount = availableFunds * tradePercentage / buyPrice;
        const buyAmount = parseFloat(Math.max(minTradeAmount, maxBuyAmount).toFixed(amountPrecision));
        // 売却に必要な資産を計算
        const sellAmount = buyAmount;

        const buyCost = buyAmount * buyPrice * tradeCost;
        const sellCost = sellAmount * sellPrice * tradeCost;

        // 購入注文を送信
        if (availableFunds >= buyPrice * buyAmount) {
          await orderCheckCancel(exchange, symbol);
          console.log(`購入価格: ${buyPrice}, 売却価格: ${sellPrice} (${symbol}), 取引量: ${buyAmount}`);
          postOrderToDiscord(`* 注文: ${exchange.name}: 購入価格: ${buyPrice}, 売却価格: ${sellPrice} (${symbol}), 取引量: ${buyAmount}`);
          const buyOrder = await exchange.createLimitBuyOrder(symbol, buyAmount, buyPrice);
          postOrderToDiscord(`== * 購入注文が受理されました: ${exchange.name}: ${symbol} 想定利益 ${(sellPrice*sellAmount-sellCost) - (buyPrice*buyAmount+buyCost).toFixed(4)} JPY`);
        } else {
          console.log(`資金不足のため、購入注文をスキップします: ${symbol}: ${exchange.name}, 資金: ${availableFunds}, 購入価格: ${buyPrice}, 取引量: ${buyAmount}`);
          postOrderToDiscord(`資金不足のため、購入注文をスキップします: ${symbol}: ${exchange.name}, 資金: ${availableFunds}, 購入価格: ${buyPrice}, 取引量: ${buyAmount}`);
        }

        // 売却注文を送信
        if (availableBaseCurrency >= sellAmount) {
          await orderCheckCancel(exchange, symbol);
          postOrderToDiscord(`& 売却注文作成: ${exchange.name}: ${symbol}: ${sellPrice}: ${sellAmount}`);
          const sellOrder = await exchange.createLimitSellOrder(symbol, sellAmount, sellPrice)
          postOrderToDiscord(`== & 売却注文が受理されました: ${exchange.name}: ${symbol} 想定利益 ${(sellPrice*sellAmount-sellCost) - (buyPrice*buyAmount+buyCost).toFixed(4)} JPY`);
        } else {
          console.log(`資産不足のため、売却注文をスキップします: ${symbol}: ${exchange.name}, 資産: ${availableBaseCurrency}, 売却量: ${sellAmount}`);
          postOrderToDiscord(`資産不足のため、売却注文をスキップします: ${symbol}: ${exchange.name}, 資産: ${availableBaseCurrency}, 売却量: ${sellAmount}`);
        }

        // 注文が完了するまで待つ
        await sleep(60000);  // 1分間待機
      } else {
        console.log(`取引をスキップします: ${symbol}: ${exchange.name}`);
        // await sleep(1000); // 1秒待機
      }
    } catch (error) {
        const errorMessage = `エラーが発生しました (${symbol}): ${error.message} : ${exchange.name}`;
        console.error(errorMessage, error);
        await postErrorToDiscord(errorMessage);
        await sleep(1000); // 1秒待機
    }
  }
}

async function orderCheckCancel(exchange, symbol) {
  const orders = await exchange.fetchOpenOrders(symbol);

  // 過去の注文が30以上ある場合、一番古い注文をキャンセル
  if (orders.length >= cancelOrderThreshold) {
    const oldestOrder = orders[0]; // 一番古い注文
    await exchange.cancelOrder(oldestOrder.id, symbol);
    await postOrderToDiscord(`古い注文をキャンセルしました: ${exchange.id} - ${symbol} : ${oldestOrder.id}`);
  }

  return;
}

async function fetchTotal(exchange, symbol) {
  try {
    const since = Date.now() - (24 * 60 * 60 * 1000); // 1日前のUNIXタイムスタンプを取得（ミリ秒単位）
    const trades = await exchange.fetchMyTrades(symbol, since); // 取引履歴を取得

    let totalSell = 0;
    let totalBuy = 0;

    for (const trade of trades) {
      let amount;
      let cost;

      if (trade.fee) {
        if (trade.fee.currency === 'JPY') {
          amount = trade.amount;
          cost = trade.fee.cost;
        } else {
          amount = trade.amount - trade.fee.cost;
          cost = 0;
        }
      } else {
        amount = trade.amount;
        cost = 0;
      }

      const delta = (trade.price * amount);

      if (trade.side === 'sell') {
        totalSell += delta - cost;
      } else if (trade.side === 'buy') {
        totalBuy += delta + cost;
      }
    }

    return totalSell - totalBuy; // 総損益を返す
  } catch (error) {
    console.error('損益の取得に失敗しました:', error);
    postErrorToDiscord(`損益の取得に失敗しました ${error.message}`);
    return 0; // エラー時は0を返す
  }
}

async function postReport(exchange) {
  const markets = await exchange.loadMarkets();
  const symbols = Object.keys(markets).filter(symbol => 
    symbol.endsWith('/JPY') && !symbol.startsWith('ELF/') // ELFを除外
  ); // JPYの通貨ペアのみをフィルタリング

  const totalPromises = symbols.map(symbol => fetchTotal(exchange, symbol)); // 各通貨ペアの損益を取得するPromiseの配列を作成

  Promise.all(totalPromises)
    .then(totals => {
      const exchangeTitle = `--- ${exchange.id}`;
      const totalMessage = totals.map((total, index) => `${symbols[index]}: *${total.toFixed(5)} JPY*`).join('\n'); // メッセージを作成
      const total = totals.reduce((accumulator, currentValue) => accumulator + currentValue, 0); // totalsの合計を計算
      return postResultToDiscord(exchangeTitle + `: ${total} JPY --- \n` + totalMessage); // Discordに一度だけ投稿
    })
    .catch(error => {
      console.error('損益の取得中にエラーが発生しました:', error);
    });

  const totalJPYValue = await calculateTotalJPYValue(exchange);
  postResultToDiscord(`=== TOTAL: ${exchange.id} ${totalJPYValue} ===`);
}

async function calculateTotalJPYValue(exchange) {
  const balance = await exchange.fetchBalance(); // 現在の資産を取得
  const markets = await exchange.loadMarkets(); // マーケット情報を取得
  let totalJPYValue = 0;

  console.log({balance});

  for (const currency in balance.total) {
    const amount = balance.total[currency]; // 各通貨の量を取得
    if (currency === 'JPY') {
      totalJPYValue += amount;
    } else {
      if (amount > 0) {
        const symbol = `${currency}/JPY`; // 通貨ペアを作成
        if (markets[symbol]) {
          const ticker = await exchange.fetchTicker(symbol); // 対日本円の価格を取得
          const price = ticker.last; // 最後の価格を取得
          totalJPYValue += amount * price; // 評価額を計算
        }
      }
    }
  }

  return totalJPYValue; // 総JPY評価額を返す
}


// レポートを投稿するためのタイマー設定
setInterval(() => {
  const now = new Date();
  if (now.getMinutes() === 0) { // 時間ごと
    postReport(exchangeBB);
    postReport(exchangeBF);
  }
}, 60000); // 1分ごとにチェック

async function startBot() {
  try {
    const exchanges = [exchangeBB, exchangeBF];

    await Promise.all(exchanges.map(async (exchange) => { // 並列に実行
      const spreadHistory = {};
      const markets = await exchange.loadMarkets();
      const symbols = Object.keys(markets).filter(symbol => 
        symbol.endsWith('/JPY') && !symbol.startsWith('ELF/') // ELFを除外
      ); // JPYの通貨ペアのみをフィルタリング

      // すべての通貨ペアに対して並列でscalpingBotを実行
      await Promise.all(symbols.map(symbol => scalpingBot(symbol, exchange, spreadHistory)));
    }));
  } catch (error) {
    const errorMessage = `エラーが発生しました: ${error.message}`;
    console.error(errorMessage, error);
    await postErrorToDiscord(errorMessage);
  }
}

postReport(exchangeBB);
postReport(exchangeBF);

startBot();
