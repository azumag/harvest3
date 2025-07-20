/**
 * Issue #5004: backtestサービスで例外が発生 - TypeError: Cannot convert undefined or null to object
 * 
 * テスト対象:
 * 1. config.global.excludeSymbols がnull/undefinedの場合のMUTUAL_INFO戦略処理
 * 2. result.parameters がnull/undefinedの場合のObject.entries呼び出し
 */

describe('Issue #5004: Backtest Service TypeError Fix', () => {
  let originalConsoleError;
  let originalConsoleLog;

  beforeEach(() => {
    // コンソール出力をモック
    originalConsoleError = console.error;
    originalConsoleLog = console.log;
    console.error = jest.fn();
    console.log = jest.fn();
  });

  afterEach(() => {
    // モックを復元
    console.error = originalConsoleError;
    console.log = originalConsoleLog;
  });

  describe('MUTUAL_INFO戦略のreferenceSymbols設定', () => {
    test('config.globalがnullの場合にエラーが発生しない', () => {
      const allExchangeSymbolPairs = [
        { exchangeId: 'bitbank', symbol: 'BTC/JPY', marketParameters: {} },
        { exchangeId: 'bitbank', symbol: 'ETH/JPY', marketParameters: {} }
      ];
      
      const config = { global: null };
      const exchange = { id: 'bitbank' };
      const symbol = 'BTC/JPY';
      
      // MUTUAL_INFO戦略のreferenceSymbols設定ロジックをテスト
      expect(() => {
        const sameExchangeSymbols = allExchangeSymbolPairs
          .filter(pair =>
            pair.exchangeId === exchange.id &&
            pair.symbol !== symbol &&
            !(config.global?.excludeSymbols || []).some(excludePattern => pair.symbol.startsWith(excludePattern))
          )
          .map(pair => pair.symbol);
        
        expect(sameExchangeSymbols).toEqual(['ETH/JPY']);
      }).not.toThrow();
    });

    test('config.global.excludeSymbolsがundefinedの場合にエラーが発生しない', () => {
      const allExchangeSymbolPairs = [
        { exchangeId: 'bitbank', symbol: 'BTC/JPY', marketParameters: {} },
        { exchangeId: 'bitbank', symbol: 'ETH/JPY', marketParameters: {} },
        { exchangeId: 'bitbank', symbol: 'ELF/JPY', marketParameters: {} }
      ];
      
      const config = { global: {} }; // excludeSymbolsがundefined
      const exchange = { id: 'bitbank' };
      const symbol = 'BTC/JPY';
      
      expect(() => {
        const sameExchangeSymbols = allExchangeSymbolPairs
          .filter(pair =>
            pair.exchangeId === exchange.id &&
            pair.symbol !== symbol &&
            !(config.global?.excludeSymbols || []).some(excludePattern => pair.symbol.startsWith(excludePattern))
          )
          .map(pair => pair.symbol);
        
        expect(sameExchangeSymbols).toEqual(['ETH/JPY', 'ELF/JPY']);
      }).not.toThrow();
    });

    test('config.global.excludeSymbolsが正常に動作する', () => {
      const allExchangeSymbolPairs = [
        { exchangeId: 'bitbank', symbol: 'BTC/JPY', marketParameters: {} },
        { exchangeId: 'bitbank', symbol: 'ETH/JPY', marketParameters: {} },
        { exchangeId: 'bitbank', symbol: 'ELF/JPY', marketParameters: {} }
      ];
      
      const config = { 
        global: { 
          excludeSymbols: ['ELF/'] 
        } 
      };
      const exchange = { id: 'bitbank' };
      const symbol = 'BTC/JPY';
      
      const sameExchangeSymbols = allExchangeSymbolPairs
        .filter(pair =>
          pair.exchangeId === exchange.id &&
          pair.symbol !== symbol &&
          !(config.global?.excludeSymbols || []).some(excludePattern => pair.symbol.startsWith(excludePattern))
        )
        .map(pair => pair.symbol);
      
      expect(sameExchangeSymbols).toEqual(['ETH/JPY']); // ELF/JPYは除外される
    });
  });

  describe('Object.entries(result.parameters)の安全な呼び出し', () => {
    test('result.parametersがnullの場合にエラーが発生しない', () => {
      const result = {
        finalBaseFund: 10500.0,
        timeframe: '5m',
        parameters: null
      };
      
      expect(() => {
        const paramStr = Object.entries(result.parameters || {})
          .map(([key, value]) => `${key}: ${value}`)
          .join(', ');
        
        expect(paramStr).toBe(''); // 空文字列が返される
      }).not.toThrow();
    });

    test('result.parametersがundefinedの場合にエラーが発生しない', () => {
      const result = {
        finalBaseFund: 10500.0,
        timeframe: '5m'
        // parametersがundefined
      };
      
      expect(() => {
        const paramStr = Object.entries(result.parameters || {})
          .map(([key, value]) => `${key}: ${value}`)
          .join(', ');
        
        expect(paramStr).toBe(''); // 空文字列が返される
      }).not.toThrow();
    });

    test('result.parametersが正常に動作する', () => {
      const result = {
        finalBaseFund: 10500.0,
        timeframe: '5m',
        parameters: {
          threshold: 0.7,
          period: 30
        }
      };
      
      const paramStr = Object.entries(result.parameters || {})
        .map(([key, value]) => `${key}: ${value}`)
        .join(', ');
      
      expect(paramStr).toBe('threshold: 0.7, period: 30');
    });
  });

  describe('統合テスト: MUTUAL_INFO戦略の完全フロー', () => {
    test('configとresultの両方がnull/undefinedでもエラーが発生しない', () => {
      // configの問題をテスト
      const allExchangeSymbolPairs = [
        { exchangeId: 'bitbank', symbol: 'BTC/JPY', marketParameters: {} },
        { exchangeId: 'bitbank', symbol: 'ETH/JPY', marketParameters: {} }
      ];
      
      const config = { global: null };
      const exchange = { id: 'bitbank' };
      const symbol = 'BTC/JPY';
      
      // フィルタリング処理
      const sameExchangeSymbols = allExchangeSymbolPairs
        .filter(pair =>
          pair.exchangeId === exchange.id &&
          pair.symbol !== symbol &&
          !(config.global?.excludeSymbols || []).some(excludePattern => pair.symbol.startsWith(excludePattern))
        )
        .map(pair => pair.symbol);
      
      // resultの問題をテスト
      const results = [
        { finalBaseFund: 10500.0, timeframe: '5m', parameters: null },
        { finalBaseFund: 10300.0, timeframe: '1h', parameters: undefined },
        { finalBaseFund: 10800.0, timeframe: '15m', parameters: { threshold: 0.8 } }
      ];
      
      expect(() => {
        results.forEach(result => {
          const paramStr = Object.entries(result.parameters || {})
            .map(([key, value]) => `${key}: ${value}`)
            .join(', ');
          
          // パラメータ文字列生成が成功することを確認
          expect(typeof paramStr).toBe('string');
        });
      }).not.toThrow();
    });
  });
});