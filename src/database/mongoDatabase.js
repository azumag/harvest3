const { MongoClient, ObjectId } = require('mongodb');
const dotenv = require('dotenv');
const { SETTINGS } = require('../config/settings');
const {
  safeValidateTradeData,
  safeValidateOrderData
} = require('./schemas');
const { postMongoConnectionErrorToDiscord } = require('../common/notifications');
const Logger = require('../hft/utils/Logger');
dotenv.config();

const logger = new Logger('MongoDB');

const mongoUrl = process.env.MONGO_URL;
const mongoDbName = process.env.MONGODB_DB_NAME;

// MongoDB接続オプションを追加 - 本番環境向けに最適化
// レビュー対応: 非対応オプションを削除し、安定した接続設定に変更
const mongoOptions = {
  serverSelectionTimeoutMS: SETTINGS.DATABASE.MONGODB.SERVER_SELECTION_TIMEOUT,
  connectTimeoutMS: SETTINGS.DATABASE.MONGODB.CONNECT_TIMEOUT,
  socketTimeoutMS: SETTINGS.DATABASE.MONGODB.SOCKET_TIMEOUT,
  maxPoolSize: SETTINGS.DATABASE.MONGODB.MAX_POOL_SIZE,
  minPoolSize: SETTINGS.DATABASE.MONGODB.MIN_POOL_SIZE,
  maxIdleTimeMS: SETTINGS.DATABASE.MONGODB.MAX_IDLE_TIME,
  retryWrites: true,                // 書き込み再試行を有効化
  heartbeatFrequencyMS: SETTINGS.DATABASE.MONGODB.HEARTBEAT_FREQUENCY,
  // bufferMaxEntries: 削除（新しいドライバでは非対応）
  compressors: ['zlib'],            // データ圧縮を有効化
  maxConnecting: SETTINGS.DATABASE.MONGODB.MAX_CONNECTING
};

let client;
let db;

// 接続プール監視用の変数
let connectionMonitoringInterval;
const connectionStats = {
  totalConnections: 0,
  activeConnections: 0,
  availableConnections: 0,
  maxConnections: mongoOptions.maxPoolSize,
  lastChecked: null
};

/**
 * 接続プールの統計情報を更新
 */
function updateConnectionStats() {
  if (!client) {
    connectionStats.totalConnections = 0;
    connectionStats.activeConnections = 0;
    connectionStats.availableConnections = 0;
  } else {
    try {
      // MongoDB Node.js Driverでの接続プール情報の取得
      const topology = client.topology;
      if (topology && topology.s && topology.s.servers) {
        let totalActive = 0;
        let totalAvailable = 0;
        topology.s.servers.forEach(server => {
          if (server.s && server.s.pool) {
            totalActive += server.s.pool.totalConnectionCount || 0;
            totalAvailable += server.s.pool.availableConnectionCount || 0;
          }
        });
        connectionStats.totalConnections = totalActive;
        connectionStats.activeConnections = totalActive - totalAvailable;
        connectionStats.availableConnections = totalAvailable;
      }
    } catch (error) {
      logger.warn('接続プール統計の取得に失敗:', error.message);
    }
  }
  connectionStats.lastChecked = new Date().toISOString();
}

/**
 * 接続プール監視の開始
 */
function startConnectionMonitoring() {
  if (connectionMonitoringInterval) {
    clearInterval(connectionMonitoringInterval);
  }

  connectionMonitoringInterval = setInterval(() => {
    updateConnectionStats();

    // 警告レベルのチェック（接続プールの80%を超えた場合）
    const usageRatio = connectionStats.totalConnections / connectionStats.maxConnections;
    if (usageRatio > 0.8) {
      logger.warn(`接続プール使用率が高いです: ${Math.round(usageRatio * 100)}% (${connectionStats.totalConnections}/${connectionStats.maxConnections})`);

      // Discord通知を送信（循環参照回避のため条件付き読み込み）
      try {
        const { postErrorToDiscord } = require('../common/notifications');
        postErrorToDiscord(`⚠️ **MongoDB接続プール警告**\n使用率: ${Math.round(usageRatio * 100)}%\n接続数: ${connectionStats.totalConnections}/${connectionStats.maxConnections}`, {
          deduplicationKey: `mongo_pool_warning_${Math.floor(usageRatio * 10)}`,
          priority: 2, // WARNING
          deduplicationWindow: 1800000 // 30分間の重複防止
        });
      } catch (error) {
        logger.warn('Discord通知の送信に失敗:', error.message);
      }
    }
  }, 30000); // 30秒ごとに監視
}

