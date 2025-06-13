const { initRedisClient } = require('../src/database/redisClient');
const { getTradeSummary } = require('../src/database/redisDatabase');
const { executeStopLoss } = require('../src/strategies/utils/riskManagement');
const { config } = require('../src/config');

async function testImprovedStopLoss() {
  try {
    await initRedisClient();
    console.log('=== 改善されたストップロステスト ===\n');
    
    const exchange = config.exchanges.bitbank.instance;
    const symbol = 'OMG/JPY';
    const baseAsset = 'OMG';
    
    // テスト用の戦略
    const testStrategies = ['MEAN_REVERSION', 'MUTUAL_INFO', 'TEST_STRATEGY'];
    
    for (const strategyKey of testStrategies) {
      console.log(`\n--- 戦略: ${strategyKey} ---`);
      
      // サマリー情報を取得
      const summary = await getTradeSummary({
        exchangeId: exchange.id,
        symbol: symbol,
        strategyKey: strategyKey
      });
      
      const netPosition = summary?.netPosition || 0;
      console.log(`正味ポジション: ${netPosition} ${baseAsset}`);
      
      // 実際の残高を確認
      const balance = await exchange.fetchBalance();
      const availableAmount = balance.free[baseAsset] || 0;
      console.log(`利用可能残高: ${availableAmount} ${baseAsset}`);
      
      // テスト用のポジション情報
      const testPosition = {
        amount: 10, // 個別ポジション量
        entryPrice: 25,
        key: `test:position:${strategyKey}`,
        orderId: 'test123',
        symbol: symbol,
        strategyKey: strategyKey,
        side: 'buy',
        status: 'open'
      };
      
      // マーケットパラメータ
      const marketParameters = {
        amountPrecision: 4,
        minTradeAmount: 0.0001
      };
      
      console.log(`\nストップロス実行テスト:`);
      console.log(`- 個別ポジション量: ${testPosition.amount}`);
      console.log(`- 正味ポジション: ${netPosition}`);
      console.log(`- 利用可能残高: ${availableAmount}`);
      console.log(`- 売却可能量: ${Math.min(testPosition.amount, netPosition, availableAmount)}`);
      
      // executeStopLossは実際には実行しない（ドライラン）
      console.log(`\n結果: ${strategyKey}`);
      if (netPosition <= 0) {
        console.log('→ 正味ポジションがゼロ以下のため、ストップロスはスキップされます');
      } else if (availableAmount <= 0) {
        console.log('→ 利用可能残高がゼロのため、エラーになります');
      } else {
        const sellAmount = Math.min(testPosition.amount, netPosition, availableAmount);
        console.log(`→ ${sellAmount} ${baseAsset} を売却可能`);
      }
    }
    
    console.log('\n=== テスト完了 ===');
    
  } catch (error) {
    console.error('テストエラー:', error);
  }
  
  process.exit(0);
}

testImprovedStopLoss().catch(console.error);