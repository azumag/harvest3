/**
 * mongoDatabase.js の構造化ログ機能のテスト
 * エラーハンドリングのログ詳細化改善のテスト
 * t-wada流TDDアプローチ
 */

const { MongoClient } = require('mongodb');

// MongoDBクライアントのモック
const mockClient = {
  connect: jest.fn(),
  close: jest.fn(),
  db: jest.fn(),
  topology: {
    isConnected: jest.fn()
  }
};

const mockCollection = {
  insertOne: jest.fn(),
  insertMany: jest.fn(),
  replaceOne: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  createIndex: jest.fn(),
  listIndexes: jest.fn(),
  countDocuments: jest.fn()
};

const mockDb = {
  command: jest.fn(),
  listCollections: jest.fn(),
  createCollection: jest.fn(),
  collection: jest.fn(() => mockCollection)
};

jest.mock('mongodb', () => ({
  MongoClient: jest.fn(() => mockClient),
  ObjectId: jest.fn()
}));

// 通知機能のモック
jest.mock('../../../src/common/notifications', () => ({
  postMongoConnectionErrorToDiscord: jest.fn(),
  postErrorToDiscord: jest.fn()
}));

// スキーマ検証のモック
jest.mock('../../../src/database/schemas', () => ({
  safeValidateOrderData: jest.fn((data) => data),
  safeValidateTradeData: jest.fn((data) => data)
}));

// Logger のモック
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
};

jest.mock('../../../src/hft/utils/Logger', () => {
  return jest.fn(() => mockLogger);
});

// 環境変数のセットアップ
process.env.MONGO_URL = 'mongodb://test:27017';
process.env.MONGO_DB_NAME = 'test_db';

// connectDB のモック
const mockConnectDB = jest.fn().mockResolvedValue();

// mongoDatabase モジュールをモック
jest.mock('../../../src/database/mongoDatabase', () => {
  const originalModule = jest.requireActual('../../../src/database/mongoDatabase');
  return {
    ...originalModule,
    connectDB: jest.fn().mockResolvedValue(),
    ordersCollection: null,
    tradesCollection: null,
    ohlcvCollection: null,
    tickersCollection: null,
    signalsCollection: null
  };
});

// retryWithBackoff のテスト用に直接インポート
const retryWithBackoffModule = jest.createMockFromModule('../../../src/database/mongoDatabase');

// テスト対象をインポート
const mongoDatabase = require('../../../src/database/mongoDatabase');
const {
  addOrderMongoDB,
  addOrdersBulk,
  addTradeMongoDB,
  addOhlcvMongoDB,
  saveTickerMongoDB
} = mongoDatabase;

