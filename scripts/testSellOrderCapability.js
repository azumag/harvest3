/**
 * 売り注文実行能力テスト
 * 取引サマリー再構築後の売り注文可能性を確認
 */
require('dotenv').config();
const ccxt = require('ccxt');

async function testSellOrderCapability() {
  try {
    console.log('=== 売り注文実行能力テスト ===');
    
    // 取引所接続
    const exchange = new ccxt.bitbank({
      apiKey: process.env.BB_API_KEY,
      secret: process.env.BB_API_SECRET
    });
    
    // 動的にmanagerを読み込み
    const { formattedAvailableAmount } = require('../src/database/manager');
    
    // テスト対象（ポジションがある主要通貨）
    const testCases = [
      { symbol: 'GALA/JPY', strategy: 'BOLLINGER_BANDS' },
      { symbol: 'FLR/JPY', strategy: 'OSCILLATOR' },
      { symbol: 'XYM/JPY', strategy: 'BOLLINGER_BANDS' },
      { symbol: 'ETH/JPY', strategy: 'BOLLINGER_BANDS' },
      { symbol: 'XRP/JPY', strategy: 'BOLLINGER_BANDS' },
      { symbol: 'ARB/JPY', strategy: 'BOLLINGER_BANDS' },
      { symbol: 'ATOM/JPY', strategy: 'BOLLINGER_BANDS' },
      { symbol: 'OMG/JPY', strategy: 'BOLLINGER_BANDS' }
    ];
    
    console.log(`\n対象テストケース: ${testCases.length}件`);
    
    let successCount = 0;
    let totalAvailable = 0;
    
    for (const testCase of testCases) {
      try {
        console.log(`\n--- ${testCase.symbol} (${testCase.strategy}) ---`);
        
        // 売却可能量を確認
        const available = await formattedAvailableAmount(
          exchange, 
          testCase.symbol, 
          testCase.strategy, 
          4, // amountPrecision
          {} // options (リアルタイムモード)
        );
        
        console.log(`売却可能量: ${available}`);
        
        if (available > 0) {
          successCount++;
          totalAvailable += available;
          console.log(`✅ 売り注文実行可能`);
          
          // 最小取引量と比較
          const market = exchange.markets[testCase.symbol];
          const minAmount = market?.limits?.amount?.min || 0.0001;
          
          if (available >= minAmount) {
            console.log(`✅ 最小取引量(${minAmount})をクリア`);
          } else {
            console.log(`⚠️ 最小取引量(${minAmount})未満`);
          }
        } else {
          console.log(`❌ 売却不可（残高0）`);
        }
        
        // API制限回避
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.log(`❌ エラー: ${error.message}`);
      }
    }
    
    // 結果サマリー
    console.log('\n=== テスト結果サマリー ===');
    console.log(`売り注文可能ケース: ${successCount}/${testCases.length}件`);
    console.log(`総売却可能量: ${totalAvailable.toFixed(6)}`);
    
    if (successCount > 0) {
      console.log('🎉 売り注文実行が可能になりました！');
      console.log('✅ 取引サマリー再構築により問題が解決されました');
    } else {
      console.log('⚠️ まだ売り注文が実行できません。追加調査が必要です。');
    }
    
    // 今後の監視ポイント
    console.log('\n=== 今後の監視ポイント ===');
    console.log('1. 戦略実行ログで売りシグナル発生を確認');
    console.log('2. 未約定売り注文の増加を監視');
    console.log('3. ポジション偏りの改善を確認');
    console.log('4. 数時間後に再度ポジション分析実行');
    
    console.log('\n✅ 売り注文能力テスト完了');
    
  } catch (error) {
    console.error('❌ エラー:', error.message);
  }
}

testSellOrderCapability();