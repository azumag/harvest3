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

const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL; // Discord Webhook URL

const exchangeBB = new ccxt.bitbank({
    apiKey: BBApiKey,
    secret: BBApiSecret,
});

const exchangeBF = new ccxt.bitflyer({
    apiKey: BFApiKey,
    secret: BFApiSecret,
});

const amount = 0.0001;  // 注文するBTCの量
const profitMargin = 0.0015;  // 目標利益率（取引手数料を考慮）

const maxHistoryLength = 100;  // スプレッド履歴の最大長

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

async function postToDiscord(message) {
  if (discordWebhookUrl) {
    try {
      await axios.post(discordWebhookUrl, { content: message });
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
  const minTradeAmount = (exchange.id === 'bitflyer' ? bitflyerMinTradeAmounts[symbol] : market.limits.amount.min) || 0.01; // bitflyerの場合は最小取引単位を設定
  const pricePrecision = market.precision.price; // 価格の精度を取得

  if (!minTradeAmount) {
    const errorMessage = `最小取引単位が取得できませんでした: ${symbol} ${exchange.name}`;
    console.error(errorMessage);
    await postToDiscord(errorMessage);
    return;
  } else {
    console.log(`最小取引単位: ${symbol}: ${minTradeAmount}: ${exchange.name}`);
  }

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

        console.log(`購入価格: ${buyPrice}, 売却価格: ${sellPrice} (${symbol}), 取引量: ${minTradeAmount}`);

        // 購入注文を送信
        const buyOrder = await exchange.createLimitBuyOrder(symbol, minTradeAmount, buyPrice); // 最小取引単位を使用
        console.log('購入注文が送信されました: ', buyOrder);

        // 売却注文を送信
        const sellOrder = await exchange.createLimitSellOrder(symbol, minTradeAmount, sellPrice); // 最小取引単位を使用
        console.log('売却注文が送信されました: ', sellOrder);

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
        await postToDiscord(errorMessage);
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
    const errorMessage = `エラーが発生しました: ${error.message} : ${exchange.name}`;
    console.error(errorMessage, error);
    await postToDiscord(errorMessage);
  }
}

startBot();