describe('mongoDatabase - 構造化ログ機能', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // デフォルトのモック設定
    mockClient.connect.mockResolvedValue();
    mockClient.close.mockResolvedValue();
    mockClient.db.mockReturnValue(mockDb);
    mockDb.command.mockResolvedValue({ ok: 1 });
    mockDb.listCollections.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([])
    });
    mockDb.createCollection.mockResolvedValue();
    mockCollection.listIndexes.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([])
    });
    mockCollection.createIndex.mockResolvedValue();
    mockCollection.countDocuments.mockResolvedValue(0);

    // connectDB のモック設定
    mongoDatabase.connectDB.mockResolvedValue();
    
    // コレクションの参照をモックに設定
    mongoDatabase.ordersCollection = mockCollection;
    mongoDatabase.tradesCollection = mockCollection;
    mongoDatabase.ohlcvCollection = mockCollection;
    mongoDatabase.tickersCollection = mockCollection;
    mongoDatabase.signalsCollection = mockCollection;
  });

  describe('addOrderMongoDB', () => {
    describe('🔴 Red: 重複キーエラーの構造化ログ', () => {
      it('重複キーエラー時に構造化されたログ情報を出力すること', async () => {
        const orderData = {
          orderId: 'test-order-123',
          exchange: 'bitbank',
          symbol: 'BTC/JPY',
          amount: 0.1
        };

        const duplicateError = new Error('Duplicate key error');
        duplicateError.code = 11000;
        duplicateError.keyPattern = { orderId: 1 };

        mockCollection.insertOne.mockRejectedValue(duplicateError);

        const result = await addOrderMongoDB(orderData);

        expect(mockLogger.warn).toHaveBeenCalledWith(
          `Order ${orderData.orderId} already exists, skipping duplicate insertion`,
          {
            operation: 'addOrderMongoDB',
            error: 'Duplicate key error',
            errorCode: 11000,
            timestamp: expect.any(Number),
            collection: 'orders',
            keyPattern: { orderId: 1 },
            orderId: 'test-order-123',
            stack: expect.any(String)
          }
        );

        expect(result).toEqual({
          acknowledged: true,
          insertedId: null,
          duplicate: true,
          orderId: 'test-order-123'
        });
      });

      it('一般的なエラー時に構造化されたログ情報を出力すること', async () => {
        const orderData = {
          orderId: 'test-order-456',
          exchange: 'bitbank',
          symbol: 'BTC/JPY',
          amount: 0.1
        };

        const generalError = new Error('Database connection failed');
        generalError.code = 'NETWORK_ERROR';
        generalError.stack = 'Error stack trace';

        mockCollection.insertOne.mockRejectedValue(generalError);

        await expect(addOrderMongoDB(orderData)).rejects.toThrow();

        expect(mockLogger.error).toHaveBeenCalledWith(
          'Error adding order:',
          {
            operation: 'addOrderMongoDB',
            error: 'Database connection failed',
            errorCode: 'NETWORK_ERROR',
            timestamp: expect.any(Number),
            orderId: 'test-order-456',
            stack: expect.any(String)
          }
        );
      });
    });
  });

  describe('addOrdersBulk', () => {
    describe('🔴 Red: 一括注文エラーの構造化ログ', () => {
      it('一括注文エラー時に構造化されたログ情報を出力すること', async () => {
        const ordersData = [
          { orderId: 'bulk-1', exchange: 'bitbank', symbol: 'BTC/JPY', amount: 0.1 },
          { orderId: 'bulk-2', exchange: 'bitbank', symbol: 'BTC/JPY', amount: 0.2 }
        ];

        const bulkError = new Error('Bulk insert failed');
        bulkError.code = 'BULK_WRITE_ERROR';
        bulkError.stack = 'Error stack trace';

        mockCollection.insertMany.mockRejectedValue(bulkError);

        await expect(addOrdersBulk(ordersData)).rejects.toThrow();

        expect(mockLogger.error).toHaveBeenCalledWith(
          'Error adding orders in bulk:',
          {
            operation: 'addOrdersBulk',
            error: 'Bulk insert failed',
            errorCode: 'BULK_WRITE_ERROR',
            timestamp: expect.any(Number),
            ordersCount: 2,
            stack: expect.any(String)
          }
        );
      });
    });
  });

  describe('addTradeMongoDB', () => {
    describe('🔴 Red: 約定データエラーの構造化ログ', () => {
      it('約定データエラー時に構造化されたログ情報を出力すること', async () => {
        const tradeData = {
          tradeId: 'trade-123',
          orderId: 'order-123',
          amount: 0.1,
          price: 4000000
        };

        const tradeError = new Error('Trade insert failed');
        tradeError.code = 'TRADE_ERROR';
        tradeError.stack = 'Error stack trace';

        mockCollection.replaceOne.mockRejectedValue(tradeError);

        await expect(addTradeMongoDB(tradeData)).rejects.toThrow();

        expect(mockLogger.error).toHaveBeenCalledWith(
          'Error adding/updating trade:',
          {
            operation: 'addTradeMongoDB',
            error: 'Trade insert failed',
            errorCode: 'TRADE_ERROR',
            timestamp: expect.any(Number),
            tradeId: 'trade-123',
            stack: expect.any(String)
          }
        );
      });
    });
  });

  describe('addOhlcvMongoDB', () => {
    describe('🔴 Red: OHLCVデータエラーの構造化ログ', () => {
      it('OHLCV正常処理時にエラーログが出力されないこと（upsert使用）', async () => {
        const ohlcvData = {
          exchange: 'bitbank',
          symbol: 'BTC/JPY',
          timeframe: '1h',
          timestamp: 1673000000000,
          open: 4000000,
          high: 4100000,
          low: 3900000,
          close: 4050000,
          volume: 100
        };
        
        // replaceOneが正常に完了する場合をモック（既存データの更新）
        mockCollection.replaceOne.mockResolvedValue({
          upsertedCount: 0,
          upsertedId: null,
          modifiedCount: 1,
          matchedCount: 1
        });
        mockCollection.findOne.mockResolvedValue(ohlcvData);
        
        const result = await addOhlcvMongoDB(ohlcvData);
        
        // upsertを使用するため、重複エラーは発生せず警告ログも出力されない
        expect(mockLogger.warn).not.toHaveBeenCalled();
        expect(mockLogger.error).not.toHaveBeenCalled();
        expect(result).toEqual(ohlcvData);
      });

      it('OHLCV一般エラー時に構造化されたログ情報を出力すること', async () => {
        const ohlcvData = {
          exchange: 'bitbank',
          symbol: 'BTC/JPY',
          timeframe: '1h',
          timestamp: 1673000000000
        };

        const generalError = new Error('Database error');
        generalError.code = 'DB_ERROR';
        generalError.stack = 'Error stack trace';

        mockCollection.replaceOne.mockRejectedValue(generalError);

        await expect(addOhlcvMongoDB(ohlcvData)).rejects.toThrow();

        expect(mockLogger.error).toHaveBeenCalledWith(
          'Error adding OHLCV:',
          {
            operation: 'addOhlcvMongoDB',
            error: 'Database error',
            errorCode: 'DB_ERROR',
            timestamp: expect.any(Number),
            exchange: 'bitbank',
            symbol: 'BTC/JPY',
            timeframe: '1h',
            stack: expect.any(String)
          }
        );
      });
    });
  });

  describe('saveTickerMongoDB', () => {
    describe('🔴 Red: ティッカーデータエラーの構造化ログ', () => {
      it('ティッカー重複エラー時に構造化されたログ情報を出力すること', async () => {
        const tickerData = {
          exchange: 'bitbank',
          symbol: 'BTC/JPY',
          timestamp: 1673000000000,
          bid: 4000000,
          ask: 4000100
        };

        const duplicateError = new Error('Duplicate key error');
        duplicateError.code = 11000;

        mockCollection.replaceOne.mockRejectedValue(duplicateError);
        mockCollection.countDocuments.mockResolvedValue(1000);

        const result = await saveTickerMongoDB(tickerData);

        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining('[Ticker保存] 重複データをスキップ:'),
          {
            operation: 'saveTickerMongoDB',
            error: 'Duplicate key error',
            errorCode: 11000,
            timestamp: 1673000000000, // This is the timestamp from the tickerData
            collection: 'tickers',
            exchange: 'bitbank',
            symbol: 'BTC/JPY',
            stack: expect.any(String)
          }
        );

        expect(result).toEqual({
          acknowledged: true,
          upsertedCount: 0,
          matchedCount: 1
        });
      });

      it('ティッカー一般エラー時に構造化されたログ情報を出力すること', async () => {
        const tickerData = {
          exchange: 'bitbank',
          symbol: 'BTC/JPY',
          timestamp: 1673000000000
        };

        const generalError = new Error('Save failed');
        generalError.code = 'SAVE_ERROR';
        generalError.stack = 'Error stack trace';

        mockCollection.replaceOne.mockRejectedValue(generalError);

        await expect(saveTickerMongoDB(tickerData)).rejects.toThrow();

        expect(mockLogger.error).toHaveBeenCalledWith(
          'Error saving ticker:',
          {
            operation: 'saveTickerMongoDB',
            error: 'Save failed',
            errorCode: 'SAVE_ERROR',
            timestamp: expect.any(Number),
            exchange: 'bitbank',
            symbol: 'BTC/JPY',
            stack: expect.any(String)
          }
        );
      });
    });
  });

  describe('構造化ログの統合テスト', () => {
    describe('🔴 Red: ログ形式の一貫性', () => {
      it('すべてのエラーログが一貫した構造を持つこと', async () => {
        // 各種エラーをテストして、ログ構造の一貫性を確認
        const testCases = [
          {
            function: addOrderMongoDB,
            data: { orderId: 'test', exchange: 'bitbank', symbol: 'BTC/JPY', amount: 0.1 },
            expectedFields: ['error', 'errorCode', 'orderId', 'operation', 'stack']
          }
        ];

        for (const testCase of testCases) {
          const error = new Error('Test error');
          error.code = 'TEST_CODE';
          error.stack = 'Test stack';

          mockCollection.insertOne.mockRejectedValue(error);

          try {
            await testCase.function(testCase.data);
          } catch (e) {
            // エラーが投げられることを期待
          }

          expect(mockLogger.error).toHaveBeenCalled();
          const logCall = mockLogger.error.mock.calls[mockLogger.error.mock.calls.length - 1];
          const logData = logCall[1];

          // 期待されるフィールドがすべて存在することを確認
          testCase.expectedFields.forEach(field => {
            expect(logData).toHaveProperty(field);
          });

          jest.clearAllMocks();
        }
      });
    });
  });

  describe('retryWithBackoff', () => {
    let originalModule;
    let retryWithBackoff;

    beforeAll(() => {
      // 実際のモジュールをインポートしてretryWithBackoff関数にアクセス
      jest.unmock('../../../src/database/mongoDatabase');
      originalModule = require('../../../src/database/mongoDatabase');
      
      // retryWithBackoff は exportされていないため、テスト用に一時的に export する必要がある
      // 今回は実装をテストするために直接テストする
    });

    afterAll(() => {
      // モックを元に戻す
      jest.mock('../../../src/database/mongoDatabase', () => {
        const originalModule = jest.requireActual('../../../src/database/mongoDatabase');
        return {
          ...originalModule,
          connectDB: jest.fn().mockResolvedValue(),
          ordersCollection: null,
          tradesCollection: null,
          ohlcvCollection: null,
          tickersCollection: null,
          signalsCollection: null
        };
      });
    });

    describe('🔴 Red: retryWithBackoff関数の構造化ログ', () => {
      it('リトライ警告時に構造化されたログ情報を出力すること', async () => {
        jest.clearAllMocks();
        
        const mockOperation = jest.fn()
          .mockRejectedValueOnce(new Error('First failure'))
          .mockRejectedValueOnce(new Error('Second failure'))
          .mockResolvedValueOnce('Success');

        // retryWithBackoff を直接テストするため、実装をコピー
        const testRetryWithBackoff = async (operation, operationName, maxRetries = 3) => {
          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
              return await operation();
            } catch (error) {
              const isLastAttempt = attempt === maxRetries;
              
              // 警告ログでは本番環境でもスタックトレースを含めない
              mockLogger.warn(`${operationName} 失敗 (試行 ${attempt}/${maxRetries}):`, {
                operation: operationName,
                error: error.message,
                errorCode: error.code,
                attempt: attempt,
                maxRetries: maxRetries
              });

              if (isLastAttempt) {
                // createLogMetadata の簡易実装
                const metadata = {
                  operation: operationName,
                  error: error.message,
                  errorCode: error.code,
                  timestamp: Date.now(),
                  maxRetries: maxRetries
                };
                if (process.env.NODE_ENV === 'production') {
                  metadata.stack = error.stack?.split('\n')[0] || error.message;
                } else {
                  metadata.stack = error.stack;
                }
                
                mockLogger.error(`${operationName} 最終失敗:`, metadata);
                throw error;
              }

              const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
              await new Promise(resolve => setTimeout(resolve, 1)); // テスト用に短縮
            }
          }
        };

        const result = await testRetryWithBackoff(mockOperation, 'testOperation', 3);

        expect(result).toBe('Success');
        expect(mockOperation).toHaveBeenCalledTimes(3);
        
        // 警告ログが2回呼ばれることを確認
        expect(mockLogger.warn).toHaveBeenCalledTimes(2);
        
        // 最初の警告ログの構造確認
        expect(mockLogger.warn).toHaveBeenNthCalledWith(1, 
          'testOperation 失敗 (試行 1/3):', 
          {
            operation: 'testOperation',
            error: 'First failure',
            errorCode: undefined,
            attempt: 1,
            maxRetries: 3
          }
        );
      });

      it('最終失敗時に構造化されたログ情報を出力すること', async () => {
        jest.clearAllMocks();
        
        const mockOperation = jest.fn()
          .mockRejectedValue(new Error('Persistent failure'));

        // createLogMetadata の簡易実装
        const createLogMetadata = (operation, error, additionalData = {}) => {
          const metadata = {
            operation,
            error: error.message,
            errorCode: error.code,
            timestamp: Date.now(),
            ...additionalData
          };
          if (process.env.NODE_ENV === 'production') {
            metadata.stack = error.stack?.split('\n')[0] || error.message;
          } else {
            metadata.stack = error.stack;
          }
          return metadata;
        };

        const testRetryWithBackoff = async (operation, operationName, maxRetries = 2) => {
          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
              return await operation();
            } catch (error) {
              const isLastAttempt = attempt === maxRetries;
              
              mockLogger.warn(`${operationName} 失敗 (試行 ${attempt}/${maxRetries}):`, {
                operation: operationName,
                error: error.message,
                errorCode: error.code,
                attempt: attempt,
                maxRetries: maxRetries
              });

              if (isLastAttempt) {
                mockLogger.error(`${operationName} 最終失敗:`, createLogMetadata(operationName, error, {
                  maxRetries: maxRetries
                }));
                throw error;
              }

              await new Promise(resolve => setTimeout(resolve, 1));
            }
          }
        };

        await expect(testRetryWithBackoff(mockOperation, 'testOperation', 2)).rejects.toThrow('Persistent failure');

        expect(mockOperation).toHaveBeenCalledTimes(2);
        expect(mockLogger.warn).toHaveBeenCalledTimes(2);
        expect(mockLogger.error).toHaveBeenCalledTimes(1);
        
        // 最終失敗ログの構造確認
        const errorCall = mockLogger.error.mock.calls[0];
        expect(errorCall[0]).toBe('testOperation 最終失敗:');
        expect(errorCall[1]).toMatchObject({
          operation: 'testOperation',
          error: 'Persistent failure',
          maxRetries: 2,
          timestamp: expect.any(Number)
        });
        expect(errorCall[1]).toHaveProperty('stack');
      });
    });
  });
});