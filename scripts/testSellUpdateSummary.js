#!/usr/bin/env node

/**
 * 売却取引のtrade_summary更新テストスクリプト
 * 
 * 実際の売却取引データを使用してupdateTradeSummary関数の動作をテストし、
 * なぜ売却がtrade_summaryに反映されないかを調査する
 */

const { getClient, initialize: initializeRedis } = require('../src/database/redisDatabase');
const { updateTradeSummary } = require('../src/database/redisDatabase');

async function testSellUpdateSummary() {
  console.log('🔍 売却取引のtrade_summary更新テスト開始');
  console.log('================================================================================');
  
  try {
    await initializeRedis();
    const client = getClient();
    console.log('✅ Redis接続完了');
    console.log('');
    
    // Test 1: AXS BOLLINGER_BANDS売却前の状態確認
    console.log('⏰ Test 1: AXS BOLLINGER_BANDS売却前の状態確認');
    console.log('-------------------------------------------');
    
    const axsSummaryKey = 'trade_summary:bitbank:AXS/JPY:BOLLINGER_BANDS';
    const beforeSummary = await client.hGetAll(axsSummaryKey);
    
    console.log('  売却前のsummary:');
    Object.keys(beforeSummary).forEach(key => {
      console.log(`    ${key}: ${beforeSummary[key]}`);
    });
    console.log('');
    
    // Test 2: 模擬売却取引でupdateTradeSummary実行
    console.log('⏰ Test 2: 模擬売却取引でupdateTradeSummary実行');
    console.log('----------------------------------------------');
    
    const testSellTrade = {
      exchange: 'bitbank',
      symbol: 'AXS/JPY',
      strategy: 'BOLLINGER_BANDS',
      side: 'sell',
      amount: 0.5447,  // 実際の売却データ
      price: 319.697,
      value: 0.5447 * 319.697,
      orderId: '47029433617',
      fee: 0.1,
      timestamp: Date.now()
    };
    
    console.log('  テスト売却取引データ:');
    Object.keys(testSellTrade).forEach(key => {
      console.log(`    ${key}: ${testSellTrade[key]}`);
    });
    console.log('');
    
    try {
      console.log('  updateTradeSummary実行中...');
      await updateTradeSummary(testSellTrade);
      console.log('  ✅ updateTradeSummary実行完了');
    } catch (updateError) {
      console.error(`  ❌ updateTradeSummary実行エラー: ${updateError.message}`);
    }
    
    // Test 3: 売却後の状態確認
    console.log('⏰ Test 3: 売却後の状態確認');
    console.log('---------------------------');
    
    const afterSummary = await client.hGetAll(axsSummaryKey);
    
    console.log('  売却後のsummary:');
    Object.keys(afterSummary).forEach(key => {
      console.log(`    ${key}: ${afterSummary[key]}`);
    });
    console.log('');
    
    // Test 4: 変更内容の比較
    console.log('⏰ Test 4: 変更内容の比較');
    console.log('-------------------------');
    
    const sellAmountBefore = parseFloat(beforeSummary.sellAmount || 0);
    const sellAmountAfter = parseFloat(afterSummary.sellAmount || 0);
    const netPositionBefore = parseFloat(beforeSummary.netPosition || 0);
    const netPositionAfter = parseFloat(afterSummary.netPosition || 0);
    
    console.log(`  sellAmount: ${sellAmountBefore} → ${sellAmountAfter} (変化: ${sellAmountAfter - sellAmountBefore})`);
    console.log(`  netPosition: ${netPositionBefore} → ${netPositionAfter} (変化: ${netPositionAfter - netPositionBefore})`);
    
    const expectedSellAmount = sellAmountBefore + testSellTrade.amount;
    const expectedNetPosition = netPositionBefore - testSellTrade.amount;
    
    console.log(`  期待値 sellAmount: ${expectedSellAmount}`);
    console.log(`  期待値 netPosition: ${expectedNetPosition}`);
    
    if (Math.abs(sellAmountAfter - expectedSellAmount) < 0.0001) {
      console.log('  ✅ sellAmount更新正常');
    } else {
      console.log('  ❌ sellAmount更新異常');
    }
    
    if (Math.abs(netPositionAfter - expectedNetPosition) < 0.0001) {
      console.log('  ✅ netPosition更新正常');
    } else {
      console.log('  ❌ netPosition更新異常');
    }
    
    console.log('');
    console.log('================================================================================');
    console.log('🎉 売却取引のtrade_summary更新テスト完了');
    
  } catch (error) {
    console.error('❌ テスト実行エラー:', error);
    throw error;
  }
}

// スクリプト実行
if (require.main === module) {
  testSellUpdateSummary().then(() => {
    console.log('\\n📊 テスト完了');
    process.exit(0);
  }).catch((error) => {
    console.error('❌ テスト実行失敗:', error);
    process.exit(1);
  });
}

module.exports = { testSellUpdateSummary };