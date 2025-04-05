const ccxt = require('ccxt');
const dotenv = require('dotenv');
const axios = require('axios');
dotenv.config(); // .envファイルから環境変数を読み込む
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 戦略モジュールをインポート
const strategies = require('./strategies');

// APIキーとシークレットを設定
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

// 取引記録を保持するグローバル変数
// 構造: { exchangeId: { symbol: { strategy: { buyAmount: number, timestamp: number } } } }
const tradeRecords = {};

/**
 * 購入記録を追加する関数
 * @param {String} exchangeId - 取引所ID
 * @param {String} symbol - 通貨ペア
 * @param {String} strategy - 戦略名
 * @param {Number} amount - 購入量
 */
function addBuyRecord(exchangeId, symbol, strategy, amount) {
  if (!tradeRecords[exchangeId]) {
    tradeRecords[exchangeId] = {};
  }
  if (!tradeRecords[exchangeId][symbol]) {
    tradeRecords[exchangeId][symbol] = {};
  }
  tradeRecords[exchangeId][symbol][strategy] = {
    buyAmount: amount,
    timestamp: Date.now()
  };
  console.log(`購入記録を追加: ${exchangeId} - ${symbol} - ${strategy} - ${amount}`);
}

/**
 * 売却可能量を取得する関数
 * @param {String} exchangeId - 取引所ID
 * @param {String} symbol - 通貨ペア
 * @param {String} strategy - 戦略名
 * @param {Number} availableAmount - 利用可能な残高
 * @returns {Number} 売却可能量
 */
function getSellAmount(exchangeId, symbol, strategy, availableAmount) {
  if (
    tradeRecords[exchangeId] &&
    tradeRecords[exchangeId][symbol] &&
    tradeRecords[exchangeId][symbol][strategy]
  ) {
    // 記録がある場合は、その量を返す（ただし利用可能量を超えないようにする）
    return Math.min(tradeRecords[exchangeId][symbol][strategy].buyAmount, availableAmount);
  }
  // 記録がない場合でも、利用可能な残高があれば売ることができる
  return availableAmount;
}

// 設定パラメータ
const config = {
  // 共通設定
  amount: 0.0001,  // 注文するBTCの量
  profitMargin: 0.003,  // 目標利益率（取引料を考慮）
  maxHistoryLength: 100,  // スプレッド履歴の最大長
  tradePercentage: 0.02,  // 資金の%で取引
  sellPercentage: 0.1, // 売却可能量の%で取引
  tradeCost: 0.0012, // 手数料暫定（bitbank)
  cancelOrderThreshold: 10, // 一銘柄ごとの注文限度数
  safetyJPYAmount: 2000, // JPY残高がこの額を下回ったら購入しない(HFTのときのみ)
  
  // 戦略固有の設定
  strategies: {
    // トレンドフォロー戦略
    MA: {
      enabled: process.env.STRATEGY_MA_ENABLED === 'true',
      shortPeriod: 5,
      longPeriod: 20
    },
    MACD: {
      enabled: process.env.STRATEGY_MACD_ENABLED === 'true',
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9
    },
    RSI: {
      enabled: process.env.STRATEGY_RSI_ENABLED === 'true',
      period: 14,
      oversoldThreshold: 30,
      overboughtThreshold: 70
    },
    BOLLINGER_BANDS: {
      enabled: process.env.STRATEGY_BOLLINGER_BANDS_ENABLED === 'true',
      period: 20,
      stdDev: 2
    },
    
    // 逆張り戦略
    MEAN_REVERSION: {
      enabled: process.env.STRATEGY_MEAN_REVERSION_ENABLED === 'true',
      period: 20,
      deviationThreshold: 3
    },
    OSCILLATOR: {
      enabled: process.env.STRATEGY_OSCILLATOR_ENABLED === 'true',
      period: 14,
      oversoldThreshold: 20,
      overboughtThreshold: 80
    },
    
    // アービトラージ戦略
    INTER_EXCHANGE_ARBITRAGE: {
      enabled: process.env.STRATEGY_ARBITRAGE_ENABLED === 'true',
      minProfitPercent: 1.0
    },
    
    // 高頻度取引戦略
    HFT: {
      enabled: process.env.STRATEGY_HIGH_FREQUENCY_ENABLED === 'true',
      interval: 1000,
      priceThreshold: 0.05,
      maxOrdersPerMinute: 10
    },
    SCALPING: {
      enabled: process.env.STRATEGY_SCALPING_ENABLED === 'true'
    }
  }
};

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

