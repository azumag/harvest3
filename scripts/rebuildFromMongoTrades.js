#!/usr/bin/env node

/**
 * MongoDB取引履歴ベースの正しいtrade_summary再構築スクリプト
 *
 * positionキーではなく、MongoDB内の実際の取引履歴に基づいて
 * trade_summaryを正確に再構築する
 */

const { connectDB } = require('../src/database/mongoDatabase');
const { getClient, initialize: initializeRedis } = require('../src/database/redisDatabase');

async function rebuildFromMongoTrades() {
  console.log('🔧 MongoDB取引履歴ベースの正しいtrade_summary再構築開始');
  console.log('================================================================================');

  try {
    await connectDB();
    await initializeRedis();
    const client = getClient();

    // MongoDBのコレクション参照を取得
    const mongoModule = require('../src/database/mongoDatabase');
    const tradesCollection = mongoModule.tradesCollection;

    if (!tradesCollection) {
      throw new Error('tradesCollection not available');
    }

    console.log('✅ データベース接続完了');

    // 既存のtrade_summaryキーを削除
    const existingSummaries = await client.keys('summary:trade:*');
    if (existingSummaries.length > 0) {
      await client.del(existingSummaries);
      console.log(`✅ 既存のtrade_summary削除: ${existingSummaries.length}件`);
    }

    // MongoDB内の全取引履歴を取得
    console.log('📊 MongoDB取引履歴を分析中...');
    const allTrades = await tradesCollection.find({}).toArray();
    console.log(`📊 取得した取引: ${allTrades.length}件`);

    if (allTrades.length === 0) {
      console.log('⚠️  取引履歴が見つかりません');
      return;
    }

    // 戦略別・通貨別にグループ化して集計
    const summaryByKey = new Map(); // key: 'exchange:symbol:strategy'

    for (const trade of allTrades) {
      try {
        const exchange = trade.exchange || 'bitbank';
        const symbol = trade.symbol;
        const strategy = trade.strategyKey || 'OUTSIDE';
        const side = trade.side;
        const amount = parseFloat(trade.amount) || 0;
        const value = parseFloat(trade.value) || 0;
        const fee = parseFloat(trade.fee) || 0;

        if (!symbol || !side || amount <= 0) {
          console.warn(`  無効な取引をスキップ: ${JSON.stringify(trade)}`);
          continue;
        }

        const summaryKey = `${exchange}:${symbol}:${strategy}`;

        if (!summaryByKey.has(summaryKey)) {
          summaryByKey.set(summaryKey, {
            exchange,
            symbol,
            strategy,
            buyAmount: 0,
            sellAmount: 0,
            totalBuyCost: 0,
            totalSellRevenue: 0,
            netPosition: 0,
            totalFee: 0,
            realizedPnL: 0,
            buyCount: 0,
            sellCount: 0,
            firstTradeAt: trade.filledAt,
            lastTradeAt: trade.filledAt
          });
        }

        const summary = summaryByKey.get(summaryKey);

        // 取引日時の更新
        if (trade.filledAt < summary.firstTradeAt) {
          summary.firstTradeAt = trade.filledAt;
        }
        if (trade.filledAt > summary.lastTradeAt) {
          summary.lastTradeAt = trade.filledAt;
        }

        if (side === 'buy') {
          summary.buyAmount += amount;
          summary.totalBuyCost += value;
          summary.netPosition += amount;
          summary.buyCount++;
        } else if (side === 'sell') {
          summary.sellAmount += amount;
          summary.totalSellRevenue += value;
          summary.netPosition -= amount;
          summary.sellCount++;
        }

        summary.totalFee += fee;

      } catch (error) {
        console.error(`  取引処理エラー: ${error.message}`, trade);
      }
    }

    console.log(`📈 再構築されるサマリー: ${summaryByKey.size}件`);
    console.log('');

    // Redisにtrade_summaryキーを作成
    let createdCount = 0;
    const problemCurrencies = ['XRP/JPY', 'OMG/JPY', 'GALA/JPY', 'OAS/JPY'];

    for (const [summaryKey, data] of summaryByKey) {
      const redisKey = `summary:trade:${data.exchange}:${data.symbol}:${data.strategy}`;

      try {
        await client.hSet(redisKey, {
          buyAmount: data.buyAmount.toFixed(8),
          sellAmount: data.sellAmount.toFixed(8),
          totalBuyCost: data.totalBuyCost.toFixed(8),
          totalSellRevenue: data.totalSellRevenue.toFixed(8), // 修正: totalSellValue -> totalSellRevenue
          netPosition: data.netPosition.toFixed(8),
          avgBuyPrice: data.buyAmount > 0 ? (data.totalBuyCost / data.buyAmount).toFixed(8) : '0',
          avgSellPrice: data.sellAmount > 0 ? (data.totalSellRevenue / data.sellAmount).toFixed(8) : '0',
          realizedPnL: data.realizedPnL.toFixed(8),
          totalFee: data.totalFee.toFixed(8),
          createdAt: Date.now(),
          updatedAt: Date.now()
        });

        createdCount++;

        // 問題通貨の詳細表示
        if (problemCurrencies.includes(data.symbol)) {
          console.log(`🔍 ${data.exchange}:${data.symbol}:${data.strategy}:`);
          console.log(`  買い: ${data.buyAmount.toFixed(6)} (${data.buyCount}回, ${data.totalBuyCost.toFixed(2)}円)`);
          console.log(`  売り: ${data.sellAmount.toFixed(6)} (${data.sellCount}回, ${data.totalSellRevenue.toFixed(2)}円)`);
          console.log(`  正味: ${data.netPosition.toFixed(6)}`);
          console.log(`  手数料: ${data.totalFee.toFixed(6)}`);
          console.log('');
        }

      } catch (error) {
        console.error(`  Redisキー作成エラー: ${redisKey} - ${error.message}`);
      }
    }

    console.log(`✅ trade_summary再構築完了: ${createdCount}件作成`);
    console.log('');

    // 結果を通貨別に集計して表示
    console.log('📊 問題通貨の修正結果:');
    const currencyTotals = new Map();

    for (const [, data] of summaryByKey) {
      const currency = data.symbol.split('/')[0];
      if (problemCurrencies.some(pc => pc.startsWith(currency))) {
        if (!currencyTotals.has(currency)) {
          currencyTotals.set(currency, {
            buyTotal: 0,
            sellTotal: 0,
            netTotal: 0
          });
        }
        const totals = currencyTotals.get(currency);
        totals.buyTotal += data.buyAmount;
        totals.sellTotal += data.sellAmount;
        totals.netTotal += data.netPosition;
      }
    }

    for (const [currency, totals] of currencyTotals) {
      console.log(`  ${currency}:`);
      console.log(`    買い累計: ${totals.buyTotal.toFixed(6)}`);
      console.log(`    売り累計: ${totals.sellTotal.toFixed(6)}`);
      console.log(`    正味ポジション: ${totals.netTotal.toFixed(6)}`);
      console.log('');
    }

    console.log('================================================================================');
    console.log('🎉 MongoDB取引履歴ベースの再構築完了');

    return {
      totalSummaries: createdCount,
      processedTrades: allTrades.length
    };

  } catch (error) {
    console.error('❌ 再構築エラー:', error);
    throw error;
  }
}

// スクリプト実行
if (require.main === module) {
  rebuildFromMongoTrades().then((result) => {
    console.log(`\\n📊 最終結果: ${result.totalSummaries}件のサマリーを${result.processedTrades}件の取引から再構築`);
    process.exit(0);
  }).catch((error) => {
    console.error('❌ スクリプト実行失敗:', error);
    process.exit(1);
  });
}

module.exports = { rebuildFromMongoTrades };