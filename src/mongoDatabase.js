const { MongoClient, ObjectId } = require('mongodb');
const { mongoUrl, mongoDbName } = require('./config');

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
 */
async function createIndexes() {
  try {
    // ordersコレクションのインデックス
    await module.exports.ordersCollection.createIndex({ orderId: 1 }, { unique: true });
    await module.exports.ordersCollection.createIndex({ orderedAt: 1 });
    await module.exports.ordersCollection.createIndex({ orderedAt: -1 });

    // tradesコレクションのインデックス
    await module.exports.tradesCollection.createIndex({ orderId: 1 });
    await module.exports.tradesCollection.createIndex({ tradeId: 1 }, { unique: true });
    await module.exports.tradesCollection.createIndex({ filledAt: 1 });
    await module.exports.tradesCollection.createIndex({ filledAt: -1 });

    // signalsコレクションのインデックス
    await module.exports.signalsCollection.createIndex({ timestamp: 1 });
    await module.exports.signalsCollection.createIndex({ timestamp: -1 });

    console.log('MongoDBインデックスを作成しました');
  } catch (error) {
    console.error('MongoDBインデックス作成エラー:', error);
    // インデックス作成失敗をより明示的に通知するか、
    // 重要なインデックスが作成できない場合はエラーを投げることを検討
    // throw new Error(`重要なインデックスの作成に失敗しました: ${error.message}`);
  }
}


/**
 * ordersコレクションにデータを追加する
 * @param {Object} orderData - 注文データ
 */
async function addOrder(orderData) {
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
async function addTrade(tradeData) {
  await connectDB();
  try {
    const result = await module.exports.tradesCollection.insertOne(tradeData);
    // console.log('Trade added:', result.insertedId);
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
async function addSignal(signalData) {
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
  addOrder,
  addOrdersBulk,
  addTrade,
  addSignal,
  listOrders,
  listTrades,
  listSignals,
  getOrderByOrderId,
  getTradeByTradeId,
  getSignalById,
  // コレクション参照はconnectDB後に設定される
  ordersCollection: null,
  tradesCollection: null,
  signalsCollection: null,
  setupGracefulShutdown
};