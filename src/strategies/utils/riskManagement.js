const { getTradeCurrentPosition, updateTradeSummary, getTradeSummary, addOrder } = require('../../database/manager');
const { postOrderToDiscord, postErrorToDiscord } = require('../../common/notifications');
const { 
  savePositionRedis, 
  getPositionRedis, 
  getStrategyPositionsRedis, 
  deletePositionRedis,
  recordPnLRedis,
  calculatePeriodPnLRedis,
  clearPnLRedis,
  clearAllPositionsRedis,
  clearAllPnLRedis
} = require('../../database/redisDatabase');

/**
 * リスク管理設定のデフォルト値
 */
const DEFAULT_RISK_SETTINGS = {
  // ストップロス設定
  fixedStopLossPercent: 0.02, // 2%の固定ストップロス
  trailingStopTriggerPercent: 0.01, // 1%の利益でトレーリングストップ発動
  trailingStopDistancePercent: 0.01, // 最高値から1%下でトレーリング
  timeBasedStopHours: 24, // 24時間でタイムストップ
  
  // ドローダウン制御
  dailyMaxLossPercent: 0.05, // 日次最大損失5%
  weeklyMaxLossPercent: 0.10, // 週次最大損失10%
  monthlyMaxLossPercent: 0.15, // 月次最大損失15%
  
  // ポジション管理
  maxPositionsPerPair: 3, // 同一通貨ペアの最大ポジション数
  maxTotalPositions: 10, // 全体の最大ポジション数
};

/**
 * Redis接続エラー時のフォールバック用メモリストレージ
 */
const fallbackPositionStore = new Map();

/**
 * ポジション情報を保存
 * @param {string} positionKey - ポジションキー (exchange:symbol:strategy:orderId)
 * @param {Object} positionData - ポジション情報
 */
async function savePosition(positionKey, positionData) {
  try {
    const success = await savePositionRedis(positionKey, positionData);
    if (!success) {
      // Redis失敗時はメモリにフォールバック
      fallbackPositionStore.set(positionKey, {
        ...positionData,
        updatedAt: Date.now()
      });
      console.warn(`Redis保存失敗、メモリにフォールバック: ${positionKey}`);
    }
  } catch (error) {
    // Redis接続エラー時はメモリにフォールバック
    fallbackPositionStore.set(positionKey, {
      ...positionData,
      updatedAt: Date.now()
    });
    console.warn(`Redis接続エラー、メモリにフォールバック: ${positionKey}`, error.message);
  }
}

/**
 * テスト用: ポジションストレージをクリア
 */
async function clearPositionStore() {
  try {
    await clearAllPositionsRedis();
  } catch (error) {
    console.warn('Redis クリア失敗、メモリストレージのみクリア:', error.message);
  }
  fallbackPositionStore.clear();
}

/**
 * ポジション情報を取得
 * @param {string} positionKey - ポジションキー
 * @returns {Object|null} - ポジション情報
 */
async function getPosition(positionKey) {
  try {
    const position = await getPositionRedis(positionKey);
    if (position) {
      return position;
    }
  } catch (error) {
    console.warn(`Redis取得エラー、メモリにフォールバック: ${positionKey}`, error.message);
  }
  
  // Redis失敗時はメモリから取得
  return fallbackPositionStore.get(positionKey) || null;
}

/**
 * 戦略に関連する全ポジションを取得
 * @param {string} exchangeId - 取引所ID
 * @param {string} symbol - シンボル
 * @param {string} strategyKey - 戦略キー
 * @returns {Array} - ポジション配列
 */
async function getStrategyPositions(exchangeId, symbol, strategyKey) {
  try {
    const positions = await getStrategyPositionsRedis(exchangeId, symbol, strategyKey);
    if (positions.length > 0) {
      return positions;
    }
  } catch (error) {
    console.warn(`Redis取得エラー、メモリにフォールバック: ${exchangeId}:${symbol}:${strategyKey}`, error.message);
  }
  
  // Redis失敗時はメモリから取得
  const positions = [];
  for (const [key, position] of fallbackPositionStore.entries()) {
    if (key.startsWith(`${exchangeId}:${symbol}:${strategyKey}:`)) {
      positions.push({ key, ...position });
    }
  }
  return positions;
}