/**
 * 指定された戦略を実行する関数
 * @param {String} strategyKey - 戦略のキー
 * @param {Object} exchange - 取引所オブジェクト
 * @param {String} symbol - 通貨ペア
 * @param {Object} options - オプション
 */
async function runStrategy(strategyKey, exchange, symbol, options = {}) {
  try {
    const strategyConfig = config.strategies[strategyKey];
    if (!strategyConfig || !strategyConfig.enabled) {
      return null;
    }
    
    // 取引記録関連の関数をオプションに追加
    options.addBuyRecord = (amount) => addBuyRecord(exchange.id, symbol, strategyKey, amount);
    options.getSellAmount = (availableAmount) => getSellAmount(exchange.id, symbol, strategyKey, availableAmount);
    options.tradePercentage = config.tradePercentage;
    
    // 戦略に応じたパラメータを設定
    const params = [];
    
    switch (strategyKey) {
      case 'MA':
        params.push(exchange, symbol, strategyConfig.shortPeriod, strategyConfig.longPeriod, config.amount, options);
        break;
      case 'MACD':
        params.push(exchange, symbol, strategyConfig.fastPeriod, strategyConfig.slowPeriod, strategyConfig.signalPeriod, config.amount, options);
        break;
      case 'RSI':
        params.push(exchange, symbol, strategyConfig.period, strategyConfig.oversoldThreshold, strategyConfig.overboughtThreshold, config.amount, options);
        break;
      case 'BOLLINGER_BANDS':
        params.push(exchange, symbol, strategyConfig.period, strategyConfig.stdDev, config.amount, options);
        break;
      case 'MEAN_REVERSION':
        params.push(exchange, symbol, strategyConfig.period, strategyConfig.deviationThreshold, config.amount, options);
        break;
      case 'OSCILLATOR':
        params.push(exchange, symbol, strategyConfig.period, strategyConfig.oversoldThreshold, strategyConfig.overboughtThreshold, config.amount, options);
        break;
      case 'INTER_EXCHANGE_ARBITRAGE':
        // アービトラージは複数の取引所を必要とするため、別途処理
        return null;
      case 'HFT':
        params.push(exchange, symbol, strategyConfig.interval, strategyConfig.priceThreshold, config.amount, options);
        break;
      case 'SCALPING':
        params.push(exchange, symbol, options.spreadHistory || {}, options);
        break;
      default:
        console.log(`未知の戦略: ${strategyKey}`);
        return null;
    }
    
    // 戦略を実行
    return await strategies.executeStrategy(strategyKey, params);
  } catch (error) {
    console.error(`戦略の実行中にエラーが発生しました: ${strategyKey} - ${symbol}`, error);
    if (options.postErrorToDiscord) {
      await options.postErrorToDiscord(`戦略の実行中にエラーが発生しました: ${strategyKey} - ${exchange.id} - ${symbol} - ${error.message}`);
    }
    return null;
  }
}

/**
 * アービトラージ戦略を実行する関数
 * @param {Array} exchanges - 取引所オブジェクトの配列
 * @param {String} symbol - 通貨ペア
 * @param {Object} options - オプション
 */
