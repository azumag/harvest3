/**
 * Issue #4951: strategy-runnerサービスでのRedis接続障害修正テスト
 * Redis接続の厳格な健全性チェックによる"null/undefined error"の修正テスト
 */

// Jest テストフレームワークを使用
jest.unmock('../../../src/database/manager');

describe('Issue #4951: Redis接続の厳格な健全性チェック修正', () => {
  let mockRedisClient;
  let mockRedisDatabase;
  let mockLogger;
  let databaseManager;

  beforeEach(() => {
    // Jest のモックキャッシュをクリア
    jest.resetModules();
    
    // モックの初期化
    mockRedisClient = {
      multi: jest.fn(),
      isReady: true,
      isOpen: true,
      status: 'ready',
      serverInfo: { version: '6.2.0' },
      ping: jest.fn().mockResolvedValue('PONG')
    };

    mockRedisDatabase = {
      getClient: jest.fn().mockReturnValue(mockRedisClient)
    };

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    };

    // Logger クラスをモック
    jest.doMock('../../../src/hft/utils/Logger', () => {
      return jest.fn(() => mockLogger);
    });

    // redisDatabase をモック
    jest.doMock('../../../src/database/redisDatabase', () => mockRedisDatabase);

    // database manager を再インポート
    databaseManager = require('../../../src/database/manager');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('checkRedisConnectionHealth - Issue #4951 厳格な接続状態チェック', () => {
    test('全ての接続指標が正常な場合は健全と判定', async () => {
      mockRedisClient.isReady = true;
      mockRedisClient.isOpen = true;
      mockRedisClient.status = 'ready';
      
      const result = await databaseManager.checkRedisConnectionHealth(mockRedisClient, mockLogger);
      
      expect(result.isHealthy).toBe(true);
      expect(result.details.clientReady).toBe(true);
      expect(result.details.clientOpen).toBe(true);
      expect(result.details.clientConnected).toBe(true);
      expect(result.details.pingSuccess).toBe(true);
    });

    test('isReady=false の場合は不健全と判定（Issue #4951対応）', async () => {
      mockRedisClient.isReady = false;
      mockRedisClient.isOpen = true;
      mockRedisClient.status = 'ready';
      
      const result = await databaseManager.checkRedisConnectionHealth(mockRedisClient, mockLogger);
      
      expect(result.isHealthy).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[Redis Health Check] 接続状態不良: isReady=false')
      );
    });

    test('isOpen=false の場合は不健全と判定（Issue #4951対応）', async () => {
      mockRedisClient.isReady = true;
      mockRedisClient.isOpen = false;
      mockRedisClient.status = 'ready';
      
      const result = await databaseManager.checkRedisConnectionHealth(mockRedisClient, mockLogger);
      
      expect(result.isHealthy).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[Redis Health Check] 接続状態不良: isOpen=false')
      );
    });

    test('status!==ready の場合は不健全と判定（Issue #4951メイン修正）', async () => {
      mockRedisClient.isReady = true;
      mockRedisClient.isOpen = true;
      mockRedisClient.status = 'connecting'; // ready ではない状態
      
      const result = await databaseManager.checkRedisConnectionHealth(mockRedisClient, mockLogger);
      
      expect(result.isHealthy).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("[Redis Health Check] 接続状態不良: status='connecting'")
      );
    });

    test('Issue #4951のエラーケース：isReady=true, isOpen=true, status!=ready（実際のエラーログ再現）', async () => {
      // 実際のエラーログで報告された接続状態を再現
      mockRedisClient.isReady = true;
      mockRedisClient.isOpen = true;
      mockRedisClient.status = 'end'; // connected ではない状態
      
      const result = await databaseManager.checkRedisConnectionHealth(mockRedisClient, mockLogger);
      
      expect(result.isHealthy).toBe(false);
      expect(result.details.clientReady).toBe(true);
      expect(result.details.clientOpen).toBe(true);
      expect(result.details.clientConnected).toBe(false); // status !== 'ready'
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("[Redis Health Check] 接続状態不良: status='end'")
      );
    });

    test('複数の接続指標が不正な場合は詳細ログを出力', async () => {
      mockRedisClient.isReady = false;
      mockRedisClient.isOpen = false;
      mockRedisClient.status = 'disconnected';
      
      const result = await databaseManager.checkRedisConnectionHealth(mockRedisClient, mockLogger);
      
      expect(result.isHealthy).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("[Redis Health Check] 接続状態不良: isReady=false, isOpen=false, status='disconnected'")
      );
    });

    test('pingが失敗した場合は不健全と判定', async () => {
      mockRedisClient.isReady = true;
      mockRedisClient.isOpen = true;
      mockRedisClient.status = 'ready';
      mockRedisClient.ping.mockRejectedValue(new Error('Connection timeout'));
      
      const result = await databaseManager.checkRedisConnectionHealth(mockRedisClient, mockLogger);
      
      expect(result.isHealthy).toBe(false);
      expect(result.details.pingSuccess).toBe(false);
      expect(result.details.pingError).toBe('Connection timeout');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[Redis Health Check] Ping failed: Connection timeout')
      );
    });

    test('pingがタイムアウトした場合は不健全と判定', async () => {
      mockRedisClient.isReady = true;
      mockRedisClient.isOpen = true;
      mockRedisClient.status = 'ready';
      
      // 5秒以上かかるpingをシミュレート
      mockRedisClient.ping.mockImplementation(() => {
        return new Promise(resolve => setTimeout(resolve, 6000));
      });
      
      const result = await databaseManager.checkRedisConnectionHealth(mockRedisClient, mockLogger);
      
      expect(result.isHealthy).toBe(false);
      expect(result.details.pingSuccess).toBe(false);
      expect(result.details.pingError).toBe('Ping timeout');
    });
  });

  describe('Redis接続状態の詳細情報', () => {
    test('健全性チェックの詳細情報が正しく設定される', async () => {
      mockRedisClient.isReady = true;
      mockRedisClient.isOpen = true;
      mockRedisClient.status = 'ready';
      mockRedisClient.serverInfo = { version: '6.2.0' };
      
      const result = await databaseManager.checkRedisConnectionHealth(mockRedisClient, mockLogger);
      
      expect(result.details).toEqual(
        expect.objectContaining({
          clientExists: true,
          clientReady: true,
          clientOpen: true,
          clientConnected: true,
          clientStatus: 'ready',
          serverInfo: 'available',
          pingSuccess: true,
          pingError: null
        })
      );
    });

    test('serverInfoが存在しない場合は"unavailable"と表示', async () => {
      mockRedisClient.isReady = true;
      mockRedisClient.isOpen = true;
      mockRedisClient.status = 'ready';
      delete mockRedisClient.serverInfo;
      
      const result = await databaseManager.checkRedisConnectionHealth(mockRedisClient, mockLogger);
      
      expect(result.details.serverInfo).toBe('unavailable');
    });
  });
});