/**
 * ストップロス価格を計算
 * @param {Object} position - ポジション情報
 * @param {number} currentPrice - 現在価格
 * @param {Object} riskSettings - リスク設定
 * @returns {number|null} - ストップロス価格
 */
function calculateStopLossPrice(position, currentPrice, riskSettings = DEFAULT_RISK_SETTINGS) {
  const { entryPrice, highestPrice = entryPrice } = position;
  
  // 固定ストップロス価格
  const fixedStopLoss = entryPrice * (1 - riskSettings.fixedStopLossPercent);
  
  // トレーリングストップロスの計算
  let trailingStopLoss = null;
  const profitPercent = (currentPrice - entryPrice) / entryPrice;
  
  if (profitPercent >= riskSettings.trailingStopTriggerPercent) {
    // トレーリングストップが発動
    const effectiveHighest = Math.max(highestPrice, currentPrice);
    trailingStopLoss = effectiveHighest * (1 - riskSettings.trailingStopDistancePercent);
  }
  
  // より高い方のストップロス価格を使用
  if (trailingStopLoss) {
    return Math.max(fixedStopLoss, trailingStopLoss);
  }
  
  return fixedStopLoss;
}

/**
 * ポジションがストップロスに達しているかチェック
 * @param {Object} exchange - 取引所オブジェクト
 * @param {string} symbol - シンボル
 * @param {string} strategyKey - 戦略キー
 * @param {number} currentPrice - 現在価格
 * @param {Object} riskSettings - リスク設定
 * @returns {Array} - ストップロスが必要なポジション
 */
async function checkStopLoss(exchange, symbol, strategyKey, currentPrice, riskSettings = DEFAULT_RISK_SETTINGS) {
  const positions = await getStrategyPositions(exchange.id, symbol, strategyKey);
  const stopLossPositions = [];
  
  for (const position of positions) {
    // 買いポジションのみチェック（売りポジションは既に決済済み）
    if (position.side !== 'buy' || position.status === 'closed') {
      continue;
    }
    
    // 最高値を更新とトレーリングストップ通知
    const previousHighest = position.highestPrice || position.entryPrice;
    if (currentPrice > previousHighest) {
      position.highestPrice = currentPrice;
      await savePosition(position.key, position);
      
      // トレーリングストップ発動条件をチェック
      const profitPercent = (currentPrice - position.entryPrice) / position.entryPrice;
      if (profitPercent >= riskSettings.trailingStopTriggerPercent) {
        const priceIncrease = ((currentPrice - previousHighest) / previousHighest * 100);
        
        // 大幅な価格上昇時（1%以上）のみ通知
        if (priceIncrease >= 1.0) {
          const message = `📈 [リスク管理] トレーリングストップ更新 📈\n` +
                         `取引所: ${exchange.id}\n` +
                         `通貨ペア: ${symbol}\n` +
                         `戦略: ${strategyKey}\n` +
                         `注文ID: ${position.orderId}\n` +
                         `エントリー価格: ${position.entryPrice.toLocaleString()}円\n` +
                         `新最高値: ${currentPrice.toLocaleString()}円\n` +
                         `現在利益: ${(profitPercent * 100).toFixed(2)}%\n` +
                         `📊 トレーリングストップが追従中です`;
          
          if (postOrderToDiscord) {
            await postOrderToDiscord(message);
          }
        }
      }
    }
    
    // ストップロス価格を計算
    const stopLossPrice = calculateStopLossPrice(position, currentPrice, riskSettings);
    
    // 時間ベースのストップロスチェック
    const positionAge = (Date.now() - position.createdAt) / (1000 * 60 * 60); // 時間単位
    const timeBasedStop = positionAge >= riskSettings.timeBasedStopHours;
    
    // ストップロス条件をチェック
    if (currentPrice <= stopLossPrice || timeBasedStop) {
      stopLossPositions.push({
        ...position,
        stopLossPrice,
        reason: timeBasedStop ? 'time-based' : 'price-based',
        currentPrice
      });
    }
  }
  
  return stopLossPositions;
}

