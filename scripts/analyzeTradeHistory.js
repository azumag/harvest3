#!/usr/bin/env node

/**
 * 取引履歴詳細分析スクリプト
 *
 * MongoDB内の取引履歴を分析してBot管理残高との差異原因を特定
 */

const { connectDB } = require('../src/database/mongoDatabase');
const { initRedisClient } = require('../src/database/redisClient');
const { getTradeSummary } = require('../src/database/redisDatabase');
const { config } = require('../src/config');

async function analyzeTradeHistory() {
  try {
    console.log('🔍 取引履歴詳細分析開始');
    console.log('================================================================================');

    await connectDB();
    await initRedisClient();

    // 問題のある通貨に焦点を当てる
    const problemCurrencies = [
      { symbol: 'XRP/JPY', issue: 'Bot8.72 vs 取引所0.00', priority: 'critical' },
      { symbol: 'OMG/JPY', issue: 'Bot19.70 vs 取引所10.66', priority: 'high' },
      { symbol: 'GALA/JPY', issue: '取引所222.23 vs Bot144.98', priority: 'medium' },
      { symbol: 'OAS/JPY', issue: '取引所254.51 vs Bot170.53', priority: 'medium' }
    ];

    const activeStrategies = Object.keys(config.strategies).filter(key =>
      config.strategies[key].enabled
    );

    console.log(`📋 問題通貨: ${problemCurrencies.length}種類`);
    console.log(`📋 有効戦略: ${activeStrategies.join(', ')}`);
    console.log('');

    for (const currencyInfo of problemCurrencies) {
      const { symbol, issue, priority } = currencyInfo;
      const baseAsset = symbol.split('/')[0];

      console.log(`🔎 ${symbol} 詳細分析 (${priority})`);
      console.log(`📝 問題: ${issue}`);
      console.log('─'.repeat(80));

      // === MongoDB取引履歴分析 ===
      console.log('📊 MongoDB取引履歴:');

      try {
        // MongoDBのコレクション参照を取得
        const mongoModule = require('../src/database/mongoDatabase');
        const tradesCollection = mongoModule.tradesCollection;

        if (!tradesCollection) {
          throw new Error('tradesCollection not available');
        }

        // 最近30日間の取引履歴を取得（タイムスタンプ順）
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        const trades = await tradesCollection
          .find({
            symbol: symbol,
            filledAt: { $gte: thirtyDaysAgo }
          })
          .sort({ filledAt: -1 })
          .toArray();

        console.log(`  見つかった取引: ${trades.length}件`);

        if (trades.length === 0) {
          console.log('  ⚠️  取引履歴が見つかりません');
        } else {
          // 戦略別集計
          const strategyStats = {};
          let totalBuyAmount = 0;
          let totalSellAmount = 0;
          let totalBuyCost = 0;
          let totalSellRevenue = 0;

          for (const trade of trades) {
            const strategy = trade.strategyKey || 'UNKNOWN';

            if (!strategyStats[strategy]) {
              strategyStats[strategy] = {
                buyAmount: 0,
                sellAmount: 0,
                buyCost: 0,
                sellRevenue: 0,
                buyCount: 0,
                sellCount: 0
              };
            }

            const amount = parseFloat(trade.amount) || 0;
            const cost = parseFloat(trade.value) || 0;

            if (trade.side === 'buy') {
              strategyStats[strategy].buyAmount += amount;
              strategyStats[strategy].buyCost += cost;
              strategyStats[strategy].buyCount++;
              totalBuyAmount += amount;
              totalBuyCost += cost;
            } else if (trade.side === 'sell') {
              strategyStats[strategy].sellAmount += amount;
              strategyStats[strategy].sellRevenue += cost;
              strategyStats[strategy].sellCount++;
              totalSellAmount += amount;
              totalSellRevenue += cost;
            }
          }

          console.log('  戦略別取引統計:');
          for (const [strategy, stats] of Object.entries(strategyStats)) {
            const netAmount = stats.buyAmount - stats.sellAmount;
            console.log(`    ${strategy}:`);
            console.log(`      買い: ${stats.buyAmount.toFixed(6)} (${stats.buyCount}回, ${stats.buyCost.toFixed(2)}円)`);
            console.log(`      売り: ${stats.sellAmount.toFixed(6)} (${stats.sellCount}回, ${stats.sellRevenue.toFixed(2)}円)`);
            console.log(`      正味: ${netAmount.toFixed(6)}`);
          }

          const mongoNetPosition = totalBuyAmount - totalSellAmount;
          console.log(`  MongoDB合計正味ポジション: ${mongoNetPosition.toFixed(6)}`);

          // 最新の取引を表示
          console.log('  最新の取引 (5件):');
          trades.slice(0, 5).forEach((trade, index) => {
            const date = new Date(trade.filledAt).toISOString();
            console.log(`    ${index + 1}. ${date} - ${trade.side} ${trade.amount} @${trade.price} (${trade.strategyKey})`);
          });
        }

      } catch (mongoError) {
        console.error(`  ❌ MongoDB取引履歴取得エラー: ${mongoError.message}`);
      }

      console.log('');

      // === Redis現在残高分析 ===
      console.log('📊 Redis現在残高:');

      let redisTotalNet = 0;
      const redisDetails = {};

      for (const strategy of activeStrategies) {
        try {
          const summary = await getTradeSummary({
            exchangeId: 'bitbank',
            symbol: symbol,
            strategyKey: strategy
          });

          if (summary && summary.netPosition > 0) {
            redisTotalNet += summary.netPosition;
            redisDetails[strategy] = {
              netPosition: summary.netPosition,
              buyAmount: summary.buyAmount,
              sellAmount: summary.sellAmount,
              updatedAt: new Date(summary.updatedAt).toISOString()
            };

            console.log(`  ${strategy}:`);
            console.log(`    正味ポジション: ${summary.netPosition.toFixed(6)}`);
            console.log(`    買い累計: ${summary.buyAmount.toFixed(6)}`);
            console.log(`    売り累計: ${summary.sellAmount.toFixed(6)}`);
            console.log(`    最終更新: ${new Date(summary.updatedAt).toISOString()}`);
          }
        } catch (redisError) {
          console.error(`  ❌ ${strategy} Redis取得エラー: ${redisError.message}`);
        }
      }

      console.log(`  Redis合計正味ポジション: ${redisTotalNet.toFixed(6)}`);
      console.log('');

      // === 差異分析 ===
      console.log('🎯 差異分析:');
      console.log(`  現在のBot管理残高: ${redisTotalNet.toFixed(6)}`);
      console.log(`  問題の詳細: ${issue}`);

      if (priority === 'critical') {
        console.log('  🚨 CRITICAL: 詳細調査が必要');

        // XRPの場合は売り取引の詳細を確認
        if (symbol === 'XRP/JPY') {
          console.log('  🔍 XRP売り取引の詳細調査:');
          try {
            const mongoModule = require('../src/database/mongoDatabase');
            const tradesCollection = mongoModule.tradesCollection;

            if (!tradesCollection) {
              throw new Error('tradesCollection not available');
            }

            const sellTrades = await tradesCollection
              .find({
                symbol: 'XRP/JPY',
                side: 'sell'
              })
              .sort({ filledAt: -1 })
              .limit(10)
              .toArray();

            console.log(`    売り取引件数: ${sellTrades.length}件`);
            sellTrades.forEach((trade, index) => {
              const date = new Date(trade.filledAt).toISOString();
              console.log(`      ${index + 1}. ${date} - 売り ${trade.amount} @${trade.price} (${trade.strategyKey}) ID:${trade.orderId}`);
            });
          } catch (error) {
            console.error(`    ❌ 売り取引調査エラー: ${error.message}`);
          }
        }
      }

      console.log('');
      console.log('═'.repeat(80));
      console.log('');
    }

    console.log('🎉 取引履歴詳細分析完了');

  } catch (error) {
    console.error('❌ 分析エラー:', error);
    throw error;
  }
}

// スクリプト実行
if (require.main === module) {
  analyzeTradeHistory().then(() => {
    console.log('\\n📊 分析完了');
    process.exit(0);
  }).catch((error) => {
    console.error('❌ スクリプト実行失敗:', error);
    process.exit(1);
  });
}

module.exports = { analyzeTradeHistory };