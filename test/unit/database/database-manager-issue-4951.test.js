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

    // redisClient の機能をモック
    jest.doMock('../../../src/database/redisClient', () => ({
      initRedisClient: jest.fn().mockResolvedValue(true),
      getCircuitBreakerState: jest.fn().mockReturnValue({
        failures: 0,
        lastFailureTime: 0,
        state: 'CLOSED',
        isOpen: false,
        timeSinceLastFailure: 0
      }),
      isCircuitBreakerOpen: jest.fn().mockReturnValue(false),
      getExtendedConnectionHealth: jest.fn().mockResolvedValue({
        clientExists: true,
        clientReady: true,
        clientStatus: 'ready',
        circuitBreaker: { state: 'CLOSED', isOpen: false },
        ping: { success: true, latency: 10, error: null },
        overallHealth: true
      })
    }));

    // database manager を再インポート
    databaseManager = require('../../../src/database/manager');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('checkRedisConnectionHealth - Issue #4951 厳格な接続状態チェック', () => {
    test('全ての接続指標が正常な場合は健全と判定', async () => {
      mockRedisClient.isReady = true;
      mockRedisClient.status = 'ready';
      
      const result = await databaseManager.checkRedisConnectionHealth(mockRedisClient, mockLogger);
      
      expect(result.isHealthy).toBe(true);
      expect(result.details.clientReady).toBe(true);
      expect(result.details.clientConnected).toBe(true);
      expect(result.details.pingSuccess).toBe(true);
    });

    test('isReady=false の場合は不健全と判定（Issue #4951対応）', async () => {
      mockRedisClient.isReady = false;
      mockRedisClient.status = 'ready';
      
      const result = await databaseManager.checkRedisConnectionHealth(mockRedisClient, mockLogger);
      
      expect(result.isHealthy).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[Redis Health Check] 接続状態不良: isReady=false')
      );
    });

    test('isReady=false の場合は不健全と判定（Issue #4951対応）', async () => {
      mockRedisClient.isReady = false;
      mockRedisClient.status = 'ready';
      
      const result = await databaseManager.checkRedisConnectionHealth(mockRedisClient, mockLogger);
      
      expect(result.isHealthy).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[Redis Health Check] 接続状態不良')
      );
    });

    test('status!==ready の場合は健全と判定（Issue #4896修正後）', async () => {
      mockRedisClient.isReady = true;
      mockRedisClient.status = 'connecting'; // ready ではない状態
      mockRedisClient.ping.mockResolvedValue('PONG');
      
      const result = await databaseManager.checkRedisConnectionHealth(mockRedisClient, mockLogger);
      
      expect(result.isHealthy).toBe(false); // status が ready でない場合は不健全と判定
      expect(mockLogger.warn).toHaveBeenCalled(); // 警告が出力される
    });

    test('Issue #4896のケース：isReady=true, status!=ready（修正後は不健全と判定）', async () => {
      // Issue #4896で報告された接続状態（修正後は不健全と判定される）
      mockRedisClient.isReady = true;
      mockRedisClient.status = 'end'; // ready ではない状態
      mockRedisClient.ping.mockResolvedValue('PONG');
      
      const result = await databaseManager.checkRedisConnectionHealth(mockRedisClient, mockLogger);
      
      expect(result.isHealthy).toBe(false); // status が ready でない場合は不健全と判定
      expect(result.details.clientReady).toBe(true);
      expect(result.details.clientConnected).toBe(false); // status != ready のため false
      expect(mockLogger.warn).toHaveBeenCalled(); // 警告が出力される
    });

    test('複数の接続指標が不正な場合は詳細ログを出力', async () => {
      mockRedisClient.isReady = false;
      mockRedisClient.status = 'disconnected';
      
      const result = await databaseManager.checkRedisConnectionHealth(mockRedisClient, mockLogger);
      
      expect(result.isHealthy).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("[Redis Health Check] 接続状態不良")
      );
    });

    test('pingが失敗した場合は不健全と判定', async () => {
      mockRedisClient.isReady = true;
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
      mockRedisClient.status = 'ready';
      mockRedisClient.serverInfo = { version: '6.2.0' };
      
      const result = await databaseManager.checkRedisConnectionHealth(mockRedisClient, mockLogger);
      
      expect(result.details).toEqual(
        expect.objectContaining({
          clientExists: true,
          clientReady: true,
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
      mockRedisClient.status = 'ready';
      delete mockRedisClient.serverInfo;
      
      const result = await databaseManager.checkRedisConnectionHealth(mockRedisClient, mockLogger);
      
      expect(result.details.serverInfo).toBe('unavailable');
    });
  });
});