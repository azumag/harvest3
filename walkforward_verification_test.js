// Walk-Forward Analysis 実証検証テスト
const { WalkForwardAnalysis } = require('./src/strategies/utils/walkForwardAnalysis');
const { MonteCarloBootstrapping } = require('./src/strategies/utils/monteCarloBootstrapping');

console.log('🔬 Walk-Forward Analysis実証検証開始...');

// シンプルなテストデータ生成
function generateTestData(length = 500) {
  const data = [];
  let basePrice = 100;
  
  for (let i = 0; i < length; i++) {
    // 単純なランダムウォークシミュレーション
    const change = (Math.random() - 0.5) * 2; // -1 から 1
    basePrice += change;
    
    data.push({
      timestamp: Date.now() + i * 3600000, // 1時間ごと
      price: basePrice,
      volume: Math.random() * 1000,
      returns: i > 0 ? (basePrice - data[i-1].price) / data[i-1].price : 0
    });
  }
  
  return data;
}

// シンプルな戦略のモック
function mockStrategy(trainData, testData) {
  // 移動平均戦略のシミュレーション
  const shortMA = trainData.slice(-10).reduce((sum, d) => sum + d.price, 0) / 10;
  const longMA = trainData.slice(-30).reduce((sum, d) => sum + d.price, 0) / 30;
  
  const signals = [];
  let totalReturn = 0;
  
  for (const testPoint of testData) {
    const signal = shortMA > longMA ? 1 : -1; // 1: buy, -1: sell
    const pointReturn = signal * testPoint.returns;
    totalReturn += pointReturn;
    
    signals.push({
      timestamp: testPoint.timestamp,
      signal,
      returns: pointReturn
    });
  }
  
  return {
    totalReturn,
    signals,
    sharpeRatio: calculateSharpe(signals.map(s => s.returns)),
    maxDrawdown: calculateMaxDrawdown(signals.map(s => s.returns))
  };
}

function calculateSharpe(returns) {
  if (returns.length === 0) return 0;
  const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
  const std = Math.sqrt(variance);
  return std === 0 ? 0 : mean / std;
}

function calculateMaxDrawdown(returns) {
  let peak = 0;
  let drawdown = 0;
  let cumReturn = 0;
  
  for (const ret of returns) {
    cumReturn += ret;
    peak = Math.max(peak, cumReturn);
    drawdown = Math.min(drawdown, cumReturn - peak);
  }
  
  return Math.abs(drawdown);
}

async function runVerificationTest() {
  try {
    console.log('📊 テストデータ生成中...');
    const testData = generateTestData(500);
    
    console.log('🔄 Walk-Forward Analysis設定...');
    const walkForward = new WalkForwardAnalysis({
      trainWindow: 100,
      testWindow: 20,
      stepSize: 10,
      anchored: false,
      minTrainPeriods: 50
    });
    
    console.log('⚡ Walk-Forward Analysis実行中...');
    const results = await walkForward.runAnalysis(testData, mockStrategy);
    
    console.log('✅ Walk-Forward Analysis完了');
    console.log('📊 実証結果:');
    console.log(`  検証期間数: ${results.periods ? results.periods.length : 'N/A'}`);
    console.log(`  平均シャープレシオ: ${results.averageMetrics ? results.averageMetrics.sharpeRatio?.toFixed(4) : 'N/A'}`);
    console.log(`  平均最大ドローダウン: ${results.averageMetrics ? (results.averageMetrics.maxDrawdown * 100)?.toFixed(2) : 'N/A'}%`);
    console.log(`  統計的有意性: ${results.statisticalSignificance ? 'あり' : 'なし'}`);
    
    // Monte Carlo検証
    console.log('🎲 Monte Carlo Bootstrapping実行中...');
    const monteCarlo = new MonteCarloBootstrapping();
    const mcResults = await monteCarlo.performBootstrapValidation(results, 100);
    
    console.log('✅ Monte Carlo完了');
    console.log(`  信頼区間: ${mcResults.confidenceInterval ? 
      `[${mcResults.confidenceInterval.lower?.toFixed(4)}, ${mcResults.confidenceInterval.upper?.toFixed(4)}]` : 'N/A'}`);
    
    return {
      walkForwardResults: results,
      monteCarloResults: mcResults,
      testDataLength: testData.length,
      success: true
    };
    
  } catch (error) {
    console.error('❌ 検証エラー:', error.message);
    return {
      success: false,
      error: error.message,
      stack: error.stack
    };
  }
}

// テスト実行
runVerificationTest()
  .then(result => {
    console.log('🏁 検証テスト完了');
    console.log('📋 最終結果:', JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
  })
  .catch(error => {
    console.error('🚨 予期しないエラー:', error);
    process.exit(1);
  });