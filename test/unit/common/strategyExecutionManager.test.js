const { StrategyExecutionManager } = require('../../../src/common/strategyExecutionManager');

describe('StrategyExecutionManager', () => {
  let manager;
  let mockConfig;
  let mockAllExchangeSymbolPairs;

  beforeEach(() => {
    manager = new StrategyExecutionManager();
    
    mockConfig = {
      exchanges: {
        bitbank: {
          instance: {
            id: 'bitbank',
            fetchTicker: jest.fn(),
            fetchOHLCV: jest.fn()
          }
        }
      },
      strategies: {
        BOLLINGER_BANDS: {
          enabled: true,
          exchanges: [{ id: 'bitbank' }],
          function: jest.fn(),
          ohlcvInterval: '15m',
          period: 20
        },
        MA: {
          enabled: true,
          exchanges: [{ id: 'bitbank' }],
          function: jest.fn()
        },
        DISABLED_STRATEGY: {
          enabled: false,
          exchanges: [{ id: 'bitbank' }],
          function: jest.fn()
        }
      }
    };

    mockAllExchangeSymbolPairs = [
      {
        exchangeId: 'bitbank',
        symbol: 'BTC/JPY',
        marketParameters: { precision: 0 }
      },
      {
        exchangeId: 'bitbank',
        symbol: 'ETH/JPY',
        marketParameters: { precision: 0 }
      }
    ];
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('戦略優先度設定', () => {
    test('戦略優先度の取得', () => {
      expect(manager.getStrategyPriority('BOLLINGER_BANDS')).toBe(10);
      expect(manager.getStrategyPriority('MA')).toBe(8);
      expect(manager.getStrategyPriority('UNKNOWN_STRATEGY')).toBe(3);
    });
  });

  describe('戦略グループ化', () => {
    test('有効な戦略のみがグループ化される', () => {
      const groups = manager.groupStrategiesByPriority(mockAllExchangeSymbolPairs, mockConfig);
      
      // 無効な戦略は除外される
      const allStrategies = groups.flat();
      expect(allStrategies).not.toContainEqual(
        expect.objectContaining({ strategyKey: 'DISABLED_STRATEGY' })
      );
      
      // 有効な戦略は含まれる
      expect(allStrategies).toContainEqual(
        expect.objectContaining({ strategyKey: 'BOLLINGER_BANDS' })
      );
      expect(allStrategies).toContainEqual(
        expect.objectContaining({ strategyKey: 'MA' })
      );
    });

    test('優先度順にソートされる', () => {
      const groups = manager.groupStrategiesByPriority(mockAllExchangeSymbolPairs, mockConfig);
      const allStrategies = groups.flat();
      
      const bollingerIndex = allStrategies.findIndex(s => s.strategyKey === 'BOLLINGER_BANDS');
      const maIndex = allStrategies.findIndex(s => s.strategyKey === 'MA');
      
      expect(bollingerIndex).toBeLessThan(maIndex); // BOLLINGER_BANDSの方が高優先度
    });

    test('最大同時実行数でグループ分けされる', () => {
      manager.maxConcurrentStrategies = 2;
      
      const groups = manager.groupStrategiesByPriority(mockAllExchangeSymbolPairs, mockConfig);
      
      groups.forEach(group => {
        expect(group.length).toBeLessThanOrEqual(2);
      });
    });

    test('戦略関数がない戦略は除外される', () => {
      const configWithInvalidStrategy = {
        ...mockConfig,
        strategies: {
          ...mockConfig.strategies,
          INVALID_STRATEGY: {
            enabled: true,
            exchanges: [{ id: 'bitbank' }]
            // function property missing
          }
        }
      };
      
      const groups = manager.groupStrategiesByPriority(mockAllExchangeSymbolPairs, configWithInvalidStrategy);
      const allStrategies = groups.flat();
      
      expect(allStrategies).not.toContainEqual(
        expect.objectContaining({ strategyKey: 'INVALID_STRATEGY' })
      );
    });
  });

  describe('戦略実行', () => {
    test('戦略がキャッシュデータで実行される', async () => {
      const tickerData = { symbol: 'BTC/JPY', bid: 5000000, ask: 5001000 };
      const ohlcvData = [[Date.now(), 5000000, 5010000, 4990000, 5005000, 1.5]];
      
      // APIDataCacheのモック
      jest.doMock('../../../src/common/apiDataCache', () => ({
        globalAPIDataCache: {
          queueRequest: jest.fn()
            .mockResolvedValueOnce(tickerData)
            .mockResolvedValueOnce(ohlcvData),
          getStats: jest.fn().mockReturnValue({
            hits: 1,
            misses: 0,
            requests: 2,
            hitRate: '100%'
          })
        }
      }));

      const strategyData = {
        exchangeId: 'bitbank',
        symbol: 'BTC/JPY',
        strategyKey: 'BOLLINGER_BANDS',
        strategy: mockConfig.strategies.BOLLINGER_BANDS,
        exchangeConfig: mockConfig.exchanges.bitbank,
        marketParameters: { precision: 0 },
        supportedExchange: { id: 'bitbank' }
      };

      mockConfig.strategies.BOLLINGER_BANDS.function.mockResolvedValue({ success: true });

      const result = await manager.executeStrategyWithCache(strategyData);

      expect(result.success).toBe(true);
      expect(result.strategyKey).toBe('BOLLINGER_BANDS');
      expect(result.symbol).toBe('BTC/JPY');
    });

    test('戦略実行エラーの処理', async () => {
      const strategyData = {
        exchangeId: 'bitbank',
        symbol: 'BTC/JPY',
        strategyKey: 'MA',
        strategy: mockConfig.strategies.MA,
        exchangeConfig: mockConfig.exchanges.bitbank,
        marketParameters: { precision: 0 },
        supportedExchange: { id: 'bitbank' }
      };

      const error = new Error('Strategy execution failed');
      mockConfig.strategies.MA.function.mockRejectedValue(error);

      const result = await manager.executeStrategyWithCache(strategyData);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Strategy execution failed');
    });
  });

  describe('非同期スケジューリング', () => {
    test('戦略実行が時間差で開始される', (done) => {
      const startTimes = [];
      const originalSetTimeout = global.setTimeout;
      
      global.setTimeout = jest.fn((callback, delay) => {
        startTimes.push(delay);
        originalSetTimeout(callback, 0); // テストを早く終わらせるため
      });

      manager.scheduleStrategyExecution(mockAllExchangeSymbolPairs, mockConfig);

      setTimeout(() => {
        expect(startTimes.length).toBeGreaterThan(0);
        expect(startTimes[0]).toBe(0);
        if (startTimes.length > 1) {
          expect(startTimes[1]).toBe(manager.staggerInterval);
        }
        
        global.setTimeout = originalSetTimeout;
        done();
      }, 100);
    });
  });

  describe('実行サマリー', () => {
    test('正常実行のサマリー', () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
      
      const results = [
        { value: { success: true, strategyKey: 'BOLLINGER_BANDS', symbol: 'BTC/JPY' } },
        { value: { success: true, strategyKey: 'MA', symbol: 'ETH/JPY' } }
      ];

      // APIDataCacheのモック
      jest.doMock('../../../src/common/apiDataCache', () => ({
        globalAPIDataCache: {
          getStats: jest.fn().mockReturnValue({
            hits: 8,
            misses: 2,
            requests: 10,
            hitRate: '80%',
            cacheSize: 5
          })
        }
      }));

      manager.logExecutionSummary(results);

      consoleLogSpy.mockRestore();
    });

    test('エラーを含む実行のサマリー', () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
      
      const results = [
        { value: { success: true, strategyKey: 'BOLLINGER_BANDS', symbol: 'BTC/JPY' } },
        { value: { success: false, strategyKey: 'MA', symbol: 'ETH/JPY', error: 'API Error' } }
      ];

      // APIDataCacheのモック
      jest.doMock('../../../src/common/apiDataCache', () => ({
        globalAPIDataCache: {
          getStats: jest.fn().mockReturnValue({
            hits: 3,
            misses: 7,
            requests: 10,
            hitRate: '30%',
            cacheSize: 2
          })
        }
      }));

      manager.logExecutionSummary(results);

      consoleLogSpy.mockRestore();
    });
  });

  describe('exchangeInstanceの渡し方', () => {
    test('戦略関数に実際のexchangeInstance（fetchBalanceメソッド付き）が渡される', async () => {
      // fetchBalanceメソッドを持つexchangeInstanceをモック
      const mockExchangeInstance = {
        id: 'bitbank',
        fetchTicker: jest.fn(),
        fetchOHLCV: jest.fn(),
        fetchBalance: jest.fn().mockResolvedValue({
          total: { JPY: 100000, BTC: 0.1 }
        })
      };

      // supportedExchangeはfetchBalanceメソッドを持たない設定オブジェクト
      const mockSupportedExchange = { id: 'bitbank' };

      const strategyData = {
        exchangeId: 'bitbank',
        symbol: 'BTC/JPY',
        strategyKey: 'BOLLINGER_BANDS',
        strategy: {
          ...mockConfig.strategies.BOLLINGER_BANDS,
          function: jest.fn().mockResolvedValue({ success: true })
        },
        exchangeConfig: {
          instance: mockExchangeInstance
        },
        marketParameters: { precision: 0 },
        supportedExchange: mockSupportedExchange
      };

      // APIDataCacheのモック
      jest.doMock('../../../src/common/apiDataCache', () => ({
        globalAPIDataCache: {
          queueRequest: jest.fn()
            .mockResolvedValueOnce({ symbol: 'BTC/JPY', bid: 5000000, ask: 5001000 })
            .mockResolvedValueOnce([[Date.now(), 5000000, 5010000, 4990000, 5005000, 1.5]]),
          getStats: jest.fn().mockReturnValue({
            hits: 1,
            misses: 0,
            requests: 2,
            hitRate: '100%'
          })
        }
      }));

      await manager.executeStrategyWithCache(strategyData);

      // 戦略関数が呼び出されることを確認
      expect(strategyData.strategy.function).toHaveBeenCalled();

      // 第1引数（exchange）が実際のexchangeInstanceであることを確認
      const firstArgument = strategyData.strategy.function.mock.calls[0][0];
      expect(firstArgument).toBe(mockExchangeInstance);
      expect(firstArgument.fetchBalance).toBeDefined();
      expect(typeof firstArgument.fetchBalance).toBe('function');

      // supportedExchangeではないことを確認
      expect(firstArgument).not.toBe(mockSupportedExchange);
      expect(firstArgument.id).toBe('bitbank');
    });
  });
});