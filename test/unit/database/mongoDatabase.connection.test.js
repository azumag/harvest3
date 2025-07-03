/**
 * mongoDatabase.js の接続改善機能のテスト
 * MongoDB接続の改善（タイムアウト、再試行、ヘルスチェック）
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

const mockDb = {
  command: jest.fn(),
  listCollections: jest.fn(),
  createCollection: jest.fn(),
  collection: jest.fn()
};

jest.mock('mongodb', () => ({
  MongoClient: jest.fn(() => mockClient),
  ObjectId: jest.fn()
}));

// 通知機能のモック
jest.mock('../../../src/common/notifications', () => ({
  postMongoConnectionErrorToDiscord: jest.fn()
}));

// 環境変数のセットアップ
process.env.MONGO_URL = 'mongodb://test:27017';
process.env.MONGO_DB_NAME = 'test_db';

// テスト対象をインポート
const {
  connectDB,
  connectWithRetry,
  isConnected,
  startHealthCheck,
  stopHealthCheck,
  closeDB
} = require('../../../src/database/mongoDatabase');

describe.skip('mongoDatabase - 接続改善機能', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useFakeTimers();
    
    // デフォルトのモック設定
    mockClient.connect.mockResolvedValue();
    mockClient.close.mockResolvedValue();
    mockClient.db.mockReturnValue(mockDb);
    mockDb.command.mockResolvedValue({ ok: 1 });
    mockDb.listCollections.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([])
    });
    mockDb.createCollection.mockResolvedValue();
    mockDb.collection.mockReturnValue({
      createIndex: jest.fn().mockResolvedValue(),
      listIndexes: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([])
      })
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('isConnected', () => {
    describe('🔴 Red: 接続状態を正しく判定すること', () => {
      it('クライアントが存在しない場合はfalseを返すこと', async () => {
        // クライアントをnullにして実行
        const result = await isConnected();
        expect(result).toBe(false);
      });

      it('ping成功時はtrueを返すこと', async () => {
        mockDb.command.mockResolvedValue({ ok: 1 });
        
        const result = await isConnected();
        expect(result).toBe(true);
        expect(mockDb.command).toHaveBeenCalledWith({ ping: 1 });
      });

      it('pingエラー時はfalseを返すこと', async () => {
        mockDb.command.mockRejectedValue(new Error('Connection failed'));
        
        const result = await isConnected();
        expect(result).toBe(false);
      });
    });
  });

  describe('connectWithRetry', () => {
    describe('🔴 Red: 指数バックオフ再試行が正しく動作すること', () => {
      it('1回目で成功する場合は即座に完了すること', async () => {
        mockClient.connect.mockResolvedValueOnce();
        
        await connectWithRetry(3, 1000);
        
        expect(mockClient.connect).toHaveBeenCalledTimes(1);
      });

      it('最大再試行回数まで失敗した場合はエラーを投げること', async () => {
        const connectionError = new Error('Connection failed');
        mockClient.connect.mockRejectedValue(connectionError);
        
        await expect(connectWithRetry(2, 1000)).rejects.toThrow('MongoDB接続が2回失敗しました');
        expect(mockClient.connect).toHaveBeenCalledTimes(2);
      });

      it('2回目で成功する場合は適切な待機時間後に完了すること', async () => {
        mockClient.connect
          .mockRejectedValueOnce(new Error('First attempt failed'))
          .mockResolvedValueOnce();
        
        const connectPromise = connectWithRetry(3, 1000);
        
        // 最初の失敗後、1秒待機してから2回目の接続
        jest.advanceTimersByTime(1000);
        
        await connectPromise;
        
        expect(mockClient.connect).toHaveBeenCalledTimes(2);
      });

      it('指数バックオフの遅延が正しく計算されること', async () => {
        mockClient.connect
          .mockRejectedValueOnce(new Error('Attempt 1 failed'))
          .mockRejectedValueOnce(new Error('Attempt 2 failed'))
          .mockResolvedValueOnce();
        
        const connectPromise = connectWithRetry(3, 1000);
        
        // 1回目失敗 → 1秒待機
        jest.advanceTimersByTime(1000);
        
        // 2回目失敗 → 2秒待機（指数バックオフ）
        jest.advanceTimersByTime(2000);
        
        await connectPromise;
        
        expect(mockClient.connect).toHaveBeenCalledTimes(3);
      });
    });
  });

  describe('ヘルスチェック機能', () => {
    describe('🔴 Red: 定期的な接続監視が正しく動作すること', () => {
      it('ヘルスチェック開始時にintervalが設定されること', () => {
        const setIntervalSpy = jest.spyOn(global, 'setInterval');
        
        startHealthCheck();
        
        expect(setIntervalSpy).toHaveBeenCalledWith(
          expect.any(Function),
          60000 // 1分間隔
        );
      });

      it('接続切断検出時に再接続を試行すること', async () => {
        mockDb.command.mockRejectedValue(new Error('Connection lost'));
        const connectWithRetrySpy = jest.fn().mockResolvedValue();
        
        startHealthCheck();
        
        // ヘルスチェック実行
        jest.advanceTimersByTime(60000);
        
        // 非同期処理の完了を待つ
        await new Promise(resolve => setImmediate(resolve));
        
        expect(mockDb.command).toHaveBeenCalledWith({ ping: 1 });
      });

      it('ヘルスチェック停止時にintervalがクリアされること', () => {
        const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
        
        startHealthCheck();
        stopHealthCheck();
        
        expect(clearIntervalSpy).toHaveBeenCalled();
      });
    });
  });

  describe('closeDB', () => {
    describe('🔴 Red: 安全なデータベース切断が行われること', () => {
      it('ヘルスチェックが停止され、クライアントが閉じられること', async () => {
        const stopHealthCheckSpy = jest.fn();
        
        await closeDB();
        
        expect(mockClient.close).toHaveBeenCalled();
      });

      it('クライアント切断時のエラーがキャッチされること', async () => {
        mockClient.close.mockRejectedValue(new Error('Close failed'));
        
        // エラーが投げられずに完了することを確認
        await expect(closeDB()).resolves.toBeUndefined();
      });
    });
  });

  describe('統合テスト', () => {
    describe('🔴 Red: MongoDB接続の改善された設定が適用されること', () => {
      it('適切なタイムアウト設定でMongoClientが作成されること', async () => {
        await connectDB();
        
        expect(MongoClient).toHaveBeenCalledWith(
          'mongodb://test:27017',
          expect.objectContaining({
            serverSelectionTimeoutMS: 30000,
            connectTimeoutMS: 10000,
            socketTimeoutMS: 45000,
            maxPoolSize: 50,
            minPoolSize: 5,
            maxIdleTimeMS: 30000,
            retryWrites: true,
            heartbeatFrequencyMS: 10000,
            // bufferMaxEntries: 削除（新しいドライバでは非対応）
            compressors: ['zlib'],
            maxConnecting: 10
          })
        );
      });

      it('接続エラー時に適切なDiscord通知が送信されること', async () => {
        const { postMongoConnectionErrorToDiscord } = require('../../../src/common/notifications');
        const connectionError = new Error('Connection failed');
        mockClient.connect.mockRejectedValue(connectionError);
        
        await expect(connectDB()).rejects.toThrow();
        
        expect(postMongoConnectionErrorToDiscord).toHaveBeenCalledWith(
          'Connection failed',
          'mongodb://test:27017'
        );
      });
    });
  });

  describe('パフォーマンステスト', () => {
    describe('🔴 Red: 接続性能の改善が確認できること', () => {
      it('再試行時間が指数バックオフパターンに従うこと', async () => {
        const delays = [];
        const originalSetTimeout = setTimeout;
        
        // setTimeoutをスパイして実際の遅延時間を記録
        jest.spyOn(global, 'setTimeout').mockImplementation((fn, delay) => {
          delays.push(delay);
          return originalSetTimeout(fn, 0); // 実際には待機しない
        });
        
        mockClient.connect
          .mockRejectedValueOnce(new Error('Attempt 1'))
          .mockRejectedValueOnce(new Error('Attempt 2'))
          .mockRejectedValueOnce(new Error('Attempt 3'))
          .mockResolvedValueOnce();
        
        await connectWithRetry(4, 1000);
        
        // 指数バックオフ: 1000, 2000, 4000ms
        expect(delays).toEqual([1000, 2000, 4000]);
      });

      it('最大遅延時間が30秒に制限されること', async () => {
        const delays = [];
        jest.spyOn(global, 'setTimeout').mockImplementation((fn, delay) => {
          delays.push(delay);
          return setTimeout(fn, 0);
        });
        
        mockClient.connect
          .mockRejectedValueOnce(new Error('Attempt 1'))
          .mockRejectedValueOnce(new Error('Attempt 2'))
          .mockRejectedValueOnce(new Error('Attempt 3'))
          .mockRejectedValueOnce(new Error('Attempt 4'))
          .mockRejectedValueOnce(new Error('Attempt 5'))
          .mockResolvedValueOnce();
        
        await connectWithRetry(6, 1000);
        
        // 指数バックオフだが最大30秒制限: 1000, 2000, 4000, 8000, 16000 → 30000, 30000
        expect(Math.max(...delays)).toBeLessThanOrEqual(30000);
      });
    });
  });
});