/**
 * 接続プール統計の取得
 */
function getConnectionStats() {
  updateConnectionStats();
  return { ...connectionStats };
}

/**
 * MongoDB接続状態を確認する (非推奨APIに依存しない)
 */
async function isConnected() {
  try {
    if (!client) {
      return false;
    }
    // ping コマンドで接続状態を確認
    await client.db('admin').command({ ping: 1 });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * 構造化ログメタデータを作成するヘルパー関数
 * @param {string} operation - 操作名
 * @param {Error} error - エラーオブジェクト
 * @param {Object} additionalData - 追加データ
 * @returns {Object} 構造化ログメタデータ
 */
function createLogMetadata(operation, error, additionalData = {}) {
  const metadata = {
    operation,
    error: error.message,
    errorCode: error.code,
    timestamp: Date.now(),
    ...additionalData
  };

  // 本番環境ではスタックトレースの最初の行のみを含める（セキュリティ対策）
  if (process.env.NODE_ENV === 'production') {
    metadata.stack = error.stack?.split('\n')[0] || error.message;
  } else {
    metadata.stack = error.stack;
  }

  return metadata;
}

/**
 * 指数バックオフでのリトライ実行
 */
async function retryWithBackoff(operation, operationName, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const isLastAttempt = attempt === maxRetries;
      
      // 警告ログでは本番環境でもスタックトレースを含めない
      logger.warn(`${operationName} 失敗 (試行 ${attempt}/${maxRetries}):`, {
        operation: operationName,
        error: error.message,
        errorCode: error.code,
        attempt: attempt,
        maxRetries: maxRetries
      });

      if (isLastAttempt) {
        logger.error(`${operationName} 最終失敗:`, createLogMetadata(operationName, error, {
          maxRetries: maxRetries
        }));
        throw error;
      }

      const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // 1s, 2s, 4s, max 10s
      logger.info(`${backoffMs}ms後にリトライします...`);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }
}

/**
 * MongoDBに接続し、データベースとコレクションへの参照を取得する（リトライロジック付き）
 */
async function connectDB() {
  if (!await isConnected()) {
    await retryWithBackoff(async () => {
      logger.info('MongoDB接続情報:', { mongoDbName, mongoUrl });
      client = new MongoClient(mongoUrl, mongoOptions);
      await client.connect();
      db = client.db(mongoDbName);
      logger.info('MongoDBに接続しました');

      // 必要なコレクションが存在するか確認し、存在しない場合は作成
      await ensureCollectionsExist();

      // コレクションの参照を取得
      module.exports.ordersCollection = db.collection('orders');
      module.exports.tradesCollection = db.collection('trades');
      module.exports.signalsCollection = db.collection('signals');
      module.exports.ohlcvCollection = db.collection('ohlcv'); // ohlcvCollection の参照を追加
      module.exports.tickersCollection = db.collection('tickers');
      module.exports.positionsCollection = db.collection('positions');

      // 接続プール監視の開始
      startConnectionMonitoring();

      // インデックスの作成 (冪等性があるため、接続時に実行しても問題ない)
      await createIndexes();
    }, 'MongoDB接続', 3);

    // 接続成功後のDiscord通知（エラー時のみ送信していたが、接続復旧も通知）
    try {
      // 接続エラー履歴がある場合のみ復旧通知
      logger.info('接続が正常に確立されました');
    } catch (notificationError) {
      logger.warn('Discord通知送信に失敗:', notificationError.message);
    }
  }
}

/**
 * 必要なコレクションが存在するか確認し、存在しない場合は作成する
 */
async function ensureCollectionsExist() {
  try {
    // 既存のコレクション一覧を取得
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);

    // 必要なコレクションのリスト
    const requiredCollections = ['orders', 'trades', 'signals', 'ohlcv', 'tickers'];

    // 存在しないコレクションを作成
    for (const name of requiredCollections) {
      if (!collectionNames.includes(name)) {
        logger.info(`コレクション ${name} が存在しないため作成します`);
        await db.createCollection(name);
        logger.info(`コレクション ${name} を作成しました`);
      }
    }
  } catch (error) {
    logger.error('コレクション確認/作成エラー:', createLogMetadata('ensureCollectionsExist', error));
    throw error;
  }
}

