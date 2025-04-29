const { postErrorToDiscord } = require('./notifications');
const { getStrategyParameters, saveStrategyParameters,
   getTradeCurrentPosition, getCurrentOrderPosition } = require('../database/manager');

async function getMarketParametersByExchangeSymbol(symbolByExchange, config) {
  const exchanges = Object.keys(symbolByExchange);
  const marketParametersByExchange = {};

  for (const exchangeId of exchanges) {
    const symbols = symbolByExchange[exchangeId];
    const exchangeInstance = config.exchanges[exchangeId].instance;
    for (const symbol of symbols) {
      const params = await getMarketParameters(exchangeInstance, symbol);
      const { minTradeAmount, pricePrecision, amountPrecision } = params;

      marketParametersByExchange[exchangeId] = marketParametersByExchange[exchangeId] || {};
      marketParametersByExchange[exchangeId][symbol] = {
        minTradeAmount,
        pricePrecision,
        amountPrecision,
      };

      console.log(`取引所 ${exchangeId} の通貨ペア ${symbol} のパラメータを取得しました:`, params)
      await sleep(300);
    }
  }

  return marketParametersByExchange;
}

async function getStrategyConfig(exchange, symbol, strategyKey, config) {
  // configからデフォルトの戦略設定を取得
  const defaultConfig = config.strategies[strategyKey];
    
  if (!defaultConfig || !defaultConfig.enabled) {
    return null;
  }

  // データベースから戦略パラメータを取得
  const dbParams = await getStrategyParameters(exchange.id, symbol, strategyKey);

  const strategyConfig = (() => {
    if (dbParams) {
      // デフォルト設定とデータベースのパラメータをマージ（データベース優先）
      return { ...(config.global), ...defaultConfig, ...dbParams };
    } else {
      // DBにパラメータがない場合はデフォルト設定を使用
      // デフォルト設定をDBに保存
      // Create a clean config without functions and exchanges property
      const configToSave = Object.fromEntries(
        Object.entries(defaultConfig).filter(([key, value]) => 
          typeof value !== 'function' && key !== 'exchanges'
        )
      );
      saveStrategyParameters(exchange.id, symbol, strategyKey, configToSave);
      return { ...(config.global), ...defaultConfig };
    }
  })();

  return strategyConfig;
}
 
/**
 * 加重平均を計算する関数
 * @param {Array} prices - 価格の配列
 * @param {Array} amounts - 数量の配列
 * @returns {Number} - 加重平均値
 */
function weightedAverage(prices, amounts) {
  const totalAmount = amounts.reduce((acc, val) => acc + val, 0);
  return prices.reduce((acc, price, index) => acc + (price * amounts[index]), 0) / totalAmount;
}

/**
 * 取引所から総損益を取得する関数
 * @param {Object} exchange - 取引所オブジェクト
 * @param {String} symbol - 通貨ペア
 * @returns {Number} - 総損益
 */
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
  
  const minTradeAmount = (market.limits?.amount?.min || 0.0001);
    
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

async function getSymbolsByExchange(config) {
  const exchanges = Object.keys(config.exchanges);
  const symbolsByExchange = {};

  for (const exchange of exchanges) {
    const exchangeInstance = config.exchanges[exchange].instance;
    const markets = await exchangeInstance.loadMarkets();

    // 除外シンボル
    const symbols = Object.keys(markets).filter(symbol =>
      symbol.endsWith('/JPY') 
        && !config.global.excludeSymbols.some(excludePattern => symbol.startsWith(excludePattern))
    );

    symbolsByExchange[exchange] = symbols;
    console.log(`取引所 ${exchange} のシンボルを取得しました: ${symbols}`);
  }

  return symbolsByExchange;
}

/**
 * 買い注文が実行可能かどうかを資金とポジション制限に基づいてチェックする
 * @param {Object} exchange - ccxtの取引所オブジェクト
 * @param {String} symbol - 通貨ペア
 * @param {String} strategyKey - 戦略キー
 * @param {Number} midPrice - 現在の中間価格
 * @param {Number} formattedAmount - 注文数量
 * @param {Number} availableFunds - 利用可能な資金
 * @param {Number} tradePercentage - 取引に使用する資金の割合
 * @param {Number} realizedPnL - 実現した損益
 * @param {Number} baseMinTradeAmount - 最小取引量
 * @returns {Object} - {allowed: boolean, reason: string}
 */
async function checkBuyOrderAllowance(exchange, symbol, strategyKey, price, formattedAmount, availableFunds, tradePercentage, realizedPnL, baseMinTradeAmount) {
  // この戦略で約定し残っている量（買った量ー売った量）
  const currentTradePosition = await getTradeCurrentPosition(exchange, symbol, strategyKey);

  // 今注文に出している買い量
  const currentOrderPosition = await getCurrentOrderPosition(exchange, symbol, strategyKey);

  // 可能購入量限度を計算
  const maxBuyAmount = ((availableFunds * tradePercentage) + realizedPnL) / price;

  // Calculate required funds for the potential buy order
  const requiredFunds = price * formattedAmount;
  
  // Check if available funds are sufficient
  if (availableFunds < requiredFunds || formattedAmount <= 0) {
    return {
      allowed: false,
      reason: `資金不足のため買い注文をスキップ: ${symbol} - 必要: ${requiredFunds}, 利用可能: ${availableFunds}`
    };
  }
  
  // Calculate total position after the potential order
  const totalPositionAfterOrder = currentTradePosition + currentOrderPosition;
  
  // Determine if a buy order is allowed based on position limits
  // Allow buy if total position is within maxBuyAmount OR if maxBuyAmount is less than baseMinTradeAmount
  const isBuyAllowed = totalPositionAfterOrder <= maxBuyAmount || maxBuyAmount < baseMinTradeAmount;
  
  if (!isBuyAllowed) {
    return {
      allowed: false,
      reason: `買い注文が許可されません: ${symbol} - 現在のポジション: ${totalPositionAfterOrder}, 最大購入許可量: ${maxBuyAmount}`
    };
  }
  
  return { allowed: true };
}

// スリープ関数
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = {
  getSymbolsByExchange,
  weightedAverage,
  fetchTotal,
  getMarketParameters,
  sleep,
  getStrategyConfig,
  getMarketParametersByExchangeSymbol,
  checkBuyOrderAllowance,
};