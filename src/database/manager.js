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
  countSignals,
  addOhlcvMongoDB,
  fetchHistoricalOHLCVData,
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
  getAllTradeSummaries,
  getAllStrategyParametersRedis,
} = require('./redisDatabase');

const { fetchOHLCVDataAPI } = require('./exchangeAPI');

// このモジュールは、DBへのアクセス層として、MongoDBとRedisの両方のデータベースにアクセスするための関数を提供します。
// また、取引所APIを通じて得る記録なども同列に外部DBとして取り扱います。

async function initializeDB() {
  // MongoDBとRedisの初期化を行う
  await initialize();
  await connectDB();
}

async function fetchOHLCVData(exchange, symbol, timeframe, limit, options = {}) {
  try {
    // バックテストモードの場合
    if (options.backtest) {
      const timestamp = options.backtest.timestamp;
      // mongoDBから過去データを取得
      const historicalData = await fetchHistoricalOHLCVData(exchange.id, symbol, timeframe, limit, timestamp);
      
      if (!historicalData || historicalData.length === 0) {
        console.log(`バックテストモードでのOHLCVデータ取得に失敗しました: ${exchange.id} ${symbol} ${timeframe}`);
        return [];
      }

      // 取得したデータをCCXTフォーマットに変換して返す
      // CCXTフォーマット: [timestamp, open, high, low, close, volume]
      return historicalData.map(candle => {
        return [
          candle.timestamp,
          candle.open,
          candle.high,
          candle.low,
          candle.close,
          candle.volume
        ];
      });
    }
    
    // 通常モード（リアルタイムデータ取得）
    return await fetchOHLCVDataAPI(exchange, symbol, timeframe, limit);
  } catch (error) {
    console.error(`Error fetching OHLCV data: ${error.message}`);
    throw error;
  }
}

async function getOHLCVByParams(exchange, symbol, timeframe, limit, timestamp) {
  return await getOHLCVByParamsMongoDB(exchange.id, symbol, timeframe, limit, timestamp);
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

async function getRealizedPnL(exchange, symbol, strategyKey, options = {}) { // options を追加
  // バックテストモードの場合
  if (options.backtest) {
    // options.backtest に totalSellCost と totalBuyCost があることを前提とする
    return (options.backtest.totalSellCost || 0) - (options.backtest.totalBuyCost || 0);
  }

  // リアルタイムモードの場合 (既存ロジック)
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
    // console.log(`最終更新時間: ${new Date(lastCheckTime).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
    
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
    
    if (processedCount > 0) {
      console.log(`${exchange.id} ${symbol} ${strategyKey}: ${processedCount}件の約定を記録しました`);
    }
    return processedCount;
  } catch (error) {
    console.error(`約定履歴の更新エラー (${exchange.id} ${symbol} :`, error);
    return 0;
  }
}

