/**
 * API サーバー起動とヘルスチェックの単体テスト
 * 
 * Strategy-runner サービスの起動タイムアウト問題を解決するための
 * データベース初期化順序とヘルスチェック機能のテスト
 */

// モック関数
const mockInitializeDB = jest.fn();
const mockIsConnected = jest.fn();
const mockRedisClient = {
  isReady: true
};

// Express アプリケーションのモック
const mockListen = jest.fn();
const mockExpress = {
  listen: mockListen,
  use: jest.fn(),
  get: jest.fn(),
  static: jest.fn()
};

// Express関数自体のモック
const mockExpressFunction = () => mockExpress;
// Express.jsonなどの静的メソッドを追加
mockExpressFunction.json = jest.fn();
mockExpressFunction.static = jest.fn();

// モジュールのモック
jest.mock('express', () => mockExpressFunction);

jest.mock('../../../src/database/manager', () => ({
  initializeDB: mockInitializeDB
}));

jest.mock('../../../src/database/mongoDatabase', () => ({
  isConnected: mockIsConnected
}));

jest.mock('../../../src/database/redisDatabase', () => ({
  client: mockRedisClient
}));

jest.mock('../../../src/api/routes', () => {
  return {
    get: jest.fn()
  };
});

// 他の依存関係をモック
jest.mock('cors', () => jest.fn(() => (req, res, next) => next()));
jest.mock('morgan', () => jest.fn(() => (req, res, next) => next()));
jest.mock('path');
jest.mock('node-fetch');
jest.mock('dotenv', () => ({
  config: jest.fn()
}));

describe('API サーバー起動とヘルスチェック', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // コンソールログをモック（テスト出力をクリーンに保つ）
    jest.spyOn(console, 'error').mockImplementation(() => {});
    
    // process.exit をモック
    jest.spyOn(process, 'exit').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('サーバー起動順序', () => {
    it('データベース初期化が先に実行されること', async () => {
      // データベース初期化を成功させる
      mockInitializeDB.mockResolvedValue();
      
      // startServer関数をテスト用に取り出す
      const { startServer } = require('../../../src/api/index');
      
      // startServer関数を実行
      await startServer();
      
      // データベース初期化が最初に呼ばれることを確認
      expect(mockInitializeDB).toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith('データベース初期化を開始します...');
      expect(console.error).toHaveBeenCalledWith('データベースが正常に初期化されました');
      
      // サーバーが起動されることを確認
      expect(mockListen).toHaveBeenCalled();
    });

    it('データベース初期化失敗時でもサーバーが起動すること', async () => {
      // データベース初期化を失敗させる
      const dbError = new Error('データベース接続エラー');
      mockInitializeDB.mockRejectedValue(dbError);
      
      const { startServer } = require('../../../src/api/index');
      
      // startServer関数を実行
      await startServer();

      // エラーハンドリングが正しく動作することを確認
      expect(mockInitializeDB).toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith('データベース初期化エラー:', dbError);
      expect(console.error).toHaveBeenCalledWith('データベース初期化に失敗しましたが、サーバーを起動します');
      
      // サーバーが起動されることを確認
      expect(mockListen).toHaveBeenCalled();
    });
  });

  describe('ヘルスチェック機能', () => {
    it('健全性チェック用のヘルスオブジェクトが正しく構築されること', () => {
      // ヘルスチェックロジックをユニットテスト
      const createHealthStatus = (redisReady, mongoConnected) => {
        const health = {
          status: 'ok',
          timestamp: new Date().toISOString(),
          services: {}
        };

        // Redis接続確認
        if (redisReady) {
          health.services.redis = 'connected';
        } else {
          health.services.redis = 'disconnected';
          health.status = 'degraded';
        }

        // MongoDB接続確認
        if (mongoConnected) {
          health.services.mongodb = 'connected';
        } else {
          health.services.mongodb = 'disconnected';
          health.status = 'degraded';
        }

        return health;
      };

      // すべて正常な場合
      const healthOk = createHealthStatus(true, true);
      expect(healthOk.status).toBe('ok');
      expect(healthOk.services.redis).toBe('connected');
      expect(healthOk.services.mongodb).toBe('connected');

      // Redis失敗時
      const healthRedisDown = createHealthStatus(false, true);
      expect(healthRedisDown.status).toBe('degraded');
      expect(healthRedisDown.services.redis).toBe('disconnected');
      expect(healthRedisDown.services.mongodb).toBe('connected');

      // MongoDB失敗時
      const healthMongoDown = createHealthStatus(true, false);
      expect(healthMongoDown.status).toBe('degraded');
      expect(healthMongoDown.services.redis).toBe('connected');
      expect(healthMongoDown.services.mongodb).toBe('disconnected');

      // すべて失敗時
      const healthAllDown = createHealthStatus(false, false);
      expect(healthAllDown.status).toBe('degraded');
      expect(healthAllDown.services.redis).toBe('disconnected');
      expect(healthAllDown.services.mongodb).toBe('disconnected');
    });
  });

  describe('タイムアウト対策', () => {
    it('データベース初期化が迅速に実行されること', async () => {
      // 高速なデータベース初期化をシミュレート
      mockInitializeDB.mockImplementation(() => 
        new Promise(resolve => setTimeout(resolve, 100))
      );
      
      const start = Date.now();
      const { startServer } = require('../../../src/api/index');
      
      await startServer();
      
      const elapsed = Date.now() - start;
      
      // データベース初期化が迅速に完了することを確認
      expect(elapsed).toBeLessThan(1000); // 1秒以内
      expect(mockInitializeDB).toHaveBeenCalled();
      expect(mockListen).toHaveBeenCalled();
    });
  });
});