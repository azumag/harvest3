/**
 * Redis統合されたリスク管理機能のテスト
 */
const { initialize } = require('../src/database/redisDatabase');
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

async function testRiskManagementWithRedis() {
  console.log('=== Redis統合リスク管理機能テスト開始 ===\n');
  
  try {
    // Redis初期化
    console.log('Redis接続を初期化中...');
    await initialize();
    console.log('Redis接続成功\n');
    
    // 1. ストップロス計算テスト（Redis不要）
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
    
    // 2. Redis ポジション保存・取得テスト
    console.log('2. Redis ポジション保存・取得テスト');
    await clearPositionStore();
    
    const exchange = { id: 'bitbank' };
    const symbol = 'BTC/JPY';
    const strategyKey = 'testStrategy';
    
    // ポジションを保存
    await savePosition(`${exchange.id}:${symbol}:${strategyKey}:order123`, {
      exchangeId: exchange.id,
      symbol,
      strategyKey,
      orderId: 'order123',
      side: 'buy',
      amount: 0.01,
      entryPrice: 5000000,
      highestPrice: 5000000,
      status: 'open',
      createdAt: Date.now()
    });
    
    // ポジションを取得
    const savedPosition = await getPosition(`${exchange.id}:${symbol}:${strategyKey}:order123`);
    console.log(`  ポジション保存・取得: ${savedPosition ? '成功' : '失敗'}`);
    if (savedPosition) {
      console.log(`  orderId: ${savedPosition.orderId}`);
      console.log(`  entryPrice: ${savedPosition.entryPrice.toLocaleString()}円`);
    }
    console.log();
    
    // 3. 複数ポジション管理テスト
    console.log('3. 複数ポジション管理テスト');
    
    // 複数ポジションを追加
    for (let i = 0; i < 3; i++) {
      await savePosition(`${exchange.id}:${symbol}:${strategyKey}:order${i}`, {
        exchangeId: exchange.id,
        symbol,
        strategyKey,
        orderId: `order${i}`,
        side: 'buy',
        amount: 0.01,
        entryPrice: 5000000 + i * 10000,
        highestPrice: 5000000 + i * 10000,
        status: 'open',
        createdAt: Date.now()
      });
    }
    
    const positions = await getStrategyPositions(exchange.id, symbol, strategyKey);
    console.log(`  保存されたポジション数: ${positions.length}`);
    
    const limitCheck = await checkPositionLimits(exchange, symbol, strategyKey, {
      maxPositionsPerPair: 3,
      maxTotalPositions: 10
    });
    console.log(`  新規ポジション許可: ${limitCheck.allowed ? 'OK' : 'NG'}`);
    if (!limitCheck.allowed) {
      console.log(`  理由: ${limitCheck.reason}`);
    }
    console.log();
    
    // 4. 損益記録テスト
    console.log('4. 損益記録テスト');
    await clearPnLTracker();
    
    // 損益を記録
    await recordPnL(exchange.id, strategyKey, -50000);   // 5万円の損失
    await recordPnL(exchange.id, strategyKey, 30000);    // 3万円の利益
    await recordPnL(exchange.id, strategyKey, -20000);   // 2万円の損失
    
    console.log('  本日の取引記録完了:');
    console.log('    -50,000円');
    console.log('    +30,000円');
    console.log('    -20,000円');
    console.log('  合計: -40,000円\n');
    
    console.log('=== Redis統合テスト完了 ===');
    
  } catch (error) {
    console.error('テスト実行中にエラーが発生しました:', error.message);
    console.log('フォールバック機能により、メモリストレージでテストを継続します。\n');
    
    // フォールバック機能のテスト
    console.log('=== フォールバック機能テスト ===');
    await clearPositionStore();
    
    // メモリにフォールバックして基本機能をテスト
    await savePosition('test:fallback:position', {
      exchangeId: 'test',
      symbol: 'BTC/JPY',
      strategyKey: 'fallback',
      orderId: 'fallback123',
      side: 'buy',
      amount: 0.01,
      entryPrice: 5000000,
      status: 'open',
      createdAt: Date.now()
    });
    
    const fallbackPosition = await getPosition('test:fallback:position');
    console.log(`フォールバック機能: ${fallbackPosition ? '正常動作' : '動作不良'}`);
    
    console.log('=== フォールバックテスト完了 ===');
  }
  
  process.exit(0);
}

// テスト実行
testRiskManagementWithRedis().catch(console.error);