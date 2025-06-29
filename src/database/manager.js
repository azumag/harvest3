// Import MongoDB related functions
const { 
  addTradeMongoDB, 
  addSignalMongoDB, 
  addOrderMongoDB, 
  getOrderByOrderId,
  updateOrderByOrderId,
  deleteOrderByOrderId,
  connectDB,
  listOrders,
  listTrades,
  listSignals,
  countSignals,
  addOhlcvMongoDB,
  fetchHistoricalOHLCVData,
  saveTickerMongoDB,
  fetchTickerFromMongoDB,
  listFilledPositions,
} = require('./mongoDatabase');

const {
  savePendingOrderRedis,
  deletePendingOrderRedis,
  getAllPendingOrdersRedis,
  cleanupInvalidPendingOrders
} = require('./redisDatabase');

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
  getBacktestOHLCVRedisBeforeTimestamp,
  deleteKey
} = require('./redisDatabase');

const { fetchOHLCVDataAPI } = require('./exchangeAPI');
const { getOHLCVQueue } = require('./ohlcvQueue');
const { getOHLCVCacheManager } = require('./ohlcvCache');

const { sleep, timeframeToMs, isBacktestMode } = require('../common/utils');

// このモジュールは、DBへのアクセス層として、MongoDBとRedisの両方のデータベースにアクセスするための関数を提供します。
// また、取引所APIを通じて得る記録なども同列に外部DBとして取り扱います。

/**
 * バックテスト用の実行確率とスリッページを計算する
 * @param {number} volume - ボリューム 
 * @param {number} high - 高値
 * @param {number} low - 安値
 * @param {number} targetPrice - 目標執行価格
 * @returns {Object} { executionProbability, slippage }
 */
function calculateExecutionAccuracy(volume, high, low, targetPrice) {
  // ボリュームベースの流動性評価
  const volumeNormalized = Math.min(volume / 1000, 1); // 1000を基準値として正規化
  const spreadRatio = (high - low) / low; // 相対的なスプレッド
  
  // 流動性が高いほど実行確率が高く、スリッページが小さい
  const liquidityFactor = volumeNormalized * (1 - spreadRatio);
  
  // 実行確率（流動性が高いほど高い、基本確率85%）
  const executionProbability = Math.min(0.85 + liquidityFactor * 0.14, 0.99);
  
  // スリッページ（価格の0.01%〜0.1%、流動性によって変動）
  const baseSlippage = 0.0001; // 0.01%
  const maxSlippage = 0.001;   // 0.1%
  const slippageRatio = baseSlippage + (1 - liquidityFactor) * (maxSlippage - baseSlippage);
  const slippage = targetPrice * slippageRatio;
  
  return {
    executionProbability,
    slippage,
    liquidityFactor
  };
}

/**
 * スプレッドを考慮したビッド/アスク価格を生成
 * @param {number} midPrice - 中間価格
 * @param {number} volume - ボリューム
 * @param {number} volatility - ボラティリティ（high-low比率）
 * @returns {Object} { bid, ask }
 */
function generateRealisticSpread(midPrice, volume, volatility) {
  // ボリュームが低いほど、ボラティリティが高いほどスプレッドが広い
  const volumeNormalized = Math.min(volume / 1000, 1);
  const baseSpread = 0.0002; // 0.02%
  const maxSpread = 0.002;   // 0.2%
  
  const spreadMultiplier = 1 + volatility * 2 - volumeNormalized;
  const spreadRatio = baseSpread + (Math.max(0, spreadMultiplier - 1)) * (maxSpread - baseSpread);
  const halfSpread = midPrice * spreadRatio / 2;
  
  return {
    bid: midPrice - halfSpread,
    ask: midPrice + halfSpread
  };
}

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
      // console.log(`${symbol} - ${timeframe}: Redisにデータが見つかりませんでした。`);
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

// グローバルインスタンス（遅延初期化）
let _ohlcvQueue = null;
let _ohlcvCacheManager = null;

function getOHLCVQueueInstance() {
  if (!_ohlcvQueue) {
    _ohlcvQueue = getOHLCVQueue({
      maxConcurrentRequests: 1,
      rateLimitMs: 1000,
      retryAttempts: 3,
      retryDelayMs: 2000
    });
  }
  return _ohlcvQueue;
}

function getOHLCVCacheManagerInstance() {
  if (!_ohlcvCacheManager) {
    // redisDatabase モジュールの関数群を渡してキャッシュマネージャーを初期化
    const redisModule = {
      getOHLCVRedis,
      getOHLCVRedisTimestamp,
      updateOHLCVRedis,
      getBacktestOHLCVRedisBeforeTimestamp,
      updateBacktestOHLCVRedisSortedSet
    };
    _ohlcvCacheManager = getOHLCVCacheManager(redisModule, {
      memoryTTL: 300, // 5分
      maxMemoryKeys: 1000
    });
  }
  return _ohlcvCacheManager;
}

