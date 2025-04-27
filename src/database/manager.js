// Import MongoDB related functions
const { 
  addTradeMongoDB, 
  addSignalMongoDB, 
  addOrderMongoDB, 
  getOrderByOrderId, 
  connectDB,
  listOrders,
  listTrades,
  listSignals,
  countSignals, // countSignals をインポートに追加
} = require('./mongoDatabase');
const { 
  getTradeSummary, updateTradeSummary, 
  getStrategyParametersRedis, saveStrategyParametersRedis,
  getCurrentOrderPairRedis, setCurrentOrderPairRedis,
  getTradeSummaryTimestamp,
  updateTradeSummaryTimestamp,
  getTradeSummaries,
  initialize,
  getTradeKeys,
  getAllTradeSummaries
} = require('./redisDatabase');

// このモジュールは、DBへのアクセス層として、MongoDBとRedisの両方のデータベースにアクセスするための関数を提供します。
// また、取引所APIを通じて得る記録なども同列に外部DBとして取り扱います。

async function initializeDB() {
  // MongoDBとRedisの初期化を行う
  await initialize();
  await connectDB();
}


async function getCurrentOrderPair(exchange, symbol, strategyKey) {
  return await getCurrentOrderPairRedis(exchange.id, symbol, strategyKey);
}

async function setCurrentOrderPair(exchange, symbol, strategyKey, orderPair) {
  return await setCurrentOrderPairRedis(exchange.id, symbol, strategyKey, orderPair);
}

async function getCurrentOrderPosition(exchange, symbol, strategyKey) {
  // 未約定の注文を取得
  const openOrders = await exchange.fetchOpenOrders(symbol);

  // 未約定の売り注文のうち、注文を戦略キーでフィルタリングして合計量を計算
  const buyOrderAmounts = await Promise.all(
    openOrders.map(async (order) => {
      const _strategyKey = await getOrderStrategyKeyByOrderId(order.id);
      // buy only
      return (strategyKey === _strategyKey && order.side === 'buy') ? order.amount : 0;
    })
  );
  const totalAmount = buyOrderAmounts.reduce((sum, amount) => sum + amount, 0);

  return totalAmount;
};

async function getRealizedPnL(exchange, symbol, strategyKey) {
  // 約定を更新
  await updateFilledTrades(exchange, symbol);

  const summary = await getTradeSummary({
    exchangeId: exchange.id,
    symbol,
    strategyKey
  });
  
  // console.log(summary);
  return (summary && summary.realizedPnL) ? summary.realizedPnL : 0;
}

async function getTradeCurrentPosition(exchange, symbol, strategyKey) {
  // 約定を更新
  await updateFilledTrades(exchange, symbol);

  const summary = await getTradeSummary({
    exchangeId: exchange.id,
    symbol,
    strategyKey
  });
  
  return (summary && summary.netPosition) ? summary.netPosition : 0;
}

async function getOrderStrategyKeyByOrderId(orderId) {
  const order = await getOrderByOrderId(orderId);

  return (order && order.strategy) ? order.strategy : 'OUTSIDE';
}

/**
 * 前回チェック時から現在までの約定履歴を取得し記録する
 * @param {Object} exchange - 取引所オブジェクト
 * @param {string} symbol - 通貨ペア
 * @returns {Promise<number>} - 処理した約定数
 */
