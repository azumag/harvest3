/**
 * 包括的E2Eデータ整合性テストスクリプト
 * TransactionalOrderManager完全フローとシステム間整合性検証
 */

const {
  addOrderMongoDB,
  updateOrderByOrderId,
  deleteOrderByOrderId,
  listOrders,
  connectDB,
  closeDB
} = require('../src/database/mongoDatabase');

const TransactionalOrderManager = require('../src/common/transactionalOrderManager');

// テスト構成
const TEST_CONFIG = {
  pairs: ['BTC/JPY', 'ETH/JPY', 'SOL/JPY'],
  strategies: ['BOLLINGER_BANDS', 'MACD', 'RSI'],
  orderTypes: ['limit', 'market'],
  exchanges: {
    id: 'bitbank',
    name: 'Bitbank'
  }
};

// モック取引所オブジェクト
class MockExchange {
  constructor() {
    this.id = 'bitbank';
    this.orderCounter = 1000000;
  }

  async createLimitBuyOrder(symbol, amount, price) {
    const orderId = `MOCK_${this.orderCounter++}`;
    return {
      id: orderId,
      orderId: orderId,
      symbol,
      side: 'buy',
      amount,
      price,
      type: 'limit',
      status: 'open',
      timestamp: Date.now(),
      exchange: this.id
    };
  }

  async createLimitSellOrder(symbol, amount, price) {
    const orderId = `MOCK_${this.orderCounter++}`;
    return {
      id: orderId,
      orderId: orderId,
      symbol,
      side: 'sell',
      amount,
      price,
      type: 'limit',
      status: 'open',
      timestamp: Date.now(),
      exchange: this.id
    };
  }

  async cancelOrder(orderId, symbol) {
    return { id: orderId, status: 'canceled' };
  }
}

class E2EDataIntegrityTester {
  constructor() {
    this.mockExchange = new MockExchange();
    this.tom = new TransactionalOrderManager(this.mockExchange);
    this.testResults = {
      phase1Tests: [],
      phase2Tests: [],
      phase3Tests: [],
      integrityTests: [],
      strategyTests: [],
      errors: []
    };
  }

  async runComprehensiveTest() {
    console.log('🚀 包括的E2Eデータ整合性テスト開始');

    try {
      await connectDB();

      // Phase 1-3 完全フローテスト
      await this.testPhase1To3Flow();

      // 複数取引ペアテスト
      await this.testMultipleTradingPairs();

      // 複数戦略テスト
      await this.testMultipleStrategies();

      // データ整合性検証
      await this.testDataIntegrity();

      // 結果レポート生成
      await this.generateReport();

    } catch (error) {
      this.testResults.errors.push({
        type: 'CRITICAL_ERROR',
        message: error.message,
        stack: error.stack
      });
      console.error('❌ テスト実行中にクリティカルエラー:', error);
    } finally {
      await closeDB();
    }
  }

