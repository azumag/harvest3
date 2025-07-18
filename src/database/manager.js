// Import MongoDB related functions
const {
  addTradeMongoDB,
  addSignalMongoDB,
  addOrderMongoDB,
  getOrderByOrderId,
  updateOrderByOrderId,
  deleteOrderByOrderId,
  connectDB,
  connectWithRetry,
  startHealthCheck,
  listOrders,
  listTrades,
  listSignals,
  countSignals,
  addOhlcvMongoDB,
  fetchHistoricalOHLCVData,
  fetchTickerFromMongoDB,
  listFilledPositions
} = require('./mongoDatabase');

const { postErrorToDiscord } = require('../common/notifications');
const marketDataProvider = require('../data/marketDataProvider');
const Logger = require('../hft/utils/Logger');
const { TRADING_EXECUTION_CONSTANTS, EXCHANGE_SETTINGS } = require('../common/const');
const { throttleMonitor } = require('../common/throttleMonitor');
const { apiCoordinator } = require('../common/apiCoordinator');

/**
 * Redisコミットエラークラス（構造化されたエラーハンドリング）
 */
class RedisCommitError extends Error {
  constructor(failedCommands, successfulCommands) {
    const errorDetails = failedCommands.map(({ command, errorMessage }) => 
      `${command}: ${errorMessage}`
    ).join(', ');
    
    super(`Redis Commit失敗: ${failedCommands.length}個のコマンドが失敗しました - ${errorDetails}`);
    this.name = 'RedisCommitError';
    this.code = 'REDIS_COMMIT_FAILED';
    this.failedCommands = failedCommands;
    this.successfulCommands = successfulCommands;
  }
}

// 一般的なRedisエラーコードのマッピング（パフォーマンス最適化：関数外で定義）
const REDIS_ERROR_CODES = {
  0: 'Connection closed',
  1: 'IO error',
  2: 'Connection timeout',
  3: 'Connection refused',
  4: 'Protocol error',
  5: 'Authentication failed',
  6: 'Database selection failed',
  7: 'Out of memory',
  8: 'Redis server error',
  9: 'Command not supported',
  10: 'Wrong number of arguments'
};

/**
 * Redisエラーメッセージの改善された取得関数
 * Issue #3622: 数値エラーコードや意味のないエラーオブジェクトの適切な処理
 */
function getRedisErrorMessage(error, commandIndex) {
  // undefinedまたはnullの場合
  if (error === undefined || error === null) {
    return 'Unknown error';
  }
  
  // Errorオブジェクトの場合
  if (error instanceof Error) {
    return error.message || error.toString();
  }
  
  // 文字列の場合
  if (typeof error === 'string') {
    // 意味のない文字列パターンをチェック
    if (error === '-' || error === '' || error.trim() === '') {
      return `Redis command ${commandIndex} failed: Invalid response`;
    }
    return error;
  }
  
  // 数値の場合（Redis エラーコード）
  if (typeof error === 'number') {
    const errorDescription = REDIS_ERROR_CODES[error] || `Redis error code: ${error}`;
    return `Redis command ${commandIndex} failed: ${errorDescription}`;
  }
  
  // オブジェクトの場合
  if (typeof error === 'object') {
    // messageプロパティがある場合
    if (error.message) {
      return error.message;
    }
    
    // codeプロパティがある場合
    if (error.code) {
      return `Redis error: ${error.code}`;
    }
    
    // nameプロパティがある場合
    if (error.name) {
      return `Redis error: ${error.name}`;
    }
    
    // JSON.stringifyで内容を取得しようとする
    try {
      const jsonStr = JSON.stringify(error);
      if (jsonStr && jsonStr !== '{}') {
        return `Redis command ${commandIndex} failed: ${jsonStr}`;
      }
    } catch (e) {
      // JSON.stringifyが失敗した場合は無視
    }
    
    // toString()を試す
    try {
      const stringified = error.toString();
      if (stringified && stringified !== '[object Object]') {
        return `Redis command ${commandIndex} failed: ${stringified}`;
      }
    } catch (e) {
      // toString()が失敗した場合は無視
    }
    
    return `Redis command ${commandIndex} failed: Unknown object error`;
  }
  
  // その他の型の場合
  return `Redis command ${commandIndex} failed: ${String(error)}`;
}

// Logger instance for database operations
const logger = new Logger('DatabaseManager');

// フォールバック定数
const FALLBACK_PRICE_PRECISION = 8; // デフォルトの価格精度

// 戦略名マッピング: 表示名 → 内部キー
function getStrategyKey(strategyDisplayName) {
  const strategyMapping = {
    'BB戦略': 'BOLLINGER_BANDS',
    'オシレーター戦略': 'OSCILLATOR',
    'MA戦略': 'MA',  // MA戦略はMAキーにマップする（MACDではない）
    'MACD戦略': 'MACD', // MACD戦略の表示名マッピングを追加
    'マルチ指標戦略': 'MULTI_INDICATOR',
    'RSI戦略': 'RSI',
    'BOLLINGER_BANDS': 'BOLLINGER_BANDS', // 既に正しいキーの場合はそのまま
    'OSCILLATOR': 'OSCILLATOR',
    'MACD': 'MACD',
    'MA': 'MA', // MAキーもそのまま返す
    'MULTI_INDICATOR': 'MULTI_INDICATOR',
    'RSI': 'RSI'
  };

  return strategyMapping[strategyDisplayName] || strategyDisplayName;
}

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

const { sleep, timeframeToMs, isBacktestMode, validateLockParameters } = require('../common/utils');
const { withBitbankErrorHandling } = require('../common/bitbankErrorHandler');

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
  const volumeNormalized = Math.min(volume / TRADING_EXECUTION_CONSTANTS.VOLUME_NORMALIZATION_BASE, 1);
  const spreadRatio = (high - low) / low; // 相対的なスプレッド

  // 流動性が高いほど実行確率が高く、スリッページが小さい
  const liquidityFactor = volumeNormalized * (1 - spreadRatio);

  // 実行確率（流動性が高いほど高い、基本確率から最大確率まで）
  const probabilityRange = TRADING_EXECUTION_CONSTANTS.MAX_EXECUTION_PROBABILITY - TRADING_EXECUTION_CONSTANTS.BASE_EXECUTION_PROBABILITY;
  const executionProbability = Math.min(
    TRADING_EXECUTION_CONSTANTS.BASE_EXECUTION_PROBABILITY + liquidityFactor * probabilityRange, 
    TRADING_EXECUTION_CONSTANTS.MAX_EXECUTION_PROBABILITY
  );

  // スリッページ（基本から最大まで、流動性によって変動）
  const baseSlippage = TRADING_EXECUTION_CONSTANTS.BASE_SLIPPAGE_PERCENT;
  const maxSlippage = TRADING_EXECUTION_CONSTANTS.MAX_SLIPPAGE_PERCENT;
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
  const volumeNormalized = Math.min(volume / TRADING_EXECUTION_CONSTANTS.VOLUME_NORMALIZATION_BASE, 1);
  const baseSpread = TRADING_EXECUTION_CONSTANTS.BASE_SPREAD_PERCENT;
  const maxSpread = TRADING_EXECUTION_CONSTANTS.MAX_SPREAD_PERCENT;

  const spreadMultiplier = 1 + volatility * TRADING_EXECUTION_CONSTANTS.SPREAD_VOLATILITY_MULTIPLIER - volumeNormalized;
  const spreadRatio = baseSpread + (Math.max(0, spreadMultiplier - 1)) * (maxSpread - baseSpread);
  const halfSpread = midPrice * spreadRatio / TRADING_EXECUTION_CONSTANTS.SPREAD_DIVISOR;

  return {
    bid: midPrice - halfSpread,
    ask: midPrice + halfSpread
  };
}

