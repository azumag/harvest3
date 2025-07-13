const Logger = require('../../../src/hft/utils/Logger');

// MongoDBクライアントをモック
const mockClient = {
  connect: jest.fn(),
  close: jest.fn(),
  db: jest.fn()
};
const mockDb = {
  command: jest.fn(),
  listCollections: jest.fn(),
  createCollection: jest.fn(),
  collection: jest.fn()
};
const mockCollection = {
  insertOne: jest.fn(),
  replaceOne: jest.fn(),
  findOne: jest.fn(),
  updateOne: jest.fn(),
  deleteOne: jest.fn(),
  createIndex: jest.fn(),
  listIndexes: jest.fn(),
  countDocuments: jest.fn()
};

// MongoDBモック
jest.mock('mongodb', () => ({
  MongoClient: {
    connect: jest.fn(() => mockClient)
  },
  ObjectId: jest.fn().mockImplementation((id) => ({ id }))
}));

// dotenvをモック
jest.mock('dotenv', () => ({
  config: jest.fn()
}));

// Loggerをモック
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
};

jest.mock('../../../src/hft/utils/Logger', () => {
  return jest.fn(() => mockLogger);
});

// 設定をモック
jest.mock('../../../src/config/settings', () => ({
  SETTINGS: {
    DATABASE: {
      MONGODB: {
        SERVER_SELECTION_TIMEOUT: 5000,
        CONNECT_TIMEOUT: 10000,
        SOCKET_TIMEOUT: 30000,
        MAX_POOL_SIZE: 10,
        MIN_POOL_SIZE: 5,
        MAX_IDLE_TIME: 30000,
        HEARTBEAT_FREQUENCY: 10000,
        MAX_CONNECTING: 2
      }
    }
  }
}));

// 通知をモック
jest.mock('../../../src/common/notifications', () => ({
  postMongoConnectionErrorToDiscord: jest.fn()
}));

// スキーマをモック
jest.mock('../../../src/database/schemas', () => ({
  safeValidateTradeData: jest.fn(),
  safeValidateOrderData: jest.fn()
}));

