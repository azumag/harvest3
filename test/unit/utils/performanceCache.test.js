/**
 * パフォーマンスキャッシュのテスト
 * ループ処理でのデータ取得効率化をテスト
 */

const {
  getCachedStrategyConfig,
  getCachedOrderBook,
  clearStrategyConfigCache,
  clearOrderBookCache,
  getCacheStats
} = require('../../../src/utils/performanceCache');

describe('パフォーマンスキャッシュ機能テスト', () => {
  beforeEach(() => {
    // 各テスト前にキャッシュをクリア
    clearStrategyConfigCache();
    clearOrderBookCache();
  });

  describe('戦略設定キャッシュ', () => {
    test('初回呼び出しでデータを取得してキャッシュする', async () => {
      const mockConfig = { enabled: true, amount: 100 };
      const fetchFunction = jest.fn().mockResolvedValue(mockConfig);

      const result = await getCachedStrategyConfig('bitbank', 'BTC/JPY', 'MEAN_REVERSION', fetchFunction);

      expect(result).toEqual(mockConfig);
      expect(fetchFunction).toHaveBeenCalledTimes(1);
    });

    test('2回目の呼び出しではキャッシュから取得する', async () => {
      const mockConfig = { enabled: true, amount: 100 };
      const fetchFunction = jest.fn().mockResolvedValue(mockConfig);

      // 1回目
      await getCachedStrategyConfig('bitbank', 'BTC/JPY', 'MEAN_REVERSION', fetchFunction);
      // 2回目
      const result = await getCachedStrategyConfig('bitbank', 'BTC/JPY', 'MEAN_REVERSION', fetchFunction);

      expect(result).toEqual(mockConfig);
      expect(fetchFunction).toHaveBeenCalledTimes(1); // 1回だけ呼ばれる
    });

    test('異なる取引所/シンボル/戦略の組み合わせは個別にキャッシュされる', async () => {
      const mockConfig1 = { enabled: true, amount: 100 };
      const mockConfig2 = { enabled: false, amount: 200 };
      const fetchFunction1 = jest.fn().mockResolvedValue(mockConfig1);
      const fetchFunction2 = jest.fn().mockResolvedValue(mockConfig2);

      const result1 = await getCachedStrategyConfig('bitbank', 'BTC/JPY', 'MEAN_REVERSION', fetchFunction1);
      const result2 = await getCachedStrategyConfig('bitflyer', 'BTC/JPY', 'MEAN_REVERSION', fetchFunction2);

      expect(result1).toEqual(mockConfig1);
      expect(result2).toEqual(mockConfig2);
      expect(fetchFunction1).toHaveBeenCalledTimes(1);
      expect(fetchFunction2).toHaveBeenCalledTimes(1);
    });

    test('null値も正しくキャッシュされる', async () => {
      const fetchFunction = jest.fn().mockResolvedValue(null);

      const result1 = await getCachedStrategyConfig('bitbank', 'BTC/JPY', 'INVALID', fetchFunction);
      const result2 = await getCachedStrategyConfig('bitbank', 'BTC/JPY', 'INVALID', fetchFunction);

      expect(result1).toBeNull();
      expect(result2).toBeNull();
      expect(fetchFunction).toHaveBeenCalledTimes(2); // null値はキャッシュされない
    });
  });

  describe('注文ブックキャッシュ', () => {
    test('初回呼び出しでデータを取得してキャッシュする', async () => {
      const mockOrderBook = {
        bids: [[100, 1.5], [99, 2.0]],
        asks: [[101, 1.2], [102, 0.8]]
      };
      const fetchFunction = jest.fn().mockResolvedValue(mockOrderBook);

      const result = await getCachedOrderBook('bitbank', 'BTC/JPY', 20, fetchFunction);

      expect(result).toEqual(mockOrderBook);
      expect(fetchFunction).toHaveBeenCalledTimes(1);
    });

    test('2回目の呼び出しではキャッシュから取得する', async () => {
      const mockOrderBook = {
        bids: [[100, 1.5], [99, 2.0]],
        asks: [[101, 1.2], [102, 0.8]]
      };
      const fetchFunction = jest.fn().mockResolvedValue(mockOrderBook);

      // 1回目
      await getCachedOrderBook('bitbank', 'BTC/JPY', 20, fetchFunction);
      // 2回目
      const result = await getCachedOrderBook('bitbank', 'BTC/JPY', 20, fetchFunction);

      expect(result).toEqual(mockOrderBook);
      expect(fetchFunction).toHaveBeenCalledTimes(1); // 1回だけ呼ばれる
    });

    test('異なるdepthは個別にキャッシュされる', async () => {
      const mockOrderBook20 = { bids: [[100, 1.5]], asks: [[101, 1.2]] };
      const mockOrderBook50 = { bids: [[100, 1.5], [99, 2.0]], asks: [[101, 1.2], [102, 0.8]] };
      const fetchFunction20 = jest.fn().mockResolvedValue(mockOrderBook20);
      const fetchFunction50 = jest.fn().mockResolvedValue(mockOrderBook50);

      const result20 = await getCachedOrderBook('bitbank', 'BTC/JPY', 20, fetchFunction20);
      const result50 = await getCachedOrderBook('bitbank', 'BTC/JPY', 50, fetchFunction50);

      expect(result20).toEqual(mockOrderBook20);
      expect(result50).toEqual(mockOrderBook50);
      expect(fetchFunction20).toHaveBeenCalledTimes(1);
      expect(fetchFunction50).toHaveBeenCalledTimes(1);
    });
  });

  describe('キャッシュクリア機能', () => {
    test('戦略設定の特定キーをクリアできる', async () => {
      const mockConfig = { enabled: true, amount: 100 };
      const fetchFunction = jest.fn().mockResolvedValue(mockConfig);

      // キャッシュに保存
      await getCachedStrategyConfig('bitbank', 'BTC/JPY', 'MEAN_REVERSION', fetchFunction);

      // 特定キーをクリア
      clearStrategyConfigCache('bitbank', 'BTC/JPY', 'MEAN_REVERSION');

      // 再度呼び出すと、fetchFunctionが再実行される
      await getCachedStrategyConfig('bitbank', 'BTC/JPY', 'MEAN_REVERSION', fetchFunction);

      expect(fetchFunction).toHaveBeenCalledTimes(2);
    });

    test('注文ブックの特定キーをクリアできる', async () => {
      const mockOrderBook = { bids: [[100, 1.5]], asks: [[101, 1.2]] };
      const fetchFunction = jest.fn().mockResolvedValue(mockOrderBook);

      // キャッシュに保存
      await getCachedOrderBook('bitbank', 'BTC/JPY', 20, fetchFunction);

      // 特定キーをクリア
      clearOrderBookCache('bitbank', 'BTC/JPY');

      // 再度呼び出すと、fetchFunctionが再実行される
      await getCachedOrderBook('bitbank', 'BTC/JPY', 20, fetchFunction);

      expect(fetchFunction).toHaveBeenCalledTimes(2);
    });
  });

  describe('キャッシュ統計情報', () => {
    test('キャッシュヒット/ミス統計を取得できる', async () => {
      const mockConfig = { enabled: true, amount: 100 };
      const fetchFunction = jest.fn().mockResolvedValue(mockConfig);

      // 初期状態
      let stats = getCacheStats();
      expect(stats.strategyConfig.keys).toBe(0);

      // キャッシュミス
      await getCachedStrategyConfig('bitbank', 'BTC/JPY', 'MEAN_REVERSION', fetchFunction);

      // キャッシュヒット
      await getCachedStrategyConfig('bitbank', 'BTC/JPY', 'MEAN_REVERSION', fetchFunction);

      stats = getCacheStats();
      expect(stats.strategyConfig.keys).toBe(1);
      expect(stats.strategyConfig.hits).toBeGreaterThan(0);
      expect(stats.strategyConfig.misses).toBeGreaterThan(0);
    });
  });

  describe('パフォーマンス測定', () => {
    test('複数回の呼び出しでキャッシュによる高速化を確認', async () => {
      const mockConfig = { enabled: true, amount: 100 };
      const fetchFunction = jest.fn().mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve(mockConfig), 10))
      );

      const startTime = Date.now();

      // 1回目（キャッシュミス）
      await getCachedStrategyConfig('bitbank', 'BTC/JPY', 'MEAN_REVERSION', fetchFunction);
      const firstCallTime = Date.now() - startTime;

      // 2回目（キャッシュヒット）
      const secondStartTime = Date.now();
      await getCachedStrategyConfig('bitbank', 'BTC/JPY', 'MEAN_REVERSION', fetchFunction);
      const secondCallTime = Date.now() - secondStartTime;

      // 2回目の方が高速であることを確認
      expect(secondCallTime).toBeLessThan(firstCallTime);
      expect(fetchFunction).toHaveBeenCalledTimes(1);
    });
  });
});