async function initializeDB() {
  const MAX_INIT_RETRIES = 3;
  const RETRY_DELAY = 5000; // 5秒
  
  for (let attempt = 1; attempt <= MAX_INIT_RETRIES; attempt++) {
    try {
      logger.info(`[DB初期化] データベース接続を開始します... (試行 ${attempt}/${MAX_INIT_RETRIES})`);

      // Redisの初期化（エラーハンドリング強化）
      logger.info('[DB初期化] Redis接続中...');
      try {
        await initialize();
        logger.info('[DB初期化] Redis接続が成功しました ✓');
      } catch (redisError) {
        logger.warn(`[DB初期化] Redis接続に失敗しました（続行します）: ${redisError.message}`);
        // Redis接続失敗は致命的ではないため、アプリケーションを続行
      }

      // MongoDBの初期化（改善された接続メカニズム使用）
      logger.info('[DB初期化] MongoDB接続中（指数バックオフ再試行付き）...');
      try {
        await connectWithRetry(5, 1000); // 最大5回、1秒から開始の指数バックオフ
        logger.info('[DB初期化] MongoDB接続が成功しました ✓');
        
        // 接続監視の開始
        logger.info('[DB初期化] MongoDB接続監視を開始します...');
        startHealthCheck();
      } catch (mongoError) {
        logger.error(`[DB初期化] MongoDB接続に失敗しました: ${mongoError.message}`);
        
        if (attempt < MAX_INIT_RETRIES) {
          logger.info(`[DB初期化] ${RETRY_DELAY}ms後に再試行します...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
          continue;
        }
        throw mongoError;
      }

      logger.info('[DB初期化] データベース初期化が完了しました ✓');
      return; // 成功した場合はここで終了
      
    } catch (error) {
      logger.error(`[DB初期化] データベース初期化に失敗しました (試行 ${attempt}/${MAX_INIT_RETRIES}):`, error.message);
      
      if (attempt === MAX_INIT_RETRIES) {
        // 最終試行でも失敗した場合
        const finalError = new Error(`データベース初期化失敗 (${MAX_INIT_RETRIES}回試行後): ${error.message}`);
        finalError.originalError = error;
        throw finalError;
      }
      
      // 再試行前の待機
      logger.info(`[DB初期化] ${RETRY_DELAY}ms後に再試行します...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
    }
  }
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
    let ohlcvs = await fetchHistoricalOHLCVData(exchange.id, symbol, timeframe, limit);
    
    if (!ohlcvs || ohlcvs.length === 0) {
      logger.info(`${symbol} - ${timeframe}: データが見つかりませんでした。データを自動取得を試行します...`);
      
      try {
        // 欠損データの自動取得を試行
        const autoFetchLimit = Math.max(limit, 1000); // 十分なデータ量を確保
        await fetchOHLCVData(exchange, symbol, timeframe, autoFetchLimit, { forceUpdate: true });
        
        // 再度MongoDBから取得を試行
        ohlcvs = await fetchHistoricalOHLCVData(exchange.id, symbol, timeframe, limit);
        
        if (ohlcvs && ohlcvs.length > 0) {
          logger.info(`${symbol} - ${timeframe}: データ自動取得成功 (${ohlcvs.length}件)`);
        } else {
          logger.warn(`${symbol} - ${timeframe}: データ自動取得失敗。空のデータセットを返します。`);
          return [];
        }
      } catch (autoFetchError) {
        logger.warn(`${symbol} - ${timeframe}: データ自動取得中にエラー: ${autoFetchError.message}`);
        return [];
      }
    }
    
    // Redisに保存
    await updateBacktestOHLCVRedisSortedSet(exchange.id, symbol, timeframe, ohlcvs);
    logger.info(`RedisにOHLCVデータを保存しました: ${exchange.id} ${symbol} ${timeframe} ${ohlcvs.length}件`);
    return ohlcvs;
  } catch (error) {
    logger.error(`Error loading historical OHLCV data: ${error.message}`);
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
    // logger.info(`fetchBacktestOHLCVData: ${exchangeId} ${symbol} ${timeframe} ${limit} ${timestamp}`);
    // Redisからデータを取得
    const redisData = await getBacktestOHLCVRedisBeforeTimestamp(exchangeId, symbol, timeframe, timestamp, limit);
    if (!redisData || redisData.length === 0) {
      // logger.info(`${symbol} - ${timeframe}: Redisにデータが見つかりませんでした。`);
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
    logger.error(`Error fetching historical OHLCV data: ${error.message}`);
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
      // logger.info(`[OHLCVData] バックテストモード: ${exchange.id} ${symbol} ${timeframe} ${limit} ${timestamp}`);
      return await fetchBacktestOHLCVData(exchange.id, symbol, timeframe, limit, timestamp);
    }

    // 通常モード時のログを制御（バックテスト時は出力しない）
    if (!isBacktestMode()) {
      logger.info(`[OHLCVData] 通常モード: ${exchange.id} ${symbol} ${timeframe} ${limit}`);
    }

    // キャッシュマネージャーとキューの初期化
    const cacheManager = getOHLCVCacheManagerInstance();
    const queue = getOHLCVQueueInstance();

    // 1. 階層化キャッシュから取得を試行
    const cachedData = await cacheManager.get(exchange.id, symbol, timeframe, limit, options);
    if (cachedData && !options.forceUpdate) {
      const duration = Date.now() - startTime;
      if (!isBacktestMode()) {
        logger.info(`[OHLCVData] キャッシュヒット: ${exchange.id} ${symbol} ${timeframe} (${duration}ms)`);
      }
      return applyLimitToData(cachedData, limit);
    }

    // 2. 新しいデータの取得が必要
    if (!isBacktestMode()) {
      logger.info(`[OHLCVData] APIから新しいデータを取得: ${exchange.id} ${symbol} ${timeframe}`);
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
        logger.info(`[OHLCVData] ${symbol} - ${timeframe}: データが見つかりませんでした。`);
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
      logger.info(`[OHLCVData] API取得完了: ${exchange.id} ${symbol} ${timeframe} (${ohlcvs.length}件, ${duration}ms)`);
    }

    return applyLimitToData(ohlcvs, limit);

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(`[OHLCVData] エラー: ${exchange.id} ${symbol} ${timeframe} (${duration}ms)`, error);

    // フォールバック: 従来の方法で取得を試行
    try {
      if (!isBacktestMode()) {
        logger.info('[OHLCVData] フォールバック処理: 従来の方法で取得');
      }
      return await fetchOHLCVDataFallback(exchange, symbol, timeframe, limit, options);
    } catch (fallbackError) {
      logger.error('[OHLCVData] フォールバック処理も失敗:', fallbackError);

      // 重要なエラーはDiscordに通知
      const { postErrorToDiscord } = require('../common/notifications');
      const errorMessage = `OHLCV Data Complete Failure: ${exchange.id} ${symbol} ${timeframe} - メインとフォールバック両方が失敗`;
      try {
        await postErrorToDiscord(errorMessage);
      } catch (err) {
        logger.error('Discord通知エラー:', err);
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
          volume: volume
        };
        addOhlcvMongoDB(ohlcvData);
      } catch (error) {
        logger.error('[OHLCVData] MongoDB保存エラー:', error);
      }
    }
  } catch (error) {
    logger.error('[OHLCVData] MongoDB保存処理エラー:', error);
  }
}

// データにlimitを適用
function applyLimitToData(data, limit) {
  if (!data || data.length === 0) {
    return data;
  }

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

/**
 * 指定された戦略キーの未約定注文のポジション量を取得する共通関数
 * @param {Object} exchange - 取引所オブジェクト
 * @param {string} symbol - 通貨ペア
 * @param {string} strategyKey - 戦略キー
 * @param {string} side - 注文の種類 ('buy' または 'sell')
 * @returns {Promise<number>} 未約定注文の合計量
 */
async function getCurrentOrderPositionBySide(exchange, symbol, strategyKey, side) {
  // 取引所がシンボルをサポートしているか確認
  if (!exchange.markets) {
    await exchange.loadMarkets();
  }

  // シンボルが取引所でサポートされているか確認
  if (!(symbol in exchange.markets)) {
    logger.info(`警告: ${exchange.id}は${symbol}をサポートしていません。${side === 'buy' ? '買い' : '売り'}注文ポジション計算をスキップします。`);
    return 0; // サポートされていない場合は0を返す
  }

  // 未約定の注文を取得
  let openOrders;
  try {
    openOrders = await exchange.fetchOpenOrders(symbol);
  } catch (fetchError) {
    // 認証エラーや無効なシンボルエラーの場合、サポートされていないシンボルとして扱う
    if (fetchError.name === 'AuthenticationError' || fetchError.message.includes('authentication') || fetchError.message.includes('Invalid symbol')) {
      logger.info(`警告: ${exchange.id}の${symbol}でオープンオーダー取得に失敗しました（サポートされていない可能性）: ${fetchError.message}`);
      return 0; // エラーの場合は0を返す
    }
    // その他のエラーは再スロー
    throw fetchError;
  }

  // 指定されたサイドの未約定注文のうち、注文を戦略キーでフィルタリングして合計量を計算
  const orderAmounts = await Promise.all(
    openOrders.map(async (order) => {
      const _strategyKey = await getOrderStrategyKeyByOrderId(order.id);
      return (strategyKey === _strategyKey && order.side === side) ? order.amount : 0;
    })
  );
  const totalAmount = orderAmounts.reduce((sum, amount) => sum + amount, 0);

  return totalAmount;
}

/**
 * 指定された戦略キーの未約定買い注文のポジション量を取得
 * @param {Object} exchange - 取引所オブジェクト
 * @param {string} symbol - 通貨ペア
 * @param {string} strategyKey - 戦略キー
 * @returns {Promise<number>} 未約定買い注文の合計量
 */
async function getCurrentOrderPosition(exchange, symbol, strategyKey) {
  return await getCurrentOrderPositionBySide(exchange, symbol, strategyKey, 'buy');
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

  // logger.info(summary);
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
    logger.warn(`[戦略探索] OrderID ${orderId} の戦略が見つかりません。関連取引から推測を試みます...`);

    // MongoDB から同じOrderIDの取引を探す
    const relatedTrades = await listTrades({ orderId }, {}, 10);
    if (relatedTrades.length > 0 && relatedTrades[0].strategy) {
      logger.info(`[戦略探索] 関連取引から戦略を復元: ${relatedTrades[0].strategy}`);
      return relatedTrades[0].strategy;
    }

    // それでも見つからない場合は、エラーログを記録してOUTSIDEを返す
    logger.error(`[戦略探索] OrderID ${orderId} の戦略が完全に不明です。OUTSIDE戦略を使用します。`);
    await postErrorToDiscord(`⚠️ 戦略不明注文検出: OrderID ${orderId} - 売り注文の誤配置リスク`);
  }

  return (order && order.strategy) ? order.strategy : 'OUTSIDE';
}

// 約定情報更新のキャッシュ (exchange:symbol -> {timestamp, promise})
const tradeUpdateCache = new Map();
const CACHE_DURATION = 30000; // 30秒間キャッシュ

// 定期的なキャッシュクリーンアップ (5分ごと)
let cacheCleanupInterval;
if (process.env.NODE_ENV !== 'test') {
  cacheCleanupInterval = setInterval(() => {
    const now = Date.now();
    const expiredKeys = [];

    for (const [key, cache] of tradeUpdateCache.entries()) {
      if (now - cache.timestamp > CACHE_DURATION * 2) { // 有効期限の2倍で削除
        expiredKeys.push(key);
      }
    }

    expiredKeys.forEach(key => tradeUpdateCache.delete(key));

    if (expiredKeys.length > 0) {
      logger.info(`[約定更新キャッシュ] 期限切れエントリを${expiredKeys.length}件削除`);
    }
  }, 5 * 60 * 1000);
}

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
    logger.info(`[約定更新] キャッシュヒット: ${exchange.id} ${symbol} (${cacheAge}秒前の結果を返却)`);
    const result = await cached.promise;
    logger.info(`[約定更新] キャッシュ結果返却完了: ${exchange.id} ${symbol} -> ${result}件`);
    return result;
  }

  const startTime = Date.now();
  logger.info(`[約定更新] 開始: ${exchange.id} ${symbol}`);

  // 実際の処理をPromiseとしてキャッシュに保存
  const updatePromise = updateFilledTradesInternal(exchange, symbol, startTime);
  tradeUpdateCache.set(cacheKey, {
    timestamp: now,
    promise: updatePromise
  });

  return updatePromise;
}

