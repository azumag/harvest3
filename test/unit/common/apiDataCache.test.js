const { APIDataCache } = require('../../../src/common/apiDataCache');

describe('APIDataCache', () => {
  let cache;
  let mockExchange;

  beforeEach(() => {
    cache = new APIDataCache();
    
    mockExchange = {
      id: 'bitbank',
      fetchTicker: jest.fn(),
      fetchOHLCV: jest.fn(),
      fetchBalance: jest.fn()
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('基本機能', () => {
    test('キャッシュキーの生成', () => {
      const key1 = cache.createCacheKey('bitbank', 'fetchTicker', 'BTC/JPY');
      const key2 = cache.createCacheKey('bitbank', 'fetchTicker', 'BTC/JPY', { limit: 100 });
      
      expect(key1).toBe('bitbank:fetchTicker:BTC/JPY:');
      expect(key2).toBe('bitbank:fetchTicker:BTC/JPY:{"limit":100}');
    });

    test('キャッシュの保存と取得', () => {
      const testData = { symbol: 'BTC/JPY', price: 5000000 };
      
      cache.setCache('bitbank', 'fetchTicker', 'BTC/JPY', testData);
      const result = cache.getFromCache('bitbank', 'fetchTicker', 'BTC/JPY');
      
      expect(result).toEqual(testData);
      expect(cache.stats.hits).toBe(1);
    });

    test('キャッシュミス', () => {
      const result = cache.getFromCache('bitbank', 'fetchTicker', 'ETH/JPY');
      
      expect(result).toBeNull();
      expect(cache.stats.misses).toBe(1);
    });

    test('期限切れキャッシュの削除', () => {
      const testData = { symbol: 'BTC/JPY', price: 5000000 };
      
      cache.setCache('bitbank', 'fetchTicker', 'BTC/JPY', testData);
      
      // 期限切れをシミュレート
      const key = cache.createCacheKey('bitbank', 'fetchTicker', 'BTC/JPY');
      const cachedData = cache.cache.get(key);
      cachedData.timestamp = Date.now() - cache.maxCacheAge - 1000;
      
      const result = cache.getFromCache('bitbank', 'fetchTicker', 'BTC/JPY');
      
      expect(result).toBeNull();
      expect(cache.cache.has(key)).toBe(false);
    });
  });

  describe('APIキュー処理', () => {
    test('キューリクエストの処理', async () => {
      const tickerData = { symbol: 'BTC/JPY', bid: 5000000, ask: 5001000 };
      mockExchange.fetchTicker.mockResolvedValue(tickerData);

      const result = await cache.queueRequest(mockExchange, 'fetchTicker', 'BTC/JPY');

      expect(result).toEqual(tickerData);
      expect(mockExchange.fetchTicker).toHaveBeenCalledWith('BTC/JPY');
      expect(cache.stats.requests).toBe(1);
    });

    test('キャッシュされたデータの再利用', async () => {
      const tickerData = { symbol: 'BTC/JPY', bid: 5000000, ask: 5001000 };
      
      // 最初のリクエスト
      mockExchange.fetchTicker.mockResolvedValue(tickerData);
      const result1 = await cache.queueRequest(mockExchange, 'fetchTicker', 'BTC/JPY');

      // 2回目のリクエスト（キャッシュから）
      const result2 = await cache.queueRequest(mockExchange, 'fetchTicker', 'BTC/JPY');

      expect(result1).toEqual(tickerData);
      expect(result2).toEqual(tickerData);
      expect(mockExchange.fetchTicker).toHaveBeenCalledTimes(1);
      expect(cache.stats.hits).toBe(1);
    });

    test('複数のメソッドに対応', async () => {
      const ohlcvData = [[Date.now(), 5000000, 5010000, 4990000, 5005000, 1.5]];
      mockExchange.fetchOHLCV.mockResolvedValue(ohlcvData);

      const result = await cache.queueRequest(
        mockExchange, 
        'fetchOHLCV', 
        'BTC/JPY',
        { timeframe: '1m', limit: 20 }
      );

      expect(result).toEqual(ohlcvData);
      expect(mockExchange.fetchOHLCV).toHaveBeenCalledWith('BTC/JPY', '1m', undefined, 20);
    });

    test('APIエラーの処理', async () => {
      const error = new Error('API Rate Limit Exceeded');
      mockExchange.fetchTicker.mockRejectedValue(error);

      await expect(cache.queueRequest(mockExchange, 'fetchTicker', 'BTC/JPY'))
        .rejects.toThrow('API Rate Limit Exceeded');
    });
  });

  describe('統計情報', () => {
    test('統計の取得', () => {
      cache.stats.hits = 10;
      cache.stats.misses = 5;
      cache.stats.requests = 8;

      const stats = cache.getStats();

      expect(stats.hits).toBe(10);
      expect(stats.misses).toBe(5);
      expect(stats.requests).toBe(8);
      expect(stats.hitRate).toBe('66.7%');
      expect(stats.cacheSize).toBe(0);
      expect(stats.queueSize).toBe(0);
    });

    test('統計のクリア', () => {
      cache.stats.hits = 10;
      cache.stats.misses = 5;
      cache.stats.requests = 8;

      cache.clearStats();

      expect(cache.stats.hits).toBe(0);
      expect(cache.stats.misses).toBe(0);
      expect(cache.stats.requests).toBe(0);
    });
  });

  describe('期限切れクリーンアップ', () => {
    test('期限切れキャッシュの一括削除', () => {
      const oldData = { symbol: 'BTC/JPY', price: 5000000 };
      const newData = { symbol: 'ETH/JPY', price: 400000 };

      cache.setCache('bitbank', 'fetchTicker', 'BTC/JPY', oldData);
      cache.setCache('bitbank', 'fetchTicker', 'ETH/JPY', newData);

      // BTC/JPYを期限切れにする
      const oldKey = cache.createCacheKey('bitbank', 'fetchTicker', 'BTC/JPY');
      const oldCachedData = cache.cache.get(oldKey);
      oldCachedData.timestamp = Date.now() - cache.maxCacheAge - 1000;

      expect(cache.cache.size).toBe(2);

      cache.clearExpiredCache();

      expect(cache.cache.size).toBe(1);
      expect(cache.getFromCache('bitbank', 'fetchTicker', 'ETH/JPY')).toEqual(newData);
      expect(cache.getFromCache('bitbank', 'fetchTicker', 'BTC/JPY')).toBeNull();
    });
  });
});