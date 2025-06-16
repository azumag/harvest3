const { calculateATR, calculateVolatilityBasedPositionSize } = require('../src/strategies/utils/indicators');
const { DynamicPositionSizing } = require('../src/strategies/utils/positionSizing');
const { PerformanceTracker } = require('../src/strategies/utils/performanceTracker');

// ATR計算のテスト
function testATR() {
  console.log('=== ATR計算テスト ===');
  
  const ohlcData = [
    { high: 100, low: 98, close: 99 },
    { high: 102, low: 99, close: 101 },
    { high: 104, low: 101, close: 103 },
    { high: 105, low: 102, close: 104 },
    { high: 106, low: 103, close: 105 },
    { high: 108, low: 104, close: 107 },
    { high: 109, low: 106, close: 108 },
    { high: 110, low: 107, close: 109 },
    { high: 112, low: 108, close: 111 },
    { high: 113, low: 110, close: 112 },
    { high: 115, low: 111, close: 114 },
    { high: 116, low: 113, close: 115 },
    { high: 118, low: 114, close: 117 },
    { high: 119, low: 116, close: 118 },
    { high: 121, low: 117, close: 120 }
  ];
  
  const atr = calculateATR(ohlcData, 14);
  console.log('ATR結果:', atr);
  console.log('最新ATR:', atr[atr.length - 1]);
  
  // ポジションサイズ計算テスト
  const accountBalance = 1000000; // 100万円
  const riskPerTrade = 0.01; // 1%
  const latestATR = atr[atr.length - 1];
  const atrMultiplier = 2;
  const currentPrice = 120;
  
  const positionSize = calculateVolatilityBasedPositionSize(
    accountBalance,
    riskPerTrade,
    latestATR,
    atrMultiplier,
    currentPrice
  );
  
  console.log('計算されたポジションサイズ:', positionSize);
  console.log('');
}

// 動的ポジションサイジングのテスト
function testDynamicPositionSizing() {
  console.log('=== 動的ポジションサイジングテスト ===');
  
  const config = {
    baseRiskPerTrade: 0.01,
    atrPeriod: 14,
    atrMultiplier: 2,
    maxPositionPercent: 0.1,
    minPositionPercent: 0.001,
    kellyEnabled: false,
    performanceAdjustment: true
  };
  
  const sizing = new DynamicPositionSizing(config);
  
  const ohlcData = [];
  for (let i = 0; i < 30; i++) {
    const base = 100 + i;
    ohlcData.push({
      high: base + Math.random() * 3,
      low: base - Math.random() * 3,
      close: base + (Math.random() - 0.5) * 2
    });
  }
  
  const result = sizing.calculateATRBasedPosition({
    accountBalance: 1000000,
    ohlcData,
    currentPrice: 130,
    strategyKey: 'TEST_STRATEGY'
  });
  
  console.log('動的ポジションサイジング結果:', result);
  console.log('');
}

// パフォーマンス追跡のテスト
async function testPerformanceTracker() {
  console.log('=== パフォーマンス追跡テスト ===');
  
  const tracker = new PerformanceTracker();
  
  // いくつかのトレードを記録
  const trades = [
    { side: 'buy', amount: 0.1, price: 100, pnl: null },
    { side: 'sell', amount: 0.1, price: 105, pnl: 50 },
    { side: 'buy', amount: 0.15, price: 103, pnl: null },
    { side: 'sell', amount: 0.15, price: 98, pnl: -75 },
    { side: 'buy', amount: 0.12, price: 97, pnl: null },
    { side: 'sell', amount: 0.12, price: 102, pnl: 60 }
  ];
  
  for (const trade of trades) {
    await tracker.recordTrade('bitbank', 'BTC/JPY', 'TEST_STRATEGY', trade);
  }
  
  const performance = await tracker.getPerformance('bitbank', 'BTC/JPY', 'TEST_STRATEGY');
  console.log('パフォーマンス情報:', performance);
  
  const report = await tracker.generatePerformanceReport('bitbank', 'BTC/JPY', 'TEST_STRATEGY');
  console.log('パフォーマンスレポート:', JSON.stringify(report, null, 2));
  console.log('');
}

// テスト実行
async function runTests() {
  try {
    testATR();
    testDynamicPositionSizing();
    await testPerformanceTracker();
    console.log('=== 全てのテストが完了しました ===');
  } catch (error) {
    console.error('テストエラー:', error.message);
  }
}

// テストを実行
if (require.main === module) {
  runTests();
}

module.exports = {
  testATR,
  testDynamicPositionSizing,
  testPerformanceTracker
};