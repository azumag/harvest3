/**
 * リスク管理機能の動作確認テスト
 */
const { 
  DEFAULT_RISK_SETTINGS,
  savePosition,
  getPosition,
  getStrategyPositions,
  calculateStopLossPrice,
  checkStopLoss,
  checkPositionLimits,
  recordBuyPosition,
  recordPnL,
  clearPositionStore,
  clearPnLTracker
} = require('../src/strategies/utils/riskManagement');

async function testRiskManagement() {
  console.log('=== リスク管理機能テスト開始 ===\n');
  
  // 1. ストップロス計算テスト
  console.log('1. ストップロス計算テスト');
  const position = {
    entryPrice: 5000000,  // 500万円
    highestPrice: 5000000
  };
  
  // 固定ストップロス
  const fixedStopLoss = calculateStopLossPrice(position, 5000000);
  console.log(`  エントリー価格: ${position.entryPrice.toLocaleString()}円`);
  console.log(`  固定ストップロス(-2%): ${fixedStopLoss.toLocaleString()}円`);
  
  // トレーリングストップ
  position.highestPrice = 5100000; // 2%上昇
  const trailingStopLoss = calculateStopLossPrice(position, 5080000);
  console.log(`  最高値: ${position.highestPrice.toLocaleString()}円`);
  console.log(`  トレーリングストップ(-1%): ${trailingStopLoss.toLocaleString()}円\n`);
  
  // 2. ポジション制限テスト
  console.log('2. ポジション制限テスト');
  clearPositionStore();
  
  const exchange = { id: 'bitbank' };
  const symbol = 'BTC/JPY';
  const strategyKey = 'testStrategy';
  
  // 複数ポジションを追加
  for (let i = 0; i < 3; i++) {
    savePosition(`bitbank:BTC/JPY:testStrategy:order${i}`, {
      exchangeId: 'bitbank',
      symbol: 'BTC/JPY',
      strategyKey: 'testStrategy',
      status: 'open',
      side: 'buy',
      amount: 0.01,
      entryPrice: 5000000 + i * 10000
    });
  }
  
  const positions = getStrategyPositions('bitbank', 'BTC/JPY', 'testStrategy');
  console.log(`  現在のポジション数: ${positions.length}`);
  
  const limitCheck = await checkPositionLimits(exchange, symbol, strategyKey, {
    maxPositionsPerPair: 3,
    maxTotalPositions: 10
  });
  console.log(`  新規ポジション許可: ${limitCheck.allowed ? 'OK' : 'NG'}`);
  if (!limitCheck.allowed) {
    console.log(`  理由: ${limitCheck.reason}`);
  }
  console.log();
  
  // 3. ストップロス検出テスト
  console.log('3. ストップロス検出テスト');
  clearPositionStore();
  
  // テスト用ポジションを作成
  savePosition('bitbank:BTC/JPY:testStrategy:order1', {
    exchangeId: 'bitbank',
    symbol: 'BTC/JPY',
    strategyKey: 'testStrategy',
    orderId: 'order1',
    side: 'buy',
    amount: 0.01,
    entryPrice: 5000000,
    highestPrice: 5000000,
    status: 'open',
    createdAt: Date.now()
  });
  
  // 価格が3%下落した場合
  const currentPrice = 4850000;
  const stopLossPositions = await checkStopLoss(exchange, symbol, strategyKey, currentPrice);
  
  console.log(`  現在価格: ${currentPrice.toLocaleString()}円`);
  console.log(`  ストップロス検出数: ${stopLossPositions.length}`);
  if (stopLossPositions.length > 0) {
    const slPos = stopLossPositions[0];
    console.log(`  ストップロス価格: ${slPos.stopLossPrice.toLocaleString()}円`);
    console.log(`  理由: ${slPos.reason}`);
  }
  console.log();
  
  // 4. 損益記録テスト
  console.log('4. 損益記録テスト');
  clearPnLTracker();
  
  // 損益を記録
  recordPnL('bitbank', 'testStrategy', -50000);   // 5万円の損失
  recordPnL('bitbank', 'testStrategy', 30000);    // 3万円の利益
  recordPnL('bitbank', 'testStrategy', -20000);   // 2万円の損失
  
  console.log('  本日の取引:');
  console.log('    -50,000円');
  console.log('    +30,000円');
  console.log('    -20,000円');
  console.log('  合計: -40,000円\n');
  
  console.log('=== テスト完了 ===');
}

// テスト実行
testRiskManagement().catch(console.error);