/**
 * 分散トランザクション対応の約定履歴更新実装
 * データ整合性とACID特性を保証
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
    if (!exchange.has || !exchange.has.fetchMyTrades) {
      if (!isBacktest) {
        logger.warn(`[約定更新] fetchMyTradesメソッドがサポートされていません: ${exchange.id} ${symbol}`);
      }
      return 0;
    }

    // 取引所から約定履歴を取得
    if (!isBacktest) {
      logger.info(`[約定更新] API呼び出し開始: ${exchange.id} ${symbol}`);
    }
    const apiStart = Date.now();

    // withBitbankErrorHandlingを使用してAPI呼び出しを実行
    const trades = await withBitbankErrorHandling(
      () => exchange.fetchMyTrades(symbol, lastCheckTime),
      exchange.id,
      'fetchMyTrades',
      symbol
    );

    // 空の配列が返された場合は処理を終了
    if (!trades || trades.length === 0) {
      const totalTime = Date.now() - startTime;
      if (!isBacktest) {
        logger.info(`[約定更新] 完了（約定なし）: ${exchange.id} ${symbol} (${totalTime}ms)`);
      }
      return 0;
    }

    const apiTime = Date.now() - apiStart;

    if (!isBacktest) {
      logger.info(`[約定更新] API呼び出し完了: ${exchange.id} ${symbol} (${apiTime}ms, ${trades ? trades.length : 0}件)`);
    }


    // 戦略キーを一括取得してキャッシュ
    if (!isBacktest) {
      logger.info(`[約定更新] 戦略キー取得開始: ${trades.length}件の約定を処理`);
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
          logger.info(`[約定更新] 戦略キー取得完了: ${orderIds.length}件 (${strategyTime}ms)`);
        }
      } catch (error) {
        if (!isBacktest) {
          logger.warn(`戦略キー一括取得エラー: ${error.message}`);
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
        timestamp: now
      };

      tradeDataList.push(_trade);
    }

    // 分散トランザクション処理
    let processedCount = 0;
    let successCount = 0;

    if (!isBacktest) {
      logger.info(`[約定更新] 分散トランザクション処理開始: ${tradeDataList.length}件`);
    }
    const dbStart = Date.now();

    for (const _trade of tradeDataList) {
      try {
        // 重複チェック（処理状態含む冪等性保証）
        const tradeCheck = await checkTradeExists(_trade.tradeId);

        if (tradeCheck.exists) {
          if (tradeCheck.state === 'COMPLETED') {
            if (!isBacktest) {
              logger.info(`[約定更新] 完了済み約定をスキップ: ${_trade.tradeId} (完了時刻: ${tradeCheck.completedAt})`);
            }
            processedCount++;
            successCount++; // 既に完了しているので成功とカウント
            continue;
          } else if (tradeCheck.state === 'PROCESSING') {
            if (!isBacktest) {
              logger.info(`[約定更新] 処理中約定をスキップ: ${_trade.tradeId} (他のプロセスが処理中)`);
            }
            processedCount++;
            continue; // 処理中の場合は成功にもカウントしない
          } else if (tradeCheck.state === 'FAILED') {
            if (!isBacktest) {
              logger.info(`[約定更新] 失敗約定を再処理: ${_trade.tradeId}`);
            }
            // 失敗状態の場合は再処理を試行
          }
        }

        // 分散トランザクション実行（Two-Phase Commit）
        const result = await executeDistributedTransaction(_trade, isBacktest);

        if (result.success) {
          successCount++;
          if (!isBacktest) {
            logger.info(`[約定更新] 分散トランザクション成功: ${_trade.tradeId}`);
          }
        } else {
          // トランザクション失敗時の処理
          if (!isBacktest) {
            logger.error(`[約定更新] 分散トランザクション失敗: ${_trade.tradeId} - ${result.error}`);
          }

          // 重要エラーの場合はDiscord通知
          if (result.severity === 'critical') {
            const { postErrorToDiscord } = require('../common/notifications');
            if (postErrorToDiscord && !isBacktest) {
              await postErrorToDiscord('🚨 **重要: 2PC約定処理失敗**\n' +
                                      `約定ID: ${_trade.tradeId}\n` +
                                      `取引所: ${_trade.exchange}\n` +
                                      `通貨: ${_trade.symbol}\n` +
                                      `戦略: ${_trade.strategy}\n` +
                                      `取引種別: ${_trade.side} ${_trade.amount} @ ${_trade.price}\n` +
                                      `エラー: ${result.error}\n` +
                                      '※ Two-Phase Commitによりデータ整合性は保たれています');
            }
          }
        }
      } catch (error) {
        if (!isBacktest) {
          logger.error(`[約定更新] 予期しないエラー: ${_trade.tradeId} - ${error.message}`);
        }

        // 予期しないエラーもDiscord通知
        const { postErrorToDiscord } = require('../common/notifications');
        if (postErrorToDiscord && !isBacktest) {
          await postErrorToDiscord('⚠️ **約定処理で予期しないエラー**\n' +
                                  `約定ID: ${_trade.tradeId}\n` +
                                  `エラー: ${error.message}\n` +
                                  '※ システム管理者による確認が必要です');
        }
      }

      processedCount++;
    }

    const dbTime = Date.now() - dbStart;
    if (!isBacktest) {
      logger.info(`[約定更新] 分散トランザクション処理完了: ${successCount}/${processedCount}件成功 (${dbTime}ms)`);
    }

    // サマリータイムスタンプは最後に一度だけ更新
    if (successCount > 0) {
      try {
        await updateTradeSummaryTimestamp(exchange.id, symbol, now);
      } catch (error) {
        if (!isBacktest) {
          logger.warn(`サマリータイムスタンプ更新エラー: ${error.message}`);
        }
      }
    }

    const totalTime = Date.now() - startTime;
    if (!isBacktest) {
      if (processedCount > 0) {
        logger.info(`[約定更新] 完了: ${exchange.id} ${symbol} ${processedCount}件処理 (合計${totalTime}ms)`);
      } else {
        logger.info(`[約定更新] 完了: ${exchange.id} ${symbol} 約定なし (${totalTime}ms)`);
      }
    }
    return processedCount;
  } catch (error) {
    const totalTime = Date.now() - startTime;
    logger.error(`[約定更新] エラー: ${exchange.id} ${symbol} (${totalTime}ms)`, error.message);

    // エラー時はキャッシュをクリア
    const cacheKey = `${exchange.id}:${symbol}`;
    tradeUpdateCache.delete(cacheKey);

    return 0;
  }
}

/**
 * 重複チェック（処理状態含む冪等性保証）
 */