/**
 * MongoDB接続を閉じる
 */
async function closeDB() {
  try {
    stopHealthCheck();
    if (client) {
      await client.close();
      logger.info('MongoDB接続を閉じました');
      client = null;
      db = null;
    }
  } catch (error) {
    logger.error('MongoDB接続切断エラー:', createLogMetadata('closeDB', error));
  }
}

/**
 * コレクションにインデックスを作成する
 * 既に存在するインデックスは再作成しない
 */
async function createIndexes() {
  try {
    // 各コレクションのインデックス作成処理
    await createCollectionIndexesIfNotExist('orders', [
      { key: { orderId: 1 }, options: { unique: true } },
      { key: { timestamp: 1 }, options: {} },
      { key: { timestamp: -1 }, options: {} },
      { key: { exchange: 1 }, options: {} },
      { key: { symbol: 1 }, options: {} }
    ]);

    await createCollectionIndexesIfNotExist('trades', [
      { key: { orderId: 1 }, options: {} },
      { key: { tradeId: 1 }, options: { unique: true } },
      { key: { filledAt: 1 }, options: {} },
      { key: { filledAt: -1 }, options: {} }
    ]);

    await createCollectionIndexesIfNotExist('signals', [
      { key: { timestamp: 1 }, options: {} },
      { key: { timestamp: -1 }, options: {} }
    ]);

    await createCollectionIndexesIfNotExist('ohlcv', [
      { key: { exchange: 1, symbol: 1, timeframe: 1, timestamp: 1 }, options: { unique: true } },
      { key: { timestamp: 1 }, options: {} }, // タイムスタンプでの検索・ソート用
      { key: { timestamp: -1 }, options: {} }
    ]);

    await createCollectionIndexesIfNotExist('tickers', [
      { key: { exchange: 1, symbol: 1, timestamp: 1 }, options: { unique: true } },
      { key: { timestamp: 1 }, options: {} },
      { key: { timestamp: -1 }, options: {} }
    ]);

    logger.info('MongoDBインデックスの確認/作成が完了しました');
  } catch (error) {
    logger.error('MongoDBインデックス作成エラー:', createLogMetadata('createIndexes', error));
  }
}

/**
 * 指定されたコレクションに、必要なインデックスが存在しない場合のみ作成する
 * @param {string} collectionName - コレクション名
 * @param {Array} indexSpecs - インデックス定義の配列
 */
async function createCollectionIndexesIfNotExist(collectionName, indexSpecs) {
  const collection = db.collection(collectionName);

  // 既存のインデックスを取得
  const existingIndexes = await collection.listIndexes().toArray();
  const existingIndexMap = new Map();

  // 既存インデックス情報をマップに格納
  existingIndexes.forEach(index => {
    // インデックス名をキーとする
    existingIndexMap.set(JSON.stringify(index.key), index);
  });

  // 必要なインデックスを確認し、存在しない場合のみ作成
  for (const spec of indexSpecs) {
    const indexKey = JSON.stringify(spec.key);

    if (!existingIndexMap.has(indexKey)) {
      logger.info(`コレクション ${collectionName} にインデックスを作成: ${indexKey}`);
      await collection.createIndex(spec.key, spec.options);
    } else {
      logger.info(`コレクション ${collectionName} のインデックスが既に存在: ${indexKey}`);
    }
  }
}

/**
 * ordersコレクションにデータを追加する
 * @param {Object} orderData - 注文データ
 */
