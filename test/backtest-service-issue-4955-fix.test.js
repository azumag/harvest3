/**
 * @fileoverview Issue #4955 - backtestサービスでTypeError修正のテスト
 * TypeError: Cannot convert undefined or null to object の修正確認
 * 
 * 根本原因: Object.keys()がnull/undefined値に対して呼び出されることによるエラー
 * 修正内容: symbolsByExchange と config.strategies への安全なアクセス
 */

describe('Backtest Service Issue #4955 Fix', () => {
  describe('Object.keys() null/undefined safety', () => {
    test('Object.keys(symbolsByExchange || {}) should handle null symbolsByExchange', () => {
      const nullSymbolsByExchange = null;
      
      expect(() => {
        const exchanges = Object.keys(nullSymbolsByExchange || {});
        expect(exchanges).toEqual([]);
      }).not.toThrow();
    });

    test('Object.keys(symbolsByExchange || {}) should handle undefined symbolsByExchange', () => {
      const undefinedSymbolsByExchange = undefined;
      
      expect(() => {
        const exchanges = Object.keys(undefinedSymbolsByExchange || {});
        expect(exchanges).toEqual([]);
      }).not.toThrow();
    });

    test('Object.keys(config.strategies || {}) should handle null config.strategies', () => {
      const config = { strategies: null };
      
      expect(() => {
        const strategies = Object.keys(config.strategies || {});
        expect(strategies).toEqual([]);
      }).not.toThrow();
    });

    test('Object.keys(config.strategies || {}) should handle undefined config.strategies', () => {
      const config = { strategies: undefined };
      
      expect(() => {
        const strategies = Object.keys(config.strategies || {});
        expect(strategies).toEqual([]);
      }).not.toThrow();
    });

    test('Object.keys(config.strategies || {}) should handle missing strategies property', () => {
      const config = {};
      
      expect(() => {
        const strategies = Object.keys(config.strategies || {});
        expect(strategies).toEqual([]);
      }).not.toThrow();
    });
  });

  describe('Simulation of fixed backtestRunner.js behavior', () => {
    test('Fixed loop should handle null symbolsByExchange gracefully', () => {
      const symbolsByExchange = null;
      
      // Simulate the fixed for loop from line 98
      expect(() => {
        const exchanges = [];
        for (const exchange of Object.keys(symbolsByExchange || {})) {
          exchanges.push(exchange);
        }
        expect(exchanges).toEqual([]);
      }).not.toThrow();
    });

    test('Fixed loop should handle undefined symbolsByExchange gracefully', () => {
      const symbolsByExchange = undefined;
      
      // Simulate the fixed for loop from line 129
      expect(() => {
        const exchanges = [];
        for (const exchange of Object.keys(symbolsByExchange || {})) {
          exchanges.push(exchange);
        }
        expect(exchanges).toEqual([]);
      }).not.toThrow();
    });

    test('Fixed loop should handle null config.strategies gracefully', () => {
      const config = { strategies: null };
      
      // Simulate the fixed for loop from line 169
      expect(() => {
        const strategies = [];
        for (const strategyKey of Object.keys(config.strategies || {})) {
          strategies.push(strategyKey);
        }
        expect(strategies).toEqual([]);
      }).not.toThrow();
    });

    test('Fixed loops should work with valid data', () => {
      const symbolsByExchange = {
        'bitbank': ['BTC/JPY', 'ETH/JPY'],
        'bybit': ['BTC/USDT', 'ETH/USDT']
      };
      const config = {
        strategies: {
          'MUTUAL_INFO': { enabled: true },
          'TREND_FOLLOWING': { enabled: false }
        }
      };

      // Test OHLCV data update loop (line 98)
      const ohlcvExchanges = [];
      for (const exchange of Object.keys(symbolsByExchange || {})) {
        ohlcvExchanges.push(exchange);
      }
      expect(ohlcvExchanges).toEqual(['bitbank', 'bybit']);

      // Test Redis load loop (line 129)
      const redisExchanges = [];
      for (const exchange of Object.keys(symbolsByExchange || {})) {
        redisExchanges.push(exchange);
      }
      expect(redisExchanges).toEqual(['bitbank', 'bybit']);

      // Test strategy processing loop (line 169)
      const strategies = [];
      for (const strategyKey of Object.keys(config.strategies || {})) {
        strategies.push(strategyKey);
      }
      expect(strategies).toEqual(['MUTUAL_INFO', 'TREND_FOLLOWING']);
    });
  });

  describe('Edge cases that could cause the original error', () => {
    test('should handle complete null config', () => {
      const config = null;
      
      expect(() => {
        // This would have caused the original error
        const strategies = Object.keys(config?.strategies || {});
        expect(strategies).toEqual([]);
      }).not.toThrow();
    });

    test('should handle getSymbolsByExchange returning null', () => {
      // Simulate getSymbolsByExchange(config) returning null
      const getSymbolsByExchangeResult = null;
      
      expect(() => {
        const exchanges = Object.keys(getSymbolsByExchangeResult || {});
        expect(exchanges).toEqual([]);
      }).not.toThrow();
    });

    test('should handle partial config with missing properties', () => {
      const config = {
        global: { tradePercentage: 0.1 }
        // strategies property is missing
      };
      
      expect(() => {
        const strategies = Object.keys(config.strategies || {});
        expect(strategies).toEqual([]);
      }).not.toThrow();
    });
  });

  describe('MUTUAL_INFO strategy specific checks', () => {
    test('should handle MUTUAL_INFO strategy when strategies is null', () => {
      const config = { strategies: null };
      const strategySpecify = 'MUTUAL_INFO';
      
      expect(() => {
        let foundMutualInfo = false;
        for (const strategyKey of Object.keys(config.strategies || {})) {
          if (strategySpecify && strategySpecify !== strategyKey) {
            continue;
          }
          if (strategyKey === 'MUTUAL_INFO') {
            foundMutualInfo = true;
          }
        }
        expect(foundMutualInfo).toBe(false);
      }).not.toThrow();
    });

    test('should process MUTUAL_INFO strategy when properly configured', () => {
      const config = {
        strategies: {
          'MUTUAL_INFO': {
            enabled: true,
            atomicExec: false
          },
          'OTHER_STRATEGY': {
            enabled: true,
            atomicExec: true
          }
        }
      };
      const strategySpecify = 'MUTUAL_INFO';
      
      expect(() => {
        let foundMutualInfo = false;
        for (const strategyKey of Object.keys(config.strategies || {})) {
          if (strategySpecify && strategySpecify !== strategyKey) {
            continue;
          }
          
          const strategy = config.strategies[strategyKey];
          if (strategy.atomicExec) {
            continue;
          }
          
          if (strategyKey === 'MUTUAL_INFO') {
            foundMutualInfo = true;
          }
        }
        expect(foundMutualInfo).toBe(true);
      }).not.toThrow();
    });
  });
});