async function fetchOHLCVData(exchange, symbol, timeframe, limit = 100, options = {}) {
  const startTime = Date.now();
  
  try {
    // バックテストモードの場合（既存ロジックを維持）
    if (options.backtest) {
      const timestamp = options.backtest.timestamp;
      // console.log(`[OHLCVData] バックテストモード: ${exchange.id} ${symbol} ${timeframe} ${limit} ${timestamp}`);
      return await fetchBacktestOHLCVData(exchange.id, symbol, timeframe, limit, timestamp);
    }

    // 通常モード時のログを制御（バックテスト時は出力しない）
    if (!isBacktestMode()) {
      console.log(`[OHLCVData] 通常モード: ${exchange.id} ${symbol} ${timeframe} ${limit}`);
    }
    
    // キャッシュマネージャーとキューの初期化
    const cacheManager = getOHLCVCacheManagerInstance();
    const queue = getOHLCVQueueInstance();
    
    // 1. 階層化キャッシュから取得を試行
    const cachedData = await cacheManager.get(exchange.id, symbol, timeframe, limit, options);
    if (cachedData && !options.forceUpdate) {
      const duration = Date.now() - startTime;
      if (!isBacktestMode()) {
        console.log(`[OHLCVData] キャッシュヒット: ${exchange.id} ${symbol} ${timeframe} (${duration}ms)`);
      }
      return applyLimitToData(cachedData, limit);
    }

    // 2. 新しいデータの取得が必要
    if (!isBacktestMode()) {
      console.log(`[OHLCVData] APIから新しいデータを取得: ${exchange.id} ${symbol} ${timeframe}`);
    }
    
    // forceUpdate が true の場合以外は、limit を 200 にする（既存ロジック維持）
    const _limit = options.forceUpdate ? limit : 200;
    
    // 優先度の決定
    const requestOptions = {
      ...options,
      urgent: !options.backtest && !options.forceUpdate // リアルタイムの通常取得は高優先度
    };
    
    // 3. キューシステムを使用してAPIリクエスト
    const ohlcvs = await queue.requestOHLCV(
      exchange, 
      symbol, 
      timeframe, 
      _limit, 
      requestOptions
    );
    
    if (!ohlcvs || ohlcvs.length === 0) {
      if (!isBacktestMode()) {
        console.log(`[OHLCVData] ${symbol} - ${timeframe}: データが見つかりませんでした。`);
      }
      return [];
    }

    // 4. MongoDB保存処理（既存ロジック維持）
    await saveOHLCVToMongoDB(exchange, symbol, timeframe, ohlcvs, options);
    
    // 5. キャッシュに保存
    if (!options.forceUpdate) {
      await cacheManager.set(exchange.id, symbol, timeframe, _limit, ohlcvs, options);
    }
    
    const duration = Date.now() - startTime;
    if (!isBacktestMode()) {
      console.log(`[OHLCVData] API取得完了: ${exchange.id} ${symbol} ${timeframe} (${ohlcvs.length}件, ${duration}ms)`);
    }
    
    return applyLimitToData(ohlcvs, limit);
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[OHLCVData] エラー: ${exchange.id} ${symbol} ${timeframe} (${duration}ms)`, error);
    
    // フォールバック: 従来の方法で取得を試行
    try {
      if (!isBacktestMode()) {
        console.log(`[OHLCVData] フォールバック処理: 従来の方法で取得`);
      }
      return await fetchOHLCVDataFallback(exchange, symbol, timeframe, limit, options);
    } catch (fallbackError) {
      console.error(`[OHLCVData] フォールバック処理も失敗:`, fallbackError);
      
      // 重要なエラーはDiscordに通知
      const { postErrorToDiscord } = require('../common/notifications');
      const errorMessage = `OHLCV Data Complete Failure: ${exchange.id} ${symbol} ${timeframe} - メインとフォールバック両方が失敗`;
      try {
        await postErrorToDiscord(errorMessage);
      } catch (err) {
        console.error('Discord通知エラー:', err);
      }
      
      throw error; // 元のエラーをスロー
    }
  }
}

// MongoDB保存処理を分離（既存ロジック維持）
async function saveOHLCVToMongoDB(exchange, symbol, timeframe, ohlcvs, options) {
  try {
    const lastOhlcv = await fetchHistoricalOHLCVData(exchange.id, symbol, timeframe, 1);
    
    for (const ohlcv of ohlcvs) {
      if (options.forceUpdate) {
        // forceUpdate が true の場合は全て保存
      } else if (lastOhlcv && lastOhlcv[0] && ohlcv[0] <= lastOhlcv[0].timestamp) {
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
        console.error(`[OHLCVData] MongoDB保存エラー:`, error);
      }
    }
  } catch (error) {
    console.error(`[OHLCVData] MongoDB保存処理エラー:`, error);
  }
}

// データにlimitを適用
function applyLimitToData(data, limit) {
  if (!data || data.length === 0) return data;
  
  if (limit && limit > 0 && data.length > limit) {
    return data.slice(-limit);
  }
  
  return data;
}

// フォールバック処理（元の実装）
async function fetchOHLCVDataFallback(exchange, symbol, timeframe, limit, options) {
  const timestamp = Date.now();
  const redisOHLCVTimestamp = await getOHLCVRedisTimestamp(exchange.id, symbol, timeframe);
  const timeframeMs = timeframeToMs(timeframe);
  
  if (options.forceUpdate || !redisOHLCVTimestamp || (redisOHLCVTimestamp && timestamp - redisOHLCVTimestamp > timeframeMs)) {
    const _limit = options.forceUpdate ? limit : 200;
    const ohlcvs = await fetchOHLCVDataAPI(exchange, symbol, timeframe, _limit);
    
    if (!ohlcvs || ohlcvs.length === 0) {
      return [];
    }
    
    // MongoDB保存
    await saveOHLCVToMongoDB(exchange, symbol, timeframe, ohlcvs, options);
    
    if (!options.forceUpdate) {
      await updateOHLCVRedis(exchange.id, symbol, timeframe, ohlcvs);
    }
    
    return ohlcvs;
  } else {
    const redisData = await getOHLCVRedis(exchange.id, symbol, timeframe);
    return applyLimitToData(redisData, limit);
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
  // 取引所がシンボルをサポートしているか確認
  if (!exchange.markets) {
    await exchange.loadMarkets();
  }
  
  // シンボルが取引所でサポートされているか確認
  if (!(symbol in exchange.markets)) {
    console.log(`警告: ${exchange.id}は${symbol}をサポートしていません。注文ポジション計算をスキップします。`);
    return 0; // サポートされていない場合は0を返す
  }

  // 未約定の注文を取得
  let openOrders;
  try {
    openOrders = await exchange.fetchOpenOrders(symbol);
  } catch (fetchError) {
    // 認証エラーや無効なシンボルエラーの場合、サポートされていないシンボルとして扱う
    if (fetchError.name === 'AuthenticationError' || fetchError.message.includes('authentication') || fetchError.message.includes('Invalid symbol')) {
      console.log(`警告: ${exchange.id}の${symbol}でオープンオーダー取得に失敗しました（サポートされていない可能性）: ${fetchError.message}`);
      return 0; // エラーの場合は0を返す
    }
    // その他のエラーは再スロー
    throw fetchError;
  }

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
  
  // CRITICAL FIX: OUTSIDEデフォルトが売り注文の誤配置を引き起こす問題を修正
  // 売り注文が元の買い戦略に正しく関連付けされるよう、戦略探索を強化
  if (!order || !order.strategy) {
    console.warn(`[戦略探索] OrderID ${orderId} の戦略が見つかりません。関連取引から推測を試みます...`);
    
    // MongoDB から同じOrderIDの取引を探す
    const relatedTrades = await listTrades({ orderId }, {}, 10);
    if (relatedTrades.length > 0 && relatedTrades[0].strategy) {
      console.log(`[戦略探索] 関連取引から戦略を復元: ${relatedTrades[0].strategy}`);
      return relatedTrades[0].strategy;
    }
    
    // それでも見つからない場合は、エラーログを記録してOUTSIDEを返す
    console.error(`[戦略探索] OrderID ${orderId} の戦略が完全に不明です。OUTSIDE戦略を使用します。`);
    await postErrorToDiscord(`⚠️ 戦略不明注文検出: OrderID ${orderId} - 売り注文の誤配置リスク`);
  }

  return (order && order.strategy) ? order.strategy : 'OUTSIDE';
}

// 約定情報更新のキャッシュ (exchange:symbol -> {timestamp, promise})
const tradeUpdateCache = new Map();
const CACHE_DURATION = 30000; // 30秒間キャッシュ

// 定期的なキャッシュクリーンアップ (5分ごと)
setInterval(() => {
  const now = Date.now();
  const expiredKeys = [];
  
  for (const [key, cache] of tradeUpdateCache.entries()) {
    if (now - cache.timestamp > CACHE_DURATION * 2) { // 有効期限の2倍で削除
      expiredKeys.push(key);
    }
  }
  
  expiredKeys.forEach(key => tradeUpdateCache.delete(key));
  
  if (expiredKeys.length > 0) {
    console.log(`[約定更新キャッシュ] 期限切れエントリを${expiredKeys.length}件削除`);
  }
}, 5 * 60 * 1000);

/**
 * 前回チェック時から現在までの約定履歴を取得し記録する（キャッシュ付き）
 * @param {Object} exchange - 取引所オブジェクト
 * @param {string} symbol - 通貨ペア
 * @returns {Promise<number>} - 処理した約定数
 */
async function updateFilledTrades(exchange, symbol) {
  const cacheKey = `${exchange.id}:${symbol}`;
  const now = Date.now();
  
  // キャッシュチェック
  const cached = tradeUpdateCache.get(cacheKey);
  if (cached && (now - cached.timestamp) < CACHE_DURATION) {
    const cacheAge = Math.round((now - cached.timestamp)/1000);
    console.log(`[約定更新] キャッシュヒット: ${exchange.id} ${symbol} (${cacheAge}秒前の結果を返却)`);
    const result = await cached.promise;
    console.log(`[約定更新] キャッシュ結果返却完了: ${exchange.id} ${symbol} -> ${result}件`);
    return result;
  }
  
  const startTime = Date.now();
  console.log(`[約定更新] 開始: ${exchange.id} ${symbol}`);
  
  // 実際の処理をPromiseとしてキャッシュに保存
  const updatePromise = updateFilledTradesInternal(exchange, symbol, startTime);
  tradeUpdateCache.set(cacheKey, {
    timestamp: now,
    promise: updatePromise
  });
  
  return updatePromise;
}

/**
 * 約定履歴更新の実装部分
 */
async function updateFilledTradesInternal(exchange, symbol, startTime) {
  const isBacktest = process.env.BACKTEST_MODE === 'true';
  
  try {
    // 前回の更新時間を取得
    const timestamp = await getTradeSummaryTimestamp(exchange.id, symbol);
    const now = Date.now();

    // 前回のチェック時間（ない場合は24時間前）
    const lastCheckTime = timestamp ? timestamp : now - 24 * 60 * 60 * 1000;
    
    // fetchMyTradesメソッドが利用可能かどうかを確認
    if (!exchange.has || !exchange.has['fetchMyTrades']) {
      if (!isBacktest) {
        console.warn(`[約定更新] fetchMyTradesメソッドがサポートされていません: ${exchange.id} ${symbol}`);
      }
      return 0;
    }
    
    // 取引所から約定履歴を取得
    if (!isBacktest) {
      console.log(`[約定更新] API呼び出し開始: ${exchange.id} ${symbol}`);
    }
    const apiStart = Date.now();
    const trades = await exchange.fetchMyTrades(symbol, lastCheckTime);
    const apiTime = Date.now() - apiStart;
    
    if (!isBacktest) {
      console.log(`[約定更新] API呼び出し完了: ${exchange.id} ${symbol} (${apiTime}ms, ${trades ? trades.length : 0}件)`);
    }
    
    // 約定がない場合は早期リターン
    if (!trades || trades.length === 0) {
      const totalTime = Date.now() - startTime;
      if (!isBacktest) {
        console.log(`[約定更新] 完了（約定なし）: ${exchange.id} ${symbol} (${totalTime}ms)`);
      }
      return 0;
    }

    let processedCount = 0;
    let successCount = 0;
    
    // 戦略キーを一括取得してキャッシュ
    if (!isBacktest) {
      console.log(`[約定更新] 戦略キー取得開始: ${trades.length}件の約定を処理`);
    }
    const strategyStart = Date.now();
    const orderIds = trades.map(trade => trade.order).filter(id => id);
    const strategyKeyMap = new Map();
    
    if (orderIds.length > 0) {
      try {
        // 戦略キーを並列取得
        const strategyKeys = await Promise.all(
          orderIds.map(async orderId => {
            try {
              return await getOrderStrategyKeyByOrderId(orderId);
            } catch (error) {
              return 'OUTSIDE';
            }
          })
        );
        
        orderIds.forEach((orderId, index) => {
          strategyKeyMap.set(orderId, strategyKeys[index]);
        });
        
        const strategyTime = Date.now() - strategyStart;
        if (!isBacktest) {
          console.log(`[約定更新] 戦略キー取得完了: ${orderIds.length}件 (${strategyTime}ms)`);
        }
      } catch (error) {
        if (!isBacktest) {
          console.warn(`戦略キー一括取得エラー: ${error.message}`);
        }
      }
    }

    // 約定データを準備
    const tradeDataList = [];
    for (const trade of trades) {
      const strategyKey = strategyKeyMap.get(trade.order) || 'OUTSIDE';
      
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
      };
      
      tradeDataList.push(_trade);
    }

    // 約定データを処理
    if (!isBacktest) {
      console.log(`[約定更新] MongoDB書き込み開始: ${tradeDataList.length}件`);
    }
    const dbStart = Date.now();
    
    for (const _trade of tradeDataList) {
      try {
        await addTradeMongoDB(_trade);
        
        // summary:trade更新（最大3回再試行）
        let summaryUpdateSuccess = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            await updateTradeSummary(_trade);
            summaryUpdateSuccess = true;
            break;
          } catch (summaryError) {
            if (!isBacktest) {
              console.warn(`[約定処理] summary:trade更新失敗 (試行${attempt}/3): ${_trade.tradeId} - ${summaryError.message}`);
            }
            if (attempt === 3) {
              // 3回失敗した場合は重要エラーとして通知
              const { postErrorToDiscord } = require('../common/notifications');
              if (postErrorToDiscord && !isBacktest) {
                await postErrorToDiscord(`🚨 **重要: summary:trade更新失敗**\n` +
                                        `約定ID: ${_trade.tradeId}\n` +
                                        `通貨: ${_trade.symbol}\n` +
                                        `戦略: ${_trade.strategy}\n` +
                                        `エラー: ${summaryError.message}\n` +
                                        `※ 残高不整合の原因となる可能性があります`);
              }
              throw summaryError;
            }
            // 再試行前に100ms待機
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
        
        // 約定時に対応する未約定注文をRedisから削除（最大3回再試行）
        if (_trade.orderId && _trade.strategy !== 'OUTSIDE') {
          let orderDeleteSuccess = false;
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              const deleteResult = await deletePendingOrderRedis(
                _trade.exchange, 
                _trade.symbol, 
                _trade.strategy, 
                _trade.orderId
              );
              if (deleteResult && !isBacktest) {
                console.log(`[約定処理] 未約定注文を削除: ${_trade.orderId} (${_trade.exchange}:${_trade.symbol}:${_trade.strategy})`);
              }
              orderDeleteSuccess = true;
              break;
            } catch (deleteError) {
              if (!isBacktest) {
                console.warn(`[約定処理] 未約定注文削除失敗 (試行${attempt}/3): ${_trade.orderId} - ${deleteError.message}`);
              }
              if (attempt === 3) {
                // 3回失敗した場合は警告通知（重要ではないがログに残す）
                const { postOrderToDiscord } = require('../common/notifications');
                if (postOrderToDiscord && !isBacktest) {
                  await postOrderToDiscord(`⚠️ **未約定注文削除失敗**\n` +
                                          `約定ID: ${_trade.tradeId}\n` +
                                          `注文ID: ${_trade.orderId}\n` +
                                          `通貨: ${_trade.symbol}\n` +
                                          `戦略: ${_trade.strategy}\n` +
                                          `※ 手動確認が必要な場合があります`);
                }
              } else {
                // 再試行前に50ms待機
                await new Promise(resolve => setTimeout(resolve, 50));
              }
            }
          }
          
          // 約定時に対応するポジションをクローズ（最大3回再試行）
          let positionCloseSuccess = false;
          const positionKey = `${_trade.exchange}:${_trade.symbol}:${_trade.strategy}:${_trade.orderId}`;
          
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              const { closeAndCleanupPosition } = require('./redisDatabase');
              const closeResult = await closeAndCleanupPosition(positionKey, { saveHistory: true });
              
              if (closeResult.success) {
                if (!isBacktest) {
                  console.log(`[約定処理] ポジションをクローズ: ${_trade.orderId} (${_trade.exchange}:${_trade.symbol}:${_trade.strategy})`);
                }
                positionCloseSuccess = true;
                break;
              } else {
                throw new Error(closeResult.message || 'ポジションクローズ失敗');
              }
            } catch (closeError) {
              if (!isBacktest) {
                console.warn(`[約定処理] ポジションクローズ失敗 (試行${attempt}/3): ${_trade.orderId} - ${closeError.message}`);
              }
              if (attempt === 3) {
                // 3回失敗した場合は重要エラーとして通知
                const { postErrorToDiscord } = require('../common/notifications');
                if (postErrorToDiscord && !isBacktest) {
                  await postErrorToDiscord(`🚨 **重要: ポジションクローズ失敗**\n` +
                                          `約定ID: ${_trade.tradeId}\n` +
                                          `注文ID: ${_trade.orderId}\n` +
                                          `ポジションキー: ${positionKey}\n` +
                                          `エラー: ${closeError.message}\n` +
                                          `※ 手動でポジション確認が必要です`);
                }
              } else {
                // 再試行前に100ms待機
                await new Promise(resolve => setTimeout(resolve, 100));
              }
            }
          }
        }
        
        successCount++;
      } catch (error) {
        const { errorHandler } = require('../common/errorHandler');
        const context = `約定履歴の更新 (${exchange.id} ${symbol})`;
        
        // 重複キーエラー以外の場合はDiscord通知
        if (error.code !== 11000) {
          await errorHandler.handleError(error, context, false);
        } else {
          // 重複キーエラーの場合は警告ログのみ
          if (!isBacktest) {
            console.warn(`[約定更新] 重複約定をスキップ: tradeId=${_trade.tradeId}`);
          }
        }
      }
      
      processedCount++;
    }
    
    const dbTime = Date.now() - dbStart;
    if (!isBacktest) {
      console.log(`[約定更新] MongoDB書き込み完了: ${successCount}/${processedCount}件成功 (${dbTime}ms)`);
    }
    
    // サマリータイムスタンプは最後に一度だけ更新
    if (successCount > 0) {
      try {
        await updateTradeSummaryTimestamp(exchange.id, symbol, now);
      } catch (error) {
        if (!isBacktest) {
          console.warn(`サマリータイムスタンプ更新エラー: ${error.message}`);
        }
      }
    }
    
    const totalTime = Date.now() - startTime;
    if (!isBacktest) {
      if (processedCount > 0) {
        console.log(`[約定更新] 完了: ${exchange.id} ${symbol} ${processedCount}件処理 (合計${totalTime}ms)`);
      } else {
        console.log(`[約定更新] 完了: ${exchange.id} ${symbol} 約定なし (${totalTime}ms)`);
      }
    }
    return processedCount;
  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`[約定更新] エラー: ${exchange.id} ${symbol} (${totalTime}ms)`, error.message);
    
    // エラー時はキャッシュをクリア
    const cacheKey = `${exchange.id}:${symbol}`;
    tradeUpdateCache.delete(cacheKey);
    
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

  // MongoDBに注文履歴を保存
  const mongoResult = await addOrderMongoDB(order);

  // Redisに未約定注文として保存
  await savePendingOrderRedis(exchange.id, symbol, strategyKey, orderId, {
    side,
    amount,
    price,
    orderType,
    timestamp
  });

  return mongoResult;
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

    // シグナルが出過ぎるので一時的にシャットアウト
    return;

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
    // 取引所がシンボルをサポートしているか確認
    if (!exchange.markets) {
      await exchange.loadMarkets();
    }
    
    // シンボルが取引所でサポートされているか確認
    if (!(symbol in exchange.markets)) {
      console.log(`警告: ${exchange.id}は${symbol}をサポートしていません。利用可能量計算をスキップします。`);
      return 0; // サポートされていない場合は0を返す
    }

    // 取引記録から買った量を取得（ネットポジション）
    const netPosition = await getTradeCurrentPosition(exchange, symbol, strategyKey);

    // 未約定の注文を取得
    let openOrders;
    try {
      openOrders = await exchange.fetchOpenOrders(symbol);
    } catch (fetchError) {
      // 認証エラーや無効なシンボルエラーの場合、サポートされていないシンボルとして扱う
      if (fetchError.name === 'AuthenticationError' || fetchError.message.includes('authentication') || fetchError.message.includes('Invalid symbol')) {
        console.log(`警告: ${exchange.id}の${symbol}でオープンオーダー取得に失敗しました（サポートされていない可能性）: ${fetchError.message}`);
        return 0; // エラーの場合は0を返す
      }
      // その他のエラーは再スロー
      throw fetchError;
    }

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
    return parseFloat(availableAmount !== null && availableAmount !== undefined ? availableAmount.toFixed(amountPrecision) : 0);
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
      const timestamp = latestOHLCV[0];
      
      // まずMongoDBから該当時刻のティッカーデータを取得を試行
      const mongoTicker = await fetchTickerFromMongoDB(exchange.id, symbol, timestamp);
      if (mongoTicker) {
        // MongoDBにデータがある場合はそれを使用
        options.backtest.currentPrice = mongoTicker.last || mongoTicker.close;
        return {
          symbol: symbol,
          timestamp: mongoTicker.timestamp,
          datetime: new Date(mongoTicker.timestamp).toISOString(),
          bid: mongoTicker.bid || mongoTicker.last,
          ask: mongoTicker.ask || mongoTicker.last,
          last: mongoTicker.last,
          close: mongoTicker.close || mongoTicker.last,
          average: mongoTicker.average || mongoTicker.last,
          baseVolume: mongoTicker.baseVolume || latestOHLCV[5],
          info: {
            backtest: true,
            source: 'mongodb'
          }
        };
      }
      
      // MongoDBにデータがない場合は従来の擬似処理を使用
      // OHLCV データ形式: [timestamp, open, high, low, close, volume]
      const open = latestOHLCV[1];
      const high = latestOHLCV[2];
      const low = latestOHLCV[3];
      const close = latestOHLCV[4];
      const volume = latestOHLCV[5];
      
      // ボリュームを考慮した価格生成の改善
      let randomPrice;
      
      if (volume > 0) {
        // ボリュームが高い場合はより中心価格に近づける（流動性が高い）
        // ボリュームが低い場合はより広く分散させる（スプレッドが広い）
        const volumeNormalized = Math.min(volume / 1000, 1); // 正規化（1000を基準値とする）
        const spreadFactor = 1 - volumeNormalized * 0.5; // ボリュームが高いとスプレッドが狭くなる
        
        // 終値に近い値を重み付きで選択
        const closeWeight = 0.7;
        const meanPrice = close * closeWeight + ((high + low) / 2) * (1 - closeWeight);
        const adjustedStdDev = (high - low) / 6 * spreadFactor;
        
        // 標準正規分布の乱数を生成（Box-Muller変換）
        const u1 = Math.random();
        const u2 = Math.random();
        const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
        
        randomPrice = meanPrice + adjustedStdDev * z;
      } else {
        // ボリュームが0の場合は従来の方法
        const mean = (high + low) / 2;
        const stdDev = (high - low) / 6;
        
        const u1 = Math.random();
        const u2 = Math.random();
        const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
        
        randomPrice = mean + stdDev * z;
      }
      
      // 範囲外の値を切り詰める
      randomPrice = Math.max(low, Math.min(high, randomPrice));

      // ボラティリティとスプレッドを計算
      const volatility = (high - low) / close;
      const { bid, ask } = generateRealisticSpread(randomPrice, volume, volatility);
      
      // 実行精度情報を計算（将来の注文実行時に参考値として使用可能）
      const executionAccuracy = calculateExecutionAccuracy(volume, high, low, randomPrice);

      options.backtest.currentPrice = randomPrice; // 現在価格を更新
      
      // バックテスト用のティッカーオブジェクトを作成
      return {
        symbol: symbol,
        timestamp: timestamp,
        datetime: new Date(timestamp).toISOString(),
        bid: bid,
        ask: ask,
        last: randomPrice,
        close: close,
        average: randomPrice,
        baseVolume: volume,
        info: {
          backtest: true,
          source: 'generated',
          executionAccuracy: executionAccuracy
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
      // mongoDB にも保存 - exchange と symbol を追加
      const tickerWithMeta = {
        ...ticker,
        exchange: exchange.id,
        symbol: symbol
      };
      await saveTickerMongoDB(tickerWithMeta);

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
    
    // デバッグ: 残高情報をログ出力
    const baseCurrency = symbol ? symbol.split('/')[1] : 'JPY';
    if (balance.free && balance.free[baseCurrency] !== undefined) {
      console.log(`[残高DEBUG] ${exchange.id} ${baseCurrency}: ${balance.free[baseCurrency]}円 (symbol: ${symbol})`);
    }
    
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
      
      try {
        const params = await getMarketParameters(exchangeInstance, symbol);
        
        // エラーレスポンスかどうかをチェック
        if (params && params.error) {
          const { error, message, severity } = params;
          
          // エラーレベルに応じた処理
          if (severity === 'CRITICAL') {
            console.error(`❌ [CRITICAL] ${exchangeId}:${symbol} - ${message}`);
            // 重要なエラーの場合は処理を停止
            throw new Error(`Critical error for ${exchangeId}:${symbol} - ${message}`);
          } else if (error === 'UNSUPPORTED_SYMBOL') {
            console.warn(`⚠️ ${exchangeId}:${symbol} - ${message}`);
            console.log(`   参考 - サポートペア例: ${params.examples?.join(', ') || 'なし'}`);
          } else {
            console.warn(`⚠️ ${exchangeId}:${symbol} - ${message} (エラータイプ: ${error})`);
          }
          
          // エラーメトリクスの記録
          marketParametersByExchange[exchangeId] = marketParametersByExchange[exchangeId] || {};
          marketParametersByExchange[exchangeId][symbol] = {
            error: true,
            errorType: error,
            errorMessage: message,
            timestamp: new Date().toISOString()
          };
          
        } else if (params && !params.error) {
          // 正常なレスポンスの場合
          const { minTradeAmount, pricePrecision, amountPrecision } = params;

          marketParametersByExchange[exchangeId] = marketParametersByExchange[exchangeId] || {};
          marketParametersByExchange[exchangeId][symbol] = {
            minTradeAmount,
            pricePrecision,
            amountPrecision,
            timestamp: new Date().toISOString(),
            success: true
          };

          console.log(`✅ ${exchangeId}:${symbol} パラメータ取得成功:`, {
            minTradeAmount,
            pricePrecision,
            amountPrecision
          });
        } else {
          // nullまたは予期しないレスポンスの場合
          console.warn(`⚠️ ${exchangeId}:${symbol} - 予期しないレスポンス:`, params);
          
          marketParametersByExchange[exchangeId] = marketParametersByExchange[exchangeId] || {};
          marketParametersByExchange[exchangeId][symbol] = {
            error: true,
            errorType: 'UNEXPECTED_RESPONSE',
            errorMessage: '予期しないレスポンスを受信',
            response: params,
            timestamp: new Date().toISOString()
          };
        }
        
      } catch (error) {
        console.error(`❌ ${exchangeId}:${symbol} パラメータ取得で予期しないエラー: ${error.message}`);
        console.error(`   エラータイプ: ${error.name}`);
        console.error(`   スタック: ${error.stack}`);
        
        // エラー情報を記録
        marketParametersByExchange[exchangeId] = marketParametersByExchange[exchangeId] || {};
        marketParametersByExchange[exchangeId][symbol] = {
          error: true,
          errorType: 'UNEXPECTED_ERROR',
          errorMessage: error.message,
          errorName: error.name,
          timestamp: new Date().toISOString()
        };
        
        // 重要なエラーの場合は処理を停止
        if (error.message.includes('Critical error')) {
          throw error;
        }
        // その他のエラーは処理を続行
      }
      
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
  const logPrefix = `[getMarketParameters] ${exchange.id}:${symbol}`;
  let market = null;
  
  try {
    // マーケットが読み込まれていない場合は読み込み
    if (!exchange.markets) {
      console.log(`${logPrefix} マーケットデータ未読み込み、読み込み中...`);
      await exchange.loadMarkets();
      console.log(`${logPrefix} マーケットデータ読み込み完了`);
    }
    
    market = exchange.markets[symbol];
    if (!market) {
      // マーケットが見つからない場合、再読み込みを試行
      console.log(`${logPrefix} マーケットが見つからず、再読み込み試行...`);
      await exchange.loadMarkets();
      market = exchange.markets[symbol];
      
      if (!market) {
        // サポートされている通貨ペアの一覧を取得（デバッグ用）
        const supportedSymbols = Object.keys(exchange.markets)
          .filter(s => s.includes('/JPY'))
          .sort();
        
        console.error(`${logPrefix} ❌ 通貨ペア ${symbol} は取引所 ${exchange.id} でサポートされていません`);
        console.error(`${logPrefix} サポートされているJPYペア数: ${supportedSymbols.length}`);
        console.log(`${logPrefix} 参考 - サポートされているJPYペア（一部）: ${supportedSymbols.slice(0, 10).join(', ')}${supportedSymbols.length > 10 ? '...' : ''}`);
        
        return {
          error: 'UNSUPPORTED_SYMBOL',
          message: `通貨ペア ${symbol} は取引所 ${exchange.id} でサポートされていません`,
          supportedJPYPairs: supportedSymbols.length,
          examples: supportedSymbols.slice(0, 5)
        };
      }
    }
  } catch (loadError) {
    // エラーのタイプに応じた詳細分類
    let errorType = 'UNKNOWN_ERROR';
    let errorSeverity = 'ERROR';
    
    if (loadError.name === 'NetworkError' || loadError.message.includes('network')) {
      errorType = 'NETWORK_ERROR';
      errorSeverity = 'WARNING';
    } else if (loadError.name === 'AuthenticationError' || loadError.message.includes('authentication')) {
      errorType = 'AUTHENTICATION_ERROR';
      errorSeverity = 'CRITICAL';
    } else if (loadError.name === 'RateLimitExceeded' || loadError.message.includes('rate limit')) {
      errorType = 'RATE_LIMIT_ERROR';
      errorSeverity = 'WARNING';
    } else if (loadError.message.includes('timeout')) {
      errorType = 'TIMEOUT_ERROR';
      errorSeverity = 'WARNING';
    }
    
    console.error(`${logPrefix} ❌ [${errorSeverity}] マーケットデータ読み込みエラー (${errorType}): ${loadError.message}`);
    
    return {
      error: errorType,
      message: `マーケットデータ読み込みエラー: ${loadError.message}`,
      severity: errorSeverity,
      originalError: loadError.name
    };
  }
  
  // market変数が正しく設定されているかチェック
  if (!market) {
    console.error(`${logPrefix} ❌ 予期しないエラー: market変数が未定義です`);
    return {
      error: 'MARKET_UNDEFINED',
      message: `予期しないエラー: market変数が未定義です`,
      severity: 'ERROR'
    };
  }
  
  // 基本パラメータの抽出と検証
  const minTradeAmount = market.limits?.amount?.min || 0.0001;
  let pricePrecision = market.precision ? market.precision.price : undefined;
  let amountPrecision = market.precision ? market.precision.amount : undefined;
  
  console.log(`${logPrefix} 基本パラメータ抽出: minTradeAmount=${minTradeAmount}, pricePrecision=${pricePrecision}, amountPrecision=${amountPrecision}`);
  
  // 最小取引量の検証
  if (!minTradeAmount || minTradeAmount <= 0) {
    console.error(`${logPrefix} ❌ 無効な最小取引量: ${minTradeAmount}`);
    return {
      error: 'INVALID_MIN_TRADE_AMOUNT',
      message: `最小取引量が無効です: ${minTradeAmount}`,
      marketData: {
        limits: market.limits,
        precision: market.precision
      }
    };
  }
  
  // 価格精度の補完処理
  if (!pricePrecision) {
    console.log(`${logPrefix} 価格精度が未定義のため、ティッカーから取得を試行...`);
    try {
      const ticker = await exchange.fetchTicker(symbol);
      const lastPrice = ticker.last;
      
      if (lastPrice && lastPrice > 0) {
        const priceDecimals = (lastPrice.toString().split('.')[1] || '').length;
        pricePrecision = priceDecimals;
        console.log(`${logPrefix} ✅ ティッカーから価格精度を取得: ${pricePrecision} (価格: ${lastPrice})`);
      } else {
        console.warn(`${logPrefix} ⚠️ ティッカーのlast価格が無効: ${lastPrice}`);
        return {
          error: 'INVALID_TICKER_PRICE',
          message: `ティッカーの価格が無効です: ${lastPrice}`,
          ticker: ticker
        };
      }
    } catch (tickerError) {
      // ティッカー取得エラーの詳細分類
      let tickerErrorType = 'TICKER_FETCH_ERROR';
      
      if (tickerError.name === 'NetworkError') {
        tickerErrorType = 'TICKER_NETWORK_ERROR';
      } else if (tickerError.name === 'RateLimitExceeded') {
        tickerErrorType = 'TICKER_RATE_LIMIT_ERROR';
      } else if (tickerError.message.includes('Invalid symbol')) {
        tickerErrorType = 'TICKER_INVALID_SYMBOL_ERROR';
      }
      
      console.error(`${logPrefix} ❌ ティッカー取得エラー (${tickerErrorType}): ${tickerError.message}`);
      
      return {
        error: tickerErrorType,
        message: `価格精度取得のためのティッカー取得に失敗: ${tickerError.message}`,
        originalError: tickerError.name
      };
    }
  }
  
  // 価格精度の正規化
  if (pricePrecision > 0 && pricePrecision < 1) {
    const priceDecimals = (pricePrecision.toString().split('.')[1] || '').length;
    pricePrecision = priceDecimals;
    console.log(`${logPrefix} 価格精度を正規化: ${pricePrecision}`);
  }
  
  // 数量精度の補完
  if (!amountPrecision) {
    const minTradeAmountDecimals = (minTradeAmount.toString().split('.')[1] || '').length;
    amountPrecision = minTradeAmountDecimals;
    console.log(`${logPrefix} minTradeAmountから数量精度を算出: ${amountPrecision}`);
  }
  
  // 数量精度の正規化
  if (amountPrecision > 0 && amountPrecision < 1) {
    const amountDecimals = (amountPrecision.toString().split('.')[1] || '').length;
    amountPrecision = amountDecimals;
    console.log(`${logPrefix} 数量精度を正規化: ${amountPrecision}`);
  }
  
  // 最終検証
  if (pricePrecision === undefined || amountPrecision === undefined) {
    console.error(`${logPrefix} ❌ 精度パラメータが未定義: price=${pricePrecision}, amount=${amountPrecision}`);
    return {
      error: 'UNDEFINED_PRECISION',
      message: `精度パラメータが未定義です: price=${pricePrecision}, amount=${amountPrecision}`,
      extractedData: { minTradeAmount, pricePrecision, amountPrecision }
    };
  }
  
  const result = { minTradeAmount, pricePrecision, amountPrecision };
  console.log(`${logPrefix} ✅ パラメータ取得成功:`, result);
  
  return result;
}

async function getSymbolsByExchange(config) {
  const exchanges = Object.keys(config.exchanges);
  const symbolsByExchange = {};

  for (const exchange of exchanges) {
    try {
      const exchangeInstance = config.exchanges[exchange].instance;
      const markets = await exchangeInstance.loadMarkets();

      // 除外シンボル
      const symbols = Object.keys(markets).filter(symbol =>
        symbol.endsWith('/JPY') 
          && !config.global.excludeSymbols.some(excludePattern => symbol.startsWith(excludePattern))
      );

      symbolsByExchange[exchange] = symbols;
      console.log(`取引所 ${exchange} のシンボルを取得しました: ${symbols}`);
    } catch (error) {
      console.error(`取引所 ${exchange} のマーケット情報取得でエラーが発生しました: ${error.message}`);
      symbolsByExchange[exchange] = []; // エラー時は空配列を設定
      
      // 重要なエラー（認証エラー等）の場合は続行を停止
      if (error.name === 'AuthenticationError' || error.message.includes('API key')) {
        throw new Error(`取引所 ${exchange} の認証エラー: ${error.message}`);
      }
    }
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
async function checkBuyOrderAllowance(exchange, symbol, strategyKey, price, formattedAmount, availableFunds, tradePercentage, realizedPnL, baseMinTradeAmount, isPositionSized, options = {}) {
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
  const allowedFunds = (() => {
    if (isPositionSized) {
      // ポジションサイズが有効な場合、利用可能資金は現在のポジションに基づく
      return availableFunds;
    } else {
      // ポジションサイズが無効な場合、利用可能資金は全体資金の割合+実現損益に基づく
      return (availableFunds * tradePercentage) + realizedPnL;
    }
  })();

  // Check if available funds are sufficient, considering trade percentage
  if (requiredFunds > allowedFunds || formattedAmount <= 0) {
    return {
      allowed: false,
      reason: `資金不足のため買い注文をスキップ: ${symbol} - 必要: ${requiredFunds}, 利用可能(制限内): ${allowedFunds !== null && allowedFunds !== undefined ? allowedFunds.toFixed(2) : 'N/A'}`
    };
  }

  if (isPositionSized) {
    // ポジションサイジングが有効な場合、資金が十分あるならば現在量に関わらず許可
    return { allowed: true };
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
  // 取引所がシンボルをサポートしているか確認
  if (!exchange.markets) {
    await exchange.loadMarkets();
  }
  
  // シンボルが取引所でサポートされているか確認
  if (!(symbol in exchange.markets)) {
    console.log(`警告: ${exchange.id}は${symbol}をサポートしていません。売り注文ポジション計算をスキップします。`);
    return 0; // サポートされていない場合は0を返す
  }

  // 未約定の注文を取得
  let openOrders;
  try {
    openOrders = await exchange.fetchOpenOrders(symbol);
  } catch (fetchError) {
    // 認証エラーや無効なシンボルエラーの場合、サポートされていないシンボルとして扱う
    if (fetchError.name === 'AuthenticationError' || fetchError.message.includes('authentication') || fetchError.message.includes('Invalid symbol')) {
      console.log(`警告: ${exchange.id}の${symbol}でオープンオーダー取得に失敗しました（サポートされていない可能性）: ${fetchError.message}`);
      return 0; // エラーの場合は0を返す
    }
    // その他のエラーは再スロー
    throw fetchError;
  }

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

/**
 * Deletes the trade summary for a specific exchange, symbol, and strategy key.
 * 
 * @param {string} exchangeId - The ID of the exchange.
 * @param {string} symbol - The trading pair symbol (e.g., "BTC/USD").
 * @param {string} strategyKey - The unique key identifying the trading strategy.
 * @returns {Promise<boolean>} - Returns `true` if the trade summary was successfully deleted, otherwise `false`.
 */
async function deleteTradeSummary(exchangeId, symbol, strategyKey) {
  try {
    const key = `summary:trade:${exchangeId}:${symbol}:${strategyKey}`;
    const result = await deleteKey(key);
    if (result) {
      console.log(`トレードサマリーを削除しました: ${key}`);
      return true;
    }
    return false;
  } catch (error) {
    console.error(`トレードサマリー削除中にエラーが発生しました: ${error.message}`);
    return false;
  }
}

/**
 * MongoDBから取引履歴を取得してサマリーを再計算する
 */
async function recalculateTradeSummaryFromMongoDB(exchangeId, symbol, strategyKey) {
  try {
    await connectDB();
    
    // connectDB後にtradesCollectionが利用可能になるため、直接参照
    const mongoDatabase = require('./mongoDatabase');
    if (!mongoDatabase.tradesCollection) {
      throw new Error('tradesCollection is not available after connectDB');
    }
    const collection = mongoDatabase.tradesCollection;
    
    // 該当する全取引を取得
    const trades = await collection.find({
      exchangeId,
      symbol,
      strategyKey
    }).toArray();
    
    // 集計計算
    let netPosition = 0;
    let buyAmount = 0;
    let sellAmount = 0;
    let totalBuyCost = 0;
    let totalSellRevenue = 0;
    
    for (const trade of trades) {
      if (trade.side === 'buy') {
        buyAmount += trade.amount;
        totalBuyCost += trade.amount * trade.price;
        netPosition += trade.amount;
      } else if (trade.side === 'sell') {
        sellAmount += trade.amount;
        totalSellRevenue += trade.amount * trade.price;
        netPosition -= trade.amount;
      }
    }
    
    // Redisに再計算結果を保存
    const summaryKey = `summary:trade:${exchangeId}:${symbol}:${strategyKey}`;
    const { getClient } = require('./redisDatabase');
    const client = getClient();
    
    // ⚠️ 危険: netPositionを0に補正すると戦略間データ損失が発生
    // 一時的に無効化 - より安全なアプローチが必要
    console.warn(`[再計算] 危険な操作を無効化: netPosition=${netPosition} をリセットしません`);
    throw new Error('recalculateTradeSummaryFromMongoDB is temporarily disabled to prevent data loss');
    
    /* 危険なサマリーリセットを無効化
    const newSummary = {
      netPosition: Math.max(0, netPosition), // 負の値は0に補正 ← これが危険
      buyAmount,
      sellAmount,
      totalBuyCost,
      totalSellRevenue,
      avgBuyPrice: buyAmount > 0 ? totalBuyCost / buyAmount : 0,
      avgSellPrice: sellAmount > 0 ? totalSellRevenue / sellAmount : 0,
      updatedAt: Date.now()
    };
    
    await client.hSet(summaryKey, newSummary);
    
    console.log(`[再計算] ${exchangeId}:${symbol}:${strategyKey} - ネット=${netPosition}, 買い=${buyAmount}, 売り=${sellAmount}`);
    
    return newSummary;
    */
  } catch (error) {
    console.error('[再計算] エラー:', error);
    throw error;
  }
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
  getAllStrategyParameters,
  listOrders,
  listTrades,
  listSignals,
  countSignals,
  listFilledPositions,
  updateOrderByOrderId,
  deleteOrderByOrderId,
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
  deleteTradeSummary,
  savePendingOrderRedis,
  deletePendingOrderRedis,
  getAllPendingOrdersRedis,
  cleanupInvalidPendingOrders,
  recalculateTradeSummaryFromMongoDB,
};