async function addOrderMongoDB(orderData) {
  await connectDB();
  try {
    // Zod validation for order data
    const validatedOrderData = safeValidateOrderData(orderData, 'addOrderMongoDB');
    if (!validatedOrderData) {
      throw new Error('Order data validation failed - see console for details');
    }

    const result = await module.exports.ordersCollection.insertOne(validatedOrderData);
    // console.log('Order added:', result.insertedId);
    return result;
  } catch (error) {
    // 🚨 CRITICAL FIX: Handle duplicate key errors gracefully to prevent crashes
    if (error.code === 11000 && error.keyPattern && error.keyPattern.orderId) {
      logger.warn(`Order ${orderData.orderId} already exists, skipping duplicate insertion`, 
        createLogMetadata('addOrderMongoDB', error, {
          collection: 'orders',
          keyPattern: error.keyPattern,
          orderId: orderData.orderId
        })
      );
      // Return success-like result for duplicate orders to maintain compatibility
      return {
        acknowledged: true,
        insertedId: null,
        duplicate: true,
        orderId: orderData.orderId
      };
    }

    logger.error('Error adding order:', createLogMetadata('addOrderMongoDB', error, {
      orderId: orderData.orderId
    }));
    throw error;
  }
}

/**
 * 複数の注文データを一括で追加する
 * @param {Array} ordersData - 注文データの配列
 */
async function addOrdersBulk(ordersData) {
  if (!Array.isArray(ordersData) || ordersData.length === 0) {
    return { insertedCount: 0 };
  }

  // Validate all orders in the bulk data
  const validatedOrdersData = [];
  for (let i = 0; i < ordersData.length; i++) {
    const validatedOrder = safeValidateOrderData(ordersData[i], `addOrdersBulk[${i}]`);
    if (!validatedOrder) {
      throw new Error(`Order validation failed at index ${i} - see console for details`);
    }
    validatedOrdersData.push(validatedOrder);
  }

  await connectDB();
  try {
    const result = await module.exports.ordersCollection.insertMany(validatedOrdersData);
    return result;
  } catch (error) {
    logger.error('Error adding orders in bulk:', createLogMetadata('addOrdersBulk', error, {
      ordersCount: ordersData.length
    }));
    throw error;
  }
}

/**
 * tradesコレクションにデータを追加する（重複チェック付き）
 * @param {Object} tradeData - 約定データ
 */
async function addTradeMongoDB(tradeData) {
  await connectDB();
  try {
    // Zod validation for trade data
    const validatedTradeData = safeValidateTradeData(tradeData, 'addTradeMongoDB');
    if (!validatedTradeData) {
      throw new Error('Trade data validation failed - see console for details');
    }

    // upsert操作を使用して重複エラーを回避
    const result = await module.exports.tradesCollection.replaceOne(
      { tradeId: validatedTradeData.tradeId },
      validatedTradeData,
      { upsert: true }
    );

    if (result.upsertedCount > 0) {
      logger.info('New trade added:', result.upsertedId);
    } else if (result.modifiedCount > 0) {
      logger.info('Existing trade updated for tradeId:', validatedTradeData.tradeId);
    } else {
      logger.info('Trade already exists (no changes):', validatedTradeData.tradeId);
    }

    return result;
  } catch (error) {
    logger.error('Error adding/updating trade:', createLogMetadata('addTradeMongoDB', error, {
      tradeId: tradeData?.tradeId
    }));
    throw error;
  }
}

/**
 * signalsコレクションにデータを追加する
 * @param {Object} signalData - シグナルデータ
 */
async function addSignalMongoDB(signalData) {
  await connectDB();
  try {
    const result = await module.exports.signalsCollection.insertOne(signalData);
    // console.log('Signal added:', result.insertedId);
    return result;
  } catch (error) {
    logger.error('Error adding signal:', error);
    throw error;
  }
}

/**
 * ordersコレクションからデータをリスト取得する
 * @param {Object} filter - フィルタ条件
 * @param {Object} options - クエリオプション (例: { limit: 10, sort: { orderedAt: -1 } })
 * @returns {Promise<Array>} 注文データの配列
 */
async function listOrders(filter = {}, options = {}) {
  await connectDB();
  try {
    // Add filter to exclude pre-saved orders (internal IDs starting with "pre_")
    const enhancedFilter = {
      ...filter,
      orderId: {
        ...filter.orderId,
        $not: /^pre_/
      }
    };

    const orders = await module.exports.ordersCollection.find(enhancedFilter, options).toArray();

    // Convert MongoDB _id to string and ensure all required fields exist
    const processedOrders = orders.map(order => {
      return {
        ...order,
        id: order._id ? order._id.toString() : undefined,
        orderId: order.orderId || order._id?.toString(),
        exchange: order.exchange || 'Unknown',
        symbol: order.symbol || 'Unknown',
        side: order.side || 'Unknown',
        amount: order.amount || 0,
        price: order.price || 0,
        orderType: order.orderType || order.type || 'Unknown', // Also check 'type' field
        strategy: order.strategy || 'Unknown',
        timestamp: order.timestamp || order.orderedAt || Date.now()
      };
    });

    logger.info(`listOrders: ${processedOrders.length} orders processed from DB (excluded pre-saved orders)`);
    if (processedOrders.length > 0) {
      logger.debug('Sample order structure:', processedOrders[0]);
    }

    return processedOrders;
  } catch (error) {
    logger.error('Error listing orders:', error);
    throw error;
  }
}

