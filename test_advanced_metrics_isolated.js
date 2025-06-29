#!/usr/bin/env node

// Isolated Advanced Metrics Test
const { AdvancedPerformanceMetrics } = require('./src/strategies/utils/advancedPerformanceMetrics');

console.log('📊 Advanced Performance Metrics 単体テスト開始');

async function testAdvancedMetrics() {
  try {
    // Initialize Advanced Metrics
    const apm = new AdvancedPerformanceMetrics();
    console.log('✅ Advanced Metrics初期化成功');
    
    // Generate mock returns data
    const mockReturns = [];
    const mockBenchmarkReturns = [];
    
    for (let i = 0; i < 100; i++) {
      mockReturns.push((Math.random() - 0.45) * 0.03); // Slightly positive bias
      mockBenchmarkReturns.push((Math.random() - 0.5) * 0.02); // Market returns
    }
    
    console.log('📊 モック収益データ生成完了:', mockReturns.length, '件');
    
    // Test Sharpe Ratio
    const sharpeRatio = apm.calculateSharpeRatio(mockReturns);
    console.log('✅ Sharpe Ratio計算完了:', sharpeRatio?.toFixed(4));
    
    // Test Calmar Ratio
    const calmarRatio = apm.calculateCalmarRatio(mockReturns);
    console.log('✅ Calmar Ratio計算完了:', calmarRatio?.toFixed(4));
    
    // Test Sortino Ratio
    const sortinoRatio = apm.calculateSortinoRatio(mockReturns);
    console.log('✅ Sortino Ratio計算完了:', sortinoRatio?.toFixed(4));
    
    // Test VaR (Value at Risk)
    const var95 = apm.calculateVaR(mockReturns, 0.95);
    console.log('✅ VaR(95%)計算完了:', var95?.toFixed(4));
    
    // Test CVaR (Conditional VaR)
    const cvar95 = apm.calculateCVaR(mockReturns, 0.95);
    console.log('✅ CVaR(95%)計算完了:', cvar95?.toFixed(4));
    
    // Test Maximum Drawdown
    const maxDD = apm.calculateMaximumDrawdown(mockReturns);
    console.log('✅ Maximum Drawdown計算完了:', maxDD?.toFixed(4));
    
    // Test Omega Ratio
    const omegaRatio = apm.calculateOmegaRatio(mockReturns, 0);
    console.log('✅ Omega Ratio計算完了:', omegaRatio?.toFixed(4));
    
    // Test Information Ratio
    const infoRatio = apm.calculateInformationRatio(mockReturns, mockBenchmarkReturns);
    console.log('✅ Information Ratio計算完了:', infoRatio?.toFixed(4));
    
    // Test comprehensive metrics
    const comprehensiveMetrics = apm.calculateComprehensiveMetrics(mockReturns, mockBenchmarkReturns);
    console.log('✅ Comprehensive Metrics計算完了');
    console.log('  メトリクス数:', Object.keys(comprehensiveMetrics).length);
    
    return {
      success: true,
      sharpeRatio,
      calmarRatio,
      sortinoRatio,
      var95,
      cvar95,
      maxDD,
      omegaRatio,
      infoRatio,
      comprehensiveMetrics,
      dataSize: mockReturns.length
    };
    
  } catch (error) {
    console.error('❌ Advanced Metrics テストエラー:', error.message);
    return {
      success: false,
      error: error.message,
      stack: error.stack
    };
  }
}

testAdvancedMetrics()
  .then(result => {
    console.log('\n🎯 Advanced Metrics単体テスト結果:');
    console.log('成功:', result.success ? '✅' : '❌');
    
    if (result.success) {
      console.log('📊 リスク調整リターン指標:', result.sharpeRatio !== undefined ? '✅' : '❌');
      console.log('📈 リスクメトリクス:', result.var95 !== undefined ? '✅' : '❌');
      console.log('📉 ドローダウン分析:', result.maxDD !== undefined ? '✅' : '❌');
      console.log('🔬 総合メトリクス:', result.comprehensiveMetrics ? '✅' : '❌');
    }
    
    process.exit(result.success ? 0 : 1);
  })
  .catch(error => {
    console.error('🚨 予期しないエラー:', error);
    process.exit(1);
  });