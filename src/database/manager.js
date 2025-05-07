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
  saveTickerMongoDB,
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
  getOHLCVRedisTimestamp,
  getOHLCVRedis,
  updateOHLCVRedis,
  getTickerRedis,
  updateTickerRedis,
  updateBacktestOHLCVRedisSortedSet,
  getBacktestOHLCVRedisBeforeTimestamp
} = require('./redisDatabase');

const { fetchOHLCVDataAPI } = require('./exchangeAPI');

const { sleep, timeframeToMs } = require('../common/utils');

// このモジュールは、DBへのアクセス層として、MongoDBとRedisの両方のデータベースにアクセスするための関数を提供します。
// また、取引所APIを通じて得る記録なども同列に外部DBとして取り扱います。

async function initializeDB() {
  // MongoDBとRedisの初期化を行う
  await initialize();
  await connectDB();
}

/**
 * バックテスト用のOHLCVデータを取得し、Redisに保存する関数
 * 
 * @param {Object} exchange - 取引所オブジェクト
 * @param {string} symbol - 通貨ペア
 * @param {string} timeframe - 時間枠
 * @param {number} limit - 取得するデータの件数
 * @returns {Promise<Array>} - 取得したOHLCVデータの配列
 * @throws {Error} - データ取得に失敗した場合
**/
async function loadHistoricalOHLCVToBacktestRedis(exchange, symbol, timeframe, limit = 100) {
  try {
    const ohlcvs = await fetchHistoricalOHLCVData(exchange.id, symbol, timeframe, limit);
    if (!ohlcvs || ohlcvs.length === 0) {
      console.log(`${symbol} - ${timeframe}: データが見つかりませんでした。`);
      return [];
    }
    // Redisに保存
    await updateBacktestOHLCVRedisSortedSet(exchange.id, symbol, timeframe, ohlcvs);
    console.log(`RedisにOHLCVデータを保存しました: ${exchange.id} ${symbol} ${timeframe} ${ohlcvs.length}件`);
    return ohlcvs;
  } catch (error) {
    console.error(`Error loading historical OHLCV data: ${error.message}`);
    throw error;
  }
}

/**
 * Backtest用のOHLCVデータを取得する関数
 * 
 * @param {string} exchangeId - 取引所ID
 * @param {string} symbol - 通貨ペア
 * @param {string} timeframe - 時間枠
 * @param {number} limit - 取得するデータの件数
 * @param {number} timestamp - タイムスタンプ
 * @returns {Promise<Array>} - 取得したOHLCVデータの配列
 * @throws {Error} - データ取得に失敗した場合
*/
async function fetchBacktestOHLCVData(exchangeId, symbol, timeframe, limit = 100, timestamp) {
  try {
    // console.log(`fetchBacktestOHLCVData: ${exchangeId} ${symbol} ${timeframe} ${limit} ${timestamp}`);
    // Redisからデータを取得
    const redisData = await getBacktestOHLCVRedisBeforeTimestamp(exchangeId, symbol, timeframe, timestamp, limit);
    if (!redisData || redisData.length === 0) {
      console.log(`${symbol} - ${timeframe}: Redisにデータが見つかりませんでした。`);
      return [];
    }

    redisData.reverse(); // データを逆順にして最新のデータが末尾に来るようにする

    // データをCCXTフォーマットに変換して返す
    // CCXTフォーマット: [timestamp, open, high, low, close, volume]
    return redisData.map(candle => {
      return [
        candle.timestamp,
        candle.open,
        candle.high,
        candle.low,
        candle.close,
        candle.volume
      ];
    });
   } catch (error) {
    console.error(`Error fetching historical OHLCV data: ${error.message}`);
    throw error;
  }
}