  async testPhase1To3Flow() {
    console.log('\n📋 Phase1-3完全フローテスト実行中...');

    for (const symbol of TEST_CONFIG.pairs) {
      for (const strategy of TEST_CONFIG.strategies) {
        try {
          const transactionId = `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

          // Phase 1: 事前保存テスト
          console.log(`  Phase1テスト: ${symbol} - ${strategy}`);
          const preOrder = await this.tom.saveOrderBeforeExecution(
            transactionId,
            symbol,
            'buy',
            0.001,
            5000000,
            { strategy, type: 'limit' }
          );

          this.testResults.phase1Tests.push({
            symbol,
            strategy,
            transactionId,
            preOrderId: preOrder.id,
            success: !!preOrder.id,
            fields: {
              hasOrderId: !!preOrder.orderId,
              hasExchange: !!preOrder.exchange,
              hasOrderType: !!preOrder.orderType,
              hasStrategy: !!preOrder.strategy
            }
          });

          // Phase 2: 取引所注文テスト
          console.log(`  Phase2テスト: ${symbol} - ${strategy}`);
          const exchangeOrder = await this.tom.executeOrderOnExchange(
            preOrder,
            'buy',
            0.001,
            5000000,
            transactionId
          );

          this.testResults.phase2Tests.push({
            symbol,
            strategy,
            transactionId,
            exchangeOrderId: exchangeOrder.id,
            success: !!exchangeOrder.id,
            fields: {
              hasOrderId: !!exchangeOrder.id,
              hasExchange: !!exchangeOrder.exchange,
              hasOrderType: !!exchangeOrder.type
            }
          });

          // Phase 3: 更新テスト
          console.log(`  Phase3テスト: ${symbol} - ${strategy}`);
          await this.tom.updateOrderAfterExecution(preOrder, exchangeOrder, transactionId);

          // データベースから更新されたデータを確認
          const updatedOrders = await listOrders({ orderId: exchangeOrder.id });
          const updatedOrder = updatedOrders[0];

          this.testResults.phase3Tests.push({
            symbol,
            strategy,
            transactionId,
            orderId: exchangeOrder.id,
            success: !!updatedOrder,
            fields: {
              correctOrderId: updatedOrder?.orderId === exchangeOrder.id,
              correctExchange: updatedOrder?.exchange === 'bitbank',
              correctOrderType: updatedOrder?.orderType === 'limit',
              correctStrategy: updatedOrder?.strategy === strategy,
              noInternalId: !updatedOrder?.orderId?.startsWith('pre_')
            }
          });

        } catch (error) {
          this.testResults.errors.push({
            type: 'PHASE_FLOW_ERROR',
            symbol,
            strategy,
            message: error.message
          });
        }
      }
    }
  }

  async testMultipleTradingPairs() {
    console.log('\n💱 複数取引ペアテスト実行中...');

    // 並行して複数ペアの注文をテスト
    const promises = TEST_CONFIG.pairs.map(async (symbol) => {
      try {
        const transactionId = `pair_test_${Date.now()}_${symbol.replace('/', '_')}`;

        const result = await this.tom.executeFullTransaction(
          transactionId,
          symbol,
          'buy',
          0.001,
          5000000,
          { strategy: 'BOLLINGER_BANDS', type: 'limit' }
        );

        return {
          symbol,
          success: result.success,
          orderId: result.exchangeOrderId,
          error: result.error?.message
        };
      } catch (error) {
        return {
          symbol,
          success: false,
          error: error.message
        };
      }
    });

    const results = await Promise.all(promises);
    this.testResults.integrityTests.push({
      test: 'MULTIPLE_TRADING_PAIRS',
      results
    });
  }

  async testMultipleStrategies() {
    console.log('\n📈 複数戦略テスト実行中...');

    for (const strategy of TEST_CONFIG.strategies) {
      try {
        const transactionId = `strategy_test_${Date.now()}_${strategy}`;

        const result = await this.tom.executeFullTransaction(
          transactionId,
          'BTC/JPY',
          'sell',
          0.001,
          5000000,
          { strategy, type: 'limit' }
        );

        this.testResults.strategyTests.push({
          strategy,
          success: result.success,
          orderId: result.exchangeOrderId,
          error: result.error?.message
        });

      } catch (error) {
        this.testResults.strategyTests.push({
          strategy,
          success: false,
          error: error.message
        });
      }
    }
  }

  async testDataIntegrity() {
    console.log('\n🔍 データ整合性検証実行中...');

    try {
      // API経由でのデータ取得テスト
      const apiResponse = await fetch('http://localhost:3000/api/orders');
      const apiOrders = await apiResponse.json();

      // データベース直接取得
      const dbOrders = await listOrders({});

      this.testResults.integrityTests.push({
        test: 'API_DB_CONSISTENCY',
        apiCount: apiOrders.length,
        dbCount: dbOrders.length,
        consistent: apiOrders.length === dbOrders.length
      });

      // フィールド整合性チェック
      const fieldIntegrityResults = {
        validOrderIds: 0,
        validExchanges: 0,
        validOrderTypes: 0,
        invalidRecords: []
      };

      for (const order of dbOrders) {
        if (order.orderId && !order.orderId.startsWith('pre_')) {
          fieldIntegrityResults.validOrderIds++;
        }
        if (order.exchange && order.exchange !== 'Unknown') {
          fieldIntegrityResults.validExchanges++;
        }
        if (order.orderType && order.orderType !== 'Unknown') {
          fieldIntegrityResults.validOrderTypes++;
        }

        if (!order.orderId || order.orderId.startsWith('pre_') ||
            order.exchange === 'Unknown' || order.orderType === 'Unknown') {
          fieldIntegrityResults.invalidRecords.push({
            orderId: order.orderId,
            exchange: order.exchange,
            orderType: order.orderType
          });
        }
      }

      this.testResults.integrityTests.push({
        test: 'FIELD_INTEGRITY',
        totalRecords: dbOrders.length,
        ...fieldIntegrityResults
      });

    } catch (error) {
      this.testResults.errors.push({
        type: 'INTEGRITY_TEST_ERROR',
        message: error.message
      });
    }
  }

  async generateReport() {
    console.log('\n📊 包括的テストレポート生成中...');

    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalTests: this.calculateTotalTests(),
        passedTests: this.calculatePassedTests(),
        failedTests: this.calculateFailedTests(),
        errorCount: this.testResults.errors.length
      },
      phase1Results: this.testResults.phase1Tests,
      phase2Results: this.testResults.phase2Tests,
      phase3Results: this.testResults.phase3Tests,
      integrityResults: this.testResults.integrityTests,
      strategyResults: this.testResults.strategyTests,
      errors: this.testResults.errors
    };

    // レポートをファイルに保存
    const fs = require('fs');
    const reportPath = '/tmp/e2e-test-report.json';
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log(`📝 詳細レポートを保存しました: ${reportPath}`);

    // コンソールサマリー
    this.printSummary(report);

    return report;
  }

  calculateTotalTests() {
    return this.testResults.phase1Tests.length +
           this.testResults.phase2Tests.length +
           this.testResults.phase3Tests.length +
           this.testResults.integrityTests.length +
           this.testResults.strategyTests.length;
  }

  calculatePassedTests() {
    let passed = 0;
    passed += this.testResults.phase1Tests.filter(t => t.success).length;
    passed += this.testResults.phase2Tests.filter(t => t.success).length;
    passed += this.testResults.phase3Tests.filter(t => t.success).length;
    passed += this.testResults.strategyTests.filter(t => t.success).length;
    return passed;
  }

  calculateFailedTests() {
    return this.calculateTotalTests() - this.calculatePassedTests();
  }

  printSummary(report) {
    console.log('\n=== 包括的E2Eテスト結果サマリー ===');
    console.log(`✅ 成功: ${report.summary.passedTests}`);
    console.log(`❌ 失敗: ${report.summary.failedTests}`);
    console.log(`🚨 エラー: ${report.summary.errorCount}`);
    console.log(`📊 総テスト数: ${report.summary.totalTests}`);

    if (report.summary.errorCount > 0) {
      console.log('\n❌ エラー詳細:');
      report.errors.forEach((error, i) => {
        console.log(`${i+1}. [${error.type}] ${error.message}`);
      });
    }
  }
}

// テスト実行関数
async function runE2ETest() {
  const tester = new E2EDataIntegrityTester();
  await tester.runComprehensiveTest();
}

// スクリプトとして実行された場合
if (require.main === module) {
  runE2ETest().catch(console.error);
}

module.exports = { E2EDataIntegrityTester, runE2ETest };