const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');

/**
 * Issue #5046: backtestサービスで例外が発生 - TypeError: Cannot convert undefined or null to object
 * 
 * Redis hGetAllが null/undefined を返す場合に Object.keys() でTypeErrorが発生する問題を修正
 */
describe('Issue #5046: backtest service TypeError fix', () => {
  let mockRedisClient;
  let getStrategyParametersRedis;

  beforeEach(() => {
    // Redis clientをmock
    mockRedisClient = {
      isReady: true,
      hGetAll: jest.fn()
    };

    // テスト用のモジュールを動的にロード
    jest.doMock('../src/database/redisClient', () => mockRedisClient, { virtual: true });
    
    // redisDatabase.jsから関数をインポート
    const redisDatabase = require('../src/database/redisDatabase');
    getStrategyParametersRedis = redisDatabase.getStrategyParametersRedis;
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  describe('getStrategyParametersRedis', () => {
    it('should handle null response from hGetAll without throwing TypeError', async () => {
      // Redis hGetAllがnullを返すケース
      mockRedisClient.hGetAll.mockResolvedValue(null);

      const result = await getStrategyParametersRedis('bitbank', 'BTC/JPY', 'MUTUAL_INFO');
      
      expect(result).toBeNull();
      expect(mockRedisClient.hGetAll).toHaveBeenCalledWith('params:bitbank:BTC/JPY:MUTUAL_INFO');
    });

    it('should handle undefined response from hGetAll without throwing TypeError', async () => {
      // Redis hGetAllがundefinedを返すケース
      mockRedisClient.hGetAll.mockResolvedValue(undefined);

      const result = await getStrategyParametersRedis('bitbank', 'ETH/JPY', 'MUTUAL_INFO');
      
      expect(result).toBeNull();
      expect(mockRedisClient.hGetAll).toHaveBeenCalledWith('params:bitbank:ETH/JPY:MUTUAL_INFO');
    });

    it('should handle empty object response from hGetAll', async () => {
      // Redis hGetAllが空オブジェクトを返すケース
      mockRedisClient.hGetAll.mockResolvedValue({});

      const result = await getStrategyParametersRedis('bitbank', 'DOT/JPY', 'MUTUAL_INFO');
      
      expect(result).toBeNull();
      expect(mockRedisClient.hGetAll).toHaveBeenCalledWith('params:bitbank:DOT/JPY:MUTUAL_INFO');
    });

    it('should handle valid parameters object response from hGetAll', async () => {
      // Redis hGetAllが有効なパラメータを返すケース
      const mockParams = {
        'period': '14',
        'threshold': '0.5'
      };
      mockRedisClient.hGetAll.mockResolvedValue(mockParams);

      const result = await getStrategyParametersRedis('bitbank', 'BTC/JPY', 'MUTUAL_INFO');
      
      expect(result).toEqual({
        period: 14,
        threshold: 0.5
      });
      expect(mockRedisClient.hGetAll).toHaveBeenCalledWith('params:bitbank:BTC/JPY:MUTUAL_INFO');
    });

    it('should handle Redis connection not ready', async () => {
      // Redis接続が無効な場合
      mockRedisClient.isReady = false;

      const result = await getStrategyParametersRedis('bitbank', 'BTC/JPY', 'MUTUAL_INFO');
      
      expect(result).toBeNull();
      expect(mockRedisClient.hGetAll).not.toHaveBeenCalled();
    });

    it('should handle Redis client error', async () => {
      // Redis hGetAllでエラーが発生するケース
      mockRedisClient.hGetAll.mockRejectedValue(new Error('Redis connection error'));

      const result = await getStrategyParametersRedis('bitbank', 'BTC/JPY', 'MUTUAL_INFO');
      
      expect(result).toBeNull();
      expect(mockRedisClient.hGetAll).toHaveBeenCalledWith('params:bitbank:BTC/JPY:MUTUAL_INFO');
    });
  });

  describe('Edge cases that caused the original TypeError', () => {
    it('should not throw TypeError when Object.keys is called on null result', async () => {
      // これまで TypeError の原因となっていたケース
      mockRedisClient.hGetAll.mockResolvedValue(null);

      // この呼び出しでTypeErrorが発生してはいけない
      await expect(getStrategyParametersRedis('bitbank', 'BTC/JPY', 'MUTUAL_INFO'))
        .resolves.not.toThrow('TypeError: Cannot convert undefined or null to object');
    });

    it('should not throw TypeError when Object.keys is called on undefined result', async () => {
      // これまで TypeError の原因となっていたケース
      mockRedisClient.hGetAll.mockResolvedValue(undefined);

      // この呼び出しでTypeErrorが発生してはいけない
      await expect(getStrategyParametersRedis('bitbank', 'ETH/JPY', 'MUTUAL_INFO'))
        .resolves.not.toThrow('TypeError: Cannot convert undefined or null to object');
    });
  });
});