async function fetchOHLCVData(exchange, symbol, timeframe, limit = 100, options = {}) {
  try {
    // バックテストモードの場合
    if (options.backtest) {
      const timestamp = options.backtest.timestamp;
      // console.log(`fetchOHLCVData: ${exchange.id} ${symbol} ${timeframe} ${limit} ${timestamp}`);
      return await fetchBacktestOHLCVData(exchange.id, symbol, timeframe, limit, timestamp);
    }

    // console.log(`fetchOHLCVData: ${exchange.id} ${symbol} ${timeframe} ${limit}`);
    
    // 通常モード
    // REDISに最新データがあるか確認
    const timestamp = Date.now();
    const redisOHLCVTimestamp = await getOHLCVRedisTimestamp(exchange.id, symbol, timeframe);
    const timeframeMs = timeframeToMs(timeframe);
    // 前回更新時刻がない、または前回更新時刻から Timeframe 時間以上経過している場合
    if (options.forceUpdate || !redisOHLCVTimestamp || (redisOHLCVTimestamp && timestamp - redisOHLCVTimestamp > timeframeMs)) {
    // if (true) {
      // TODO: 前回更新時刻をみて取得する limit を調整
      // TODO: 取得したデータを保存する際、redisには更新でなく追記をかける必要がある
      // forceUpdate が true の場合以外は、limit を 100 にする: REDISに保存するデータ量を固定
      const _limit = (() => {
        if (options.forceUpdate) {
          return limit;
        }
        return 100; // 戦略パラメータで100以上必要になったときに増やす
        // TODO: 戦略パラメータのMAXをlimit下限にする
      })();

      const ohlcvs = await fetchOHLCVDataAPI(exchange, symbol, timeframe, _limit);
      if (!ohlcvs || ohlcvs.length === 0) {
        console.log(`${symbol} - ${timeframe}: データが見つかりませんでした。`);
        return [];
      }
      // RedisとMongoDBに保存
      // 履歴から最新の1件だけ取得して、timestamp が更新しようとしているデータより
      // 新しい場合のみ履歴保存する
      const lastOhlcv = await fetchHistoricalOHLCVData(exchange.id, symbol, timeframe, 1);
      // console.log(`lastOhlcv: ${lastOhlcv}`);
      // console.log(`ohlcvs: ${ohlcvs}`);
      for (const ohlcv of ohlcvs) {
        if (options.forceUpdate) {
          // forceUpdate が true の場合は全て保存
          // console.log(`forceUpdate: ${ohlcv}`);
        } else if (lastOhlcv && lastOhlcv[0] && ohlcv[0] <= lastOhlcv[0].timestamp) {
          // console.log(`既存のデータより古いデータをスキップ: ${ohlcv[0]} <= ${lastOhlcv[0].timestamp}`);
          continue; // 既存のデータより古い場合はスキップ
        }
        try {
          const [_timestamp, open, high, low, close, volume] = ohlcv;
          const ohlcvData = {
              exchange: exchange.id,
              symbol: symbol,
              timeframe: timeframe,
              timestamp: _timestamp,
              open: open,
              high: high,
              low: low,
              close: close,
              volume: volume,
          };
          addOhlcvMongoDB(ohlcvData);
        } catch (error) {
          console.error(`Error adding OHLCV data to MongoDB: ${error.message}`);
        }
      }
      if (options.forceUpdate) {
        // forceUpdate が true の場合は REDIS に保存しない
      } else {
        await updateOHLCVRedis(exchange.id, symbol, timeframe, ohlcvs);
      }
      return ohlcvs;
    } else {
      // Redisにデータがある場合はそれを返す
      const redisData = await getOHLCVRedis(exchange.id, symbol, timeframe);
      // console.log(`Redis data: ${redisData}`);
      // limitが指定されている場合、データを制限
      if (limit && limit > 0) {
        return redisData.slice(-limit);
      } else {
        return redisData;
      }
    }
  } catch (error) {
    console.error(`Error fetching OHLCV data: ${error.message}`);
    throw error;
  }
}