async function checkTradeExists(tradeId) {
  try {
    const { connectDB } = require('./mongoDatabase');
    await connectDB();
    const mongoDatabase = require('./mongoDatabase');

    if (!mongoDatabase.tradesCollection) {
      return { exists: false, state: null };
    }

    const existingTrade = await mongoDatabase.tradesCollection.findOne({ tradeId });

    if (!existingTrade) {
      return { exists: false, state: null };
    }

    return {
      exists: true,
      state: existingTrade.processingState || 'UNKNOWN',
      completedAt: existingTrade.processingState === 'COMPLETED' ? existingTrade.lastStateUpdate : null
    };
  } catch (error) {
    logger.error(`重複チェックエラー: ${tradeId} - ${error.message}`);
    return { exists: false, state: null, error: error.message };
  }
}

/**
 * Two-Phase Commit Protocol実装による分散トランザクション
 * Phase 1: Prepare - 全参加者がコミット準備完了を確認
 * Phase 2: Commit - 全参加者が同時にコミット実行
 */
async function executeDistributedTransaction(trade, isBacktest) {
  let mongoSession = null;
  let redisTransaction = null;
  let distributedLock = null;

  try {
    // Issue #2790: トレードデータのバリデーション（トランザクション開始前）
    const validation = validateTradeData(trade);
    if (!validation.valid) {
      throw new Error(`トレードデータバリデーションエラー: ${validation.errors.join(', ')}`);
    }

    // 分散ロック取得（並行処理制御）
    distributedLock = await acquireDistributedLock(trade.exchange, trade.symbol, trade.tradeId);
    if (!distributedLock.acquired) {
      if (!isBacktest) {
        logger.info(`[2PC] 分散ロック取得失敗: ${trade.tradeId} - 他の処理が進行中`);
      }
      return { success: false, error: 'Lock acquisition failed', severity: 'warning' };
    }

    // 処理状態をPENDINGに設定（冪等性保証）
    const stateResult = await setTradeProcessingState(trade.tradeId, 'PENDING');
    if (!stateResult.success) {
      if (!isBacktest) {
        logger.info(`[2PC] 処理状態設定失敗: ${trade.tradeId} - ${stateResult.reason}`);
      }
      return { success: false, error: stateResult.reason, severity: 'warning' };
    }

    // === PHASE 1: PREPARE ===
    if (!isBacktest) {
      logger.info(`[2PC] Prepare Phase開始: ${trade.tradeId}`);
    }

    // MongoDB Prepare
    const { getClient } = require('./mongoDatabase');
    const mongoClient = getClient();
    mongoSession = mongoClient.startSession();
    mongoSession.startTransaction();

    // 処理状態をPROCESSINGに更新
    await setTradeProcessingState(trade.tradeId, 'PROCESSING');

    try {
      // MongoDB への準備処理（トランザクション内）
      await addTradeMongoDB(trade, { session: mongoSession });
      if (!isBacktest) {
        logger.info(`[2PC] MongoDB Prepare完了: ${trade.tradeId}`);
      }
    } catch (error) {
      throw new Error(`MongoDB Prepare失敗: ${error.message}`);
    }

    // Redis Prepare
    const redisDatabase = require('./redisDatabase');
    const redisClient = redisDatabase.getClient();
    redisTransaction = redisClient.multi();

    try {
      // Redis準備処理をトランザクションキューに追加
      await prepareRedisOperations(redisTransaction, trade);
      if (!isBacktest) {
        logger.info(`[2PC] Redis Prepare完了: ${trade.tradeId}`);
      }
    } catch (error) {
      throw new Error(`Redis Prepare失敗: ${error.message}`);
    }

    // === PHASE 2: COMMIT ===
    if (!isBacktest) {
      logger.info(`[2PC] Commit Phase開始: ${trade.tradeId}`);
    }

    // Redis先行コミット（原子性保証）
    const redisResults = await redisTransaction.exec();
    if (!redisResults) {
      throw new Error('Redis Commit失敗: トランザクション結果がnull');
    }
    
    // Issue #2856: 改善されたRedis結果検証とエラーハンドリング
    // パフォーマンス改善: reduceで結果を分類するため、初期化を削除
    
    // パフォーマンス改善: forEachをreduceに変更して効率的な分類処理
    const { failed: failedCommands, successful: successfulCommands } = redisResults.reduce((acc, result, index) => {
      if (result[0] !== null) {
        // エラーが発生したコマンド
        acc.failed.push({
          index,
          error: result[0],
          errorMessage: getRedisErrorMessage(result[0], index),
          command: `コマンド${index}`
        });
      } else {
        // 成功したコマンド
        acc.successful.push({
          index,
          result: result[1]
        });
      }
      return acc;
    }, { failed: [], successful: [] });
    
    if (failedCommands.length > 0) {
      // 詳細なエラー情報を構築
      const errorDetails = failedCommands.map(({ index, errorMessage, command }) => 
        `${command}: ${errorMessage}`
      ).join(', ');
      
      // Redis操作の詳細をログに記録
      if (!isBacktest) {
        logger.error(`[2PC] Redis Commit詳細 - 成功: ${successfulCommands.length}, 失敗: ${failedCommands.length}`);
        logger.error(`[2PC] 失敗したコマンド: ${errorDetails}`);
        logger.error(`[2PC] トレード情報: ${JSON.stringify({
          tradeId: trade.tradeId,
          exchange: trade.exchange,
          symbol: trade.symbol,
          strategy: trade.strategy,
          side: trade.side,
          amount: trade.amount,
          value: trade.value
        })}`);
      }
      
      throw new RedisCommitError(failedCommands, successfulCommands);
    }

    // MongoDB後続コミット
    await mongoSession.commitTransaction();

    // 処理状態をCOMPLETEDに更新
    await setTradeProcessingState(trade.tradeId, 'COMPLETED');

    if (!isBacktest) {
      logger.info(`[2PC] 分散トランザクション成功: ${trade.tradeId}`);
    }

    return { success: true };

  } catch (error) {
    const errorMessage = error?.message || error?.toString() || 'Unknown error';
    if (!isBacktest) {
      logger.error(`[2PC] エラー発生: ${trade.tradeId} - ${errorMessage}`);
    }

    // フェイルバック処理
    try {
      // MongoDB ロールバック
      if (mongoSession) {
        await mongoSession.abortTransaction();
        if (!isBacktest) {
          logger.info(`[2PC] MongoDB ロールバック完了: ${trade.tradeId}`);
        }
      }

      // Redis ロールバック（compensating transaction）
      if (redisTransaction) {
        await executeRedisCompensation(trade);
        if (!isBacktest) {
          logger.info(`[2PC] Redis 補償トランザクション完了: ${trade.tradeId}`);
        }
      }

      // 処理状態をFAILEDに更新
      await setTradeProcessingState(trade.tradeId, 'FAILED');

    } catch (rollbackError) {
      const rollbackErrorMessage = rollbackError?.message || rollbackError?.toString() || 'Unknown rollback error';
      if (!isBacktest) {
        logger.error(`[2PC] ロールバックエラー: ${trade.tradeId} - ${rollbackErrorMessage}`);
      }
    }

    return {
      success: false,
      error: errorMessage,
      severity: errorMessage.includes('MongoDB') ? 'critical' : 'warning'
    };

  } finally {
    // リソースクリーンアップ
    if (mongoSession) {
      await mongoSession.endSession();
    }
    if (distributedLock && distributedLock.acquired) {
      await releaseDistributedLock(distributedLock);
      if (!isBacktest) {
        logger.info(`[2PC] 分散ロック解放: ${trade.tradeId}`);
      }
    }
  }
}

