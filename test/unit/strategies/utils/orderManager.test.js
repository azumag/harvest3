/**
 * 高度注文管理システムのテスト
 * Issue #147: 複数注文タイプと実行最適化の実装
 */

const { AdvancedOrderManager, ORDER_TYPES, URGENCY_LEVELS } = require('../../../../src/strategies/utils/orderManager');

// モック取引所オブジェクト
const mockExchange = {
  id: 'test-exchange',
  fetchOrderBook: jest.fn(),
  createLimitBuyOrder: jest.fn(),
  createLimitSellOrder: jest.fn(),
  createMarketBuyOrder: jest.fn(),
  createMarketSellOrder: jest.fn(),
  fetchOrder: jest.fn().mockResolvedValue({ status: 'closed' }),
  cancelOrder: jest.fn().mockResolvedValue({ status: 'canceled' })
};

describe('AdvancedOrderManager', () => {
  let orderManager;

  beforeEach(() => {
    orderManager = new AdvancedOrderManager(mockExchange);
    jest.clearAllMocks();
  });

  afterEach(() => {
    // 非同期操作のクリーンアップ
    if (orderManager.activeOrders) {
      orderManager.activeOrders.clear();
    }
  });

  describe('最適注文タイプ選択', () => {
    test('高緊急度・高流動性の場合はマーケット注文を選択', async () => {
      // 高流動性をシミュレート
      mockExchange.fetchOrderBook.mockResolvedValue({
        bids: [[100, 10], [99, 5]],
        asks: [[101, 10], [102, 5]]
      });

      const orderType = await orderManager.selectOptimalOrderType(
        'BTC/JPY', URGENCY_LEVELS.HIGH, 0.01
      );

      expect(orderType).toBe(ORDER_TYPES.MARKET);
    });

    test('中緊急度・中流動性の場合はIOC注文を選択', async () => {
      // 中流動性をシミュレート
      mockExchange.fetchOrderBook.mockResolvedValue({
        bids: [[100, 3], [99, 2]],
        asks: [[101, 3], [102, 2]]
      });

      const orderType = await orderManager.selectOptimalOrderType(
        'BTC/JPY', URGENCY_LEVELS.MEDIUM, 0.01
      );

      expect(orderType).toBe(ORDER_TYPES.LIMIT_IOC);
    });

    test('大口注文の場合は氷山注文を選択', async () => {
      mockExchange.fetchOrderBook.mockResolvedValue({
        bids: [[100, 1], [99, 1]],
        asks: [[101, 1], [102, 1]]
      });

      const orderType = await orderManager.selectOptimalOrderType(
        'BTC/JPY', URGENCY_LEVELS.LOW, 0.2 // 大口注文
      );

      expect(orderType).toBe(ORDER_TYPES.ICEBERG);
    });
  });

  describe('流動性評価', () => {
    test('低スプレッド・高ボリュームで高流動性を返す', async () => {
      mockExchange.fetchOrderBook.mockResolvedValue({
        bids: [[100, 10], [99.9, 8], [99.8, 6]],
        asks: [[100.1, 10], [100.2, 8], [100.3, 6]]
      });

      const liquidity = await orderManager.assessLiquidity('BTC/JPY', 0.01);
      
      expect(liquidity).toBeGreaterThan(0.8);
    });

    test('高スプレッド・低ボリュームで低流動性を返す', async () => {
      mockExchange.fetchOrderBook.mockResolvedValue({
        bids: [[100, 0.01], [99, 0.01]], // より少ないボリューム
        asks: [[105, 0.01], [106, 0.01]] // より大きなスプレッド
      });

      const liquidity = await orderManager.assessLiquidity('BTC/JPY', 0.01);
      
      expect(liquidity).toBeLessThan(0.4); // より厳しい閾値
    });
  });

  describe('価格調整', () => {
    beforeEach(() => {
      mockExchange.fetchOrderBook.mockResolvedValue({
        bids: [[100, 1]],
        asks: [[101, 1]]
      });
    });

    test('買い注文で高緊急度の場合、スプレッド50%上乗せ', async () => {
      const adjustedPrice = await orderManager.calculateOptimalPrice(
        'BTC/JPY', 'buy', URGENCY_LEVELS.HIGH, 100
      );

      expect(adjustedPrice).toBeCloseTo(100.5); // 100 + (1 * 0.5)
    });

    test('売り注文で高緊急度の場合、スプレッド50%減額', async () => {
      const adjustedPrice = await orderManager.calculateOptimalPrice(
        'BTC/JPY', 'sell', URGENCY_LEVELS.HIGH, 101
      );

      expect(adjustedPrice).toBeCloseTo(100.5); // 101 - (1 * 0.5)
    });

    test('低緊急度の場合、スプレッド1%のみ調整', async () => {
      const adjustedPrice = await orderManager.calculateOptimalPrice(
        'BTC/JPY', 'buy', URGENCY_LEVELS.LOW, 100
      );

      expect(adjustedPrice).toBeCloseTo(100.01); // 100 + (1 * 0.01)
    });
  });

  describe('高度注文実行', () => {
    test('正常な注文実行の場合、成功結果を返す', async () => {
      const mockOrder = { id: '12345', symbol: 'BTC/JPY', side: 'buy', amount: 0.01 };
      mockExchange.createLimitBuyOrder.mockResolvedValue(mockOrder);
      mockExchange.fetchOrderBook.mockResolvedValue({
        bids: [[100, 1]],
        asks: [[101, 1]]
      });

      const result = await orderManager.executeAdvancedOrder(
        'BTC/JPY', 'buy', 0.01, 100, {
          urgency: URGENCY_LEVELS.LOW,
          strategy: 'TEST'
        }
      );

      expect(result.success).toBe(true);
      expect(result.order).toEqual(mockOrder);
      expect(result.orderType).toBe(ORDER_TYPES.LIMIT_POST_ONLY);
    });

    test('注文失敗時はリトライ実行', async () => {
      mockExchange.createLimitBuyOrder
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ id: '12345' });
      
      mockExchange.fetchOrderBook.mockResolvedValue({
        bids: [[100, 1]],
        asks: [[101, 1]]
      });

      const result = await orderManager.executeAdvancedOrder(
        'BTC/JPY', 'buy', 0.01, 100, {
          urgency: URGENCY_LEVELS.LOW,
          strategy: 'TEST'
        }
      );

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
      expect(mockExchange.createLimitBuyOrder).toHaveBeenCalledTimes(2);
    });
  });

  describe('氷山注文実行', () => {
    test('大口注文を複数のチャンクに分割して実行', async () => {
      const mockOrder = { id: '12345' };
      mockExchange.createLimitBuyOrder.mockResolvedValue(mockOrder);

      const result = await orderManager.executeIcebergOrder(
        'BTC/JPY', 'buy', 1.0, 100, { icebergInterval: 100 }
      );

      expect(result.success).toBe(true);
      expect(result.orders.length).toBeGreaterThan(1);
      expect(result.orderType).toBe(ORDER_TYPES.ICEBERG);
    });
  });

  describe('注文パラメータ構築', () => {
    test('POST_ONLYタイプでpostOnlyパラメータを設定', () => {
      const params = orderManager.buildOrderParams(ORDER_TYPES.LIMIT_POST_ONLY, {});
      expect(params.postOnly).toBe(true);
    });

    test('IOCタイプでtimeInForceパラメータを設定', () => {
      const params = orderManager.buildOrderParams(ORDER_TYPES.LIMIT_IOC, {});
      expect(params.timeInForce).toBe('IOC');
    });

    test('STOP_LIMITタイプでstopPriceパラメータを設定', () => {
      const params = orderManager.buildOrderParams(ORDER_TYPES.STOP_LIMIT, {
        stopPrice: 95
      });
      expect(params.stopPrice).toBe(95);
    });
  });
});

describe('定数とエクスポート', () => {
  test('ORDER_TYPESが正しく定義されている', () => {
    expect(ORDER_TYPES.LIMIT_POST_ONLY).toBe('post_only');
    expect(ORDER_TYPES.LIMIT_IOC).toBe('ioc');
    expect(ORDER_TYPES.MARKET).toBe('market');
    expect(ORDER_TYPES.STOP_LIMIT).toBe('stop_limit');
    expect(ORDER_TYPES.ICEBERG).toBe('iceberg');
  });

  test('URGENCY_LEVELSが正しく定義されている', () => {
    expect(URGENCY_LEVELS.LOW).toBe('low');
    expect(URGENCY_LEVELS.MEDIUM).toBe('medium');
    expect(URGENCY_LEVELS.HIGH).toBe('high');
  });
});