describe('addOhlcvMongoDB - Race Condition Fix', () => {
  let mongoDatabase;
  let addOhlcvMongoDB;

  beforeEach(() => {
    jest.clearAllMocks();

    // 環境変数を設定
    process.env.MONGO_URL = 'mongodb://localhost:27017';
    process.env.MONGO_DB_NAME = 'test_db';

    // デフォルトのモック設定
    mockClient.connect.mockResolvedValue();
    mockClient.close.mockResolvedValue();
    mockClient.db.mockReturnValue(mockDb);
    mockDb.command.mockResolvedValue({ ok: 1 });
    mockDb.listCollections.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([])
    });
    mockDb.createCollection.mockResolvedValue();
    mockDb.collection.mockReturnValue(mockCollection);
    mockCollection.listIndexes.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([])
    });
    mockCollection.createIndex.mockResolvedValue();
    mockCollection.countDocuments.mockResolvedValue(0);

    // モジュールをリロード
    delete require.cache[require.resolve('../../../src/database/mongoDatabase')];
    mongoDatabase = require('../../../src/database/mongoDatabase');
    addOhlcvMongoDB = mongoDatabase.addOhlcvMongoDB;

    // connectDBをモック
    mongoDatabase.connectDB = jest.fn().mockResolvedValue();
    mongoDatabase.ohlcvCollection = mockCollection;
  });

  describe('🟢 Green: 新規データ挿入', () => {
    it('新規OHLCVデータが正常に挿入されること', async () => {
      const ohlcvData = {
        exchange: 'bitbank',
        symbol: 'DOGE/JPY',
        timeframe: '5m',
        timestamp: 1752431700000,
        open: 100,
        high: 110,
        low: 95,
        close: 105,
        volume: 1000
      };

      // replaceOneが新規挿入を行った場合をモック
      mockCollection.replaceOne.mockResolvedValue({
        upsertedCount: 1,
        upsertedId: 'new-document-id',
        modifiedCount: 0,
        matchedCount: 0
      });

      const result = await addOhlcvMongoDB(ohlcvData);

      expect(mockCollection.replaceOne).toHaveBeenCalledWith(
        {
          exchange: 'bitbank',
          symbol: 'DOGE/JPY',
          timeframe: '5m',
          timestamp: 1752431700000
        },
        ohlcvData,
        { upsert: true }
      );

      expect(result).toEqual({
        insertedId: 'new-document-id',
        ...ohlcvData
      });
    });
  });

  describe('🟡 Yellow: 既存データ更新', () => {
    it('既存OHLCVデータが正常に更新されること', async () => {
      const ohlcvData = {
        exchange: 'bitbank',
        symbol: 'DOGE/JPY',
        timeframe: '5m',
        timestamp: 1752431700000,
        open: 100,
        high: 110,
        low: 95,
        close: 105,
        volume: 1000
      };

      const existingData = {
        _id: 'existing-id',
        ...ohlcvData,
        close: 108 // 既存データでは異なるclose値
      };

      // replaceOneが既存データの更新を行った場合をモック
      mockCollection.replaceOne.mockResolvedValue({
        upsertedCount: 0,
        upsertedId: null,
        modifiedCount: 1,
        matchedCount: 1
      });

      // findOneで既存データを返すモック
      mockCollection.findOne.mockResolvedValue(existingData);

      const result = await addOhlcvMongoDB(ohlcvData);

      expect(mockCollection.replaceOne).toHaveBeenCalledWith(
        {
          exchange: 'bitbank',
          symbol: 'DOGE/JPY',
          timeframe: '5m',
          timestamp: 1752431700000
        },
        ohlcvData,
        { upsert: true }
      );

      expect(mockCollection.findOne).toHaveBeenCalledWith({
        exchange: 'bitbank',
        symbol: 'DOGE/JPY',
        timeframe: '5m',
        timestamp: 1752431700000
      });

      expect(result).toEqual(existingData);
    });
  });

  describe('🔴 Red: エラーハンドリング', () => {
    it('データベースエラー時に適切にエラーがスローされること', async () => {
      const ohlcvData = {
        exchange: 'bitbank',
        symbol: 'DOGE/JPY',
        timeframe: '5m',
        timestamp: 1752431700000
      };

      const dbError = new Error('Network error');
      dbError.code = 'NETWORK_ERROR';

      mockCollection.replaceOne.mockRejectedValue(dbError);

      await expect(addOhlcvMongoDB(ohlcvData)).rejects.toThrow('Network error');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error adding OHLCV:',
        {
          operation: 'addOhlcvMongoDB',
          error: 'Network error',
          errorCode: 'NETWORK_ERROR',
          timestamp: expect.any(Number),
          exchange: 'bitbank',
          symbol: 'DOGE/JPY',
          timeframe: '5m',
          stack: expect.any(String)
        }
      );
    });

    it('nullデータでも適切にエラーハンドリングされること', async () => {
      const dbError = new Error('Validation error');

      mockCollection.replaceOne.mockRejectedValue(dbError);

      await expect(addOhlcvMongoDB(null)).rejects.toThrow('Validation error');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error adding OHLCV:',
        {
          operation: 'addOhlcvMongoDB',
          error: 'Validation error',
          errorCode: undefined,
          timestamp: expect.any(Number),
          exchange: undefined,
          symbol: undefined,
          timeframe: undefined,
          stack: expect.any(String)
        }
      );
    });
  });

  describe('🔄 Race Condition Prevention', () => {
    it('replaceOneのアトミック操作により競合状態が発生しないこと', async () => {
      const ohlcvData = {
        exchange: 'bitbank',
        symbol: 'DOGE/JPY',
        timeframe: '5m',
        timestamp: 1752431700000,
        open: 100,
        high: 110,
        low: 95,
        close: 105,
        volume: 1000
      };

      // upsert操作が成功することをモック
      mockCollection.replaceOne.mockResolvedValue({
        upsertedCount: 1,
        upsertedId: 'new-id',
        modifiedCount: 0,
        matchedCount: 0
      });

      const result = await addOhlcvMongoDB(ohlcvData);

      // findOneやinsertOneが呼ばれていないことを確認（アトミックなため）
      expect(mockCollection.findOne).not.toHaveBeenCalled();
      expect(mockCollection.insertOne).not.toHaveBeenCalled();
      
      // replaceOneのみが呼ばれていることを確認
      expect(mockCollection.replaceOne).toHaveBeenCalledTimes(1);

      expect(result).toEqual({
        insertedId: 'new-id',
        ...ohlcvData
      });
    });
  });
});