async function updateFilledTrades(exchange, symbol) {
 
  try {
    // 前回の更新時間を取得
    const timestamp = await getTradeSummaryTimestamp(exchange.id, symbol);
    const now = Date.now();

    // 前回のチェック時間（ない場合は24時間前）
    const lastCheckTime = timestamp ? timestamp : now - 24 * 60 * 60 * 1000;
    
    // fetchMyTradesメソッドが利用可能かどうかを確認
    if (!exchange.has || !exchange.has['fetchMyTrades']) {
      console.error(`約定履歴の更新エラー (${exchange.id} ${symbol}): fetchMyTradesメソッドがサポートされていません`);
      return 0;
    }
    
    // 取引所から約定履歴を取得
    // 最終チェック時間からの約定履歴を取得
    const trades = await exchange.fetchMyTrades(symbol, lastCheckTime);
    console.log(`最終更新時間: ${new Date(lastCheckTime).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
    
    let processedCount = 0;
    let strategyKey = 'OUTSIDE';
    // 各約定を処理
    for (const trade of trades) {

      if (trade.order) {
        strategyKey = await getOrderStrategyKeyByOrderId(trade.order);
      }
      // console.log(`strategykey: ${strategyKey} trade: ${trade.order}`);

      const _trade = {
        exchange: exchange.id,
        symbol,
        strategy: strategyKey,
        side: trade.side,
        amount: trade.amount,
        price: trade.price,
        value: trade.cost || trade.amount * trade.price,
        orderId: trade.order,
        orderType: trade.type || 'market',
        fee: trade.fee ? trade.fee.cost : 0,
        tradeId: trade.id,
        timestamp: now,
      }

      try {
        await addTradeMongoDB(_trade);
        console.log('_trade object:', _trade); // 追加
        await updateTradeSummary(_trade);
        console.log('updateTradeSummary executed'); // 追加
        await updateTradeSummaryTimestamp(exchange.id, symbol, now);
      } catch (error) {
        console.error(`約定履歴の更新エラー (${exchange.id} ${symbol}):`, error);
      }
      
      processedCount++;
    }
    
    console.log(`${exchange.id} ${symbol} ${strategyKey}: ${processedCount}件の約定を記録しました`);
    return processedCount;
  } catch (error) {
    console.error(`約定履歴の更新エラー (${exchange.id} ${symbol} :`, error);
    return 0;
  }
}

async function addOrder(exchange, symbol, strategyKey, side, amount, price, orderId, orderType) {
    const timestamp = Date.now();

    const order = {
      exchange: exchange.id,
      symbol,
      strategy: strategyKey,
      side,
      amount,
      price,
      orderId,
      orderType,
      timestamp
    };

    return await addOrderMongoDB(order);
}

async function addSignal(exchange, symbol, strategyKey, side, price, detail) {
    const timestamp = Date.now();

    const signal = {
        exchange: exchange.id,
        symbol,
        strategy: strategyKey,
        side,
        price,
        detail,
        timestamp
    };
    
    // console.log('Adding signal with exchange:', exchange); // ログを追加
    console.log('Signal object to be saved:', signal); // ログを追加

    return await addSignalMongoDB(signal);
}

/**
 * 戦略パラメータを読み出す関数
 * データベースに存在しない場合はnullを返す
 * @param {String} exchangeId - 取引所ID
 * @param {String} symbol - 通貨ペア
 * @param {String} strategyKey - 戦略キー
 * @returns {Promise<Object|null>} 戦略パラメータオブジェクト、またはnull
 */
async function getStrategyParameters(exchangeId, symbol, strategyKey) {
  return await getStrategyParametersRedis(exchangeId, symbol, strategyKey);
}

/**
 * 戦略パラメータを保存する関数
 * @param {String} exchangeId - 取引所ID
 * @param {String} symbol - 通貨ペア
 * @param {String} strategyKey - 戦略キー
 * @param {Object} params - 保存するパラメータオブジェクト
 * @returns {Promise} 処理完了時に解決されるPromise
 */
async function saveStrategyParameters(exchangeId, symbol, strategyKey, params) {
  return await saveStrategyParametersRedis(exchangeId, symbol, strategyKey, params);
}

// 購入量ー売り注文量を計算
async function formattedAvailableAmount(exchange, symbol, strategyKey, amountPrecision) {
  try {
    // 取引記録から買った量を取得（ネットポジション）
    const netPosition = await getTradeCurrentPosition(exchange, symbol, strategyKey);
    
    // 未約定の注文を取得
    const openOrders = await exchange.fetchOpenOrders(symbol);

    // 未約定の売り注文のうち、売り注文を戦略キーでフィルタリングして合計量を計算
    // つまり、戦略で売りに出ている量を取得
    const sellOrderAmounts = await Promise.all(
      openOrders.map(async (order) => {
        const _strategyKey = await getOrderStrategyKeyByOrderId(order.id);
        return (strategyKey === _strategyKey && order.side === 'sell') ? order.amount : 0;
      })
    );
    const totalSellOrderAmount = sellOrderAmounts.reduce((sum, amount) => sum + amount, 0);
    
    // 売り注文のみをフィルタリングして合計量を計算
    // const totalSellOrderAmount = openOrders
    //   .filter(order => order.side === 'sell')
    //   .reduce((sum, order) => sum + order.amount, 0);
    
    // 利用可能量 = ネットポジション - 未約定売り注文量
    let availableAmount = netPosition - totalSellOrderAmount;
    
    // 負の値にならないようにする
    if (availableAmount < 0) availableAmount = 0;
    
    // 精度を考慮して、最小精度以上の値を確保
    return parseFloat(availableAmount.toFixed(amountPrecision));
  } catch (error) {
    console.error('利用可能量の計算に失敗しました:', error);
    // エラーとなった取引所とシンボルを記録
    const errorMessage = `formattedAvailableAmount実行中にエラーが発生しました: ${exchange.id} ${symbol} ${strategyKey}`;
    console.error(errorMessage, error);
    
    // エラー時は安全のために0を返す（より厳格な対応）
    return 0;
  } 
}

/**
 * OHLCVデータ取得の共通関数
 * @param {Object} exchange - ccxtの取引所オブジェクト
 * @param {String} symbol - 通貨ペア
 * @param {String} timeframe - 例: '15m'
 * @param {Number} since - ミリ秒のタイムスタンプ
 * @param {Number} limit - データ数
 * @returns {Promise<Array>} OHLCV配列
 */
async function fetchOHLCVData(exchange, symbol, timeframe = '15m', limit = 100) {
  const now = new Date();
  const hour = now.getHours();
  const targetDate = new Date(now);
  
  // bitbank 用設定
  // 現在時刻が9時より前なら前日の日付を設定
  if (hour < 9) {
    targetDate.setDate(targetDate.getDate() - 1);
  }
  
  // targetDateを当日の0:00に設定
  targetDate.setHours(0, 0, 0, 0);
  const since = targetDate.getTime();
  
  return await exchange.fetchOHLCV(symbol, timeframe, since, limit);
}

module.exports = {
  fetchOHLCVData,
  updateFilledTrades,
  formattedAvailableAmount,
  getRealizedPnL,
  addSignal,
  addOrder,
  getStrategyParameters,
  saveStrategyParameters,
  getCurrentOrderPair,
  setCurrentOrderPair,
  getOrderStrategyKeyByOrderId,
  getTradeSummaries,
  getTradeCurrentPosition,
  getCurrentOrderPosition,
  initializeDB,
  getTradeKeys,
  getAllTradeSummaries,
  listOrders,
  listTrades,
  listSignals,
  countSignals, // countSignals をエクスポートに追加
};