/**
 * tradesコレクションからデータをリスト取得する
 * @param {Object} filter - フィルタ条件
 * @param {Object} options - クエリオプション (例: { limit: 10, sort: { filledAt: -1 } })
 * @returns {Promise<Array>} 約定データの配列
 */
async function listTrades(filter = {}, options = {}) {
  await connectDB();
  try {
    logger.debug('Filter:', filter);
    const trades = await module.exports.tradesCollection.find(filter, options).toArray();
    return trades;
  } catch (error) {
    logger.error('Error listing trades:', error);
    throw error;
  }
}

/**
 * signalsコレクションからデータをリスト取得する (ページング対応)
 * @param {Object} filter - フィルタ条件
 * @param {number} skip - スキップする件数
 * @param {number} limit - 取得する件数
 * @param {Object} sort - ソート条件 (例: { timestamp: -1 })
 * @returns {Promise<Array>} シグナルデータの配列
 */
async function listSignals(filter = {}, skip = 0, limit = 0, sort = { timestamp: -1 }) {
  await connectDB();
  try {
    let query = module.exports.signalsCollection.find(filter).sort(sort);
    if (skip > 0) {
      query = query.skip(skip);
    }
    if (limit > 0) {
      query = query.limit(limit);
    }
    const signals = await query.toArray();
    return signals;
  } catch (error) {
    logger.error('Error listing signals:', error);
    throw error;
  }
}

/**
 * signalsコレクションの総件数を取得する
 * @param {Object} filter - フィルタ条件
 * @returns {Promise<number>} シグナルデータの総件数
 */
async function countSignals(filter = {}) {
  await connectDB();
  try {
    const count = await module.exports.signalsCollection.countDocuments(filter);
    return count;
  } catch (error) {
    logger.error('Error counting signals:', error);
    throw error;
  }
}

/**
 * ordersコレクションからorderIdでデータを取得する
 * @param {string} orderId - 注文ID
 * @returns {Promise<Object|null>} 注文データまたはnull
 */
async function getOrderByOrderId(orderId) {
  await connectDB();
  try {
    const order = await module.exports.ordersCollection.findOne({ orderId: orderId });
    return order;
  } catch (error) {
    logger.error('Error getting order by orderId:', error);
    throw error;
  }
}

/**
 * tradesコレクションからtradeIdでデータを取得する
 * @param {string} tradeId - 約定ID
 * @returns {Promise<Object|null>} 約定データまたはnull
 */
async function getTradeByTradeId(tradeId) {
  await connectDB();
  try {
    const trade = await module.exports.tradesCollection.findOne({ tradeId: tradeId });
    return trade;
  } catch (error) {
    logger.error('Error getting trade by tradeId:', error);
    throw error;
  }
}

/**
 * 既存の注文データを更新する（orderIdで検索）
 * @param {string} orderId - 注文ID
 * @param {Object} updateData - 更新データ
 */
async function updateOrderByOrderId(orderId, updateData) {
  await connectDB();
  try {
    const result = await module.exports.ordersCollection.updateOne(
      { orderId: orderId },
      { $set: updateData }
    );
    return result;
  } catch (error) {
    logger.error('Error updating order:', error);
    throw error;
  }
}

/**
 * 注文データを削除する（orderIdで検索）
 * @param {string} orderId - 注文ID
 */
async function deleteOrderByOrderId(orderId) {
  await connectDB();
  try {
    const result = await module.exports.ordersCollection.deleteOne({ orderId: orderId });
    return result;
  } catch (error) {
    logger.error('Error deleting order:', error);
    throw error;
  }
}

