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

// 設定パラメータ
const config = {
  // 共通設定
  amount: 0.0001,  // 注文するBTCの量（固定値、tradePercentageが優先される）
  profitMargin: 0.003,  // 目標利益率（取引料を考慮）
  maxHistoryLength: 100,  // スプレッド履歴の最大長
  tradePercentage: 0.01,  // 資金の%で取引
  tradeCost: 0.0012, // 手数料暫定（bitbank)
  cancelOrderThreshold: 10, // 一銘柄ごとの注文限度数
  safetyJPYAmount: 2000, // JPY残高がこの額を下回ったら購入しない(HFTのときのみ)
  amountPrecision: 8, // 取引量の小数点以下の桁数（デフォルト値）
  
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
      enabled: process.env.STRATEGY_SCALPING_ENABLED === 'false'
    }
  }
};

// 取引記録を保存するオブジェクト
const tradeRecords = {
  // 取引所ごとの記録
  // 例: { 'bitbank': { 'BTC/JPY': { amount: 0.1, totalCost: 500000 } } }
};

/**
 * 取引記録を更新する関数
 * @param {String} exchangeId - 取引所ID
 * @param {String} symbol - 通貨ペア
 * @param {Number} amount - 取引量
 * @param {Number} price - 取引価格
 * @param {String} side - 取引方向（'buy'または'sell'）
 */
/**
 * 取引記録を更新する関数
 * @param {String} exchangeId - 取引所ID
 * @param {String} symbol - 通貨ペア
 * @param {Number} amount - 取引量
 * @param {Number} price - 取引価格
 * @param {String} side - 取引方向（'buy'または'sell'）
 * @param {String} strategyKey - 使用した戦略のキー（オプション）
 */
function updateTradeRecord(exchangeId, symbol, amount, price, side, strategyKey = 'unknown') {
  // 取引所の記録がなければ初期化
  if (!tradeRecords[exchangeId]) {
    tradeRecords[exchangeId] = {};
  }
  
  // 通貨ペアの記録がなければ初期化
  if (!tradeRecords[exchangeId][symbol]) {
    tradeRecords[exchangeId][symbol] = {};
  }
  
  // 戦略の記録がなければ初期化
  if (!tradeRecords[exchangeId][symbol][strategyKey]) {
    tradeRecords[exchangeId][symbol][strategyKey] = {
      buyAmount: 0,
      sellAmount: 0,
      totalBuyCost: 0,
      totalSellValue: 0,
      netPosition: 0, // 実際の保有量を表す新しいフィールド
      trades: [] // 取引履歴を保存する配列
    };
  }
  
  const record = tradeRecords[exchangeId][symbol][strategyKey];
  
  // 取引情報を記録
  const tradeInfo = {
    timestamp: Date.now(),
    side,
    amount,
    price,
    value: amount * price
  };
  
  record.trades.push(tradeInfo);
  
  // 最大100件の取引履歴を保持
  if (record.trades.length > 100) {
    record.trades.shift();
  }
  
  // 買いの場合
  if (side === 'buy') {
    record.buyAmount += amount;
    record.totalBuyCost += amount * price;
    record.netPosition += amount; // 保有量を増やす
  }
  // 売りの場合
  else if (side === 'sell') {
    record.sellAmount += amount;
    record.totalSellValue += amount * price;
    
    // 買った量から売った量を減らす（0未満にならないように）
    const deductAmount = Math.min(record.buyAmount, amount);
    record.buyAmount -= deductAmount;
    record.netPosition -= amount; // 保有量を減らす
  }
  
  console.log(`取引記録更新: ${exchangeId} - ${symbol} - ${strategyKey} - ${side} - 数量: ${amount}, 価格: ${price}`);
  console.log(`現在の記録: 買い量: ${record.buyAmount}, 売り量: ${record.sellAmount}, 実際の保有量: ${record.netPosition}`);
}

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
  // トレード履歴から損益を計算する
  const exchangeId = exchange.id;
  let totalJPYValue = 0;
  
  // JPY残高を取得
  try {
    const balance = await exchange.fetchBalance();
    totalJPYValue = balance.total['JPY'] || 0;
  } catch (error) {
    console.error('JPY残高の取得に失敗しました:', error);
    await postErrorToDiscord(`JPY残高の取得に失敗しました: ${error.message}`);
  }
  
  // トレード記録から損益を計算
  if (tradeRecords[exchangeId]) {
    for (const symbol in tradeRecords[exchangeId]) {
      for (const strategyKey in tradeRecords[exchangeId][symbol]) {
        const record = tradeRecords[exchangeId][symbol][strategyKey];
        // 実現損益のみを計算（評価額は計算しない）
        const profit = record.totalSellValue - record.totalBuyCost;
        totalJPYValue += profit;
      }
    }
  }
  
  return totalJPYValue; // トレード履歴から計算した総JPY評価額を返す
}

