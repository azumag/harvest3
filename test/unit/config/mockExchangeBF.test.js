const { exchangeBF, isTestEnvironment } = require('../../../src/config');

describe('Mock Exchange BF (Bitflyer)', () => {
  beforeEach(() => {
    // テスト環境であることを確認
    process.env.NODE_ENV = 'test';
    // API認証情報を削除してテスト環境にする
    delete process.env.BB_API_KEY;
    delete process.env.BB_API_SECRET;
  });

  afterEach(() => {
    // 環境変数をクリア
    delete process.env.NODE_ENV;
    delete process.env.DOCKER_ENV;
    delete process.env.BB_API_KEY;
    delete process.env.BB_API_SECRET;
  });

  describe('Test Environment Detection', () => {
    it('should be in test environment', () => {
      expect(isTestEnvironment()).toBe(true);
    });

    it('should be in test environment when DOCKER_ENV=true', () => {
      delete process.env.NODE_ENV;
      process.env.DOCKER_ENV = 'true';
      expect(isTestEnvironment()).toBe(true);
    });
  });

  describe('Mock Exchange BF Properties', () => {
    it('should have required properties', () => {
      expect(exchangeBF).toBeDefined();
      expect(exchangeBF.id).toBe('bitflyer');
      expect(typeof exchangeBF.fetchBalance).toBe('function');
      expect(typeof exchangeBF.fetchTicker).toBe('function');
      expect(typeof exchangeBF.fetchOHLCV).toBe('function');
      expect(exchangeBF.enableRateLimit).toBe(true);
      expect(exchangeBF.rateLimit).toBeDefined();
    });
  });

  describe('Mock fetchOHLCV Method', () => {
    it('should return promise with OHLCV data', async () => {
      const result = await exchangeBF.fetchOHLCV('BTC/JPY', '5m', null, 10);
      
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(10);
      
      // 各要素が [timestamp, open, high, low, close, volume] 形式であることを確認
      result.forEach(ohlcv => {
        expect(Array.isArray(ohlcv)).toBe(true);
        expect(ohlcv.length).toBe(6);
        expect(typeof ohlcv[0]).toBe('number'); // timestamp
        expect(typeof ohlcv[1]).toBe('number'); // open
        expect(typeof ohlcv[2]).toBe('number'); // high
        expect(typeof ohlcv[3]).toBe('number'); // low
        expect(typeof ohlcv[4]).toBe('number'); // close
        expect(typeof ohlcv[5]).toBe('number'); // volume
      });
    });

    it('should handle different timeframes', async () => {
      const timeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
      
      for (const timeframe of timeframes) {
        const result = await exchangeBF.fetchOHLCV('BTC/JPY', timeframe, null, 5);
        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(5);
      }
    });

    it('should handle default limit', async () => {
      const result = await exchangeBF.fetchOHLCV('BTC/JPY', '5m');
      
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(100); // デフォルト値
    });

    it('should handle different symbols', async () => {
      const symbols = ['BTC/JPY', 'ETH/JPY', 'XRP/JPY'];
      
      for (const symbol of symbols) {
        const result = await exchangeBF.fetchOHLCV(symbol, '5m', null, 5);
        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(5);
      }
    });

    it('should generate realistic price data', async () => {
      const result = await exchangeBF.fetchOHLCV('BTC/JPY', '5m', null, 10);
      
      result.forEach(ohlcv => {
        const [timestamp, open, high, low, close, volume] = ohlcv;
        
        // 価格が正の値であることを確認
        expect(open).toBeGreaterThan(0);
        expect(high).toBeGreaterThan(0);
        expect(low).toBeGreaterThan(0);
        expect(close).toBeGreaterThan(0);
        expect(volume).toBeGreaterThan(0);
        
        // high >= max(open, close) であることを確認
        expect(high).toBeGreaterThanOrEqual(Math.max(open, close));
        
        // low <= min(open, close) であることを確認
        expect(low).toBeLessThanOrEqual(Math.min(open, close));
        
        // タイムスタンプが現在時刻以前であることを確認
        expect(timestamp).toBeLessThanOrEqual(Date.now());
      });
    });

    it('should generate chronological timestamps', async () => {
      const result = await exchangeBF.fetchOHLCV('BTC/JPY', '5m', null, 10);
      
      for (let i = 1; i < result.length; i++) {
        // タイムスタンプが昇順であることを確認
        expect(result[i][0]).toBeGreaterThan(result[i-1][0]);
      }
    });
  });

  describe('Mock fetchBalance Method', () => {
    it('should return balance data', async () => {
      const result = await exchangeBF.fetchBalance();
      
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
      expect(result.total).toBeDefined();
      expect(result.free).toBeDefined();
      expect(result.used).toBeDefined();
    });
  });

  describe('Mock fetchTicker Method', () => {
    it('should return ticker data', async () => {
      const result = await exchangeBF.fetchTicker();
      
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
      expect(result.last).toBeDefined();
      expect(result.bid).toBeDefined();
      expect(result.ask).toBeDefined();
    });
  });

  describe('Mock loadMarkets Method (Issue #874)', () => {
    beforeEach(() => {
      // 各テストの前に markets プロパティを null にリセット
      exchangeBF.markets = null;
    });

    it('should have loadMarkets method', () => {
      expect(exchangeBF.loadMarkets).toBeDefined();
      expect(typeof exchangeBF.loadMarkets).toBe('function');
    });

    it('should return market data', async () => {
      const markets = await exchangeBF.loadMarkets();
      
      expect(markets).toBeDefined();
      expect(typeof markets).toBe('object');
      expect(Object.keys(markets).length).toBeGreaterThan(0);
    });

    it('should set markets property after loading', async () => {
      // 初期状態では markets は null
      expect(exchangeBF.markets).toBeNull();
      
      // loadMarkets 呼び出し後
      const markets = await exchangeBF.loadMarkets();
      
      expect(exchangeBF.markets).toBeDefined();
      expect(exchangeBF.markets).toEqual(markets);
    });

    it('should include BTC/JPY market', async () => {
      const markets = await exchangeBF.loadMarkets();
      
      expect(markets['BTC/JPY']).toBeDefined();
      
      const btcJpyMarket = markets['BTC/JPY'];
      expect(btcJpyMarket.id).toBe('btc_jpy');
      expect(btcJpyMarket.symbol).toBe('BTC/JPY');
      expect(btcJpyMarket.base).toBe('BTC');
      expect(btcJpyMarket.quote).toBe('JPY');
      expect(btcJpyMarket.active).toBe(true);
    });

    it('should include ETH/JPY market', async () => {
      const markets = await exchangeBF.loadMarkets();
      
      expect(markets['ETH/JPY']).toBeDefined();
      
      const ethJpyMarket = markets['ETH/JPY'];
      expect(ethJpyMarket.id).toBe('eth_jpy');
      expect(ethJpyMarket.symbol).toBe('ETH/JPY');
      expect(ethJpyMarket.base).toBe('ETH');
      expect(ethJpyMarket.quote).toBe('JPY');
      expect(ethJpyMarket.active).toBe(true);
    });

    it('should have correct precision settings', async () => {
      const markets = await exchangeBF.loadMarkets();
      
      // BTC/JPY の精度設定確認
      expect(markets['BTC/JPY'].precision).toBeDefined();
      expect(markets['BTC/JPY'].precision.amount).toBe(8);
      expect(markets['BTC/JPY'].precision.price).toBe(0);
      
      // ETH/JPY の精度設定確認
      expect(markets['ETH/JPY'].precision).toBeDefined();
      expect(markets['ETH/JPY'].precision.amount).toBe(8);
      expect(markets['ETH/JPY'].precision.price).toBe(0);
    });

    it('should have correct fee settings', async () => {
      const markets = await exchangeBF.loadMarkets();
      
      // 手数料情報の確認
      expect(markets['BTC/JPY'].maker).toBe(0.001);
      expect(markets['BTC/JPY'].taker).toBe(0.001);
      expect(markets['ETH/JPY'].maker).toBe(0.001);
      expect(markets['ETH/JPY'].taker).toBe(0.001);
    });

    it('should have valid limits', async () => {
      const markets = await exchangeBF.loadMarkets();
      
      ['BTC/JPY', 'ETH/JPY'].forEach(symbol => {
        const market = markets[symbol];
        expect(market.limits).toBeDefined();
        expect(market.limits.amount).toBeDefined();
        expect(market.limits.price).toBeDefined();
        expect(market.limits.cost).toBeDefined();
        
        // 最小値・最大値が正の値であることを確認
        expect(market.limits.amount.min).toBeGreaterThan(0);
        expect(market.limits.amount.max).toBeGreaterThan(0);
        expect(market.limits.price.min).toBeGreaterThan(0);
        expect(market.limits.price.max).toBeGreaterThan(0);
      });
    });

    it('should work with existing code pattern', async () => {
      // 既存のコードパターンをシミュレート（DatabaseManagerやredisDatabase.jsで使用）
      if (!exchangeBF.markets) {
        await exchangeBF.loadMarkets();
      }
      
      expect(exchangeBF.markets).toBeDefined();
      expect(exchangeBF.markets['BTC/JPY']).toBeDefined();
    });

    it('should handle multiple calls correctly', async () => {
      const markets1 = await exchangeBF.loadMarkets();
      const markets2 = await exchangeBF.loadMarkets();
      
      expect(markets1).toEqual(markets2);
      expect(exchangeBF.markets).toEqual(markets1);
    });
  });
});