/**
 * 分散ロック取得（Redis SET NX EX を使用）
 */
async function acquireDistributedLock(exchange, symbol, tradeId, ttl = 30000) {
  try {
    const redisDatabase = require('./redisDatabase');
    const redisClient = redisDatabase.getClient();
    const lockKey = `lock:trade:${exchange}:${symbol}:${tradeId}`;
    const lockValue = `${Date.now()}_${Math.random()}`;

    const result = await redisClient.set(lockKey, lockValue, 'PX', ttl, 'NX');

    return {
      acquired: result === 'OK',
      lockKey,
      lockValue,
      ttl
    };
  } catch (error) {
    logger.error(`分散ロック取得エラー: ${error.message}`);
    return { acquired: false, error: error.message };
  }
}

/**
 * 分散ロック解放
 */
async function releaseDistributedLock(lockInfo) {
  try {
    // lockInfoの厳密なバリデーション
    if (!lockInfo || typeof lockInfo !== 'object') {
      logger.warn(`分散ロック解放スキップ: 無効なlockInfo (${lockInfo})`);
      return false;
    }
    
    // lockKeyとlockValueの型安全性を確保
    if (!lockInfo.lockKey || !lockInfo.lockValue) {
      logger.warn(`分散ロック解放スキップ: パラメータが無効です (lockKey: ${lockInfo.lockKey}, lockValue: ${lockInfo.lockValue})`);
      return false;
    }
    
    // 無効な型をチェック（配列、関数、オブジェクトは処理しない）
    if (Array.isArray(lockInfo.lockKey) || typeof lockInfo.lockKey === 'function' || (typeof lockInfo.lockKey === 'object' && lockInfo.lockKey !== null)) {
      logger.warn(`分散ロック解放スキップ: 無効な型のlockKey (lockKey: ${lockInfo.lockKey}, lockValue: ${lockInfo.lockValue}, type: ${typeof lockInfo.lockKey})`);
      return false;
    }
    if (Array.isArray(lockInfo.lockValue) || typeof lockInfo.lockValue === 'function' || (typeof lockInfo.lockValue === 'object' && lockInfo.lockValue !== null)) {
      logger.warn(`分散ロック解放スキップ: 無効な型のlockValue (lockKey: ${lockInfo.lockKey}, lockValue: ${lockInfo.lockValue}, type: ${typeof lockInfo.lockValue})`);
      return false;
    }
    
    // 文字列に変換してバリデーション
    let stringLockKey = String(lockInfo.lockKey);
    let stringLockValue = String(lockInfo.lockValue);
    
    // 文字列化された値が有効かチェック
    if (stringLockKey === 'null' || stringLockKey === 'undefined' || stringLockKey === '' || stringLockKey === '[object Object]' || stringLockKey.includes(',') || stringLockKey.includes('[object')) {
      logger.warn(`分散ロック解放スキップ: 不正な文字列化されたlockKey (lockKey: ${lockInfo.lockKey}, lockValue: ${lockInfo.lockValue}, stringified: ${stringLockKey})`);
      return false;
    }
    if (stringLockValue === 'null' || stringLockValue === 'undefined' || stringLockValue === '' || stringLockValue === '[object Object]' || stringLockValue.includes(',') || stringLockValue.includes('[object')) {
      logger.warn(`分散ロック解放スキップ: 不正な文字列化されたlockValue (lockKey: ${lockInfo.lockKey}, lockValue: ${lockInfo.lockValue}, stringified: ${stringLockValue})`);
      return false;
    }
    
    // Redis Luaスクリプト用に文字列をサニタイズ（制御文字・非印字文字を除去）
    stringLockKey = stringLockKey.replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim();
    stringLockValue = stringLockValue.replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim();
    
    // サニタイズ後の最終チェック
    if (!stringLockKey || !stringLockValue) {
      logger.warn(`分散ロック解放スキップ: サニタイズ後に空文字列 (元lockKey: ${lockInfo.lockKey}, 元lockValue: ${lockInfo.lockValue})`);
      return false;
    }
    
    // バリデーションは文字列化されたパラメータで実行
    const validation = validateLockParameters(stringLockKey, stringLockValue, 'database/manager');
    if (!validation.valid) {
      logger.warn(`分散ロック解放スキップ: ${validation.error} (lockKey: ${stringLockKey}, lockValue: ${stringLockValue})`);
      return false;
    }

    const redisDatabase = require('./redisDatabase');
    const redisClient = redisDatabase.getClient();

    // Lua script for atomic lock release
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;

    // Redis eval()に明示的に文字列として渡す
    // Issue #3279: Redis Lua script引数の型安全性を強化
    let finalLockKey = stringLockKey;
    let finalLockValue = stringLockValue;
    
    // 文字列でない場合は強制的に文字列に変換
    if (typeof finalLockKey !== 'string') {
      finalLockKey = String(finalLockKey);
    }
    if (typeof finalLockValue !== 'string') {
      finalLockValue = String(finalLockValue);
    }
    
    // 最終的な型チェック
    if (typeof finalLockKey !== 'string' || typeof finalLockValue !== 'string') {
      logger.warn(`分散ロック解放スキップ: 最終的な型チェック失敗 (lockKey: ${typeof finalLockKey}, lockValue: ${typeof finalLockValue})`);
      return false;
    }
    
    const result = await redisClient.eval(script, 1, finalLockKey, finalLockValue);
    return result === 1;
  } catch (error) {
    logger.error(`分散ロック解放エラー: ${error.message}`);
    return false;
  }
}

/**
 * 処理状態管理（冪等性保証）
 */
async function setTradeProcessingState(tradeId, state) {
  try {
    const { connectDB } = require('./mongoDatabase');
    await connectDB();
    const mongoDatabase = require('./mongoDatabase');

    if (!mongoDatabase.tradesCollection) {
      throw new Error('tradesCollection is not available');
    }

    // 既存の処理状態をチェック
    const existingTrade = await mongoDatabase.tradesCollection.findOne({ tradeId });

    if (existingTrade) {
      const currentState = existingTrade.processingState;

      // 状態遷移の妥当性チェック
      if (currentState === 'COMPLETED') {
        return {
          success: false,
          reason: `取引は既に完了済み: ${tradeId}`
        };
      }

      if (currentState === 'PROCESSING' && state === 'PENDING') {
        return {
          success: false,
          reason: `取引は既に処理中: ${tradeId}`
        };
      }
    }

    // 状態を設定または更新
    await mongoDatabase.tradesCollection.updateOne(
      { tradeId },
      {
        $set: {
          processingState: state,
          lastStateUpdate: new Date()
        }
      },
      { upsert: true }
    );

    return { success: true };

  } catch (error) {
    logger.error(`処理状態設定エラー: ${tradeId} - ${error.message}`);
    return { success: false, reason: error.message };
  }
}

/**
 * 数値フィールドのバリデーション（共通関数）
 * DRY原則に従い、重複するバリデーションロジックを統合
 */