/**
 * ストップロス注文を実行
 * @param {Object} exchange - 取引所オブジェクト
 * @param {string} symbol - シンボル
 * @param {string} strategyKey - 戦略キー
 * @param {Object} position - ポジション情報
 * @param {Object} marketParameters - マーケットパラメータ
 * @returns {Object} - 実行結果
 */
async function executeStopLoss(exchange, symbol, strategyKey, position, marketParameters) {
  const { amountPrecision, minTradeAmount } = marketParameters;
  
  try {
    // formattedAvailableAmountを使用して利用可能量を取得
    const { formattedAvailableAmount } = require('../../database/manager');
    const availableToSell = await formattedAvailableAmount(exchange, symbol, strategyKey, amountPrecision);
    
    console.log(`[DEBUG] Stop-loss for ${symbol}: Strategy ${strategyKey}`);
    console.log(`[DEBUG] Position amount: ${position.amount}, Available to sell: ${availableToSell}`);
    
    // 売却可能量がゼロまたはマイナスの場合はスキップ
    if (availableToSell <= 0) {
      console.log(`[INFO] Skip stop-loss: Available to sell is ${availableToSell} (no actual available holdings)`);
      return { 
        success: false, 
        reason: 'no_available_amount',
        message: `戦略 ${strategyKey} の売却可能量が ${availableToSell} のため、ストップロスをスキップしました`
      };
    }
    
    // 売却可能量を計算（個別ポジション量と利用可能量の最小値）
    let sellAmount = Math.min(position.amount, availableToSell);
    
    // 最小取引量を満たさない場合はエラー
    if (sellAmount < minTradeAmount) {
      throw new Error(`Insufficient balance for stop-loss: available to sell ${availableToSell}, required ${minTradeAmount}`);
    }
    
    const formattedAmount = parseFloat(sellAmount.toFixed(amountPrecision));
    
    console.log(`[DEBUG] Executing stop-loss sell order: ${formattedAmount} ${baseAsset}`);
    
    // マーケット注文で即座に決済
    const order = await exchange.createMarketSellOrder(symbol, formattedAmount);
    
    // デバッグ用：注文構造をログ出力
    console.log(`[DEBUG] Stop-loss order structure for ${symbol}:`, JSON.stringify(order, null, 2));
    
    // 実行価格を取得（異なる取引所の注文構造に対応）
    let executionPrice = null;
    
    if (order.price && !isNaN(order.price)) {
      executionPrice = order.price;
    } else if (order.average && !isNaN(order.average)) {
      executionPrice = order.average;
    } else if (order.cost && order.amount && order.cost > 0 && order.amount > 0) {
      executionPrice = order.cost / order.amount;
    } else {
      // フォールバック：現在の市場価格を取得
      try {
        const ticker = await exchange.fetchTicker(symbol);
        executionPrice = ticker.last || ticker.close;
        console.log(`[DEBUG] Using fallback price from ticker: ${executionPrice}`);
      } catch (tickerError) {
        console.warn(`[WARNING] Could not get execution price for ${symbol}:`, tickerError.message);
        executionPrice = null;
      }
    }
    
    // 注文を記録
    await addOrder(exchange, symbol, strategyKey, 'sell', formattedAmount, executionPrice, order.id, 'market');
    
    // ポジション更新（部分決済か完全決済かを判定）
    const isPartialClose = formattedAmount < position.amount;
    
    if (isPartialClose) {
      // 部分決済：残ポジション量を更新
      position.amount = parseFloat((position.amount - formattedAmount).toFixed(amountPrecision));
      position.updatedAt = Date.now();
      console.log(`[DEBUG] Partial stop-loss: remaining position ${position.amount}`);
    } else {
      // 完全決済：ポジションを閉じる
      position.status = 'closed';
      position.closePrice = executionPrice;
      position.closedAt = Date.now();
      console.log(`[DEBUG] Complete stop-loss: position closed`);
    }
    
    await savePosition(position.key, position);
    
    // 通知
    const lossPercent = executionPrice && position.entryPrice ? 
                       ((executionPrice - position.entryPrice) / position.entryPrice * 100).toFixed(2) : 
                       'N/A';
    const message = `[リスク管理] ストップロス実行: ${exchange.id} - ${symbol}\n` +
                   `理由: ${position.reason === 'time-based' ? '時間切れ' : '価格到達'}\n` +
                   `${isPartialClose ? '部分決済' : '完全決済'}: ${formattedAmount}\n` +
                   `エントリー価格: ${position.entryPrice || 'N/A'}\n` +
                   `決済価格: ${executionPrice || 'N/A'}\n` +
                   `損益: ${lossPercent}%` +
                   (isPartialClose ? `\n残ポジション: ${position.amount}` : '');
    
    if (postOrderToDiscord) {
      await postOrderToDiscord(message);
    }
    
    return { 
      success: true, 
      order, 
      lossPercent, 
      executionPrice, 
      soldAmount: formattedAmount,
      isPartialClose,
      remainingAmount: isPartialClose ? position.amount : 0
    };
  } catch (error) {
    console.error(`ストップロス注文の実行に失敗: ${symbol} - ${error.message}`);
    if (postErrorToDiscord) {
      await postErrorToDiscord(`[リスク管理] ストップロス失敗: ${exchange.id} - ${symbol}\nエラー: ${error.message}`);
    }
    return { success: false, error };
  }
}

