/**
 * 高度注文管理システムの統合テスト
 * Issue #147: 高度な注文管理システムと実行最適化の実装
 */

const { AdvancedOrderManager, ORDER_TYPES, URGENCY_LEVELS } = require('../src/strategies/utils/orderManager');
const config = require('../src/config');

// テスト用のモック取引所
class MockExchange {
  constructor() {
    this.id = 'mock-exchange';
  }

  async fetchOrderBook(symbol) {
    // 模擬的な板情報を返す
    return {
      bids: [[100, 5], [99.9, 3], [99.8, 2]],
      asks: [[100.1, 5], [100.2, 3], [100.3, 2]]
    };
  }

  async createLimitBuyOrder(symbol, amount, price, params) {
    console.log(`[モック] 買い限指注文: ${symbol} ${amount} @ ${price}`, params);
    return {
      id: `buy-${Date.now()}`,
      symbol,
      amount,
      price,
      side: 'buy',
      type: 'limit',
      status: 'open'
    };
  }

  async createLimitSellOrder(symbol, amount, price, params) {
    console.log(`[モック] 売り限指注文: ${symbol} ${amount} @ ${price}`, params);
    return {
      id: `sell-${Date.now()}`,
      symbol,
      amount,
      price,
      side: 'sell',
      type: 'limit',
      status: 'open'
    };
  }

  async createMarketBuyOrder(symbol, amount, params) {
    console.log(`[モック] 買い成行注文: ${symbol} ${amount}`, params);
    return {
      id: `market-buy-${Date.now()}`,
      symbol,
      amount,
      price: 100.05, // 模擬約定価格
      side: 'buy',
      type: 'market',
      status: 'closed'
    };
  }

  async createMarketSellOrder(symbol, amount, params) {
    console.log(`[モック] 売り成行注文: ${symbol} ${amount}`, params);
    return {
      id: `market-sell-${Date.now()}`,
      symbol,
      amount,
      price: 99.95, // 模擬約定価格
      side: 'sell',
      type: 'market',
      status: 'closed'
    };
  }

  async fetchOrder(orderId) {
    // 模擬的に注文がクローズ済みとして返す
    return {
      id: orderId,
      status: 'closed'
    };
  }

  async cancelOrder(orderId) {
    console.log(`[モック] 注文キャンセル: ${orderId}`);
    return { id: orderId, status: 'canceled' };
  }
}

async function testAdvancedOrderManagement() {
  console.log('🚀 高度注文管理システム統合テスト開始');
  
  const mockExchange = new MockExchange();
  const orderManager = new AdvancedOrderManager(mockExchange);
  
  // テストケース1: 低緊急度の買い注文
  console.log('\n📊 テスト1: 低緊急度の買い注文');
  try {
    const result1 = await orderManager.executeAdvancedOrder(
      'BTC/JPY', 'buy', 0.01, 100, {
        urgency: URGENCY_LEVELS.LOW,
        strategy: 'TEST_STRATEGY',
        maxSlippage: 0.005
      }
    );
    console.log('✅ 結果:', {
      success: result1.success,
      orderType: result1.orderType,
      adjustedPrice: result1.adjustedPrice
    });
  } catch (error) {
    console.error('❌ エラー:', error.message);
  }

  // テストケース2: 高緊急度の売り注文
  console.log('\n📊 テスト2: 高緊急度の売り注文');
  try {
    const result2 = await orderManager.executeAdvancedOrder(
      'BTC/JPY', 'sell', 0.01, 100, {
        urgency: URGENCY_LEVELS.HIGH,
        strategy: 'TEST_STRATEGY',
        maxSlippage: 0.01
      }
    );
    console.log('✅ 結果:', {
      success: result2.success,
      orderType: result2.orderType,
      adjustedPrice: result2.adjustedPrice
    });
  } catch (error) {
    console.error('❌ エラー:', error.message);
  }

  // テストケース3: 大口注文（氷山注文）
  console.log('\n📊 テスト3: 大口注文（氷山注文）');
  try {
    const result3 = await orderManager.executeAdvancedOrder(
      'BTC/JPY', 'buy', 0.2, 100, { // 大口注文
        urgency: URGENCY_LEVELS.MEDIUM,
        strategy: 'TEST_STRATEGY',
        maxSlippage: 0.005
      }
    );
    console.log('✅ 結果:', {
      success: result3.success,
      orderType: result3.orderType,
      totalChunks: result3.totalChunks,
      executedChunks: result3.executedChunks
    });
  } catch (error) {
    console.error('❌ エラー:', error.message);
  }

  // テストケース4: 設定からの自動選択
  console.log('\n📊 テスト4: 設定に基づく注文タイプ自動選択');
  try {
    const orderType = await orderManager.selectOptimalOrderType(
      'BTC/JPY', URGENCY_LEVELS.MEDIUM, 0.01
    );
    console.log('✅ 選択された注文タイプ:', orderType);
    
    const liquidityLevel = await orderManager.assessLiquidity('BTC/JPY', 0.01);
    console.log('✅ 流動性レベル:', liquidityLevel.toFixed(3));
    
    const adjustedPrice = await orderManager.calculateOptimalPrice(
      'BTC/JPY', 'buy', URGENCY_LEVELS.MEDIUM, 100
    );
    console.log('✅ 調整価格:', adjustedPrice.toFixed(3));
  } catch (error) {
    console.error('❌ エラー:', error.message);
  }

  console.log('\n🎉 高度注文管理システム統合テスト完了');
}

// 設定の確認
console.log('⚙️ 高度注文管理設定:');
console.log(JSON.stringify(config.global?.advancedOrderManagement, null, 2));

// テスト実行
testAdvancedOrderManagement().catch(console.error);