#!/usr/bin/env node

/**
 * UNKNOWN戦略残高修正スクリプト
 *
 * 戦略間での売却処理の不整合により、UNKNOWN戦略に
 * 実際には売却済みのポジションが残っている問題を修正
 */

const { getClient, initialize: initializeRedis } = require('../src/database/redisDatabase');

async function fixUnknownStrategyBalance() {
  console.log('🔧 UNKNOWN戦略残高修正開始');
  console.log('================================================================================');

  try {
    await initializeRedis();
    const client = getClient();
    console.log('✅ Redis接続完了');
    console.log('');

    // 問題の通貨リスト（大きな差異のある通貨）
    const problemCurrencies = [
      { symbol: 'LTC/JPY', exchangeBalance: 0.015300, activeBalance: 0.014600 },
      { symbol: 'ETH/JPY', exchangeBalance: 0.002300, activeBalance: 0.002300 },
      { symbol: 'AVAX/JPY', exchangeBalance: 0.048300, activeBalance: 0.048300 },
      { symbol: 'DOGE/JPY', exchangeBalance: 19.866100, activeBalance: 4.548400 },
      { symbol: 'OMG/JPY', exchangeBalance: 7.712500, activeBalance: 7.712500 },
      { symbol: 'SOL/JPY', exchangeBalance: 0.000000, activeBalance: 0.000000 },
      { symbol: 'XRP/JPY', exchangeBalance: 0.665700, activeBalance: 1.215200 },
      { symbol: 'ADA/JPY', exchangeBalance: 0.929200, activeBalance: 0.497400 },
      { symbol: 'APE/JPY', exchangeBalance: 0.706300, activeBalance: 0.706300 }
    ];

    console.log(`📊 対象通貨: ${problemCurrencies.length}種類`);
    console.log('');

    let totalFixed = 0;

    for (const currencyInfo of problemCurrencies) {
      const { symbol, exchangeBalance, activeBalance } = currencyInfo;
      const unknownKey = `summary:trade:bitbank:${symbol}:UNKNOWN`;

      console.log(`🔍 ${symbol} の修正処理`);
      console.log('─'.repeat(50));

      try {
        // UNKNOWN戦略の現在状態を取得
        const exists = await client.exists(unknownKey);
        if (!exists) {
          console.log('  📝 UNKNOWN戦略キーが存在しません');
          console.log('');
          continue;
        }

        const unknownData = await client.hGetAll(unknownKey);
        const currentNetPosition = parseFloat(unknownData.netPosition || 0);
        const currentBuyAmount = parseFloat(unknownData.buyAmount || 0);
        const currentSellAmount = parseFloat(unknownData.sellAmount || 0);

        console.log('  現在の状況:');
        console.log(`    取引所残高: ${exchangeBalance}`);
        console.log(`    アクティブ戦略残高: ${activeBalance}`);
        console.log(`    UNKNOWN netPosition: ${currentNetPosition}`);
        console.log(`    UNKNOWN buyAmount: ${currentBuyAmount}`);
        console.log(`    UNKNOWN sellAmount: ${currentSellAmount}`);

        // 修正が必要かチェック
        const expectedUnknownBalance = Math.max(0, exchangeBalance - activeBalance);
        const excessBalance = currentNetPosition - expectedUnknownBalance;

        console.log(`    期待されるUNKNOWN残高: ${expectedUnknownBalance}`);
        console.log(`    過剰残高: ${excessBalance}`);

        if (excessBalance > 0.0001) { // 0.0001以上の過剰がある場合
          console.log(`  🔧 修正実行: ${excessBalance}分の過剰を解消`);

          // 売却量を追加して帳尻を合わせる
          const newSellAmount = currentSellAmount + excessBalance;
          const newNetPosition = currentBuyAmount - newSellAmount;

          // 実際の残高を基準とした値に調整
          const finalNetPosition = Math.max(0, expectedUnknownBalance);
          const finalSellAmount = currentBuyAmount - finalNetPosition;

          await client.hSet(unknownKey, {
            sellAmount: finalSellAmount.toFixed(8),
            netPosition: finalNetPosition.toFixed(8),
            totalSellRevenue: (parseFloat(unknownData.totalSellRevenue || 0) + excessBalance * parseFloat(unknownData.avgBuyPrice || 0)).toFixed(8),
            updatedAt: Date.now()
          });

          console.log('  ✅ 修正完了:');
          console.log(`    sellAmount: ${currentSellAmount} → ${finalSellAmount.toFixed(8)}`);
          console.log(`    netPosition: ${currentNetPosition} → ${finalNetPosition.toFixed(8)}`);

          totalFixed++;
        } else {
          console.log(`  📝 修正不要（差異: ${excessBalance.toFixed(8)}）`);
        }

      } catch (error) {
        console.error(`  ❌ ${symbol} 処理エラー: ${error.message}`);
      }

      console.log('');
    }

    console.log('================================================================================');
    console.log(`🎉 修正完了: ${totalFixed}通貨のUNKNOWN戦略残高を調整`);

    return { totalFixed };

  } catch (error) {
    console.error('❌ 修正処理エラー:', error);
    throw error;
  }
}

// スクリプト実行
if (require.main === module) {
  fixUnknownStrategyBalance().then((result) => {
    console.log(`\\n📊 最終結果: ${result.totalFixed}通貨のUNKNOWN戦略残高を修正`);
    process.exit(0);
  }).catch((error) => {
    console.error('❌ スクリプト実行失敗:', error);
    process.exit(1);
  });
}

module.exports = { fixUnknownStrategyBalance };