const { MongoClient, ObjectId } = require('mongodb');
const { mongoUrl, mongoDbName } = require('../config');

// MongoDB接続オプションを追加
const mongoOptions = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000,
  maxPoolSize: 10
};

let client;
let db;

/**
 * MongoDBに接続し、データベースとコレクションへの参照を取得する
 */
async function connectDB() {
  if (!client || !client.topology || !client.topology.isConnected()) {
    try {
      client = new MongoClient(mongoUrl, mongoOptions);
      await client.connect();
      db = client.db(mongoDbName);
      console.log('MongoDBに接続しました');

      // コレクションの参照を取得
      module.exports.ordersCollection = db.collection('orders');
      module.exports.tradesCollection = db.collection('trades');
      module.exports.signalsCollection = db.collection('signals');

      // インデックスの作成 (冪等性があるため、接続時に実行しても問題ない)
      await createIndexes();

    } catch (error) {
      console.error('MongoDB接続エラー:', error);
      throw error;
    }
  }
}

/**
 * MongoDB接続を閉じる
 */
async function closeDB() {
  if (client && client.connected) {
    await client.close();
    console.log('MongoDB接続を閉じました');
    client = null;
    db = null;
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
      { key: { orderedAt: 1 }, options: {} },
      { key: { orderedAt: -1 }, options: {} }
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
    
    console.log('MongoDBインデックスの確認/作成が完了しました');
  } catch (error) {
    console.error('MongoDBインデックス作成エラー:', error);
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
      console.log(`コレクション ${collectionName} にインデックスを作成: ${indexKey}`);
      await collection.createIndex(spec.key, spec.options);
    } else {
      console.log(`コレクション ${collectionName} のインデックスが既に存在: ${indexKey}`);
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
    const result = await module.exports.ordersCollection.insertOne(orderData);
    // console.log('Order added:', result.insertedId);
    return result;
  } catch (error) {
    console.error('Error adding order:', error);
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
  
  await connectDB();
  try {
    const result = await module.exports.ordersCollection.insertMany(ordersData);
    return result;
  } catch (error) {
    console.error('Error adding orders in bulk:', error);
    throw error;
  }
}

/**
 * tradesコレクションにデータを追加する
 * @param {Object} tradeData - 約定データ
 */
async function addTradeMongoDB(tradeData) {
  await connectDB();
  try {
    const result = await module.exports.tradesCollection.insertOne(tradeData);
    console.log('Trade added:', result.insertedId);
    return result;
  } catch (error) {
    console.error('Error adding trade:', error);
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
    console.error('Error adding signal:', error);
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
    const orders = await module.exports.ordersCollection.find(filter, options).toArray();
    return orders;
  } catch (error) {
    console.error('Error listing orders:', error);
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
    const trades = await module.exports.tradesCollection.find(filter, options).toArray();
    return trades;
  } catch (error) {
    console.error('Error listing trades:', error);
    throw error;
  }
}

/**
 * signalsコレクションからデータをリスト取得する
 * @param {Object} filter - フィルタ条件
 * @param {Object} options - クエリオプション (例: { limit: 10, sort: { timestamp: -1 } })
 * @returns {Promise<Array>} シグナルデータの配列
 */
async function listSignals(filter = {}, options = {}) {
  await connectDB();
  try {
    const signals = await module.exports.signalsCollection.find(filter, options).toArray();
    return signals;
  } catch (error) {
    console.error('Error listing signals:', error);
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
    console.error('Error getting order by orderId:', error);
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
    console.error('Error getting trade by tradeId:', error);
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
    console.error('Error getting signal by _id:', error);
    throw error;
  }
}

/**
 * MongoDBに接続し、再試行メカニズム付き
 * @param {number} maxRetries - 最大再試行回数
 * @param {number} retryDelayMs - 再試行間隔（ミリ秒）
 */
async function connectWithRetry(maxRetries = 3, retryDelayMs = 1000) {
  let retries = 0;
  while (retries < maxRetries) {
    try {
      await connectDB();
      return;
    } catch (error) {
      retries++;
      console.warn(`MongoDB接続失敗（${retries}/${maxRetries}）: ${error.message}`);
      if (retries >= maxRetries) {
        throw new Error(`MongoDB接続が${maxRetries}回失敗しました: ${error.message}`);
      }
      // 再試行前に待機
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }
  }
}

// アプリケーションのmain.jsなどで呼び出し用
function setupGracefulShutdown() {
  const shutdown = async () => {
    console.log('シャットダウン開始...');
    await closeDB();
    process.exit(0);
  };

  // プロセス終了シグナルを捕捉
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// モジュールエクスポートに追加
module.exports = {
  connectDB,
  closeDB,
  addOrderMongoDB,
  addOrdersBulk,
  addTradeMongoDB,
  addSignalMongoDB,
  listOrders,
  listTrades,
  listSignals,
  getOrderByOrderId,
  getTradeByTradeId,
  getSignalById,
  ordersCollection: null,
  tradesCollection: null,
  signalsCollection: null,
  setupGracefulShutdown,
  connectDB
};