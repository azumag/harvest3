#!/usr/bin/env node

/**
 * 戦略キー取得処理テストスクリプト
 * 
 * getOrderStrategyKeyByOrderId関数の動作を詳しくテストし、
 * なぜ戦略情報が取得できていないかを調査する
 */

const { connectDB } = require('../src/database/mongoDatabase');
const { getOrderByOrderId } = require('../src/database/mongoDatabase');
const { getOrderStrategyKeyByOrderId } = require('../src/database/manager');

async function testStrategyKeyRetrieval() {
  console.log('🔍 戦略キー取得処理テスト開始');
  console.log('================================================================================');
  
  try {
    await connectDB();
    console.log('✅ データベース接続完了');
    console.log('');
    
    // テスト対象のOrderID（最新の約定から）
    const testOrderIds = [
      '47043808593', // XLM/JPY - BOLLINGER_BANDS
      '47043692233', // SOL/JPY
      '47043226996', // APE/JPY  
      '47043928294', // LINK/JPY
      '47043942898'  // LINK/JPY
    ];
    
    for (const orderId of testOrderIds) {
      console.log(`📊 OrderID: ${orderId} のテスト`);
      console.log('─'.repeat(60));
      
      try {
        // Step 1: 直接MongoDB orders collectionからデータ取得
        console.log('  Step 1: 直接MongoDB orders collectionから取得');
        const order = await getOrderByOrderId(orderId);
        
        if (order) {
          console.log(`    ✅ Order取得成功`);
          console.log(`    - Symbol: ${order.symbol}`);
          console.log(`    - Strategy: ${order.strategy}`);
          console.log(`    - StrategyKey: ${order.strategyKey}`);
          console.log(`    - Other fields: ${Object.keys(order).join(', ')}`);
        } else {
          console.log(`    ❌ Order取得失敗: データが見つかりません`);
        }
        
        // Step 2: getOrderStrategyKeyByOrderId関数テスト
        console.log('  Step 2: getOrderStrategyKeyByOrderId関数テスト');
        const strategyKey = await getOrderStrategyKeyByOrderId(orderId);
        console.log(`    結果: "${strategyKey}"`);
        
        // Step 3: 期待値との比較
        console.log('  Step 3: 期待値との比較');
        if (order && order.strategy) {
          const expected = order.strategy;
          const actual = strategyKey;
          
          if (expected === actual) {
            console.log(`    ✅ 一致: 期待値="${expected}", 実際="${actual}"`);
          } else {
            console.log(`    ❌ 不一致: 期待値="${expected}", 実際="${actual}"`);
            
            // 詳細分析
            console.log(`    詳細分析:`);
            console.log(`      - order.strategy: "${order.strategy}" (type: ${typeof order.strategy})`);
            console.log(`      - order && order.strategy: ${order && order.strategy}`);
            console.log(`      - 戻り値の条件: ${order && order.strategy ? order.strategy : 'OUTSIDE'}`);
          }
        } else {
          console.log(`    📝 期待値なし（orders collectionに戦略情報なし）`);
        }
        
      } catch (error) {
        console.error(`    ❌ テストエラー: ${error.message}`);
      }
      
      console.log('');
    }
    
    console.log('================================================================================');
    console.log('🎉 戦略キー取得処理テスト完了');
    
  } catch (error) {
    console.error('❌ テスト実行エラー:', error);
    throw error;
  }
}

// スクリプト実行
if (require.main === module) {
  testStrategyKeyRetrieval().then(() => {
    console.log('\\n📊 テスト完了');
    process.exit(0);
  }).catch((error) => {
    console.error('❌ テスト実行失敗:', error);
    process.exit(1);
  });
}

module.exports = { testStrategyKeyRetrieval };