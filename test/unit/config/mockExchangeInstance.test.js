const { config, isTestEnvironment } = require('../../../src/config');

describe('Mock Exchange Instance', () => {
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
    it('should detect test environment when NODE_ENV=test', () => {
      process.env.NODE_ENV = 'test';
      expect(isTestEnvironment()).toBe(true);
    });

    it('should detect test environment when DOCKER_ENV=true', () => {
      delete process.env.NODE_ENV;
      process.env.DOCKER_ENV = 'true';
      expect(isTestEnvironment()).toBe(true);
    });

    it('should detect test environment when API credentials are missing', () => {
      delete process.env.NODE_ENV;
      delete process.env.DOCKER_ENV;
      delete process.env.BB_API_KEY;
      delete process.env.BB_API_SECRET;
      expect(isTestEnvironment()).toBe(true);
    });

    it('should not detect test environment when API credentials are present', () => {
      delete process.env.NODE_ENV;
      delete process.env.DOCKER_ENV;
      process.env.BB_API_KEY = 'test-key';
      process.env.BB_API_SECRET = 'test-secret';
      expect(isTestEnvironment()).toBe(false);
    });
  });

  describe('Mock Exchange Instance Properties', () => {
    it('should have required properties', () => {
      const exchange = config.exchanges.bitbank.instance;
      
      expect(exchange).toBeDefined();
      expect(exchange.id).toBe('bitbank');
      expect(typeof exchange.fetchBalance).toBe('function');
      expect(typeof exchange.fetchTicker).toBe('function');
      expect(typeof exchange.loadMarkets).toBe('function');
      expect(typeof exchange.fetchOHLCV).toBe('function');
      expect(exchange.enableRateLimit).toBe(true);
      expect(exchange.markets).toBeNull();
    });

    it('should have proper configuration values', () => {
      const exchange = config.exchanges.bitbank.instance;
      
      expect(exchange.rateLimit).toBeDefined();
      expect(exchange.timeout).toBeDefined();
      expect(exchange.options).toBeDefined();
      expect(exchange.options.defaultType).toBe('spot');
      expect(exchange.options.adjustForTimeDifference).toBe(true);
    });
  });

  describe('Mock fetchOHLCV Method', () => {
    it('should return promise with OHLCV data', async () => {
      const exchange = config.exchanges.bitbank.instance;
      const result = await exchange.fetchOHLCV('BTC/JPY', '5m', null, 10);
      
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
      const exchange = config.exchanges.bitbank.instance;
      
      const timeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
      
      for (const timeframe of timeframes) {
        const result = await exchange.fetchOHLCV('BTC/JPY', timeframe, null, 5);
        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(5);
      }
    });

    it('should handle default limit', async () => {
      const exchange = config.exchanges.bitbank.instance;
      const result = await exchange.fetchOHLCV('BTC/JPY', '5m');
      
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(100); // デフォルト値
    });

    it('should handle different symbols', async () => {
      const exchange = config.exchanges.bitbank.instance;
      const symbols = ['BTC/JPY', 'ETH/JPY', 'XRP/JPY'];
      
      for (const symbol of symbols) {
        const result = await exchange.fetchOHLCV(symbol, '5m', null, 5);
        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(5);
      }
    });

    it('should generate realistic price data', async () => {
      const exchange = config.exchanges.bitbank.instance;
      const result = await exchange.fetchOHLCV('BTC/JPY', '5m', null, 10);
      
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
      const exchange = config.exchanges.bitbank.instance;
      const result = await exchange.fetchOHLCV('BTC/JPY', '5m', null, 10);
      
      for (let i = 1; i < result.length; i++) {
        // タイムスタンプが昇順であることを確認
        expect(result[i][0]).toBeGreaterThan(result[i-1][0]);
      }
    });
  });

  describe('Mock loadMarkets Method', () => {
    it('should load markets and return market data', async () => {
      const exchange = config.exchanges.bitbank.instance;
      const markets = await exchange.loadMarkets();
      
      expect(markets).toBeDefined();
      expect(typeof markets).toBe('object');
      expect(markets['BTC/JPY']).toBeDefined();
      expect(markets['ETH/JPY']).toBeDefined();
      expect(markets['DOT/JPY']).toBeDefined();
      
      // 市場データの構造を確認
      const btcMarket = markets['BTC/JPY'];
      expect(btcMarket.id).toBe('btc_jpy');
      expect(btcMarket.symbol).toBe('BTC/JPY');
      expect(btcMarket.base).toBe('BTC');
      expect(btcMarket.quote).toBe('JPY');
      expect(btcMarket.active).toBe(true);
    });

    it('should set markets property after loading', async () => {
      const exchange = config.exchanges.bitbank.instance;
      
      // markets が初期値（null）でなく、loadMarkets後に設定されていることを確認
      const markets = await exchange.loadMarkets();
      expect(exchange.markets).toBeDefined();
      expect(typeof exchange.markets).toBe('object');
      expect(exchange.markets).toEqual(markets);
    });
  });
});