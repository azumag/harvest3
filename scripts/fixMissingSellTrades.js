#!/usr/bin/env node

/**
 * 欠落した売却取引のtrade_summary修正スクリプト
 *
 * MongoDBに記録されているがRedis trade_summaryに反映されていない
 * 売却取引を特定し、手動でtrade_summaryを修正する
 */

const { connectDB } = require('../src/database/mongoDatabase');
const { getClient, initialize: initializeRedis } = require('../src/database/redisDatabase');
const { updateTradeSummary } = require('../src/database/redisDatabase');

async function fixMissingSellTrades() {
  console.log('🔧 欠落した売却取引のtrade_summary修正開始');
  console.log('================================================================================');

  try {
    await connectDB();
    await initializeRedis();
    const client = getClient();

    // MongoDBのコレクション参照を取得
    const mongoModule = require('../src/database/mongoDatabase');
    const tradesCollection = mongoModule.tradesCollection;

    console.log('✅ データベース接続完了');
    console.log('');

    // 問題の通貨リスト（100%差異の通貨）
    const problemCurrencies = [
      'AXS/JPY', 'BAT/JPY', 'ADA/JPY', 'BTC/JPY',
      'BOBA/JPY', 'DOGE/JPY', 'AVAX/JPY', 'QTUM/JPY', 'OAS/JPY'
    ];

    console.log(`📊 対象通貨: ${problemCurrencies.join(', ')}`);
    console.log('');

    let totalFixed = 0;

    for (const symbol of problemCurrencies) {
      console.log(`🔍 ${symbol} の売却取引チェック`);
      console.log('─'.repeat(50));

      try {
        // MongoDB内の売却取引を取得
        const sellTrades = await tradesCollection
          .find({ symbol: symbol, side: 'sell' })
          .sort({ _id: -1 })
          .limit(10)
          .toArray();

        console.log(`  MongoDB売却取引: ${sellTrades.length}件`);

        if (sellTrades.length === 0) {
          console.log('  📝 売却取引なし');
          console.log('');
          continue;
        }

        // 各戦略のRedis trade_summaryを確認
        for (const trade of sellTrades) {
          const strategy = trade.strategy || 'UNKNOWN';
          const summaryKey = `summary:trade:bitbank:${symbol}:${strategy}`;

          console.log(`  📊 ${strategy} 戦略の売却: ${trade.amount} (OrderID: ${trade.orderId})`);

          // Redis trade_summaryの現在状態確認
          const exists = await client.exists(summaryKey);
          if (!exists) {
            console.log(`    ⚠️  trade_summaryキーが存在しません: ${summaryKey}`);
            continue;
          }

          const currentSummary = await client.hGetAll(summaryKey);
          const currentSellAmount = parseFloat(currentSummary.sellAmount || 0);
          const expectedSellAmount = currentSellAmount + trade.amount;

          console.log(`    現在のsellAmount: ${currentSellAmount}`);
          console.log(`    この売却反映後: ${expectedSellAmount}`);

          // 売却取引をtrade_summaryに反映
          try {
            console.log('    updateTradeSummary実行中...');
            await updateTradeSummary({
              exchange: trade.exchange,
              symbol: trade.symbol,
              strategy: strategy,
              side: trade.side,
              amount: trade.amount,
              price: trade.price,
              value: trade.value,
              orderId: trade.orderId,
              fee: trade.fee || 0,
              timestamp: trade.timestamp
            });

            // 更新後の確認
            const updatedSummary = await client.hGetAll(summaryKey);
            const updatedSellAmount = parseFloat(updatedSummary.sellAmount || 0);
            const updatedNetPosition = parseFloat(updatedSummary.netPosition || 0);

            console.log(`    ✅ 更新完了: sellAmount=${updatedSellAmount}, netPosition=${updatedNetPosition}`);
            totalFixed++;

          } catch (updateError) {
            console.error(`    ❌ 更新エラー: ${updateError.message}`);
          }
        }

      } catch (error) {
        console.error(`  ❌ ${symbol} 処理エラー: ${error.message}`);
      }

      console.log('');
    }

    console.log('================================================================================');
    console.log(`🎉 修正完了: ${totalFixed}件の売却取引をtrade_summaryに反映`);

    return { totalFixed };

  } catch (error) {
    console.error('❌ 修正処理エラー:', error);
    throw error;
  }
}

// スクリプト実行
if (require.main === module) {
  fixMissingSellTrades().then((result) => {
    console.log(`\\n📊 最終結果: ${result.totalFixed}件の売却取引を修正`);
    process.exit(0);
  }).catch((error) => {
    console.error('❌ スクリプト実行失敗:', error);
    process.exit(1);
  });
}

module.exports = { fixMissingSellTrades };