/**
 * マーケットパラメータを取得する共通関数
 * @param {Object} exchange - 取引所オブジェクト
 * @param {String} symbol - 通貨ペア
 * @returns {Object|null} - マーケットパラメータまたはnull（エラー時）
 */
async function getMarketParameters(exchange, symbol) {
  const market = exchange.markets[symbol];
  if (!market) {
    console.error(`マーケットデータが取得できませんでした: ${symbol} ${exchange.id}`);
    return null;
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
        return null;
      }
    } catch (error) {
      const errorMessage = `価格精度が取得できず、ティッカーの取得にも失敗しました: ${symbol} ${exchange.name}`;
      console.error(errorMessage, error);
      if (postErrorToDiscord) {
        await postErrorToDiscord(errorMessage);
      }
      return null;
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
    return null;
  }
  
  if (!amountPrecision) {
    const minTradeAmountDecimals = (minTradeAmount.toString().split('.')[1] || '').length;
    amountPrecision = minTradeAmountDecimals;
  }
  
  if (amountPrecision > 0 && amountPrecision < 1) {
    const amountDecimals = (amountPrecision.toString().split('.')[1] || '').length;
    amountPrecision = amountDecimals;
  }
  
  return { minTradeAmount, pricePrecision, amountPrecision };
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
    
    // 戦略に応じたパラメータを設定
    const params = [];
    
    // updateTradeRecordに戦略キーを渡すラッパー関数
    const updateTradeRecordWithStrategy = (exchangeId, symbol, amount, price, side) => {
      updateTradeRecord(exchangeId, symbol, amount, price, side, strategyKey);
    };
    
    switch (strategyKey) {
      case 'MA':
        params.push(exchange, symbol, strategyConfig.shortPeriod, strategyConfig.longPeriod, config.amount, { ...options, tradePercentage: config.tradePercentage, updateTradeRecord: updateTradeRecordWithStrategy, tradeRecords });
        break;
      case 'MACD':
        params.push(exchange, symbol, strategyConfig.fastPeriod, strategyConfig.slowPeriod, strategyConfig.signalPeriod, config.amount, { ...options, tradePercentage: config.tradePercentage, updateTradeRecord: updateTradeRecordWithStrategy, tradeRecords });
        break;
      case 'RSI':
        params.push(exchange, symbol, strategyConfig.period, strategyConfig.oversoldThreshold, strategyConfig.overboughtThreshold, config.amount, { ...options, tradePercentage: config.tradePercentage, updateTradeRecord: updateTradeRecordWithStrategy, tradeRecords });
        break;
      case 'BOLLINGER_BANDS':
        params.push(exchange, symbol, strategyConfig.period, strategyConfig.stdDev, config.amount, { ...options, tradePercentage: config.tradePercentage, updateTradeRecord: updateTradeRecordWithStrategy, tradeRecords });
        break;
      case 'MEAN_REVERSION':
        params.push(exchange, symbol, strategyConfig.period, strategyConfig.deviationThreshold, config.amount, { ...options, tradePercentage: config.tradePercentage, updateTradeRecord: updateTradeRecordWithStrategy, tradeRecords });
        break;
      case 'OSCILLATOR':
        params.push(exchange, symbol, strategyConfig.period, strategyConfig.oversoldThreshold, strategyConfig.overboughtThreshold, config.amount, { ...options, tradePercentage: config.tradePercentage, updateTradeRecord: updateTradeRecordWithStrategy, tradeRecords });
        break;
      case 'INTER_EXCHANGE_ARBITRAGE':
        // アービトラージは複数の取引所を必要とするため、別途処理
        return null;
      case 'HFT':
        params.push(exchange, symbol, strategyConfig.interval, strategyConfig.priceThreshold, config.amount, { ...options, tradePercentage: config.tradePercentage, updateTradeRecord: updateTradeRecordWithStrategy, tradeRecords });
        break;
      case 'SCALPING':
        params.push(exchange, symbol, options.spreadHistory || {}, { ...options, tradePercentage: config.tradePercentage, updateTradeRecord: updateTradeRecordWithStrategy, tradeRecords });
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
    
    // updateTradeRecordに戦略キーを渡すラッパー関数
    const updateTradeRecordWithStrategy = (exchangeId, symbol, amount, price, side) => {
      updateTradeRecord(exchangeId, symbol, amount, price, side, 'INTER_EXCHANGE_ARBITRAGE');
    };
    
    const params = [
      exchanges,
      symbol,
      strategyConfig.minProfitPercent,
      config.amount, // 固定値（tradePercentageが優先される）
      {
        ...options,
        bitflyerMinTradeAmounts,
        tradePercentage: config.tradePercentage,
        updateTradeRecord: updateTradeRecordWithStrategy,
        tradeRecords
      }
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
    // マーケットパラメータを取得
    const params = await getMarketParameters(exchange, symbol);
    if (!params) return;
    
    const { minTradeAmount, pricePrecision, amountPrecision } = params;
    
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

/**
 * 戦略と銘柄ごとの損益レポートを計算する関数
 * @param {Object} exchange - 取引所オブジェクト
 * @returns {String} - レポート文字列
 */
async function calculateStrategyProfitReport(exchange) {
  const exchangeId = exchange.id;
  if (!tradeRecords[exchangeId]) {
    return `${exchangeId}の取引記録がありません。`;
  }
  
  let report = `=== ${exchangeId} 戦略・銘柄別損益レポート ===\n`;
  
  // 戦略タイプごとの集計
  const strategyTypeTotals = {};
  for (const type in strategies.STRATEGY_TYPES) {
    strategyTypeTotals[strategies.STRATEGY_TYPES[type]] = 0;
  }
  
  // 各銘柄ごとに処理
  for (const symbol in tradeRecords[exchangeId]) {
    report += `\n【${symbol}】\n`;
    let symbolTotal = 0;
    
    // 各戦略ごとに処理
    for (const strategyKey in tradeRecords[exchangeId][symbol]) {
      const record = tradeRecords[exchangeId][symbol][strategyKey];
      
      // 損益計算
      const totalBuy = record.totalBuyCost;
      const totalSell = record.totalSellValue;
      const profit = totalSell - totalBuy;
      
      // 評価額の計算をスキップし、実現損益のみを使用
      let currentHoldingValue = 0;
      // 実現損益のみを総損益とする
      const totalProfit = profit;
      
      // 戦略名を取得
      let strategyName = strategyKey;
      let strategyType = 'unknown';
      if (strategies.STRATEGIES && strategies.STRATEGIES[strategyKey]) {
        strategyName = strategies.STRATEGIES[strategyKey].name;
        strategyType = strategies.STRATEGIES[strategyKey].type;
      }
      
      // 戦略タイプの合計に加算
      if (strategyType && strategyTypeTotals[strategyType] !== undefined) {
        strategyTypeTotals[strategyType] += totalProfit;
      }
      
      // レポートに追加（評価額の情報を表示しない）
      report += `  ${strategyName}: ${totalProfit.toFixed(2)} JPY`;
      if (record.netPosition > 0) {
        report += ` (保有: ${record.netPosition} ${symbol.split('/')[0]})`;
      }
      report += '\n';
      
      symbolTotal += totalProfit;
    }
    
    report += `  銘柄合計: ${symbolTotal.toFixed(2)} JPY\n`;
  }
  
  // 戦略タイプごとの合計を追加
  report += '\n【戦略タイプ別合計】\n';
  for (const type in strategyTypeTotals) {
    // 戦略タイプの日本語名を取得
    let typeName = type;
    switch (type) {
      case strategies.STRATEGY_TYPES.TREND_FOLLOWING:
        typeName = 'トレンドフォロー';
        break;
      case strategies.STRATEGY_TYPES.MEAN_REVERSION:
        typeName = '逆張り';
        break;
      case strategies.STRATEGY_TYPES.ARBITRAGE:
        typeName = 'アービトラージ';
        break;
      case strategies.STRATEGY_TYPES.HIGH_FREQUENCY:
        typeName = '高頻度取引';
        break;
    }
    report += `  ${typeName}: ${strategyTypeTotals[type].toFixed(2)} JPY\n`;
  }
  
  return report;
}

/**
 * 戦略と銘柄ごとの損益レポートを投稿する関数
 * @param {Object} exchange - 取引所オブジェクト
 */
async function postStrategyProfitReport(exchange) {
  const report = await calculateStrategyProfitReport(exchange);
  await postResultToDiscord(report);
}

// レポートを投稿するためのタイマー設定
setInterval(() => {
  const now = new Date();
  if (now.getMinutes() === 0) { // 時間ごと
    // 全体資産計算レポート
    postReport(exchangeBB);
    postReport(exchangeBF);
    
    // 戦略と銘柄ごとの損益レポート
    postStrategyProfitReport(exchangeBB);
    postStrategyProfitReport(exchangeBF);
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
          // マーケットパラメータを取得
          const params = await getMarketParameters(exchange, symbol);
          if (!params) continue;
          
          const { minTradeAmount, pricePrecision, amountPrecision } = params;
          
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
            maxOrdersPerMinute: config.strategies.HFT.maxOrdersPerMinute,
            tradePercentage: config.tradePercentage,
            updateTradeRecord,
            tradeRecords // tradeRecords を追加
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
            bitflyerMinTradeAmounts,
            tradePercentage: config.tradePercentage,
            updateTradeRecord,
            tradeRecords // tradeRecords を追加
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
