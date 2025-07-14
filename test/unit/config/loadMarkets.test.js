const { exchangeBB } = require('../../../src/config');

describe('loadMarkets メソッドのテスト (Issue #880)', () => {
  beforeEach(() => {
    // テスト環境での初期化を確認
    expect(process.env.NODE_ENV).toBe('test');
    
    // 各テストの前に markets プロパティを null にリセット
    // これにより、テストが独立して実行される
    exchangeBB.markets = null;
  });

  test('loadMarkets メソッドが存在すること', () => {
    expect(exchangeBB).toBeDefined();
    expect(exchangeBB.loadMarkets).toBeDefined();
    expect(typeof exchangeBB.loadMarkets).toBe('function');
  });

  test('loadMarkets メソッドが正しく動作すること', async () => {
    const markets = await exchangeBB.loadMarkets();
    
    expect(markets).toBeDefined();
    expect(typeof markets).toBe('object');
    expect(Object.keys(markets).length).toBeGreaterThan(0);
  });

  test('マーケット情報が期待される形式であること', async () => {
    const markets = await exchangeBB.loadMarkets();
    
    // BTC/JPY マーケット情報の検証
    expect(markets['BTC/JPY']).toBeDefined();
    const btcJpyMarket = markets['BTC/JPY'];
    
    expect(btcJpyMarket.id).toBe('btc_jpy');
    expect(btcJpyMarket.symbol).toBe('BTC/JPY');
    expect(btcJpyMarket.base).toBe('BTC');
    expect(btcJpyMarket.quote).toBe('JPY');
    expect(btcJpyMarket.active).toBe(true);
    
    // precision プロパティの検証
    expect(btcJpyMarket.precision).toBeDefined();
    expect(btcJpyMarket.precision.amount).toBe(4);
    expect(btcJpyMarket.precision.price).toBe(0);
    
    // limits プロパティの検証
    expect(btcJpyMarket.limits).toBeDefined();
    expect(btcJpyMarket.limits.amount).toBeDefined();
    expect(btcJpyMarket.limits.price).toBeDefined();
    expect(btcJpyMarket.limits.cost).toBeDefined();
    
    // 手数料情報の検証
    expect(btcJpyMarket.maker).toBe(0.0012);
    expect(btcJpyMarket.taker).toBe(0.0012);
  });

  test('marketsプロパティが設定されること', async () => {
    // 初期状態では markets は null
    expect(exchangeBB.markets).toBeNull();
    
    // loadMarkets 呼び出し後
    const markets = await exchangeBB.loadMarkets();
    
    expect(exchangeBB.markets).toBeDefined();
    expect(exchangeBB.markets).toEqual(markets);
  });

  test('主要なbitbankシンボルが含まれていること', async () => {
    const markets = await exchangeBB.loadMarkets();
    
    const expectedSymbols = [
      'BTC/JPY',
      'ETH/JPY',
      'XRP/JPY',
      'LTC/JPY',
      'BCH/JPY',
      'MONA/JPY',
      'DOT/JPY'
    ];
    
    expectedSymbols.forEach(symbol => {
      expect(markets[symbol]).toBeDefined();
      expect(markets[symbol].symbol).toBe(symbol);
      expect(markets[symbol].active).toBe(true);
    });
  });

  test('精度情報が適切に設定されていること', async () => {
    const markets = await exchangeBB.loadMarkets();
    
    // XRP/JPY と MONA/JPY は価格精度が3である
    expect(markets['XRP/JPY'].precision.price).toBe(3);
    expect(markets['MONA/JPY'].precision.price).toBe(3);
    
    // その他は価格精度が0である
    expect(markets['BTC/JPY'].precision.price).toBe(0);
    expect(markets['ETH/JPY'].precision.price).toBe(0);
    expect(markets['LTC/JPY'].precision.price).toBe(0);
    expect(markets['BCH/JPY'].precision.price).toBe(0);
    expect(markets['DOT/JPY'].precision.price).toBe(0);
  });

  test('既存のコードでloadMarketsを呼び出せること', async () => {
    // 既存のコードパターンをシミュレート
    if (!exchangeBB.markets) {
      await exchangeBB.loadMarkets();
    }
    
    expect(exchangeBB.markets).toBeDefined();
    expect(exchangeBB.markets['BTC/JPY']).toBeDefined();
  });

  test('複数回呼び出しても問題ないこと', async () => {
    const markets1 = await exchangeBB.loadMarkets();
    const markets2 = await exchangeBB.loadMarkets();
    
    expect(markets1).toEqual(markets2);
    expect(exchangeBB.markets).toEqual(markets1);
  });
});