function validateNumericFields(trade, context = '') {
  const errors = [];
  
  // 数値の有効性チェック
  if (typeof trade.amount !== 'number' || !Number.isFinite(trade.amount) || trade.amount <= 0) {
    const message = context ? `${context}のためのamount値が無効: ${trade.amount}` : `無効なamount値: ${trade.amount}`;
    errors.push(message);
  }
  
  if (typeof trade.value !== 'number' || !Number.isFinite(trade.value) || trade.value <= 0) {
    const message = context ? `${context}のためのvalue値が無効: ${trade.value}` : `無効なvalue値: ${trade.value}`;
    errors.push(message);
  }
  
  // priceは必須ではない場合もあるため、存在する場合のみチェック
  if (trade.price !== undefined && (typeof trade.price !== 'number' || !Number.isFinite(trade.price) || trade.price <= 0)) {
    const message = context ? `${context}のためのprice値が無効: ${trade.price}` : `無効なprice値: ${trade.price}`;
    errors.push(message);
  }
  
  // 極端な値のチェック（定数を使用）
  if (trade.amount > TRADING_EXECUTION_CONSTANTS.MAX_TRADE_VALUE || 
      trade.value > TRADING_EXECUTION_CONSTANTS.MAX_TRADE_VALUE || 
      (trade.price && trade.price > TRADING_EXECUTION_CONSTANTS.MAX_TRADE_VALUE)) {
    const message = context ? `${context}のためのトレード値が上限を超過` : `トレード値が上限を超過`;
    errors.push(message);
  }
  
  return errors;
}

/**
 * トレードデータの数値バリデーション
 * Issue #2790: Redis commit失敗を防ぐための数値検証
 */
function validateTradeData(trade) {
  const errors = [];
  
  // Null安全性チェック
  if (!trade || typeof trade !== 'object') {
    errors.push('トレードオブジェクトが無効');
    return { valid: false, errors };
  }
  
  // 必須フィールドの存在チェック
  if (!trade.amount || !trade.value || !trade.price) {
    errors.push('必須フィールド (amount, value, price) が不足');
  }
  
  // 数値フィールドの検証（共通関数を使用）
  const numericErrors = validateNumericFields(trade);
  errors.push(...numericErrors);
  
  return {
    valid: errors.length === 0,
    errors: errors
  };
}

/**
 * Redis操作の準備（トランザクションキューに追加）
 */
async function prepareRedisOperations(transaction, trade) {
  // Issue #2856: Redis操作の事前バリデーション
  const validationErrors = [];
  
  // 必須フィールドの検証
  if (!trade.exchange || typeof trade.exchange !== 'string') {
    validationErrors.push('無効なexchange値');
  }
  if (!trade.symbol || typeof trade.symbol !== 'string') {
    validationErrors.push('無効なsymbol値');
  }
  if (!trade.strategy || typeof trade.strategy !== 'string') {
    validationErrors.push('無効なstrategy値');
  }
  if (!trade.side || !['buy', 'sell'].includes(trade.side)) {
    validationErrors.push('無効なside値');
  }
  
  // 数値フィールドの再検証（共通関数を使用）
  const numericErrors = validateNumericFields(trade, 'Redis操作');
  validationErrors.push(...numericErrors);
  
  if (validationErrors.length > 0) {
    throw new Error(`Redis操作準備時のバリデーションエラー: ${validationErrors.join(', ')}`);
  }

  // updateTradeSummary相当の操作をトランザクションに追加
  const summaryKey = `summary:trade:${trade.exchange}:${trade.symbol}:${trade.strategy}`;

  try {
    if (trade.side === 'buy') {
      transaction.hIncrByFloat(summaryKey, 'netPosition', trade.amount);
      transaction.hIncrByFloat(summaryKey, 'buyAmount', trade.amount);
      transaction.hIncrByFloat(summaryKey, 'totalBuyCost', trade.value);
    } else if (trade.side === 'sell') {
      transaction.hIncrByFloat(summaryKey, 'netPosition', -trade.amount);
      transaction.hIncrByFloat(summaryKey, 'sellAmount', trade.amount);
      transaction.hIncrByFloat(summaryKey, 'totalSellRevenue', trade.value);
    }

    // 未約定注文削除をトランザクションに追加
    if (trade.orderId && trade.strategy !== 'OUTSIDE') {
      const pendingKey = `pending:${trade.exchange}:${trade.symbol}:${trade.strategy}`;
      transaction.hDel(pendingKey, trade.orderId.toString());
    }

    // タイムスタンプ更新
    transaction.hSet(summaryKey, 'updatedAt', Date.now().toString());
  } catch (error) {
    throw new Error(`Redis操作準備エラー: ${error.message}`);
  }
}

/**
 * Redis補償トランザクション実行
 */
