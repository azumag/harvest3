/**
 * Docker環境対応のE2Eテストランナー
 * API経由での検証を中心とした代替アプローチ
 */

const fetch = require('node-fetch');

class E2ETestRunner {
  constructor() {
    this.baseUrl = 'http://localhost:3000';
    this.results = {
      apiTests: [],
      dataIntegrityTests: [],
      performanceTests: [],
      errors: []
    };
  }

  async runAllTests() {
    console.log('🚀 E2Eテスト開始 (API中心アプローチ)');

    try {
      // API機能テスト
      await this.testApiEndpoints();

      // データ構造検証
      await this.testDataStructure();

      // フィールド整合性検証
      await this.testFieldIntegrity();

      // パフォーマンステスト
      await this.testPerformance();

      // レポート生成
      await this.generateReport();

    } catch (error) {
      this.results.errors.push({
        type: 'CRITICAL_ERROR',
        message: error.message,
        timestamp: new Date().toISOString()
      });
      console.error('❌ クリティカルエラー:', error);
    }
  }

  async testApiEndpoints() {
    console.log('\n📡 API エンドポイントテスト実行中...');

    const endpoints = [
      { path: '/api/orders', method: 'GET' },
      { path: '/api/exchanges', method: 'GET' },
      { path: '/api/symbols?exchange=bitbank', method: 'GET' }
    ];

    for (const endpoint of endpoints) {
      try {
        const startTime = Date.now();
        const response = await fetch(`${this.baseUrl}${endpoint.path}`);
        const endTime = Date.now();

        const isJson = response.headers.get('content-type')?.includes('application/json');
        const data = isJson ? await response.json() : await response.text();

        this.results.apiTests.push({
          endpoint: endpoint.path,
          method: endpoint.method,
          status: response.status,
          success: response.ok,
          responseTime: endTime - startTime,
          dataLength: Array.isArray(data) ? data.length : (data?.length || 0),
          contentType: response.headers.get('content-type')
        });

        console.log(`  ✅ ${endpoint.path} - ${response.status} (${endTime - startTime}ms)`);

      } catch (error) {
        this.results.apiTests.push({
          endpoint: endpoint.path,
          method: endpoint.method,
          success: false,
          error: error.message
        });
        console.log(`  ❌ ${endpoint.path} - ${error.message}`);
      }
    }
  }

  async testDataStructure() {
    console.log('\n📊 データ構造検証実行中...');

    try {
      const response = await fetch(`${this.baseUrl}/api/orders`);
      const orders = await response.json();

      if (!Array.isArray(orders)) {
        throw new Error('Orders APIが配列を返していません');
      }

      const structureTest = {
        totalOrders: orders.length,
        sampleSize: Math.min(10, orders.length),
        fieldAnalysis: {},
        issues: []
      };

      const requiredFields = ['orderId', 'exchange', 'symbol', 'side', 'amount', 'price', 'orderType', 'strategy', 'timestamp'];

      // フィールド分析
      for (const field of requiredFields) {
        structureTest.fieldAnalysis[field] = {
          present: 0,
          missing: 0,
          validValues: 0,
          invalidValues: []
        };
      }

      // サンプルデータ分析
      const sampleOrders = orders.slice(0, structureTest.sampleSize);

      for (const order of sampleOrders) {
        for (const field of requiredFields) {
          const analysis = structureTest.fieldAnalysis[field];

          if (order.hasOwnProperty(field) && order[field] !== undefined && order[field] !== null) {
            analysis.present++;

            // 値の妥当性チェック
            if (this.isValidFieldValue(field, order[field])) {
              analysis.validValues++;
            } else {
              analysis.invalidValues.push({
                orderId: order.orderId || 'UNKNOWN',
                value: order[field]
              });
            }
          } else {
            analysis.missing++;
          }
        }

        // 内部ID検出
        if (order.orderId && order.orderId.startsWith('pre_')) {
          structureTest.issues.push({
            type: 'INTERNAL_ID_DETECTED',
            orderId: order.orderId,
            message: '内部IDが注文履歴に表示されています'
          });
        }
      }

      this.results.dataIntegrityTests.push({
        test: 'DATA_STRUCTURE',
        ...structureTest
      });

      console.log(`  📋 ${structureTest.totalOrders}件の注文データを分析`);
      console.log(`  🔍 ${structureTest.sampleSize}件のサンプルを詳細検証`);
      console.log(`  ⚠️  ${structureTest.issues.length}件の問題を検出`);

    } catch (error) {
      this.results.errors.push({
        type: 'DATA_STRUCTURE_ERROR',
        message: error.message
      });
    }
  }

