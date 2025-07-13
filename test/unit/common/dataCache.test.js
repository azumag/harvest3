const { DataCache, StrategyCache } = require('../../../src/common/dataCache');

describe('DataCache', () => {
  let cache;

  beforeEach(() => {
    cache = new DataCache(1000); // 1秒TTL
  });

  afterEach(() => {
    cache.clear();
  });

  describe('基本的なキャッシュ機能', () => {
    test('データを設定・取得できる', () => {
      cache.set('test-key', 'test-value');
      const cached = cache.cache.get('test-key');
      
      expect(cached).toBeDefined();
      expect(cached.data).toBe('test-value');
      expect(cached.timestamp).toBeCloseTo(Date.now(), -2);
    });

    test('get()でキャッシュヒットする', async () => {
      const fetchFn = jest.fn().mockResolvedValue('fetched-value');
      
      // 初回は関数が呼ばれる
      const result1 = await cache.get('test-key', fetchFn);
      expect(result1).toBe('fetched-value');
      expect(fetchFn).toHaveBeenCalledTimes(1);
      
      // 2回目はキャッシュから返される
      const result2 = await cache.get('test-key', fetchFn);
      expect(result2).toBe('fetched-value');
      expect(fetchFn).toHaveBeenCalledTimes(1); // 呼ばれない
    });

    test('TTL期限切れで再取得される', async () => {
      const fetchFn = jest.fn()
        .mockResolvedValueOnce('first-value')
        .mockResolvedValueOnce('second-value');
      
      // 初回取得
      const result1 = await cache.get('test-key', fetchFn, 10); // 10ms TTL
      expect(result1).toBe('first-value');
      
      // TTL期限切れまで待機
      await new Promise(resolve => setTimeout(resolve, 15));
      
      // 期限切れ後の取得
      const result2 = await cache.get('test-key', fetchFn, 10);
      expect(result2).toBe('second-value');
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    test('fetchFunction エラー時は期限切れキャッシュを返す', async () => {
      // 最初に成功値をキャッシュ
      cache.set('test-key', 'cached-value', 10); // 10ms TTL
      
      // TTL期限切れまで待機
      await new Promise(resolve => setTimeout(resolve, 15));
      
      // エラーが発生する fetch 関数
      const errorFetchFn = jest.fn().mockRejectedValue(new Error('API Error'));
      
      // エラー時は期限切れキャッシュが返される
      const result = await cache.get('test-key', errorFetchFn);
      expect(result).toBe('cached-value');
    });

    test('invalidate()でキャッシュが削除される', () => {
      cache.set('test-key', 'test-value');
      expect(cache.cache.has('test-key')).toBe(true);
      
      const deleted = cache.invalidate('test-key');
      expect(deleted).toBe(true);
      expect(cache.cache.has('test-key')).toBe(false);
    });

    test('invalidatePattern()でパターンマッチしたキーが削除される', () => {
      cache.set('strategy:BTC:config', 'btc-config');
      cache.set('strategy:ETH:config', 'eth-config');
      cache.set('orderbook:BTC:data', 'btc-orderbook');
      
      const count = cache.invalidatePattern(/^strategy:.*/);
      expect(count).toBe(2);
      expect(cache.cache.has('strategy:BTC:config')).toBe(false);
      expect(cache.cache.has('strategy:ETH:config')).toBe(false);
      expect(cache.cache.has('orderbook:BTC:data')).toBe(true);
    });
  });

  describe('統計情報', () => {
    test('統計が正しく計算される', async () => {
      const fetchFn = jest.fn().mockResolvedValue('value');
      
      // ヒット/ミス統計
      await cache.get('key1', fetchFn); // miss
      await cache.get('key1', fetchFn); // hit
      await cache.get('key2', fetchFn); // miss
      
      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(2);
      expect(stats.sets).toBe(2);
      expect(stats.size).toBe(2);
      expect(stats.hitRate).toBe('33.33%');
    });

    test('統計をリセットできる', async () => {
      const fetchFn = jest.fn().mockResolvedValue('value');
      await cache.get('key1', fetchFn);
      
      cache.resetStats();
      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.sets).toBe(0);
    });
  });

  describe('クリーンアップ機能', () => {
    test('cleanup()で期限切れエントリが削除される', () => {
      // 期限切れエントリを作成
      cache.set('expired-key', 'value', 10);
      cache.set('valid-key', 'value', 10000);
      
      // 時間経過をシミュレート
      cache.cache.get('expired-key').timestamp = Date.now() - 20;
      
      const cleaned = cache.cleanup();
      expect(cleaned).toBe(1);
      expect(cache.cache.has('expired-key')).toBe(false);
      expect(cache.cache.has('valid-key')).toBe(true);
    });
  });
});

describe('StrategyCache', () => {
  let strategyCache;
  let mockExchange;

  beforeEach(() => {
    strategyCache = new StrategyCache();
    mockExchange = { id: 'bitbank' };
  });

  afterEach(() => {
    strategyCache.configCache.clear();
    strategyCache.orderBookCache.clear();
    strategyCache.tickerCache.clear();
    strategyCache.marketDataCache.clear();
  });

  describe('戦略特化キャッシュ', () => {
    test('戦略設定がキャッシュされる', async () => {
      const fetchFn = jest.fn().mockResolvedValue({ enabled: true, params: {} });
      
      const config1 = await strategyCache.getStrategyConfig(
        mockExchange, 'BTC/JPY', 'RSI', {}, fetchFn
      );
      const config2 = await strategyCache.getStrategyConfig(
        mockExchange, 'BTC/JPY', 'RSI', {}, fetchFn
      );
      
      expect(config1).toEqual(config2);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    test('注文ブックがキャッシュされる', async () => {
      const orderBookData = { bids: [[100, 1]], asks: [[101, 1]] };
      const fetchFn = jest.fn().mockResolvedValue(orderBookData);
      
      const orderBook1 = await strategyCache.getOrderBook(
        mockExchange, 'BTC/JPY', 5, fetchFn
      );
      const orderBook2 = await strategyCache.getOrderBook(
        mockExchange, 'BTC/JPY', 5, fetchFn
      );
      
      expect(orderBook1).toEqual(orderBook2);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    test('戦略無効化で関連キャッシュが削除される', async () => {
      const fetchFn = jest.fn().mockResolvedValue('test-data');
      
      // 各種データをキャッシュ
      await strategyCache.getStrategyConfig(mockExchange, 'BTC/JPY', 'RSI', {}, fetchFn);
      await strategyCache.getOrderBook(mockExchange, 'BTC/JPY', 5, fetchFn);
      await strategyCache.getTicker(mockExchange, 'BTC/JPY', fetchFn);
      
      // キャッシュが存在することを確認
      expect(strategyCache.configCache.cache.size).toBeGreaterThan(0);
      expect(strategyCache.orderBookCache.cache.size).toBeGreaterThan(0);
      expect(strategyCache.tickerCache.cache.size).toBeGreaterThan(0);
      
      // 戦略無効化
      strategyCache.invalidateStrategy(mockExchange, 'BTC/JPY', 'RSI');
      
      // 関連キャッシュが削除されることを確認
      const stats = strategyCache.getStats();
      expect(stats.configCache.size).toBe(0);
      expect(stats.orderBookCache.size).toBe(0);
      expect(stats.tickerCache.size).toBe(0);
    });
  });

  describe('統計とクリーンアップ', () => {
    test('全体統計が取得できる', async () => {
      const fetchFn = jest.fn().mockResolvedValue('data');
      
      await strategyCache.getStrategyConfig(mockExchange, 'BTC/JPY', 'RSI', {}, fetchFn);
      await strategyCache.getOrderBook(mockExchange, 'BTC/JPY', 5, fetchFn);
      
      const stats = strategyCache.getStats();
      expect(stats).toHaveProperty('configCache');
      expect(stats).toHaveProperty('orderBookCache');
      expect(stats).toHaveProperty('tickerCache');
      expect(stats).toHaveProperty('marketDataCache');
      
      expect(stats.configCache.size).toBe(1);
      expect(stats.orderBookCache.size).toBe(1);
    });

    test('cleanup()で期限切れデータが削除される', () => {
      // 期限切れデータを手動で作成
      strategyCache.configCache.set('test-key', 'value', 10);
      strategyCache.configCache.cache.get('test-key').timestamp = Date.now() - 20;
      
      const cleanupResult = strategyCache.cleanup();
      expect(cleanupResult.config).toBe(1);
      expect(strategyCache.configCache.cache.size).toBe(0);
    });
  });
});

// パフォーマンステスト
describe('DataCache パフォーマンス', () => {
  test('大量データでのパフォーマンス', async () => {
    const cache = new DataCache(60000);
    const fetchFn = jest.fn().mockImplementation(async (key) => `value-${key}`);
    
    const startTime = Date.now();
    
    // 1000回の操作
    const promises = [];
    for (let i = 0; i < 1000; i++) {
      promises.push(cache.get(`key-${i % 100}`, () => fetchFn(i))); // 100ユニークキー
    }
    
    await Promise.all(promises);
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    // 1秒以内に完了することを確認
    expect(duration).toBeLessThan(1000);
    
    // キャッシュヒット率をチェック
    const stats = cache.getStats();
    expect(parseFloat(stats.hitRate)).toBeGreaterThan(80); // 80%以上のヒット率
    
    cache.clear();
  });
});