async function getOHLCVByParams(exchange, symbol, timeframe, limit, timestamp) {
  return await fetchHistoricalOHLCVData(exchange.id, symbol, timeframe, limit, timestamp);
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
    if (options.backtest.lastSignal === 'buy') {
      return 0;
    }
    if (options.backtest.lastSignal === 'sell') {
      // options.backtest に totalSellCost と totalBuyCost があることを前提とする
      return (options.backtest.totalSellCost || 0) - (options.backtest.totalBuyCost || 0);
    }
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
      if (side === 'buy') {
        options.backtest.buySignalCount += 1;
      }
      if (side === 'sell') {
        options.backtest.sellSignalCount += 1;
      }
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
    // console.log('Signal object to be saved:', signal); // ログを追加

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
        console.log({ backtest: options.backtest });
        console.log(`バックテストモードでのティッカー取得に失敗しました: ${exchange.id} ${symbol}`);
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
      
      // highとlowの間のランダムな値を生成
      // 一様分布の代わりに正規分布を使用
      const mean = (high + low) / 2; // 平均値（中央値）
      const stdDev = (high - low) / 6; // 標準偏差（範囲の1/6で約99.7%が範囲内に収まる）
      
      // 標準正規分布の乱数を生成（Box-Muller変換）
      const u1 = Math.random();
      const u2 = Math.random();
      const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
      
      // 指定された平均と標準偏差の正規分布に変換
      let randomPrice = mean + stdDev * z;
      
      // 範囲外の値を切り詰める
      randomPrice = Math.max(low, Math.min(high, randomPrice));

      options.backtest.currentPrice = randomPrice; // 現在価格を更新
      
      // バックテスト用のティッカーオブジェクトを作成
      return {
        symbol: symbol,
        timestamp: latestOHLCV[0],
        datetime: new Date(latestOHLCV[0]).toISOString(),
        bid: randomPrice,
        ask: randomPrice,
        last: randomPrice,
        close: close,
        average: randomPrice,
        baseVolume: latestOHLCV[5],
        info: {
          backtest: true
        }
      };
    }
    
    // REDISに最新データがあるか確認
    const timestamp = Date.now();
    const redisTicker = await getTickerRedis(exchange.id, symbol);

    // console.log(redisTicker);

    if (!redisTicker || (timestamp - redisTicker.timestamp > timeframeToMs('1m'))) {
      // ticker が redis にないか、前回更新時刻から 1m 時間以上経過している場合
      // TODO: 並列実行の場合 1s でもよい
      const ticker = await exchange.fetchTicker(symbol);
      if (!ticker) {
        console.log(`${symbol} - ティッカーが見つかりませんでした。`);
        return null;
      }

      // Save to Redis
      await updateTickerRedis(exchange.id, symbol, ticker);
      // mongoDB にも保存
      await saveTickerMongoDB(ticker);

      return ticker;
    } else {
      // Redisに保存されたティッカーを返す
      return redisTicker;
    }

  } catch (error) {
    console.error(`Error fetching ticker for ${symbol}:`, error);
    throw error;
  }
}



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
async function getAvailableFund(exchange, symbol, options = {}) {
  // バックテストモードの場合
  if (options.backtest) {
    // 計画に基づき計算
    const { baseFund, totalBuyCost, totalSellCost } = options.backtest;
    const available = baseFund;
    // CCXTのfetchBalanceのfreeプロパティ形式を模倣して返す
    const baseCurrency = symbol.split('/')[1]; // 通貨ペアの右側を基軸通貨と仮定
    const result = {
      [baseCurrency]: available > 0 ? available : 0, // 負の値にならないようにする
      // 他の通貨は必要に応じて追加
    };
    // console.log(`[Backtest] 利用可能資金シミュレーション: ${baseCurrency}: ${result[baseCurrency]}`);
    return { free: result }; // fetchBalanceの戻り値の形式に合わせる
  }

  // リアルタイムモードの場合 (既存のfetchBalanceを呼び出す)
  // exchange オブジェクトは CCXT の インスタンスであると仮定
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
  // console.log(`[Backtest] 買い注文シミュレーション: ${symbol}, 数量: ${amount}, 価格: ${price}, OrderID: ${orderId}`);
  // 計画に基づき、ランダムなorderIDを持つオブジェクトを返す
  options.backtest.buyOrderCount += 1;
  options.backtest.baseFund -= price * amount; // 基本資金を減少
  options.backtest.currentAmount = amount; // 現在の量を更新
  options.backtest.totalBuyCost = (options.backtest.totalBuyCost || 0) + (price * amount);
  options.backtest.lastSignal = 'buy';
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
  // console.log(`[Backtest] 売り注文シミュレーション: ${symbol}, 数量: ${amount}, 価格: ${price}, OrderID: ${orderId}`);
  // 計画に基づき、ランダムなorderIDを持つオブジェクトを返す
  options.backtest.sellOrderCount += 1;
  options.backtest.baseFund += price * amount; // 基本資金を増加
  options.backtest.currentAmount = 0; // 現在の量を更新
  options.backtest.totalSellCost = (options.backtest.totalSellCost || 0) + (price * amount);
  options.backtest.lastSignal = 'sell'; // 最後のシグナルを更新
  return { id: orderId };
}