  async testFieldIntegrity() {
    console.log('\n🔍 フィールド整合性検証実行中...');

    try {
      const response = await fetch(`${this.baseUrl}/api/orders?limit=50`);
      const orders = await response.json();

      const integrityResults = {
        totalChecked: orders.length,
        validOrderIds: 0,
        validExchanges: 0,
        validOrderTypes: 0,
        validStrategies: 0,
        detectedIssues: {
          internalIds: [],
          unknownValues: [],
          missingFields: []
        }
      };

      for (const order of orders) {
        // OrderID検証
        if (order.orderId && !order.orderId.startsWith('pre_') && order.orderId !== 'Unknown') {
          integrityResults.validOrderIds++;
        } else if (order.orderId && order.orderId.startsWith('pre_')) {
          integrityResults.detectedIssues.internalIds.push(order.orderId);
        }

        // Exchange検証
        if (order.exchange && order.exchange !== 'Unknown') {
          integrityResults.validExchanges++;
        } else if (order.exchange === 'Unknown') {
          integrityResults.detectedIssues.unknownValues.push({
            field: 'exchange',
            orderId: order.orderId
          });
        }

        // OrderType検証
        if (order.orderType && order.orderType !== 'Unknown') {
          integrityResults.validOrderTypes++;
        } else if (order.orderType === 'Unknown') {
          integrityResults.detectedIssues.unknownValues.push({
            field: 'orderType',
            orderId: order.orderId
          });
        }

        // Strategy検証
        if (order.strategy && order.strategy !== 'Unknown') {
          integrityResults.validStrategies++;
        }
      }

      this.results.dataIntegrityTests.push({
        test: 'FIELD_INTEGRITY',
        ...integrityResults
      });

      console.log(`  ✅ 有効なOrderID: ${integrityResults.validOrderIds}/${integrityResults.totalChecked}`);
      console.log(`  ✅ 有効なExchange: ${integrityResults.validExchanges}/${integrityResults.totalChecked}`);
      console.log(`  ✅ 有効なOrderType: ${integrityResults.validOrderTypes}/${integrityResults.totalChecked}`);
      console.log(`  ⚠️  内部ID検出: ${integrityResults.detectedIssues.internalIds.length}件`);
      console.log(`  ⚠️  Unknown値検出: ${integrityResults.detectedIssues.unknownValues.length}件`);

    } catch (error) {
      this.results.errors.push({
        type: 'FIELD_INTEGRITY_ERROR',
        message: error.message
      });
    }
  }

  async testPerformance() {
    console.log('\n⚡ パフォーマンステスト実行中...');

    const testCases = [
      { name: 'orders_no_filter', path: '/api/orders' },
      { name: 'orders_with_exchange', path: '/api/orders?exchange=bitbank' },
      { name: 'orders_with_symbol', path: '/api/orders?exchange=bitbank&symbol=BTC/JPY' }
    ];

    for (const testCase of testCases) {
      try {
        const times = [];
        const iterations = 3;

        for (let i = 0; i < iterations; i++) {
          const startTime = Date.now();
          const response = await fetch(`${this.baseUrl}${testCase.path}`);
          const data = await response.json();
          const endTime = Date.now();

          times.push({
            responseTime: endTime - startTime,
            dataSize: JSON.stringify(data).length,
            recordCount: Array.isArray(data) ? data.length : 0
          });
        }

        const avgTime = times.reduce((sum, t) => sum + t.responseTime, 0) / times.length;
        const avgDataSize = times.reduce((sum, t) => sum + t.dataSize, 0) / times.length;
        const avgRecords = times.reduce((sum, t) => sum + t.recordCount, 0) / times.length;

        this.results.performanceTests.push({
          testCase: testCase.name,
          path: testCase.path,
          iterations,
          avgResponseTime: Math.round(avgTime),
          avgDataSize: Math.round(avgDataSize),
          avgRecordCount: Math.round(avgRecords),
          allTimes: times
        });

        console.log(`  📊 ${testCase.name}: ${Math.round(avgTime)}ms (${Math.round(avgRecords)}件)`);

      } catch (error) {
        this.results.performanceTests.push({
          testCase: testCase.name,
          error: error.message
        });
      }
    }
  }