/**
 * Redis接続エラー時のフォールバック用損益追跡ストレージ
 */
const fallbackPnlTracker = new Map();

/**
 * テスト用: PnLトラッカーをクリア
 */
async function clearPnLTracker() {
  try {
    await clearAllPnLRedis();
  } catch (error) {
    console.warn('Redis 損益クリア失敗、メモリストレージのみクリア:', error.message);
  }
  fallbackPnlTracker.clear();
}

/**
 * 損益を記録
 * @param {string} exchangeId - 取引所ID
 * @param {string} strategyKey - 戦略キー
 * @param {number} pnl - 損益
 */
async function recordPnL(exchangeId, strategyKey, pnl) {
  try {
    const success = await recordPnLRedis(exchangeId, strategyKey, pnl);
    if (!success) {
      // Redis失敗時はメモリにフォールバック
      recordPnLFallback(exchangeId, strategyKey, pnl);
    }
  } catch (error) {
    // Redis接続エラー時はメモリにフォールバック
    console.warn(`Redis損益記録エラー、メモリにフォールバック: ${exchangeId}:${strategyKey}`, error.message);
    recordPnLFallback(exchangeId, strategyKey, pnl);
  }
}

/**
 * フォールバック用の損益記録
 */
function recordPnLFallback(exchangeId, strategyKey, pnl) {
  const now = new Date();
  const dateKey = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const key = `${exchangeId}:${strategyKey}:${dateKey}`;
  
  const current = fallbackPnlTracker.get(key) || { pnl: 0, trades: 0 };
  fallbackPnlTracker.set(key, {
    pnl: current.pnl + pnl,
    trades: current.trades + 1,
    lastUpdated: now
  });
}

/**
 * 期間の損益を計算
 * @param {string} exchangeId - 取引所ID
 * @param {string} strategyKey - 戦略キー
 * @param {number} days - 過去何日分を計算するか
 * @returns {number} - 期間の合計損益
 */
async function calculatePeriodPnL(exchangeId, strategyKey, days) {
  try {
    const totalPnL = await calculatePeriodPnLRedis(exchangeId, strategyKey, days);
    if (totalPnL !== 0) {
      return totalPnL;
    }
  } catch (error) {
    console.warn(`Redis期間損益計算エラー、メモリにフォールバック: ${exchangeId}:${strategyKey}`, error.message);
  }
  
  // Redis失敗時はメモリから計算
  const now = new Date();
  let totalPnL = 0;
  
  for (let i = 0; i < days; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateKey = date.toISOString().split('T')[0];
    const key = `${exchangeId}:${strategyKey}:${dateKey}`;
    
    const dayData = fallbackPnlTracker.get(key);
    if (dayData) {
      totalPnL += dayData.pnl;
    }
  }
  
  return totalPnL;
}