async function runArbitrageStrategy(exchanges, symbol, options = {}) {
  try {
    const strategyConfig = config.strategies.INTER_EXCHANGE_ARBITRAGE;
    if (!strategyConfig || !strategyConfig.enabled) {
      return null;
    }
    
    // 取引記録関連の関数をオプションに追加
    const arbitrageOptions = {
      ...options,
      bitflyerMinTradeAmounts,
      tradePercentage: config.tradePercentage,
      addBuyRecord: (exchangeId, amount) => addBuyRecord(exchangeId, symbol, 'INTER_EXCHANGE_ARBITRAGE', amount),
      getSellAmount: (exchangeId, availableAmount) => getSellAmount(exchangeId, symbol, 'INTER_EXCHANGE_ARBITRAGE', availableAmount)
    };
    
    const params = [
      exchanges,
      symbol,
      strategyConfig.minProfitPercent,
      config.amount,
      arbitrageOptions
    ];
    
    return await strategies.executeStrategy('INTER_EXCHANGE_ARBITRAGE', params);
  } catch (error) {
    console.error(`アービトラージ戦略の実行中にエラーが発生しました: ${symbol}`, error);
    if (options.postErrorToDiscord) {
      await options.postErrorToDiscord(`アービトラージ戦略の実行中にエラーが発生しました: ${symbol} - ${error.message}`);
    }
    return null;
  }
}

/**
 * 複数の戦略を実行する関数
 * @param {Object} exchange - 取引所オブジェクト
 * @param {String} symbol - 通貨ペア
 * @param {Object} options - オプション
 */