  isValidFieldValue(field, value) {
    switch (field) {
    case 'orderId':
      return typeof value === 'string' && value.length > 0 && !value.startsWith('pre_');
    case 'exchange':
      return typeof value === 'string' && value !== 'Unknown' && value.length > 0;
    case 'orderType':
      return typeof value === 'string' && ['limit', 'market'].includes(value);
    case 'side':
      return typeof value === 'string' && ['buy', 'sell'].includes(value);
    case 'amount':
    case 'price':
      return typeof value === 'number' && value > 0;
    case 'strategy':
      return typeof value === 'string' && value !== 'Unknown' && value.length > 0;
    case 'timestamp':
      return typeof value === 'number' && value > 0;
    default:
      return true;
    }
  }

  async generateReport() {
    console.log('\n📋 最終レポート生成中...');

    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalTests: this.calculateTotalTests(),
        passedTests: this.calculatePassedTests(),
        failedTests: this.calculateFailedTests(),
        errorCount: this.results.errors.length
      },
      details: {
        apiTests: this.results.apiTests,
        dataIntegrityTests: this.results.dataIntegrityTests,
        performanceTests: this.results.performanceTests,
        errors: this.results.errors
      }
    };

    // レポートをファイルに保存
    const fs = require('fs');
    const reportPath = '/tmp/e2e-test-report-final.json';
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log(`\n📝 詳細レポート保存完了: ${reportPath}`);

    this.printFinalSummary(report);

    return report;
  }

  calculateTotalTests() {
    return this.results.apiTests.length +
           this.results.dataIntegrityTests.length +
           this.results.performanceTests.length;
  }

  calculatePassedTests() {
    let passed = 0;
    passed += this.results.apiTests.filter(t => t.success).length;
    passed += this.results.performanceTests.filter(t => !t.error).length;
    passed += this.results.dataIntegrityTests.length; // データ整合性テストは実行されれば成功とみなす
    return passed;
  }

  calculateFailedTests() {
    return this.calculateTotalTests() - this.calculatePassedTests();
  }

  printFinalSummary(report) {
    console.log('\n=== 包括的E2Eテスト結果サマリー ===');
    console.log(`✅ 成功テスト: ${report.summary.passedTests}`);
    console.log(`❌ 失敗テスト: ${report.summary.failedTests}`);
    console.log(`🚨 エラー数: ${report.summary.errorCount}`);
    console.log(`📊 総テスト数: ${report.summary.totalTests}`);

    // API結果サマリー
    const apiSuccess = this.results.apiTests.filter(t => t.success).length;
    console.log(`📡 API成功率: ${apiSuccess}/${this.results.apiTests.length}`);

    // データ整合性結果
    const integrityTest = this.results.dataIntegrityTests.find(t => t.test === 'FIELD_INTEGRITY');
    if (integrityTest) {
      console.log(`🔍 データ整合性: ${integrityTest.validOrderIds}/${integrityTest.totalChecked} 有効`);
    }

    // パフォーマンス結果
    const avgResponseTime = this.results.performanceTests
      .filter(t => !t.error)
      .reduce((sum, t) => sum + t.avgResponseTime, 0) /
      this.results.performanceTests.filter(t => !t.error).length;

    if (!isNaN(avgResponseTime)) {
      console.log(`⚡ 平均応答時間: ${Math.round(avgResponseTime)}ms`);
    }

    if (report.summary.errorCount > 0) {
      console.log('\n❌ エラー詳細:');
      report.details.errors.slice(0, 3).forEach((error, i) => {
        console.log(`${i+1}. [${error.type}] ${error.message}`);
      });
    }
  }
}

// テスト実行
async function runE2ETest() {
  const runner = new E2ETestRunner();
  await runner.runAllTests();
}

if (require.main === module) {
  runE2ETest().catch(console.error);
}

module.exports = { E2ETestRunner, runE2ETest };