/**
 * 現在の残高を取得（JPY換算）
 * @param {Object} exchange - 取引所オブジェクト
 * @returns {number} - JPY換算の総資産
 */
async function getCurrentBalance(exchange) {
  try {
    const balance = await exchange.fetchBalance();
    let totalJPY = 0;
    
    // JPY残高を加算
    if (balance.total.JPY) {
      totalJPY += balance.total.JPY;
    }
    
    // その他の通貨をJPY換算
    const currencies = ['BTC', 'ETH', 'XRP', 'LTC', 'BCH', 'SOL', 'DOT'];
    for (const currency of currencies) {
      if (balance.total[currency] && balance.total[currency] > 0) {
        try {
          const symbol = `${currency}/JPY`;
          const ticker = await exchange.fetchTicker(symbol);
          const jpyValue = balance.total[currency] * (ticker.last || ticker.close);
          totalJPY += jpyValue;
        } catch (error) {
          console.warn(`${currency}/JPY の価格取得に失敗:`, error.message);
        }
      }
    }
    
    return totalJPY;
  } catch (error) {
    console.error('残高取得に失敗:', error.message);
    return 100000; // フォールバック値
  }
}

/**
 * ドローダウンをチェック
 * @param {Object} exchange - 取引所オブジェクト
 * @param {string} strategyKey - 戦略キー
 * @param {Object} riskSettings - リスク設定
 * @returns {Object} - ドローダウン状態
 */
async function checkDrawdown(exchange, strategyKey, riskSettings = DEFAULT_RISK_SETTINGS) {
  // 現在の残高を動的に取得
  const currentBalance = await getCurrentBalance(exchange);
  
  // 各期間の損益を計算
  const dailyPnL = await calculatePeriodPnL(exchange.id, strategyKey, 1);
  const weeklyPnL = await calculatePeriodPnL(exchange.id, strategyKey, 7);
  const monthlyPnL = await calculatePeriodPnL(exchange.id, strategyKey, 30);
  
  // 損失率を計算（現在残高基準）
  const dailyLossRate = dailyPnL < 0 ? Math.abs(dailyPnL) / currentBalance : 0;
  const weeklyLossRate = weeklyPnL < 0 ? Math.abs(weeklyPnL) / currentBalance : 0;
  const monthlyLossRate = monthlyPnL < 0 ? Math.abs(monthlyPnL) / currentBalance : 0;
  
  return {
    currentBalance,
    daily: {
      pnl: dailyPnL,
      loss: dailyLossRate,
      limit: riskSettings.dailyMaxLossPercent,
      exceeded: dailyLossRate >= riskSettings.dailyMaxLossPercent
    },
    weekly: {
      pnl: weeklyPnL,
      loss: weeklyLossRate,
      limit: riskSettings.weeklyMaxLossPercent,
      exceeded: weeklyLossRate >= riskSettings.weeklyMaxLossPercent
    },
    monthly: {
      pnl: monthlyPnL,
      loss: monthlyLossRate,
      limit: riskSettings.monthlyMaxLossPercent,
      exceeded: monthlyLossRate >= riskSettings.monthlyMaxLossPercent
    }
  };
}

/**
 * 新規ポジションが許可されるかチェック
 * @param {Object} exchange - 取引所オブジェクト
 * @param {string} symbol - シンボル
 * @param {string} strategyKey - 戦略キー
 * @param {Object} riskSettings - リスク設定
 * @returns {Object} - 許可状態
 */
