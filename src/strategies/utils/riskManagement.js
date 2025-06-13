const { getTradeCurrentPosition, updateTradeSummary, getTradeSummary, addOrder } = require('../../database/manager');
const { postOrderToDiscord, postErrorToDiscord } = require('../../common/notifications');

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
 * ポジション情報を取得・保存するためのメモリストレージ
 * 本来はRedisに保存すべきだが、まずはメモリで実装
 */
const positionStore = new Map();

/**
 * ポジション情報を保存
 * @param {string} positionKey - ポジションキー (exchange:symbol:strategy:orderId)
 * @param {Object} positionData - ポジション情報
 */
function savePosition(positionKey, positionData) {
  positionStore.set(positionKey, {
    ...positionData,
    updatedAt: Date.now()
  });
}

/**
 * テスト用: ポジションストレージをクリア
 */
function clearPositionStore() {
  positionStore.clear();
}

/**
 * ポジション情報を取得
 * @param {string} positionKey - ポジションキー
 * @returns {Object|null} - ポジション情報
 */
function getPosition(positionKey) {
  return positionStore.get(positionKey) || null;
}

/**
 * 戦略に関連する全ポジションを取得
 * @param {string} exchangeId - 取引所ID
 * @param {string} symbol - シンボル
 * @param {string} strategyKey - 戦略キー
 * @returns {Array} - ポジション配列
 */
function getStrategyPositions(exchangeId, symbol, strategyKey) {
  const positions = [];
  for (const [key, position] of positionStore.entries()) {
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
  const positions = getStrategyPositions(exchange.id, symbol, strategyKey);
  const stopLossPositions = [];
  
  for (const position of positions) {
    // 買いポジションのみチェック（売りポジションは既に決済済み）
    if (position.side !== 'buy' || position.status === 'closed') {
      continue;
    }
    
    // 最高値を更新
    if (currentPrice > (position.highestPrice || position.entryPrice)) {
      position.highestPrice = currentPrice;
      savePosition(position.key, position);
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
    // 売却量を計算
    const sellAmount = Math.max(position.amount, minTradeAmount);
    const formattedAmount = parseFloat(sellAmount.toFixed(amountPrecision));
    
    // マーケット注文で即座に決済
    const order = await exchange.createMarketSellOrder(symbol, formattedAmount);
    
    // 注文を記録
    await addOrder(exchange, symbol, strategyKey, 'sell', formattedAmount, order.price, order.id, 'market');
    
    // ポジションを閉じる
    position.status = 'closed';
    position.closePrice = order.price;
    position.closedAt = Date.now();
    savePosition(position.key, position);
    
    // 通知
    const lossPercent = ((order.price - position.entryPrice) / position.entryPrice * 100).toFixed(2);
    const message = `[リスク管理] ストップロス実行: ${exchange.id} - ${symbol}\n` +
                   `理由: ${position.reason === 'time-based' ? '時間切れ' : '価格到達'}\n` +
                   `エントリー価格: ${position.entryPrice}\n` +
                   `決済価格: ${order.price}\n` +
                   `損益: ${lossPercent}%`;
    
    if (postOrderToDiscord) {
      await postOrderToDiscord(message);
    }
    
    return { success: true, order, lossPercent };
  } catch (error) {
    console.error(`ストップロス注文の実行に失敗: ${symbol} - ${error.message}`);
    if (postErrorToDiscord) {
      await postErrorToDiscord(`[リスク管理] ストップロス失敗: ${exchange.id} - ${symbol}\nエラー: ${error.message}`);
    }
    return { success: false, error };
  }
}

/**
 * 期間ごとの損益を追跡するためのストレージ
 */
const pnlTracker = new Map();

/**
 * テスト用: PnLトラッカーをクリア
 */
function clearPnLTracker() {
  pnlTracker.clear();
}

/**
 * 損益を記録
 * @param {string} exchangeId - 取引所ID
 * @param {string} strategyKey - 戦略キー
 * @param {number} pnl - 損益
 */
function recordPnL(exchangeId, strategyKey, pnl) {
  const now = new Date();
  const dateKey = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const key = `${exchangeId}:${strategyKey}:${dateKey}`;
  
  const current = pnlTracker.get(key) || { pnl: 0, trades: 0 };
  pnlTracker.set(key, {
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
function calculatePeriodPnL(exchangeId, strategyKey, days) {
  const now = new Date();
  let totalPnL = 0;
  
  for (let i = 0; i < days; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateKey = date.toISOString().split('T')[0];
    const key = `${exchangeId}:${strategyKey}:${dateKey}`;
    
    const dayData = pnlTracker.get(key);
    if (dayData) {
      totalPnL += dayData.pnl;
    }
  }
  
  return totalPnL;
}

/**
 * ドローダウンをチェック
 * @param {Object} exchange - 取引所オブジェクト
 * @param {string} strategyKey - 戦略キー
 * @param {Object} riskSettings - リスク設定
 * @returns {Object} - ドローダウン状態
 */
async function checkDrawdown(exchange, strategyKey, riskSettings = DEFAULT_RISK_SETTINGS) {
  // 初期資金を取得（設定から取得するか、デフォルト値を使用）
  const initialCapital = riskSettings.initialCapital || 100000; // デフォルト10万円
  
  // 各期間の損益を計算
  const dailyPnL = calculatePeriodPnL(exchange.id, strategyKey, 1);
  const weeklyPnL = calculatePeriodPnL(exchange.id, strategyKey, 7);
  const monthlyPnL = calculatePeriodPnL(exchange.id, strategyKey, 30);
  
  // 損失率を計算
  const dailyLossRate = dailyPnL < 0 ? Math.abs(dailyPnL) / initialCapital : 0;
  const weeklyLossRate = weeklyPnL < 0 ? Math.abs(weeklyPnL) / initialCapital : 0;
  const monthlyLossRate = monthlyPnL < 0 ? Math.abs(monthlyPnL) / initialCapital : 0;
  
  return {
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
  const positions = getStrategyPositions(exchange.id, symbol, strategyKey);
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
  for (const [key] of positionStore.entries()) {
    const [exchangeId, sym, strategy] = key.split(':');
    if (exchangeId === exchange.id && strategy === strategyKey) {
      allSymbols.add(sym);
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
function recordBuyPosition(exchange, symbol, strategyKey, order, entryPrice) {
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
  
  savePosition(positionKey, positionData);
}

module.exports = {
  DEFAULT_RISK_SETTINGS,
  savePosition,
  getPosition,
  getStrategyPositions,
  calculateStopLossPrice,
  checkStopLoss,
  executeStopLoss,
  checkDrawdown,
  checkPositionLimits,
  recordBuyPosition,
  recordPnL,
  // テスト用
  clearPositionStore,
  clearPnLTracker
};