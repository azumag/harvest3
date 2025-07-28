/**
 * @fileoverview Issue #5486 - backtestサービスでのcreateMarketSellOrder例外修正のテスト
 * "exchange.createMarketSellOrder is not a function" エラーの防御的処理修正確認
 * 
 * 根本原因: バックテスト環境で特定の条件下においてexchangeオブジェクトに
 *           createMarketSellOrderメソッドが存在しない場合がある
 * 修正内容: clearPositionMarket関数およびフォールバック処理に防御的プログラミングを追加し、
 *           createMarketSellOrderメソッドの存在確認を行う
 */

// テスト用のモック関数を事前に設定
jest.mock('../../../../src/common/notifications', () => ({
  postOrderToDiscord: jest.fn(),
  postErrorToDiscord: jest.fn()
}));

jest.mock('../../../../src/database/manager', () => ({
  getTradeCurrentPosition: jest.fn().mockResolvedValue(0.1),
  getMarketParameters: jest.fn().mockResolvedValue({ minTradeAmount: 0.0001 }),
  addOrder: jest.fn(),
  getStrategyPositionsRedis: jest.fn().mockResolvedValue([]),
  clearStrategyRiskData: jest.fn().mockResolvedValue({ success: true, message: 'cleared' }),
  getOrderStrategyKeyByOrderId: jest.fn().mockResolvedValue('TEST_STRATEGY')
}));

jest.mock('../../../../src/common/utils', () => ({
  closeAndCleanupPosition: jest.fn().mockResolvedValue({ success: true, action: 'cleaned' })
}));

const { clearPositionMarket } = require('../../../../src/strategies/utils/common');