/**
 * OHLCVデータをohlcvコレクションに追加する
 * replaceOne+upsertを使用してレースコンディションを防止し、重複キーエラー(E11000)を根本的に解決
 * @param {Object} ohlcvData
 */
async function addOhlcvMongoDB(ohlcvData) {
  await connectDB();
  try {
    // replaceOneとupsertを使用して重複キーエラーを防止
    const result = await module.exports.ohlcvCollection.replaceOne(
      {
        exchange: ohlcvData.exchange,
        symbol: ohlcvData.symbol,
        timeframe: ohlcvData.timeframe,
        timestamp: ohlcvData.timestamp
      },
      ohlcvData,
      { upsert: true }
    );

    if (result.upsertedCount > 0) {
      logger.debug(`[OHLCV] 新規データ追加: ${ohlcvData.exchange}:${ohlcvData.symbol}:${ohlcvData.timeframe}:${new Date(ohlcvData.timestamp).toISOString()}`);
      return { ...result, insertedId: result.upsertedId };
    } else if (result.modifiedCount > 0) {
      logger.debug(`[OHLCV] 既存データ更新: ${ohlcvData.exchange}:${ohlcvData.symbol}:${ohlcvData.timeframe}:${new Date(ohlcvData.timestamp).toISOString()}`);
      return result;
    } else {
      logger.debug(`[OHLCV] データ変更なし: ${ohlcvData.exchange}:${ohlcvData.symbol}:${ohlcvData.timeframe}:${new Date(ohlcvData.timestamp).toISOString()}`);
      return result;
    }
  } catch (error) {
    // 万が一重複エラーが発生した場合のフォールバック
    if (error.code === 11000) {
      logger.warn(`[OHLCV] 重複データ検出（フォールバック処理）: ${ohlcvData.exchange}:${ohlcvData.symbol}:${ohlcvData.timeframe}:${new Date(ohlcvData.timestamp).toISOString()}`, 
        createLogMetadata('addOhlcvMongoDB', error, {
          collection: 'ohlcv',
          exchange: ohlcvData.exchange,
          symbol: ohlcvData.symbol,
          timeframe: ohlcvData.timeframe,
          timestamp: ohlcvData.timestamp
        })
      );
      const existingData = await module.exports.ohlcvCollection.findOne({
        exchange: ohlcvData.exchange,
        symbol: ohlcvData.symbol,
        timeframe: ohlcvData.timeframe,
        timestamp: ohlcvData.timestamp
      });
      return existingData;
    }
    logger.error('Error adding OHLCV:', createLogMetadata('addOhlcvMongoDB', error, {
      exchange: ohlcvData?.exchange,
      symbol: ohlcvData?.symbol,
      timeframe: ohlcvData?.timeframe
    }));
    throw error;
  }
}

/**
 * ohlcvコレクションから指定timestampに最も近い最新のOHLCVデータを取得する
 * @param {string} exchange - 取引所名
 * @param {string} symbol - 銘柄名
 * @param {string} timeframe - タイムフレーム
 * @param {number} limit - 取得する件数
 * @param {number} timestamp - 指定したタイムスタンプ以前のデータを取得
 * @returns {Promise<Array>} OHLCVデータの配列
 */
async function fetchHistoricalOHLCVData(exchange, symbol, timeframe, limit, timestamp) {
  await connectDB();
  try {
    const query = {
      exchange: exchange,
      symbol: symbol,
      timeframe: timeframe
    };

    if (timestamp) {
      query.timestamp = { $lte: timestamp }; // 指定したタイムスタンプ以前のデータを取得
    }

    // console.log('OHLCV query:', query);

    const ohlcvData = await module.exports.ohlcvCollection
      .find(query)
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();

    // 一番新しいデータを表示
    // console.log(ohlcvData[0]);

    // console.log(`Retrieved ${ohlcvData.length} OHLCV records for ${symbol} at ${timeframe}.`);
    // 最新のデータを末尾に持ってくる
    if (ohlcvData && ohlcvData.length > 0) {
      return ohlcvData.reverse();
    }
    return [];
  } catch (error) {
    logger.error('Error getting OHLCV by parameters:', error);
    throw error;
  }
}

/**
 * signalsコレクションから_idでデータを取得する
 * @param {string} id - MongoDBのObjectId文字列
 * @returns {Promise<Object|null>} シグナルデータまたはnull
 */
