#!/usr/bin/env node

// Isolated Monte Carlo Bootstrapping Test
const { MonteCarloBootstrapping } = require('./src/strategies/utils/monteCarloBootstrapping');

console.log('🎲 Monte Carlo Bootstrapping 単体テスト開始');

async function testMonteCarloIsolated() {
  try {
    // Initialize Monte Carlo
    const mcb = new MonteCarloBootstrapping({
      iterations: 100,
      blockSize: 10,
      confidenceLevel: 0.95
    });
    
    console.log('✅ Monte Carlo初期化成功');
    
    // Generate mock performance data
    const mockReturns = [];
    for (let i = 0; i < 50; i++) {
      mockReturns.push((Math.random() - 0.5) * 0.02); // Random returns between -1% and 1%
    }
    
    console.log('📊 モックデータ生成完了:', mockReturns.length, '件');
    
    // Test Sharpe ratio calculation
    const sharpeResults = await mcb.calculateSharpeConfidenceInterval(mockReturns, 100);
    console.log('✅ Sharpe Ratio Bootstrap完了');
    console.log('  平均:', sharpeResults.mean?.toFixed(4));
    console.log('  信頼区間:', sharpeResults.confidenceInterval ? 
      `[${sharpeResults.confidenceInterval.lower?.toFixed(4)}, ${sharpeResults.confidenceInterval.upper?.toFixed(4)}]` : 'N/A');
    
    // Test Max Drawdown calculation
    const ddResults = await mcb.calculateMaxDrawdownDistribution(mockReturns, 100);
    console.log('✅ Max Drawdown Bootstrap完了');
    console.log('  平均:', ddResults.mean?.toFixed(4));
    console.log('  信頼区間:', ddResults.confidenceInterval ? 
      `[${ddResults.confidenceInterval.lower?.toFixed(4)}, ${ddResults.confidenceInterval.upper?.toFixed(4)}]` : 'N/A');
    
    // Test comprehensive analysis
    const comprehensiveResults = await mcb.comprehensiveAnalysis(mockReturns, 50);
    console.log('✅ Comprehensive Analysis完了');
    console.log('  メトリクス数:', Object.keys(comprehensiveResults).length);
    
    return {
      success: true,
      sharpeResults,
      ddResults,
      comprehensiveResults,
      dataSize: mockReturns.length
    };
    
  } catch (error) {
    console.error('❌ Monte Carlo テストエラー:', error.message);
    return {
      success: false,
      error: error.message,
      stack: error.stack
    };
  }
}

testMonteCarloIsolated()
  .then(result => {
    console.log('\n🎯 Monte Carlo単体テスト結果:');
    console.log('成功:', result.success ? '✅' : '❌');
    
    if (result.success) {
      console.log('📊 統計的検証:', result.sharpeResults ? '✅' : '❌');
      console.log('📉 リスク分析:', result.ddResults ? '✅' : '❌');
      console.log('🔬 総合分析:', result.comprehensiveResults ? '✅' : '❌');
    }
    
    process.exit(result.success ? 0 : 1);
  })
  .catch(error => {
    console.error('🚨 予期しないエラー:', error);
    process.exit(1);
  });