async function addOrder(exchange, symbol, strategyKey, side, amount, price, orderId, orderType, options = {}) {
  // バックテストモードの場合
  if (options.backtest) {
    // options.backtest のプロパティを更新
    options.backtest.lastSignal = side;
    options.backtest.currentAmount = amount; // amount を更新

    // buy/sell Cost を上書き (加算)
    if (side === 'buy') {
      options.backtest.totalBuyCost = (options.backtest.totalBuyCost || 0) + (price * amount);
    } else if (side === 'sell') {
      options.backtest.totalSellCost = (options.backtest.totalSellCost || 0) + (price * amount);
      options.backtest.baseFund = options.backtest.totalSellCost - options.backtest.totalBuyCost; // 基本資金を更新
    }

    // バックテスト結果を options.backtest.orders 配列に追加
    if (!options.backtest.orders) {
      options.backtest.orders = [];
    }
    options.backtest.orders.push({
      exchange: exchange.id,
      symbol,
      strategy: strategyKey,
      side,
      amount,
      price,
      orderId,
      orderType,
      timestamp: options.backtest.timestamp // バックテストのタイムスタンプを使用
    });

    // バックテストモードではDBには記録しないため、ここで処理終了
    return;
  }

  // リアルタイムモードの場合 (既存ロジック)
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

async function addSignal(exchange, symbol, strategyKey, side, price, detail, options = {}) { // options を追加
    // バックテストモードの場合
    if (options.backtest) {
      // バックテスト結果を options.backtest.signals 配列に追加
      if (!options.backtest.signals) {
        options.backtest.signals = [];
      }
      options.backtest.signals.push({
        exchange: exchange.id,
        symbol,
        strategy: strategyKey,
        side,
        price,
        detail,
        timestamp: options.backtest.timestamp // バックテストのタイムスタンプを使用
      });

      // バックテストモードではDBには記録しないため、ここで処理終了
      return;
    }

    // リアルタイムモードの場合 (既存ロジック)
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

/**
 * 全ての戦略パラメータを読み出す関数
 * @returns {Promise<Object>} キー（params:exchangeId:symbol:strategyKey）とパラメータオブジェクトのマップ
 */
async function getAllStrategyParameters() {
  return await getAllStrategyParametersRedis();
}

// 購入量ー売り注文量を計算
async function formattedAvailableAmount(exchange, symbol, strategyKey, amountPrecision, options = {}) { // options を追加
  // バックテストモードの場合
  if (options.backtest) {
    // options.backtest の lastSignal と currentAmount を使用
    if (options.backtest.lastSignal === 'buy') {
      return options.backtest.currentAmount || 0; // amount を返す
    } else if (options.backtest.lastSignal === 'sell') {
      return 0; // sell なら 0
    }
    // lastSignal が設定されていない場合やその他のケースのデフォルト値
    return 0;
  }

  // リアルタイムモードの場合 (既存ロジック)
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
 * 指定した取引所とシンボルのティッカーデータを取得する
 * バックテストモード時は ohlcvData の平均値を計算して返す
 * @param {Object} exchange - 取引所インスタンス
 * @param {String} symbol - 取引ペア (例: "BTC/USDT")
 * @param {Object} options - オプション設定
 * @param {Object} [options.backtest] - バックテスト設定
 * @param {Array} [options.backtest.ohlcvData] - バックテスト用のOHLCVデータ配列
 * @returns {Object} ティッカーデータ
 */
async function fetchTicker(exchange, symbol, options = {}) {
  try {
    // バックテストモードの場合
    if (options.backtest) {
      // ohlcvData が存在しない場合はエラー
      if (!options.backtest.ohlcvData || !options.backtest.ohlcvData.length) {
        throw new Error('Backtest mode requires ohlcvData in options');
      }

      // 最新のOHLCVデータを取得 (配列の最後の要素)
      const latestOHLCV = options.backtest.ohlcvData[options.backtest.ohlcvData.length - 1];
      
      // Open, High, Low, Close の平均値を計算
      // OHLCV データ形式: [timestamp, open, high, low, close, volume]
      const open = latestOHLCV[1];
      const high = latestOHLCV[2];
      const low = latestOHLCV[3];
      const close = latestOHLCV[4];
      
      const averagePrice = (open + high + low + close) / 4;
      
      // バックテスト用のティッカーオブジェクトを作成
      return {
        symbol: symbol,
        timestamp: latestOHLCV[0],
        datetime: new Date(latestOHLCV[0]).toISOString(),
        bid: averagePrice,
        ask: averagePrice,
        last: averagePrice,
        close: close,
        average: averagePrice,
        baseVolume: latestOHLCV[5],
        info: {
          backtest: true
        }
      };
    }
    
    // リアルタイムモード: 取引所APIからティッカーを取得
    return await exchange.fetchTicker(symbol);
  } catch (error) {
    console.error(`Error fetching ticker for ${symbol}:`, error);
    throw error;
  }
}

// 関数をエクスポート
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
  getAllStrategyParameters, // 新しい関数をエクスポート
  listOrders,
  listTrades,
  listSignals,
  countSignals,
  addOhlcvMongoDB,
  getOHLCVByParams,
  fetchTicker,
  getAvailableFund, // 追加
  backtestCreateLimitBuyOrder, // 追加
  backtestCreateLimitSellOrder, // 追加
};

/**
 * バックテスト用の利用可能資金取得関数
 * @param {object} exchange - 取引所オブジェクト (バックテストではダミー)
 * @param {string} symbol - 通貨ペア
 * @param {object} options - オプション
 * @param {number} basefund - バックテスト用の基本資金
 * @param {number} buycost - バックテスト用の合計買いコスト
 * @param {number} sellcost - バックテスト用の合計売りコスト
 * @returns {object} - 利用可能資金情報 (CCXTのfetchBalanceのfreeプロパティ形式を模倣)
 */
async function getAvailableFund(exchange, symbol, options = {}, basefund, buycost, sellcost) {
  // バックテストモードの場合
  if (options.backtest) {
    // 計画に基づき計算
    const available = basefund - buycost + sellcost;
    // CCXTのfetchBalanceのfreeプロパティ形式を模倣して返す
    const baseCurrency = symbol.split('/')[1]; // 通貨ペアの右側を基軸通貨と仮定
    const result = {
      [baseCurrency]: available > 0 ? available : 0, // 負の値にならないようにする
      // 他の通貨は必要に応じて追加
    };
    console.log(`[Backtest] 利用可能資金シミュレーション: ${baseCurrency}: ${result[baseCurrency]}`);
    return { free: result }; // fetchBalanceの戻り値の形式に合わせる
  }

  // リアルタイムモードの場合 (既存のfetchBalanceを呼び出す)
  // exchange オブジェクトは CCXT のインスタンスであると仮定
  try {
    const balance = await exchange.fetchBalance();
    return balance;
  } catch (error) {
    console.error(`Error fetching balance for ${exchange.id}:`, error);
    throw error;
  }
}

/**
 * バックテスト用の買い指値注文関数
 * @param {string} symbol - 通貨ペア
 * @param {number} amount - 注文数量
 * @param {number} price - 注文価格
 * @param {object} options - オプション
 * @returns {object} - 注文情報 (ランダムなorderIDを含む)
 */
async function backtestCreateLimitBuyOrder(symbol, amount, price, options = {}) {
  // ランダムなorderIDを生成
  const orderId = `backtest_${Date.now()}_buy_${Math.random().toString(36).substring(2, 15)}`;
  console.log(`[Backtest] 買い注文シミュレーション: ${symbol}, 数量: ${amount}, 価格: ${price}, OrderID: ${orderId}`);
  // 計画に基づき、ランダムなorderIDを持つオブジェクトを返す
  return { id: orderId };
}

/**
 * バックテスト用の売り指値注文関数
 * @param {string} symbol - 通貨ペア
 * @param {number} amount - 注文数量
 * @param {number} price - 注文価格
 * @param {object} options - オプション
 * @returns {object} - 注文情報 (ランダムなorderIDを含む)
 */
async function backtestCreateLimitSellOrder(symbol, amount, price, options = {}) {
  // ランダムなorderIDを生成
  const orderId = `backtest_${Date.now()}_sell_${Math.random().toString(36).substring(2, 15)}`;
  console.log(`[Backtest] 売り注文シミュレーション: ${symbol}, 数量: ${amount}, 価格: ${price}, OrderID: ${orderId}`);
  // 計画に基づき、ランダムなorderIDを持つオブジェクトを返す
  return { id: orderId };
}