async function getSignalById(id) {
  await connectDB();
  try {
    const signal = await module.exports.signalsCollection.findOne({ _id: new ObjectId(id) });
    return signal;
  } catch (error) {
    logger.error('Error getting signal by _id:', error);
    throw error;
  }
}

/**
 * MongoDBに接続し、指数バックオフ再試行メカニズム付き
 * @param {number} maxRetries - 最大再試行回数
 * @param {number} baseDelayMs - 基本再試行間隔（ミリ秒）
 */
async function connectWithRetry(maxRetries = 5, baseDelayMs = 1000) {
  let retries = 0;
  while (retries < maxRetries) {
    try {
      await connectDB();
      logger.info(`MongoDB接続成功（${retries > 0 ? `${retries}回目の再試行後` : '初回'}）`);
      return;
    } catch (error) {
      retries++;
      logger.warn(`MongoDB接続失敗（${retries}/${maxRetries}）: ${error.message}`, createLogMetadata('connectWithRetry', error, {
        retries: retries,
        maxRetries: maxRetries
      }));
      if (retries >= maxRetries) {
        const wrappedError = new Error(`MongoDB接続が${maxRetries}回失敗しました: ${error.message}`);
        wrappedError.cause = error;
        throw wrappedError;
      }
      // 指数バックオフ: 1秒、2秒、4秒、8秒、16秒（最大30秒）
      const delay = Math.min(baseDelayMs * Math.pow(2, retries - 1), 30000);
      logger.info(`${delay}ms後に再試行します...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * 接続監視とヘルスチェック機能
 */
let healthCheckInterval;

function startHealthCheck() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
  }

  healthCheckInterval = setInterval(async () => {
    try {
      if (!await isConnected()) {
        logger.warn('MongoDB接続が失われました。再接続を試行します...');
        await connectWithRetry();
      }
    } catch (error) {
      logger.error('MongoDB接続監視エラー:', error);
    }
  }, 60000); // 1分間隔でチェック
}

function stopHealthCheck() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}

// アプリケーションのmain.jsなどで呼び出し用
function setupGracefulShutdown() {
  const shutdown = async () => {
    logger.info('シャットダウン開始...');
    await closeDB();
    process.exit(0);
  };

  // プロセス終了シグナルを捕捉
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

/**
 * tickerコレクションにデータを追加する
 * 一週間分の分速データを超える場合は古いデータを削除する
 * @param {Object} tickerData - ティッカーデータ
 */
async function saveTickerMongoDB(tickerData) {
  await connectDB();
  try {
    // 重複キーエラー防止のためreplaceOneとupsertを使用
    const result = await module.exports.tickersCollection.replaceOne(
      {
        exchange: tickerData.exchange,
        symbol: tickerData.symbol,
        timestamp: tickerData.timestamp
      },
      tickerData,
      { upsert: true }
    );

    // 一週間分の分速データの上限（7日 × 1440分）
    const MAX_TICKER_RECORDS = 7 * 1440;

    // 同じ銘柄・取引所のデータ数をカウント
    const count = await module.exports.tickersCollection.countDocuments({
      exchange: tickerData.exchange,
      symbol: tickerData.symbol
    });

    // 上限を超えている場合、古いデータを削除
    if (count > MAX_TICKER_RECORDS) {
      const recordsToDelete = count - MAX_TICKER_RECORDS;

      // 最も古いデータを特定して削除
      const oldestRecords = await module.exports.tickersCollection
        .find({ exchange: tickerData.exchange, symbol: tickerData.symbol })
        .sort({ timestamp: 1 })
        .limit(recordsToDelete)
        .toArray();

      if (oldestRecords.length > 0) {
        const oldestIds = oldestRecords.map(record => record._id);
        await module.exports.tickersCollection.deleteMany({
          _id: { $in: oldestIds }
        });
        // console.log(`${tickerData.exchange}:${tickerData.symbol} の古いticker ${recordsToDelete}件を削除しました`);
      }
    }

    return result;
  } catch (error) {
    // 重複キーエラーの場合は警告ログのみで処理継続
    if (error.code === 11000) {
      logger.warn(`[Ticker保存] 重複データをスキップ: ${tickerData.exchange}:${tickerData.symbol} timestamp=${tickerData.timestamp}`, 
        createLogMetadata('saveTickerMongoDB', error, {
          collection: 'tickers',
          exchange: tickerData.exchange,
          symbol: tickerData.symbol,
          timestamp: tickerData.timestamp
        })
      );
      return { acknowledged: true, upsertedCount: 0, matchedCount: 1 };
    }
    // その他のエラーは再スロー
    logger.error('Error saving ticker:', createLogMetadata('saveTickerMongoDB', error, {
      exchange: tickerData?.exchange,
      symbol: tickerData?.symbol
    }));
    throw error;
  }
}

/**
 * MongoDBから指定された時刻に最も近いtickerデータを取得する
 * @param {string} exchange - 取引所ID
 * @param {string} symbol - 通貨ペア
 * @param {number} timestamp - 取得したい時刻のタイムスタンプ
 * @param {number} maxTimeDiff - 最大時間差（ミリ秒、デフォルト: 5分）
 * @returns {Object|null} ティッカーデータまたはnull
 */
async function fetchTickerFromMongoDB(exchange, symbol, timestamp, maxTimeDiff = 5 * 60 * 1000) {
  // Check if MongoDB is available
  if (!mongoUrl || !mongoDbName) {
    return null;
  }

  try {
    await connectDB();
    // 指定時刻の前後のティッカーデータを検索
    const tickers = await module.exports.tickersCollection
      .find({
        exchange: exchange,
        symbol: symbol,
        timestamp: {
          $gte: timestamp - maxTimeDiff,
          $lte: timestamp + maxTimeDiff
        }
      })
      .sort({ timestamp: 1 })
      .toArray();

    if (tickers.length === 0) {
      return null;
    }

    // 最も近い時刻のティッカーデータを選択
    let closestTicker = tickers[0];
    let minTimeDiff = Math.abs(tickers[0].timestamp - timestamp);

    for (const ticker of tickers) {
      const timeDiff = Math.abs(ticker.timestamp - timestamp);
      if (timeDiff < minTimeDiff) {
        minTimeDiff = timeDiff;
        closestTicker = ticker;
      }
    }

    return closestTicker;
  } catch (error) {
    logger.error('Error fetching ticker from MongoDB:', error);
    return null;
  }
}

/**
 * 約定済みポジション履歴を取得
 * @param {Object} filter - フィルタ条件
 * @param {Number} limit - 取得件数制限
 * @returns {Promise<Array>} 約定済みポジション配列
 */
async function listFilledPositions(filter = {}, limit = 1000) {
  await connectDB();
  try {
    // フィルタ条件を構築
    const query = {};

    if (filter.exchangeId) {
      query.exchangeId = filter.exchangeId;
    }

    if (filter.symbol) {
      query.symbol = filter.symbol;
    }

    if (filter.strategyKey) {
      query.strategyKey = filter.strategyKey;
    }

    // 約定済み（closed）ポジションのみを取得
    query.status = 'closed';

    logger.debug('listFilledPositions query:', query);

    const positions = await module.exports.positionsCollection
      .find(query)
      .sort({ closedAt: -1 })
      .limit(limit)
      .toArray();

    logger.info(`listFilledPositions found ${positions.length} positions`);

    return positions;
  } catch (error) {
    logger.error('約定済みポジションの取得に失敗:', error);
    throw error;
  }
}

/**
 * MongoDBクライアントを取得する関数
 * @returns {Object} MongoDB クライアント
 */
function getClient() {
  return client;
}

// モジュールエクスポートに追加
module.exports = {
  getClient,
  connectDB,
  closeDB,
  isConnected,
  connectWithRetry,
  startHealthCheck,
  stopHealthCheck,
  getConnectionStats,
  addOrderMongoDB,
  addOrdersBulk,
  addTradeMongoDB,
  addSignalMongoDB,
  addOhlcvMongoDB,
  saveTickerMongoDB,
  fetchTickerFromMongoDB,
  listOrders,
  listTrades,
  listSignals,
  countSignals,
  getOrderByOrderId,
  updateOrderByOrderId,
  deleteOrderByOrderId,
  getTradeByTradeId,
  getSignalById,
  ordersCollection: null,
  tradesCollection: null,
  signalsCollection: null,
  ohlcvCollection: null,
  setupGracefulShutdown,
  fetchHistoricalOHLCVData,
  listFilledPositions
};