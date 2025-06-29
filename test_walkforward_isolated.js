#!/usr/bin/env node

// Isolated Walk-Forward Analysis Test
const { WalkForwardAnalysis } = require('./src/strategies/utils/walkForwardAnalysis');

console.log('📈 Walk-Forward Analysis 単体テスト開始');

async function testWalkForwardIsolated() {
  try {
    // Initialize Walk-Forward with proper config
    const wfa = new WalkForwardAnalysis({
      trainWindow: 30,
      testWindow: 10,
      stepSize: 5,
      anchored: false,
      minTrainPeriods: 15
    });
    
    console.log('✅ Walk-Forward初期化成功');
    
    // Generate mock time series data
    const mockData = [];
    let baseValue = 100;
    
    for (let i = 0; i < 50; i++) {
      const change = (Math.random() - 0.5) * 2;
      baseValue += change;
      
      mockData.push({
        timestamp: Date.now() + i * 3600000, // hourly data
        value: baseValue,
        price: baseValue,
        volume: Math.random() * 1000,
        returns: i > 0 ? change / (baseValue - change) : 0
      });
    }
    
    console.log('📊 モック時系列データ生成完了:', mockData.length, '件');
    
    // Test data integrity validation
    wfa.validateDataIntegrity(mockData);
    console.log('✅ データ整合性検証完了');
    
    // Test time series splitting
    const splits = wfa.splitTimeSeries(mockData);
    console.log('✅ 時系列分割完了');
    console.log('  分割数:', splits.length);
    console.log('  訓練期間:', splits[0]?.trainData?.length || 'N/A');
    console.log('  テスト期間:', splits[0]?.testData?.length || 'N/A');
    
    // Test time series statistics
    const stats = wfa.calculateTimeSeriesStats(mockData);
    console.log('✅ 時系列統計計算完了');
    console.log('  平均:', stats.mean?.toFixed(4));
    console.log('  標準偏差:', stats.standardDeviation?.toFixed(4));
    console.log('  歪度:', stats.skewness?.toFixed(4));
    
    // Test performance metrics calculation
    const mockReturns = mockData.map(d => d.returns).filter(r => !isNaN(r));
    const perfMetrics = wfa.calculatePerformanceMetrics(mockReturns);
    console.log('✅ パフォーマンス指標計算完了');
    console.log('  シャープレシオ:', perfMetrics.sharpeRatio?.toFixed(4));
    console.log('  最大ドローダウン:', perfMetrics.maxDrawdown?.toFixed(4));
    
    return {
      success: true,
      splits,
      stats,
      perfMetrics,
      dataSize: mockData.length,
      splitsCount: splits.length
    };
    
  } catch (error) {
    console.error('❌ Walk-Forward テストエラー:', error.message);
    return {
      success: false,
      error: error.message,
      stack: error.stack
    };
  }
}

testWalkForwardIsolated()
  .then(result => {
    console.log('\n🎯 Walk-Forward単体テスト結果:');
    console.log('成功:', result.success ? '✅' : '❌');
    
    if (result.success) {
      console.log('📊 時系列分割:', result.splits ? '✅' : '❌');
      console.log('📈 統計計算:', result.stats ? '✅' : '❌');
      console.log('🔬 パフォーマンス指標:', result.perfMetrics ? '✅' : '❌');
      console.log('📋 分割期間数:', result.splitsCount || 0);
    }
    
    process.exit(result.success ? 0 : 1);
  })
  .catch(error => {
    console.error('🚨 予期しないエラー:', error);
    process.exit(1);
  });