async function checkPositionLimits(exchange, symbol, strategyKey, riskSettings = DEFAULT_RISK_SETTINGS) {
  // 戦略の全ポジションを取得
  const positions = await getStrategyPositions(exchange.id, symbol, strategyKey);
  const openPositions = positions.filter(p => p.status !== 'closed');
  
  // 同一通貨ペアのポジション数をチェック
  const symbolPositions = openPositions.filter(p => p.symbol === symbol);
  if (symbolPositions.length >= riskSettings.maxPositionsPerPair) {
    return {
      allowed: false,
      reason: `同一通貨ペアの最大ポジション数(${riskSettings.maxPositionsPerPair})に達しています`
    };
  }
  
  // 全体のポジション数をチェック
  const allSymbols = new Set();
  
  // Redisから全ポジションを取得してカウント
  try {
    // 簡易実装: 主要通貨ペアのポジションをチェック
    const majorPairs = ['BTC/JPY', 'ETH/JPY', 'XRP/JPY', 'LTC/JPY', 'BCH/JPY'];
    for (const pair of majorPairs) {
      const pairPositions = await getStrategyPositions(exchange.id, pair, strategyKey);
      if (pairPositions.length > 0) {
        allSymbols.add(pair);
      }
    }
  } catch (error) {
    console.warn('全ポジション数チェックでエラー、フォールバック処理:', error.message);
    // フォールバック: メモリストレージから取得
    for (const [key] of fallbackPositionStore.entries()) {
      const [exchangeId, sym, strategy] = key.split(':');
      if (exchangeId === exchange.id && strategy === strategyKey) {
        allSymbols.add(sym);
      }
    }
  }
  
  if (allSymbols.size >= riskSettings.maxTotalPositions) {
    return {
      allowed: false,
      reason: `全体の最大ポジション数(${riskSettings.maxTotalPositions})に達しています`
    };
  }
  
  return { allowed: true };
}

/**
 * 買い注文時にポジション情報を記録
 * @param {Object} exchange - 取引所オブジェクト
 * @param {string} symbol - シンボル
 * @param {string} strategyKey - 戦略キー
 * @param {Object} order - 注文情報
 * @param {number} entryPrice - エントリー価格
 */
async function recordBuyPosition(exchange, symbol, strategyKey, order, entryPrice) {
  const positionKey = `${exchange.id}:${symbol}:${strategyKey}:${order.id}`;
  const positionData = {
    exchangeId: exchange.id,
    symbol,
    strategyKey,
    orderId: order.id,
    side: 'buy',
    amount: order.amount,
    entryPrice,
    highestPrice: entryPrice,
    status: 'open',
    createdAt: Date.now()
  };
  
  await savePosition(positionKey, positionData);
  
  // ポジション開始通知
  const message = `🎯 [リスク管理] 新規ポジション開始 🎯\n` +
                 `取引所: ${exchange.id}\n` +
                 `通貨ペア: ${symbol}\n` +
                 `戦略: ${strategyKey}\n` +
                 `注文ID: ${order.id}\n` +
                 `エントリー価格: ${entryPrice.toLocaleString()}円\n` +
                 `数量: ${order.amount}\n` +
                 `💰 ポジション管理を開始しました`;
  
  if (postOrderToDiscord) {
    await postOrderToDiscord(message);
  }
}

/**
 * リスク管理の統計情報を報告
 * @param {Object} exchange - 取引所オブジェクト
 * @param {string} strategyKey - 戦略キー
 * @param {Object} riskSettings - リスク設定
 * @returns {Object} - 統計情報
 */