async function executeRedisCompensation(trade) {
  try {
    const redisDatabase = require('./redisDatabase');
    const redisClient = redisDatabase.getClient();
    const compensation = redisClient.multi();

    const summaryKey = `summary:trade:${trade.exchange}:${trade.symbol}:${trade.strategy}`;

    // 逆操作を実行
    if (trade.side === 'buy') {
      compensation.hIncrByFloat(summaryKey, 'netPosition', -trade.amount);
      compensation.hIncrByFloat(summaryKey, 'buyAmount', -trade.amount);
      compensation.hIncrByFloat(summaryKey, 'totalBuyCost', -trade.value);
    } else if (trade.side === 'sell') {
      compensation.hIncrByFloat(summaryKey, 'netPosition', trade.amount);
      compensation.hIncrByFloat(summaryKey, 'sellAmount', -trade.amount);
      compensation.hIncrByFloat(summaryKey, 'totalSellRevenue', -trade.value);
    }

    await compensation.exec();
  } catch (error) {
    logger.error(`Redis補償トランザクションエラー: ${error.message}`);
    throw error;
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
      logger.info(`警告: ${exchange.id}は${symbol}をサポートしていません。利用可能量計算をスキップします。`);
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
        logger.info(`警告: ${exchange.id}の${symbol}でオープンオーダー取得に失敗しました（サポートされていない可能性）: ${fetchError.message}`);
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

    // デバッグログ: 売却量計算の詳細
    if (!options.backtest) {
      logger.debug(`[売却量DEBUG] ${exchange.id} ${symbol} ${strategyKey}:`);
      logger.debug(`  ネットポジション: ${netPosition}`);
      logger.debug(`  未約定売り注文量: ${totalSellOrderAmount}`);
    }

    // 利用可能量 = ネットポジション - 未約定売り注文量
    let availableAmount = netPosition - totalSellOrderAmount;

    // 負の値にならないようにする
    if (availableAmount < 0) {
      availableAmount = 0;
    }

    // 実際の取引所残高との整合性チェック
    try {
      const baseAsset = symbol.split('/')[0];
      const balance = await exchange.fetchBalance();
      const actualBalance = balance.total[baseAsset] || 0;

      // 計算された利用可能量が実際の残高を超えている場合は、実際の残高を使用
      if (availableAmount > actualBalance) {
        logger.warn(`[WARNING] Available amount (${availableAmount}) exceeds actual balance (${actualBalance}) for ${symbol} - ${strategyKey}. Using actual balance.`);
        availableAmount = actualBalance;
      }
    } catch (balanceError) {
      logger.warn(`[WARNING] Failed to verify actual balance: ${balanceError.message}`);
      // エラーの場合は計算値をそのまま使用
    }

    // 精度を考慮して、最小精度以上の値を確保
    const result = parseFloat(availableAmount !== null && availableAmount !== undefined ? availableAmount.toFixed(amountPrecision) : 0);

    // デバッグログ: 最終結果
    if (!options.backtest) {
      logger.info(`  計算結果: ${availableAmount} → ${result} (精度: ${amountPrecision})`);
    }

    return result;
  } catch (error) {
    logger.error('利用可能量の計算に失敗しました:', error);
    // エラーとなった取引所とシンボルを記録
    const errorMessage = `formattedAvailableAmount実行中にエラーが発生しました: ${exchange.id} ${symbol} ${strategyKey}`;
    logger.error(errorMessage, error);

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
        logger.info({ backtest: options.backtest });
        logger.info(`バックテストモードでのティッカー取得に失敗しました: ${exchange.id} ${symbol}`);
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

    // リアルタイムモードの場合、marketDataProvider を使用
    return await marketDataProvider.fetchTicker(exchange, symbol);

  } catch (error) {
    logger.error(`Error fetching ticker for ${symbol}:`, error);
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
      [baseCurrency]: available > 0 ? available : 0 // 負の値にならないようにする
      // 他の通貨は必要に応じて追加
    };
    // logger.info(`[Backtest] 利用可能資金シミュレーション: ${baseCurrency}: ${result[baseCurrency]}`);
    return { free: result }; // fetchBalanceの戻り値の形式に合わせる
  }

  // リアルタイムモードの場合 - Issue #440: throttle queue overflow対策強化
  
  // Issue #440: throttleMonitorの状態をチェックしてサーキットブレーカー適用
  const throttleStats = throttleMonitor.getStats();
  const coordinatorStats = apiCoordinator.getStats();
  
  // サーキットブレーカー: システムが高負荷の場合はリトライを減らす
  let maxRetries = 2; // デフォルトリトライ数を削減（Issue #440対応）
  
  if (throttleStats.isRecoveryMode || 
      throttleStats.errorRate > 0.15 || 
      coordinatorStats.queueUsageRate > 0.7) {
    maxRetries = 1; // 高負荷時はリトライをさらに削減
    logger.warn(`[残高取得] システム高負荷検出、リトライを制限: ${maxRetries}回 (errorRate: ${(throttleStats.errorRate * 100).toFixed(1)}%, queueUsage: ${(coordinatorStats.queueUsageRate * 100).toFixed(1)}%)`);
  }
  
  let consecutiveFailures = 0;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Issue #440: システム負荷が高い場合は事前待機
      if (attempt === 1 && throttleStats.isRecoveryMode) {
        const preDelay = throttleMonitor.getRecommendedDelay();
        if (preDelay > 0) {
          logger.debug(`[残高取得] 事前待機: ${preDelay}ms (recovery mode)`);
          await new Promise(resolve => setTimeout(resolve, preDelay));
        }
      }
      
      // Issue #443: APIコーディネーターを使用して協調制御でAPI呼び出し
      const requestId = `balance_${exchange.id}_${symbol || 'all'}_${Date.now()}`;
      const balance = await apiCoordinator.executeAPICall(
        () => exchange.fetchBalance(),
        requestId,
        1 // 残高取得は高優先度
      );

      // デバッグ: 残高情報をログ出力
      const baseCurrency = symbol ? symbol.split('/')[1] : 'JPY';
      if (balance.free && balance.free[baseCurrency] !== undefined) {
        logger.debug(`[残高DEBUG] ${exchange.id} ${baseCurrency}: ${balance.free[baseCurrency]}円 (symbol: ${symbol})`);
      }

      // 成功時はthrottleMonitorに記録
      throttleMonitor.recordRequest(false);
      logger.debug(`[残高取得成功] ${exchange.id} 試行${attempt}回目で成功`);
      return balance;

    } catch (error) {
      consecutiveFailures++;
      const errorMessage = error?.message || error?.toString() || 'Unknown error';
      logger.warn(`[残高取得エラー] ${exchange.id} 試行${attempt}/${maxRetries}: ${errorMessage}`);

      // throttleMonitorにエラーを記録
      throttleMonitor.recordRequest(true, errorMessage);

      // Issue #438: maxCapacity特化処理 - 即座に中断し、throttleMonitorにmaxCapacityエラーを通知
      if (errorMessage.includes('maxCapacity') || 
          errorMessage.includes('throttle queue is over')) {
        logger.error(`[残高取得] maxCapacity overflow検出、即座に中断: ${errorMessage}`);
        
        // Issue #438: throttleMonitorにmaxCapacityエラーを記録（特別処理をトリガー）
        throttleMonitor.recordRequest(true, errorMessage);
        
        // Issue #438: 緊急時はDiscord通知を送信
        const emergencyContext = `🚨 Issue #438: CCXT maxCapacity overflow - ${exchange.id} 残高取得中
        
**エラー**: ${errorMessage}
**対象Exchange**: ${exchange.id}
**Symbol**: ${symbol || 'all'}
**試行回数**: ${attempt}/${maxRetries}

**自動対応**: throttleMonitor maxCapacity特化処理を実行中...`;
        await postErrorToDiscord(error, emergencyContext).catch(discordError => {
          logger.error('Discord通知失敗:', discordError);
        });
        
        throw new Error(`maxCapacity overflow (Issue #438対応): ${errorMessage}`);
      }

      // Issue #443: APIコーディネーター利用時のエラーハンドリング
      if (errorMessage.includes('queue is full') || 
          errorMessage.includes('coordinator')) {
        // APIコーディネーターのqueue満杯エラー
        logger.error(`[API Coordinator] queue満杯またはコーディネーターエラー: ${errorMessage}`);
        
        // Issue #440: coordinator errorの場合、より長い待機時間
        if (attempt < maxRetries) {
          const coordinatorDelay = Math.min(5000 * attempt, 15000); // 最大15秒
          logger.warn(`[残高取得] coordinator待機: ${coordinatorDelay}ms`);
          await new Promise(resolve => setTimeout(resolve, coordinatorDelay));
          continue;
        }
      }

      // throttle/rate limitエラーの場合（maxCapacity以外）
      if (errorMessage.includes('throttle') || 
          errorMessage.includes('rate limit') || 
          errorMessage.includes('429')) {
        
        // Issue #440: throttleMonitorの推奨遅延を優先使用
        const recommendedDelay = throttleMonitor.getRecommendedDelay();
        const fallbackDelay = Math.min(EXCHANGE_SETTINGS.BACKOFF_INITIAL_DELAY * Math.pow(2, attempt - 1), 
                                      EXCHANGE_SETTINGS.BACKOFF_MAX_DELAY);
        
        const delay = recommendedDelay > 0 ? Math.max(recommendedDelay, fallbackDelay) : fallbackDelay;
        
        logger.warn(`[Throttle対応] ${exchange.id} throttle/rate limitエラー検出: ${delay}ms待機中...`);
        
        // 最終試行でない場合のみ待機
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }

      // その他のエラーまたは最終試行の場合
      if (attempt === maxRetries) {
        logger.error(`[残高取得失敗] ${exchange.id} 最大試行回数(${maxRetries})に到達:`, error);
        
        // Issue #440: エラー詳細を含む通知
        const errorContext = `残高取得失敗: ${exchange.id} (${symbol}) - Issue #440対応後 - throttleStats: errorRate=${(throttleStats.errorRate * 100).toFixed(1)}%, queueUsage=${(coordinatorStats.queueUsageRate * 100).toFixed(1)}%`;
        await postErrorToDiscord(error, errorContext).catch(discordError => {
          logger.error('Discord通知失敗:', discordError);
        });
        
        throw error;
      }

      // 通常のエラーの場合は適応的待機
      const shortDelay = Math.min(2000 * attempt, 8000); // Issue #440: 最大8秒に制限
      logger.info(`[残高取得リトライ] ${exchange.id} ${shortDelay}ms後に再試行...`);
      await new Promise(resolve => setTimeout(resolve, shortDelay));
    }
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
  // logger.info(`[Backtest] 買い注文シミュレーション: ${symbol}, 数量: ${amount}, 価格: ${price}, OrderID: ${orderId}`);
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
  // logger.info(`[Backtest] 売り注文シミュレーション: ${symbol}, 数量: ${amount}, 価格: ${price}, OrderID: ${orderId}`);
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
            logger.error(`❌ [CRITICAL] ${exchangeId}:${symbol} - ${message}`);
            // 重要なエラーの場合は処理を停止
            throw new Error(`Critical error for ${exchangeId}:${symbol} - ${message}`);
          } else if (error === 'UNSUPPORTED_SYMBOL') {
            logger.warn(`⚠️ ${exchangeId}:${symbol} - ${message}`);
            logger.info(`   参考 - サポートペア例: ${params.examples?.join(', ') || 'なし'}`);
          } else {
            logger.warn(`⚠️ ${exchangeId}:${symbol} - ${message} (エラータイプ: ${error})`);
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

          logger.info(`✅ ${exchangeId}:${symbol} パラメータ取得成功:`, {
            minTradeAmount,
            pricePrecision,
            amountPrecision
          });
        } else {
          // nullまたは予期しないレスポンスの場合
          logger.warn(`⚠️ ${exchangeId}:${symbol} - 予期しないレスポンス:`, params);

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
        logger.error(`❌ ${exchangeId}:${symbol} パラメータ取得で予期しないエラー: ${error.message}`);
        logger.error(`   エラータイプ: ${error.name}`);
        logger.error(`   スタック: ${error.stack}`);

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
  // 統一化された戦略管理モジュールを使用
  const { getUnifiedStrategyConfig } = require('../config/strategyManager');

  return await getUnifiedStrategyConfig(config, exchange.id, symbol, strategyKey);
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
      logger.info(`${logPrefix} マーケットデータ未読み込み、読み込み中...`);
      await exchange.loadMarkets();
      logger.info(`${logPrefix} マーケットデータ読み込み完了`);
    }

    market = exchange.markets[symbol];
    if (!market) {
      // マーケットが見つからない場合、再読み込みを試行
      logger.info(`${logPrefix} マーケットが見つからず、再読み込み試行...`);
      await exchange.loadMarkets();
      market = exchange.markets[symbol];

      if (!market) {
        // サポートされている通貨ペアの一覧を取得（デバッグ用）
        const supportedSymbols = Object.keys(exchange.markets)
          .filter(s => s.includes('/JPY'))
          .sort();

        logger.error(`${logPrefix} ❌ 通貨ペア ${symbol} は取引所 ${exchange.id} でサポートされていません`);
        logger.error(`${logPrefix} サポートされているJPYペア数: ${supportedSymbols.length}`);
        logger.info(`${logPrefix} 参考 - サポートされているJPYペア（一部）: ${supportedSymbols.slice(0, 10).join(', ')}${supportedSymbols.length > 10 ? '...' : ''}`);

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

    logger.error(`${logPrefix} ❌ [${errorSeverity}] マーケットデータ読み込みエラー (${errorType}): ${loadError.message}`);

    return {
      error: errorType,
      message: `マーケットデータ読み込みエラー: ${loadError.message}`,
      severity: errorSeverity,
      originalError: loadError.name
    };
  }

  // market変数が正しく設定されているかチェック
  if (!market) {
    logger.error(`${logPrefix} ❌ 予期しないエラー: market変数が未定義です`);
    return {
      error: 'MARKET_UNDEFINED',
      message: '予期しないエラー: market変数が未定義です',
      severity: 'ERROR'
    };
  }

  // 基本パラメータの抽出と検証
  const minTradeAmount = market.limits?.amount?.min || 0.0001;
  let pricePrecision = market.precision ? market.precision.price : undefined;
  let amountPrecision = market.precision ? market.precision.amount : undefined;

  logger.info(`${logPrefix} 基本パラメータ抽出: minTradeAmount=${minTradeAmount}, pricePrecision=${pricePrecision}, amountPrecision=${amountPrecision}`);

  // 最小取引量の検証
  if (!minTradeAmount || minTradeAmount <= 0) {
    logger.error(`${logPrefix} ❌ 無効な最小取引量: ${minTradeAmount}`);
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
    logger.info(`${logPrefix} 価格精度が未定義のため、ティッカーから取得を試行...`);
    try {
      const ticker = await exchange.fetchTicker(symbol);
      if (!ticker || !ticker.last) {
        logger.warn(`${logPrefix} ⚠️ ティッカーまたはlast価格が取得できませんでした`);
        pricePrecision = FALLBACK_PRICE_PRECISION;
        logger.info(`${logPrefix} フォールバック価格精度を使用: ${pricePrecision}`);
      } else {
        const lastPrice = ticker.last;
        if (lastPrice && lastPrice > 0) {
          const priceDecimals = (lastPrice.toString().split('.')[1] || '').length;
          pricePrecision = priceDecimals;
          logger.info(`${logPrefix} ✅ ティッカーから価格精度を取得: ${pricePrecision} (価格: ${lastPrice})`);
        } else {
          logger.warn(`${logPrefix} ⚠️ ティッカーのlast価格が無効: ${lastPrice}`);
          return {
            error: 'INVALID_TICKER_PRICE',
            message: `ティッカーの価格が無効です: ${lastPrice}`,
            ticker: ticker
          };
        }
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

      logger.error(`${logPrefix} ❌ ティッカー取得エラー (${tickerErrorType}): ${tickerError.message}`);

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
    logger.info(`${logPrefix} 価格精度を正規化: ${pricePrecision}`);
  }

  // 数量精度の補完
  if (!amountPrecision) {
    const minTradeAmountDecimals = (minTradeAmount.toString().split('.')[1] || '').length;
    amountPrecision = minTradeAmountDecimals;
    logger.info(`${logPrefix} minTradeAmountから数量精度を算出: ${amountPrecision}`);
  }

  // 数量精度の正規化
  if (amountPrecision > 0 && amountPrecision < 1) {
    const amountDecimals = (amountPrecision.toString().split('.')[1] || '').length;
    amountPrecision = amountDecimals;
    logger.info(`${logPrefix} 数量精度を正規化: ${amountPrecision}`);
  }

  // 最終検証
  if (pricePrecision === undefined || amountPrecision === undefined) {
    logger.error(`${logPrefix} ❌ 精度パラメータが未定義: price=${pricePrecision}, amount=${amountPrecision}`);
    return {
      error: 'UNDEFINED_PRECISION',
      message: `精度パラメータが未定義です: price=${pricePrecision}, amount=${amountPrecision}`,
      extractedData: { minTradeAmount, pricePrecision, amountPrecision }
    };
  }

  const result = { minTradeAmount, pricePrecision, amountPrecision };
  logger.info(`${logPrefix} ✅ パラメータ取得成功:`, result);

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
      logger.info(`取引所 ${exchange} のシンボルを取得しました: ${symbols}`);
    } catch (error) {
      logger.error(`取引所 ${exchange} のマーケット情報取得でエラーが発生しました: ${error.message}`);
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
    // logger.info(`[Backtest] checkBuyOrderAllowance: lastSignal = ${options.backtest.lastSignal}`);
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

  logger.info(`最大可能購入量: ${maxBuyAmountWithMinTrade} 現在のポジション: ${currentTradePosition}, 買注文量: ${currentOrderPosition}, 売注文量: ${currentSellOrders}, 実質ポジション: ${effectivePosition}, 新注文後ポジション: ${newEffectivePosition}`);

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

/**
 * 指定された戦略キーの未約定売り注文のポジション量を取得
 * @param {Object} exchange - 取引所オブジェクト
 * @param {string} symbol - 通貨ペア
 * @param {string} strategyKey - 戦略キー
 * @returns {Promise<number>} 未約定売り注文の合計量
 */
async function getCurrentSellOrderPosition(exchange, symbol, strategyKey) {
  return await getCurrentOrderPositionBySide(exchange, symbol, strategyKey, 'sell');
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
      logger.info(`トレードサマリーを削除しました: ${key}`);
      return true;
    }
    return false;
  } catch (error) {
    logger.error(`トレードサマリー削除中にエラーが発生しました: ${error.message}`);
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
    const redisDatabase = require('./redisDatabase');
    const client = redisDatabase.getClient();

    // ⚠️ 危険: netPositionを0に補正すると戦略間データ損失が発生
    // 一時的に無効化 - より安全なアプローチが必要
    logger.warn(`[再計算] 危険な操作を無効化: netPosition=${netPosition} をリセットしません`);
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

    logger.info(`[再計算] ${exchangeId}:${symbol}:${strategyKey} - ネット=${netPosition}, 買い=${buyAmount}, 売り=${sellAmount}`);

    return newSummary;
    */
  } catch (error) {
    logger.error('[再計算] エラー:', error);
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
  acquireDistributedLock,
  releaseDistributedLock,
  fetchBacktestOHLCVData,
  deleteTradeSummary,
  savePendingOrderRedis,
  deletePendingOrderRedis,
  getAllPendingOrdersRedis,
  cleanupInvalidPendingOrders,
  recalculateTradeSummaryFromMongoDB,
  getStrategyKey, // 戦略名マッピング関数を追加
  executeDistributedTransaction, // Issue #2790: テスト用にエクスポート
  validateTradeData, // Issue #2790: テスト用にエクスポート
  prepareRedisOperations, // Issue #2856: テスト用にエクスポート
  getRedisErrorMessage // Issue #3622: テスト用にエクスポート
};