async function getMarketParametersByExchangeSymbol(symbolByExchange, config, options = {}) {
  const exchanges = Object.keys(symbolByExchange);
  const marketParametersByExchange = {};

  for (const exchangeId of exchanges) {
    const symbols = symbolByExchange[exchangeId];
    const exchangeInstance = config.exchanges[exchangeId].instance;
    for (const symbol of symbols) {
      if (options.targetSymbol) {
        if (symbol !== options.targetSymbol) {
          continue;
        }
      }
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
async function checkBuyOrderAllowance(exchange, symbol, strategyKey, price, formattedAmount, availableFunds, tradePercentage, realizedPnL, baseMinTradeAmount, options = {}) {
  // バックテストモードの場合
  if (options.backtest) {
    // console.log(`[Backtest] checkBuyOrderAllowance: lastSignal = ${options.backtest.lastSignal}`);
    if (options.backtest.lastSignal === 'sell') {
      return { allowed: true };
    } else if (options.backtest.lastSignal === 'buy') {
      return { allowed: false, reason: '[Backtest] Last signal was buy' };
    } else {
      // lastSignal が設定されていない場合やその他のケース
      return { allowed: false, reason: '[Backtest] Invalid or no last signal in backtest' };
    }
  }

  // リアルタイムモードの場合
  // この戦略で約定し残っている量（買った量ー売った量）
  const currentTradePosition = await getTradeCurrentPosition(exchange, symbol, strategyKey);

  // 今注文に出している買い量
  const currentOrderPosition = await getCurrentOrderPosition(exchange, symbol, strategyKey);

  // 今注文に出している売り量を取得
  const currentSellOrders = await getCurrentSellOrderPosition(exchange, symbol, strategyKey);

  // 可能購入量限度を計算
  const maxBuyAmount = ((availableFunds * tradePercentage) + realizedPnL) / price;
  const maxBuyAmountWithMinTrade = Math.max(maxBuyAmount, baseMinTradeAmount);

  // Calculate required funds for the potential buy order
  const requiredFunds = price * formattedAmount;

  // トレードパーセンテージを考慮した利用可能資金を計算
  const allowedFunds = (availableFunds * tradePercentage) + realizedPnL;

  // Check if available funds are sufficient, considering trade percentage
  if (requiredFunds > allowedFunds || formattedAmount <= 0) {
    return {
      allowed: false,
      reason: `資金不足のため買い注文をスキップ: ${symbol} - 必要: ${requiredFunds}, 利用可能(制限内): ${allowedFunds.toFixed(2)}`
    };
  }

  // 実質的なポジションを計算 (売り注文量を差し引く)
  const effectivePosition = currentTradePosition + currentOrderPosition - currentSellOrders;

  // 新しい注文を加えた場合の合計ポジションを計算
  const newEffectivePosition = effectivePosition + formattedAmount;

  console.log(`最大可能購入量: ${maxBuyAmountWithMinTrade} 現在のポジション: ${currentTradePosition}, 買注文量: ${currentOrderPosition}, 売注文量: ${currentSellOrders}, 実質ポジション: ${effectivePosition}, 新注文後ポジション: ${newEffectivePosition}`);

  // 新注文を加えた合計ポジションが最大購入量以下かチェック
  const isBuyAllowed = newEffectivePosition <= maxBuyAmountWithMinTrade;

  if (!isBuyAllowed) {
    return {
      allowed: false,
      reason: `買い注文が許可されません: ${symbol} - 新注文後の実質ポジション: ${newEffectivePosition}, 最大購入許可量: ${maxBuyAmountWithMinTrade}`
    };
  }

  return { allowed: true };
}

async function getCurrentSellOrderPosition(exchange, symbol, strategyKey) {
  // 未約定の注文を取得
  const openOrders = await exchange.fetchOpenOrders(symbol);

  // 未約定の売り注文のうち、注文を戦略キーでフィルタリングして合計量を計算
  const sellOrderAmounts = await Promise.all(
    openOrders.map(async (order) => {
      const _strategyKey = await getOrderStrategyKeyByOrderId(order.id);
      // sell only
      return (strategyKey === _strategyKey && order.side === 'sell') ? order.amount : 0;
    })
  );
  const totalAmount = sellOrderAmounts.reduce((sum, amount) => sum + amount, 0);

  return totalAmount;
};

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
  getAllStrategyParameters,
  listOrders,
  listTrades,
  listSignals,
  countSignals,
  addOhlcvMongoDB, // script からの利用のみ
  getOHLCVByParams, // script からの利用のみ
  fetchTicker,
  getAvailableFund, 
  backtestCreateLimitBuyOrder,
  backtestCreateLimitSellOrder,
  getStrategyConfig,
  getMarketParametersByExchangeSymbol,
  checkBuyOrderAllowance,
  getSymbolsByExchange,
  getMarketParameters,
  getCurrentSellOrderPosition,
  fetchHistoricalOHLCVData,
  loadHistoricalOHLCVToBacktestRedis,
  fetchBacktestOHLCVData,
};