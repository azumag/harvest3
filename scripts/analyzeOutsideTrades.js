#!/usr/bin/env node

/**
 * OUTSIDE約定詳細分析スクリプト
 *
 * なぜOUTSIDE戦略の約定が発生しているのかを詳細に調査し、
 * BOT管理外の約定として記録される原因を特定する
 */

const { connectDB } = require('../src/database/mongoDatabase');

async function analyzeOutsideTrades() {
  console.log('🔍 OUTSIDE約定詳細分析開始');
  console.log('================================================================================');

  try {
    await connectDB();

    // MongoDBのコレクション参照を取得
    const mongoModule = require('../src/database/mongoDatabase');
    const tradesCollection = mongoModule.tradesCollection;
    const ordersCollection = mongoModule.ordersCollection;

    if (!tradesCollection || !ordersCollection) {
      throw new Error('MongoDB collections not available');
    }

    console.log('✅ MongoDB接続完了');
    console.log('');

    // 1. OUTSIDE戦略の約定を全て取得
    console.log('📊 OUTSIDE戦略約定の調査...');
    const outsideTrades = await tradesCollection.find({
      strategyKey: 'OUTSIDE'
    }).sort({ filledAt: 1 }).toArray();

    console.log(`📈 OUTSIDE約定総数: ${outsideTrades.length}件`);

    if (outsideTrades.length === 0) {
      console.log('📝 OUTSIDE約定が見つかりません');
      return { outsideTradesCount: 0 };
    }

    console.log('');

    // 2. 時系列分析
    console.log('📅 時系列分析:');
    const dateGroups = new Map();
    const orderIdSet = new Set();

    for (const trade of outsideTrades) {
      const date = new Date(trade.filledAt).toISOString().split('T')[0];
      if (!dateGroups.has(date)) {
        dateGroups.set(date, []);
      }
      dateGroups.get(date).push(trade);

      if (trade.orderId) {
        orderIdSet.add(trade.orderId);
      }
    }

    // 日付順にソート
    const sortedDates = Array.from(dateGroups.keys()).sort();

    console.log(`  期間: ${sortedDates[0]} ～ ${sortedDates[sortedDates.length - 1]}`);
    for (const date of sortedDates.slice(-10)) { // 直近10日分
      const tradesInDate = dateGroups.get(date);
      console.log(`  ${date}: ${tradesInDate.length}件`);
    }
    console.log('');

    // 3. オーダーID分析
    console.log('🔍 オーダーID分析:');
    console.log(`  OUTSIDE約定のユニークオーダーID数: ${orderIdSet.size}件`);

    // 対応する注文データの存在確認
    const existingOrderIds = new Set();
    const missingOrderIds = new Set();
    const ordersWithoutStrategy = new Set();

    for (const orderId of orderIdSet) {
      const orderRecord = await ordersCollection.findOne({ orderId: orderId });
      if (orderRecord) {
        existingOrderIds.add(orderId);
        if (!orderRecord.strategy) {
          ordersWithoutStrategy.add(orderId);
        }
      } else {
        missingOrderIds.add(orderId);
      }
    }

    console.log(`  MongoDB注文記録が存在: ${existingOrderIds.size}件`);
    console.log(`  MongoDB注文記録が不存在: ${missingOrderIds.size}件`);
    console.log(`  注文記録はあるが戦略なし: ${ordersWithoutStrategy.size}件`);
    console.log('');

    // 4. 詳細分析サンプル
    console.log('📋 詳細分析サンプル（直近5件）:');
    const recentTrades = outsideTrades.slice(-5);

    for (let i = 0; i < recentTrades.length; i++) {
      const trade = recentTrades[i];
      console.log(`\n  [${i + 1}] ${trade.symbol} ${trade.side} ${trade.amount}`);
      console.log(`      約定時刻: ${new Date(trade.filledAt).toLocaleString()}`);
      console.log(`      オーダーID: ${trade.orderId}`);
      console.log(`      約定価格: ${trade.price}`);
      console.log(`      約定金額: ${trade.value}`);

      // 対応する注文記録をチェック
      if (trade.orderId) {
        const orderRecord = await ordersCollection.findOne({ orderId: trade.orderId });
        if (orderRecord) {
          console.log('      📄 注文記録: 存在');
          console.log(`          戦略: ${orderRecord.strategy || 'なし'}`);
          console.log(`          注文時刻: ${new Date(orderRecord.createdAt).toLocaleString()}`);
          console.log(`          注文タイプ: ${orderRecord.type || '不明'}`);
        } else {
          console.log('      ❌ 注文記録: 不存在');
        }
      } else {
        console.log('      ⚠️  オーダーIDなし');
      }
    }

    console.log('');

    // 5. パターン分析
    console.log('🔬 パターン分析:');

    // 戦略なし注文の詳細
    if (ordersWithoutStrategy.size > 0) {
      console.log('\n  ⚠️  戦略なし注文の詳細:');
      let strategylessCount = 0;
      for (const orderId of ordersWithoutStrategy) {
        if (strategylessCount >= 3) {
          break;
        } // 最初の3件のみ表示

        const orderRecord = await ordersCollection.findOne({ orderId: orderId });
        console.log(`    オーダーID: ${orderId}`);
        console.log(`    作成時刻: ${new Date(orderRecord.createdAt).toLocaleString()}`);
        console.log(`    タイプ: ${orderRecord.type || '不明'}`);
        console.log(`    シンボル: ${orderRecord.symbol}`);
        console.log('');
        strategylessCount++;
      }
    }

    // 注文記録不存在の分析
    if (missingOrderIds.size > 0) {
      console.log('\n  ❌ 注文記録不存在の約定:');
      let missingCount = 0;
      for (const orderId of missingOrderIds) {
        if (missingCount >= 3) {
          break;
        } // 最初の3件のみ表示

        const tradeWithMissingOrder = outsideTrades.find(t => t.orderId === orderId);
        if (tradeWithMissingOrder) {
          console.log(`    オーダーID: ${orderId}`);
          console.log(`    約定時刻: ${new Date(tradeWithMissingOrder.filledAt).toLocaleString()}`);
          console.log(`    シンボル: ${tradeWithMissingOrder.symbol}`);
          console.log(`    取引タイプ: ${tradeWithMissingOrder.side}`);
          console.log('');
        }
        missingCount++;
      }
    }

    // 6. 通貨別集計
    console.log('💱 通貨別OUTSIDE約定集計:');
    const symbolCounts = new Map();
    const symbolAmounts = new Map();

    for (const trade of outsideTrades) {
      const symbol = trade.symbol;
      symbolCounts.set(symbol, (symbolCounts.get(symbol) || 0) + 1);

      if (!symbolAmounts.has(symbol)) {
        symbolAmounts.set(symbol, { buy: 0, sell: 0 });
      }

      if (trade.side === 'buy') {
        symbolAmounts.get(symbol).buy += parseFloat(trade.amount);
      } else {
        symbolAmounts.get(symbol).sell += parseFloat(trade.amount);
      }
    }

    // 件数順にソート
    const sortedSymbols = Array.from(symbolCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10); // 上位10通貨

    for (const [symbol, count] of sortedSymbols) {
      const amounts = symbolAmounts.get(symbol);
      const netPosition = amounts.buy - amounts.sell;
      console.log(`  ${symbol}: ${count}件 (買い${amounts.buy.toFixed(6)}, 売り${amounts.sell.toFixed(6)}, 正味${netPosition.toFixed(6)})`);
    }

    console.log('');
    console.log('================================================================================');
    console.log('🎯 分析結果サマリー:');
    console.log(`📊 OUTSIDE約定総数: ${outsideTrades.length}件`);
    console.log(`📅 期間: ${sortedDates[0]} ～ ${sortedDates[sortedDates.length - 1]}`);
    console.log(`🔍 ユニークオーダーID: ${orderIdSet.size}件`);
    console.log(`✅ 注文記録存在: ${existingOrderIds.size}件 (${((existingOrderIds.size / orderIdSet.size) * 100).toFixed(1)}%)`);
    console.log(`❌ 注文記録不存在: ${missingOrderIds.size}件 (${((missingOrderIds.size / orderIdSet.size) * 100).toFixed(1)}%)`);
    console.log(`⚠️  戦略なし注文: ${ordersWithoutStrategy.size}件 (${((ordersWithoutStrategy.size / orderIdSet.size) * 100).toFixed(1)}%)`);

    return {
      outsideTradesCount: outsideTrades.length,
      uniqueOrderIds: orderIdSet.size,
      existingOrders: existingOrderIds.size,
      missingOrders: missingOrderIds.size,
      ordersWithoutStrategy: ordersWithoutStrategy.size,
      dateRange: { start: sortedDates[0], end: sortedDates[sortedDates.length - 1] }
    };

  } catch (error) {
    console.error('❌ 分析エラー:', error);
    throw error;
  }
}

// スクリプト実行
if (require.main === module) {
  analyzeOutsideTrades().then((result) => {
    console.log(`\n📊 最終結果: ${result.outsideTradesCount}件のOUTSIDE約定を分析完了`);
    console.log(`   注文記録存在率: ${((result.existingOrders / result.uniqueOrderIds) * 100).toFixed(1)}%`);
    console.log(`   注文記録不存在: ${result.missingOrders}件`);
    console.log(`   戦略なし注文: ${result.ordersWithoutStrategy}件`);
    process.exit(0);
  }).catch((error) => {
    console.error('❌ スクリプト実行失敗:', error);
    process.exit(1);
  });
}

module.exports = { analyzeOutsideTrades };