async function generateRiskManagementReport(exchange, strategyKey, riskSettings = DEFAULT_RISK_SETTINGS) {
  try {
    // 現在のポジション情報を取得
    const allPositions = [];
    const majorPairs = ['BTC/JPY', 'ETH/JPY', 'XRP/JPY', 'SOL/JPY', 'DOT/JPY'];
    
    for (const symbol of majorPairs) {
      const positions = await getStrategyPositions(exchange.id, symbol, strategyKey);
      allPositions.push(...positions);
    }
    
    const openPositions = allPositions.filter(p => p.status !== 'closed');
    
    // 損益情報を取得
    const dailyPnL = await calculatePeriodPnL(exchange.id, strategyKey, 1);
    const weeklyPnL = await calculatePeriodPnL(exchange.id, strategyKey, 7);
    const monthlyPnL = await calculatePeriodPnL(exchange.id, strategyKey, 30);
    
    // ドローダウン状況を計算
    const drawdownStatus = await checkDrawdown(exchange, strategyKey, riskSettings);
    
    const report = {
      timestamp: new Date().toISOString(),
      exchange: exchange.id,
      strategy: strategyKey,
      positions: {
        total: openPositions.length,
        bySymbol: {},
        maxAllowed: riskSettings.maxTotalPositions
      },
      pnl: {
        daily: dailyPnL,
        weekly: weeklyPnL,
        monthly: monthlyPnL
      },
      drawdown: {
        daily: {
          current: (drawdownStatus.daily.loss * 100).toFixed(2),
          limit: (drawdownStatus.daily.limit * 100).toFixed(2),
          status: drawdownStatus.daily.exceeded ? '🚨 制限超過' : '✅ 正常'
        },
        weekly: {
          current: (drawdownStatus.weekly.loss * 100).toFixed(2),
          limit: (drawdownStatus.weekly.limit * 100).toFixed(2),
          status: drawdownStatus.weekly.exceeded ? '🚨 制限超過' : '✅ 正常'
        },
        monthly: {
          current: (drawdownStatus.monthly.loss * 100).toFixed(2),
          limit: (drawdownStatus.monthly.limit * 100).toFixed(2),
          status: drawdownStatus.monthly.exceeded ? '🚨 制限超過' : '✅ 正常'
        }
      }
    };
    
    // シンボル別ポジション数を計算
    for (const position of openPositions) {
      const symbol = position.symbol;
      if (!report.positions.bySymbol[symbol]) {
        report.positions.bySymbol[symbol] = 0;
      }
      report.positions.bySymbol[symbol]++;
    }
    
    return report;
  } catch (error) {
    console.error('リスク管理レポート生成エラー:', error.message);
    return null;
  }
}

/**
 * リスク管理レポートをDiscordに送信
 * @param {Object} exchange - 取引所オブジェクト
 * @param {string} strategyKey - 戦略キー
 * @param {Object} riskSettings - リスク設定
 */
async function sendRiskManagementReport(exchange, strategyKey, riskSettings = DEFAULT_RISK_SETTINGS) {
  const report = await generateRiskManagementReport(exchange, strategyKey, riskSettings);
  
  if (!report) {
    return;
  }
  
  let symbolPositions = '';
  for (const [symbol, count] of Object.entries(report.positions.bySymbol)) {
    symbolPositions += `  ${symbol}: ${count}ポジション\n`;
  }
  
  const message = `📊 [リスク管理] 定期レポート 📊\n` +
                 `取引所: ${report.exchange}\n` +
                 `戦略: ${report.strategy}\n` +
                 `レポート時刻: ${new Date().toLocaleString('ja-JP')}\n\n` +
                 
                 `📈 ポジション状況:\n` +
                 `  合計: ${report.positions.total}/${report.positions.maxAllowed}\n` +
                 `${symbolPositions || '  (オープンポジションなし)\n'}\n` +
                 
                 `💰 損益状況:\n` +
                 `  本日: ${report.pnl.daily.toLocaleString()}円\n` +
                 `  今週: ${report.pnl.weekly.toLocaleString()}円\n` +
                 `  今月: ${report.pnl.monthly.toLocaleString()}円\n\n` +
                 
                 `⚠️ ドローダウン監視:\n` +
                 `  日次: ${report.drawdown.daily.current}%/${report.drawdown.daily.limit}% ${report.drawdown.daily.status}\n` +
                 `  週次: ${report.drawdown.weekly.current}%/${report.drawdown.weekly.limit}% ${report.drawdown.weekly.status}\n` +
                 `  月次: ${report.drawdown.monthly.current}%/${report.drawdown.monthly.limit}% ${report.drawdown.monthly.status}`;
  
  if (postOrderToDiscord) {
    await postOrderToDiscord(message);
  }
}

module.exports = {
  DEFAULT_RISK_SETTINGS,
  savePosition,
  getPosition,
  getStrategyPositions,
  calculateStopLossPrice,
  checkStopLoss,
  executeStopLoss,
  getCurrentBalance,
  checkDrawdown,
  checkPositionLimits,
  recordBuyPosition,
  recordPnL,
  generateRiskManagementReport,
  sendRiskManagementReport,
  // テスト用
  clearPositionStore,
  clearPnLTracker
};