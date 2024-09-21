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
const profitMargin = 0.0015;  // 目標利益率（取引料を考慮）
const maxHistoryLength = 100;  // スプレッド履歴の最大長
const tradePercentage = 0.01;  // 資金の1%で取引

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

async function scalpingBot(symbol, exchange, spreadHistory) {
  spreadHistory[symbol] = spreadHistory[symbol] || [];
  const market = exchange.markets[symbol];

  if (!market) {
    const errorMessage = `マーケットデータが取得できませんでした: ${symbol} ${exchange.name}`;
    console.error(errorMessage);
    await postErrorToDiscord(errorMessage);
    return;
  }

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

  if (pricePrecision > 0 && pricePrecision < 1) {
    const priceDecimals = (pricePrecision.toString().split('.')[1] || '').length;
    console.log(` 価格精度変更: ${pricePrecision} -> ${priceDecimals}`);
    pricePrecision = priceDecimals;
  }

  let amountPrecision = market.precision ? market.precision.amount : undefined; // 取引量の精度を取得

  if (!minTradeAmount) {
    const errorMessage = `最小取引単位が取得できませんでした: ${symbol} ${exchange.name}`;
    console.error(errorMessage);
    await postErrorToDiscord(errorMessage);
    return;
  } else {
    console.log(`最小取引単位: ${symbol}: ${minTradeAmount}: ${exchange.name}`);
  }

  if (!amountPrecision) {
    const minTradeAmountDecimals = (minTradeAmount.toString().split('.')[1] || '').length;
    amountPrecision = minTradeAmountDecimals;
  }

  if (amountPrecision > 0 && amountPrecision < 1) {
    const amountDecimals = (amountPrecision.toString().split('.')[1] || '').length;
    console.log(` 量精度変更: ${amountPrecision} -> ${amountDecimals}`);
    amountPrecision = amountDecimals;
  }

  console.log({pricePrecision, amountPrecision});

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

      // 現在のスプレッドを計算
      const currentSpread = ask - bid;

      // スプレッド履歴に追加
      spreadHistory[symbol].push(currentSpread);
      if (spreadHistory[symbol].length > maxHistoryLength) {
        spreadHistory[symbol].shift();  // 履歴が最大長を超えたら古いデータを削除
      }

      // スプレッドの平均値を計算
      const averageSpread = spreadHistory[symbol].reduce((a, b) => a + b, 0) / spreadHistory[symbol].length;

      // 基準スプレッドを動的に設定（例：平均スプレッドの1.5倍）
      const dynamicSpreadThreshold = averageSpread * 1.5;

      // 価格差（スプレッド）が基準スプレッドより広い場合のみ取引を行う
      if (currentSpread > dynamicSpreadThreshold) {
        const buyPrice = parseFloat((bid + currentSpread / 2).toFixed(pricePrecision));  // 価格を精度に基づいて丸める
        const sellPrice = parseFloat((buyPrice * (1 + profitMargin)).toFixed(pricePrecision));  // 目標利益率で売却価格を設定

        // 利用可能な資金を取得
        const balance = await exchange.fetchBalance();
        const baseCurrency = symbol.split('/')[0];
        const quoteCurrency = symbol.split('/')[1];
        const availableFunds = balance.free[quoteCurrency];
        const availableBaseCurrency = balance.free[baseCurrency];

        // 購入に必要な資金を計算
        const maxBuyAmount = availableFunds * tradePercentage / buyPrice;
        const buyAmount = parseFloat(Math.max(minTradeAmount, maxBuyAmount).toFixed(amountPrecision));

        // 購入注文を送信
        if (availableFunds >= buyPrice * buyAmount) {
          console.log(`購入価格: ${buyPrice}, 売却価格: ${sellPrice} (${symbol}), 取引量: ${buyAmount}`);
          await postOrderToDiscord(`*購入注文準備: ${exchange.name}: 購入価格: ${buyPrice}, 売却価格: ${sellPrice} (${symbol}), 取引量: ${buyAmount} 量精度: ${amountPrecision} 価格精度: ${pricePrecision}`);
          const buyOrder = await exchange.createLimitBuyOrder(symbol, buyAmount, buyPrice); // 購入量を使用
          console.log('購入注文が送信されました: ', buyOrder);
          await postOrderToDiscord(`購入注文が送信されました: ${exchange.name}: ${symbol}: ${buyPrice}: ${buyAmount}`);
        } else {
          console.log(`資金不足のため、購入注文をスキップします: ${symbol}: ${exchange.name}, 資金: ${availableFunds}, 購入価格: ${buyPrice}, 取引量: ${buyAmount}`);
          await postOrderToDiscord(`資金不足のため、購入注文をスキップします: ${symbol}: ${exchange.name}, 資金: ${availableFunds}, 購入価格: ${buyPrice}, 取引量: ${buyAmount}`);
        }

        // 売却に必要な資産を計算
        const sellAmount = buyAmount;

        // 売却注文を送信
        if (availableBaseCurrency >= sellAmount) {
          await postOrderToDiscord(`&売却注文作成: ${exchange.name}: ${symbol}: ${sellPrice}: ${sellAmount} 量精度: ${amountPrecision} 価格精度: ${pricePrecision}`);
          const sellOrder = await exchange.createLimitSellOrder(symbol, sellAmount, sellPrice); // 売却量を使用
          console.log('売却注文が送信されました: ', sellOrder);
          await postOrderToDiscord(`売却注文が送信されました: ${exchange.name}: ${symbol}`);
        } else {
          console.log(`資産不足のため、売却注文をスキップします: ${symbol}: ${exchange.name}, 資産: ${availableBaseCurrency}, 売却量: ${sellAmount}`);
          await postOrderToDiscord(`資産不足のため、売却注文をスキップします: ${symbol}: ${exchange.name}, 資産: ${availableBaseCurrency}, 売却量: ${sellAmount}`);
        }

        // 注文が完了するまで待つ
        await sleep(60000);  // 1分間待機
      } else {
        console.log(`スプレッドが狭すぎるため、取引をスキップします: ${symbol}: ${exchange.name}`);
        console.log({currentSpread, averageSpread, dynamicSpreadThreshold});
        await sleep(1000); // 1秒待機
      }
    } catch (error) {
        const errorMessage = `エラーが発生しました (${symbol}): ${error.message} : ${exchange.name}`;
        console.error(errorMessage, error);
        await postErrorToDiscord(errorMessage);
        await sleep(1000); // 1秒待機
    }
  }
}

async function startBot() {
  try {
    const exchanges = [exchangeBB, exchangeBF];
    await Promise.all(exchanges.map(async (exchange) => { // 並列に実行
      const spreadHistory = {};
      const markets = await exchange.loadMarkets();
      const symbols = Object.keys(markets).filter(symbol => symbol.endsWith('/JPY')); // JPYの通貨ペアのみをフィルタリング

      // すべての通貨ペアに対して並列でscalpingBotを実行
      await Promise.all(symbols.map(symbol => scalpingBot(symbol, exchange, spreadHistory)));
    }));
  } catch (error) {
    const errorMessage = `エラーが発生しました: ${error.message}`;
    console.error(errorMessage, error);
    await postErrorToDiscord(errorMessage);
  }
}

startBot();