async function runStrategies(exchange, symbol, options = {}) {
  try {
    const market = exchange.markets[symbol];
    if (!market) {
      console.error(`マーケットデータが取得できませんでした: ${symbol} ${exchange.id}`);
      return;
    }
    
    // 市場情報を取得
    let pricePrecision = market.precision ? market.precision.price : undefined;
    let amountPrecision = market.precision ? market.precision.amount : undefined;
    
    if (!pricePrecision) {
      try {
        const ticker = await exchange.fetchTicker(symbol);
        const lastPrice = ticker.last;
        
        if (lastPrice) {
          const priceDecimals = (lastPrice.toString().split('.')[1] || '').length;
          pricePrecision = priceDecimals;
        }
      } catch (error) {
        console.error(`価格精度の取得に失敗しました: ${symbol} ${exchange.id}`, error);
      }
    }
    
    const minTradeAmount = (exchange.id === 'bitflyer' && bitflyerMinTradeAmounts[symbol]) 
      ? bitflyerMinTradeAmounts[symbol] 
      : (market.limits?.amount?.min || config.amount);
    
    if (!amountPrecision && minTradeAmount) {
      const minTradeAmountDecimals = (minTradeAmount.toString().split('.')[1] || '').length;
      amountPrecision = minTradeAmountDecimals;
    }
    
    // 共通オプションを設定
    const commonOptions = {
      pricePrecision,
      amountPrecision,
      minTradeAmount,
      postOrderToDiscord,
      postErrorToDiscord,
      spreadHistory: options.spreadHistory || {},
      bitflyerMinTradeAmounts
    };
    
    // 各戦略を実行
    const results = [];
    
    // 戦略を実行
    
    // トレンドフォロー戦略
    if (config.strategies.MA.enabled) {
      const result = await runStrategy('MA', exchange, symbol, commonOptions);
      if (result) results.push(result);
    }
    
    if (config.strategies.MACD.enabled) {
      const result = await runStrategy('MACD', exchange, symbol, commonOptions);
      if (result) results.push(result);
    }
    
    if (config.strategies.RSI.enabled) {
      const result = await runStrategy('RSI', exchange, symbol, commonOptions);
      if (result) results.push(result);
    }
    
    if (config.strategies.BOLLINGER_BANDS.enabled) {
      const result = await runStrategy('BOLLINGER_BANDS', exchange, symbol, commonOptions);
      if (result) results.push(result);
    }
    
    // 逆張り戦略
    if (config.strategies.MEAN_REVERSION.enabled) {
      const result = await runStrategy('MEAN_REVERSION', exchange, symbol, commonOptions);
      if (result) results.push(result);
    }
    
    if (config.strategies.OSCILLATOR.enabled) {
      const result = await runStrategy('OSCILLATOR', exchange, symbol, commonOptions);
      if (result) results.push(result);
    }
    
    // 高頻度取引戦略
    if (config.strategies.SCALPING.enabled) {
      const result = await runStrategy('SCALPING', exchange, symbol, commonOptions);
      if (result) results.push(result);
    }
    
    return results;
  } catch (error) {
    console.error(`戦略の実行中にエラーが発生しました: ${symbol} ${exchange.id}`, error);
    await postErrorToDiscord(`戦略の実行中にエラーが発生しました: ${symbol} ${exchange.id} - ${error.message}`);
    return [];
  }
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
    
    // 高頻度取引戦略（HFT）を実行
    if (config.strategies.HFT.enabled) {
      for (const exchange of exchanges) {
        const markets = await exchange.loadMarkets();
        const symbols = Object.keys(markets).filter(symbol => 
          symbol.endsWith('/JPY') && !symbol.startsWith('ELF/') && symbol !== 'BTC/JPY' // ELFとBTC/JPYを除外
        );
        
        for (const symbol of symbols) {
          const market = exchange.markets[symbol];
          if (!market) continue;
          
          const pricePrecision = market.precision?.price || 8;
          const amountPrecision = market.precision?.amount || 8;
          const minTradeAmount = (exchange.id === 'bitflyer' && bitflyerMinTradeAmounts[symbol]) 
            ? bitflyerMinTradeAmounts[symbol] 
            : (market.limits?.amount?.min || config.amount);
          
          // HFT戦略を別スレッドで実行
          runStrategy('HFT', exchange, symbol, {
            pricePrecision,
            amountPrecision,
            minTradeAmount,
            postOrderToDiscord,
            postErrorToDiscord,
            bitflyerMinTradeAmounts,
            interval: config.strategies.HFT.interval,
            priceThreshold: config.strategies.HFT.priceThreshold,
            maxOrdersPerMinute: config.strategies.HFT.maxOrdersPerMinute
          });
        }
      }
    }
    
    // アービトラージ戦略を実行
    if (config.strategies.INTER_EXCHANGE_ARBITRAGE.enabled) {
      // 共通の通貨ペアを見つける
      const bbMarkets = await exchangeBB.loadMarkets();
      const bfMarkets = await exchangeBF.loadMarkets();
      
      const bbSymbols = Object.keys(bbMarkets).filter(symbol => symbol.endsWith('/JPY'));
      const bfSymbols = Object.keys(bfMarkets).filter(symbol => symbol.endsWith('/JPY'));
      
      // 両方の取引所に存在する通貨ペアを見つける
      const commonSymbols = bbSymbols.filter(symbol => bfSymbols.includes(symbol));
      
      // 定期的にアービトラージ機会を確認
      setInterval(async () => {
        for (const symbol of commonSymbols) {
          await runArbitrageStrategy(exchanges, symbol, {
            postOrderToDiscord,
            postErrorToDiscord,
            bitflyerMinTradeAmounts
          });
        }
      }, 10000); // 10秒ごとに確認
    }
    
    // その他の戦略を実行
    const spreadHistory = {};
    
    while (true) {
      for (const exchange of exchanges) {
        const markets = await exchange.loadMarkets();
        const symbols = Object.keys(markets).filter(symbol => 
          symbol.endsWith('/JPY') && !symbol.startsWith('ELF/') && symbol !== 'BTC/JPY' // ELFとBTC/JPYを除外
        );
        
        for (const symbol of symbols) {
          await runStrategies(exchange, symbol, { spreadHistory });
          await sleep(1000); // 1秒待機
        }
      }
    }
  } catch (error) {
    const errorMessage = `エラーが発生しました: ${error.message}`;
    console.error(errorMessage, error);
    await postErrorToDiscord(errorMessage);
  }
}

// 初期レポートを投稿
postReport(exchangeBB);
postReport(exchangeBF);

// 利用可能な戦略を表示
console.log('利用可能な戦略:');
console.log(strategies.getAvailableStrategies());

// ボットを起動
startBot();