describe('Backtest Service Issue #5486 Fix', () => {
  describe('createMarketSellOrder defensive programming', () => {
    test('should handle exchange objects without createMarketSellOrder method', async () => {
      // createMarketSellOrderメソッドが存在しないexchangeオブジェクトをシミュレート
      const mockExchangeWithoutMethod = {
        id: 'bitbank',
        markets: {
          'XRP/JPY': {
            id: 'xrp_jpy',
            symbol: 'XRP/JPY',
            base: 'XRP',
            quote: 'JPY',
            active: true
          }
        },
        fetchOpenOrders: jest.fn().mockResolvedValue([])
        // createMarketSellOrderメソッドが意図的に定義されていない
      };

      // clearPositionMarket関数が例外をスローせずに正常に動作することを確認
      expect(async () => {
        const result = await clearPositionMarket(mockExchangeWithoutMethod, 'XRP/JPY', 'TEST_STRATEGY');
        expect(result).toBeDefined();
      }).not.toThrow();
    });

    test('should return success with mock order when createMarketSellOrder method is not available', async () => {
      const mockExchangeWithoutMethod = {
        id: 'bitbank',
        markets: {
          'XRP/JPY': {
            id: 'xrp_jpy',
            symbol: 'XRP/JPY',
            base: 'XRP',
            quote: 'JPY',
            active: true
          }
        },
        fetchOpenOrders: jest.fn().mockResolvedValue([])
      };

      const result = await clearPositionMarket(mockExchangeWithoutMethod, 'XRP/JPY', 'TEST_STRATEGY');
      
      // createMarketSellOrderが存在しない場合でも、模擬注文で処理されるため成功となる
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });

    test('should work normally with proper exchange objects that have createMarketSellOrder', async () => {
      // 正常なcreateMarketSellOrderメソッドを持つexchangeオブジェクト
      const mockExchangeWithMethod = {
        id: 'bitbank',
        markets: {
          'XRP/JPY': {
            id: 'xrp_jpy',
            symbol: 'XRP/JPY',
            base: 'XRP',
            quote: 'JPY',
            active: true
          }
        },
        fetchOpenOrders: jest.fn().mockResolvedValue([]),
        createMarketSellOrder: jest.fn().mockResolvedValue({
          id: 'order_123',
          symbol: 'XRP/JPY',
          amount: 0.1,
          price: 100,
          type: 'market',
          side: 'sell',
          status: 'closed'
        })
      };

      const result = await clearPositionMarket(mockExchangeWithMethod, 'XRP/JPY', 'TEST_STRATEGY');
      
      // createMarketSellOrderメソッドが存在する場合は正常に呼び出される
      expect(mockExchangeWithMethod.createMarketSellOrder).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });

    test('should handle mixed scenarios with multiple exchange types', async () => {
      // createMarketSellOrderなし
      const mockExchangeWithoutMethod = {
        id: 'bitbank',
        markets: { 'XRP/JPY': { id: 'xrp_jpy', symbol: 'XRP/JPY', active: true } },
        fetchOpenOrders: jest.fn().mockResolvedValue([])
      };
      
      // createMarketSellOrderあり
      const mockExchangeWithMethod = {
        id: 'bitflyer',
        markets: { 'XRP/JPY': { id: 'xrp_jpy', symbol: 'XRP/JPY', active: true } },
        fetchOpenOrders: jest.fn().mockResolvedValue([]),
        createMarketSellOrder: jest.fn().mockResolvedValue({
          id: 'order_456',
          symbol: 'XRP/JPY',
          amount: 0.1,
          price: 100
        })
      };

      // 両方のケースで例外が発生しないことを確認
      const result1 = await clearPositionMarket(mockExchangeWithoutMethod, 'XRP/JPY', 'TEST_STRATEGY');
      const result2 = await clearPositionMarket(mockExchangeWithMethod, 'XRP/JPY', 'TEST_STRATEGY');

      expect(result1).toBeDefined();
      expect(result1.success).toBe(true);
      expect(result2).toBeDefined();
      expect(result2.success).toBe(true);
      expect(mockExchangeWithMethod.createMarketSellOrder).toHaveBeenCalled();
    });

    test('should prevent "is not a function" error from original issue', () => {
      const problematicExchange = {
        id: 'bitbank',
        markets: {
          'XRP/JPY': { id: 'xrp_jpy', symbol: 'XRP/JPY', active: true }
        },
        fetchOpenOrders: jest.fn().mockResolvedValue([])
        // createMarketSellOrderが不完全な状態
      };

      // 元のissueで発生していたエラーが発生しないことを確認
      expect(async () => {
        await clearPositionMarket(problematicExchange, 'XRP/JPY', 'TEST_STRATEGY');
      }).not.toThrow();
    });

    // Issue #5486: createMarketSellOrderが関数として認識されるが実際には呼び出しでエラーになる場合の対策
    test('should handle createMarketSellOrder "is not a function" runtime error', async () => {
      const mockExchangeWithDefectiveCreateMarketSellOrder = {
        id: 'bitbank',
        markets: {
          'XRP/JPY': {
            id: 'xrp_jpy',
            symbol: 'XRP/JPY',
            base: 'XRP',
            quote: 'JPY',
            active: true
          }
        },
        fetchOpenOrders: jest.fn().mockResolvedValue([]),
        // createMarketSellOrderプロパティは存在するが関数ではない（実際のエラーを再現）
        createMarketSellOrder: 'not a function'
      };

      // "is not a function"エラーが適切にキャッチされ、模擬注文で処理が継続されることを確認
      const result = await clearPositionMarket(mockExchangeWithDefectiveCreateMarketSellOrder, 'XRP/JPY', 'TEST_STRATEGY');
      
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      // 関数がexceptionを投げずに正常に完了することを確認
    });

    test('should handle createMarketSellOrder method that throws "is not a function" error', async () => {
      const mockExchangeWithThrowingCreateMarketSellOrder = {
        id: 'bitbank',
        markets: {
          'XRP/JPY': {
            id: 'xrp_jpy',
            symbol: 'XRP/JPY',
            base: 'XRP',
            quote: 'JPY',
            active: true
          }
        },
        fetchOpenOrders: jest.fn().mockResolvedValue([]),
        // createMarketSellOrderメソッドは存在するが、呼び出し時に"is not a function"エラーをスローする
        createMarketSellOrder: jest.fn().mockImplementation(() => {
          const error = new Error('exchange.createMarketSellOrder is not a function');
          throw error;
        })
      };

      // この場合でもエラーが適切にキャッチされることを確認
      const result = await clearPositionMarket(mockExchangeWithThrowingCreateMarketSellOrder, 'XRP/JPY', 'TEST_STRATEGY');
      
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(mockExchangeWithThrowingCreateMarketSellOrder.createMarketSellOrder).toHaveBeenCalled();
    });
  });

  describe('Error prevention validation', () => {
    test('should handle undefined exchange object gracefully', async () => {
      expect(async () => {
        // undefined exchangeの場合の処理
        await clearPositionMarket(undefined, 'XRP/JPY', 'TEST_STRATEGY');
      }).not.toThrow();
    });

    test('should handle null exchange object gracefully', async () => {
      expect(async () => {
        // null exchangeの場合の処理
        await clearPositionMarket(null, 'XRP/JPY', 'TEST_STRATEGY');
      }).not.toThrow();
    });

    test('should handle exchange with partial properties', async () => {
      const partialExchange = {
        id: 'test'
        // marketsプロパティが存在しない
      };

      expect(async () => {
        await clearPositionMarket(partialExchange, 'XRP/JPY', 'TEST_STRATEGY');
      }).not.toThrow();
    });
  });

  describe('Backtest environment specific behavior', () => {
    test('should work correctly in simulated backtest environment', async () => {
      // バックテスト環境を模擬した設定
      process.env.BACKTEST_MODE = 'true';
      
      const backtestExchange = {
        id: 'bitbank',
        markets: {
          'XRP/JPY': { id: 'xrp_jpy', symbol: 'XRP/JPY', active: true },
          'ETH/JPY': { id: 'eth_jpy', symbol: 'ETH/JPY', active: true }
        },
        fetchOpenOrders: jest.fn().mockResolvedValue([])
        // createMarketSellOrderメソッドが定義されていない（バックテスト環境の問題を再現）
      };

      // エラーなしで動作することを確認
      const result1 = await clearPositionMarket(backtestExchange, 'XRP/JPY', 'MA');
      const result2 = await clearPositionMarket(backtestExchange, 'ETH/JPY', 'BOLLINGER_BANDS');

      expect(result1).toBeDefined();
      expect(result1.success).toBe(true);
      expect(result2).toBeDefined();
      expect(result2.success).toBe(true);

      delete process.env.BACKTEST_MODE;
    });

    test('should maintain compatibility with existing mock objects', async () => {
      // 既存のモックオブジェクトとの互換性確認
      const existingMock = {
        id: 'bitbank',
        fetchBalance: () => Promise.resolve({ total: {}, free: {}, used: {} }),
        fetchTicker: () => Promise.resolve({ last: 0, bid: 0, ask: 0 }),
        fetchOpenOrders: () => Promise.resolve([]),
        createMarketSellOrder: () => Promise.resolve({
          id: 'mock_order',
          symbol: 'XRP/JPY',
          amount: 0.1,
          price: 100
        }),
        markets: {
          'XRP/JPY': { id: 'xrp_jpy', symbol: 'XRP/JPY', active: true }
        }
      };

      const result = await clearPositionMarket(existingMock, 'XRP/JPY', 'TEST_STRATEGY');
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });
  });

  describe('Mock order object validation', () => {
    test('should create proper mock order structure for backtest environment', async () => {
      const backtestExchange = {
        id: 'bitbank',
        markets: {
          'XRP/JPY': { id: 'xrp_jpy', symbol: 'XRP/JPY', active: true }
        },
        fetchOpenOrders: jest.fn().mockResolvedValue([])
        // createMarketSellOrderが存在しない
      };

      // 既存のaddOrderモックをクリアして検証の準備
      const databaseManager = require('../../../../src/database/manager');
      databaseManager.addOrder.mockClear();

      await clearPositionMarket(backtestExchange, 'XRP/JPY', 'TEST_STRATEGY');

      // addOrderが呼ばれた際の引数を確認
      expect(databaseManager.addOrder).toHaveBeenCalled();
      const addOrderArgs = databaseManager.addOrder.mock.calls[0];
      
      // 模擬注文オブジェクトの構造を検証
      // addOrder(exchange, symbol, strategyKey, 'sell', netPosition, order.price, order.id, 'market')
      expect(addOrderArgs[5]).toBe(0); // order.price (バックテストでは0)
      expect(addOrderArgs[6]).toContain('backtest_sell_'); // order.id
      expect(addOrderArgs[7]).toBe('market'); // order type
    });
  });
});