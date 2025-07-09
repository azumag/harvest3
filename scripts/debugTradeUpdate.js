#!/usr/bin/env node

/**
 * 約定更新処理デバッグスクリプト
 *
 * 実際の約定更新プロセスを詳細にトレースし、
 * 戦略情報がどの段階で失われているかを特定する
 */

const { connectDB } = require('../src/database/mongoDatabase');
const { initRedisClient } = require('../src/database/redisClient');
const { config } = require('../src/config');

async function debugTradeUpdate() {
  console.log('🔍 約定更新処理デバッグ開始');
  console.log('================================================================================');

  try {
    await connectDB();
    await initRedisClient();
    console.log('✅ データベース接続完了');
    console.log('');

    const exchange = config.exchanges.bitbank.instance;
    const symbol = 'GALA/JPY'; // 最近約定があった通貨

    console.log(`📊 対象: ${exchange.id} ${symbol}`);
    console.log('');

    // Step 1: 取引所から約定データを取得
    console.log('⏰ Step 1: 取引所から約定データを取得');
    console.log('------------------------------------------');

    try {
      const trades = await exchange.fetchMyTrades(symbol, undefined, 5);
      console.log(`  取得した約定数: ${trades.length}件`);

      if (trades.length > 0) {
        const latestTrade = trades[0];
        console.log('  最新約定の詳細:');
        console.log(`    Order ID: ${latestTrade.order}`);
        console.log(`    Trade ID: ${latestTrade.id}`);
        console.log(`    Side: ${latestTrade.side}`);
        console.log(`    Amount: ${latestTrade.amount}`);
        console.log(`    Price: ${latestTrade.price}`);
        console.log(`    Timestamp: ${new Date(latestTrade.timestamp).toISOString()}`);
        console.log('');

        // Step 2: 戦略キー取得テスト
        console.log('⏰ Step 2: 戦略キー取得テスト');
        console.log('------------------------------');

        const { getOrderStrategyKeyByOrderId } = require('../src/database/manager');

        if (latestTrade.order) {
          try {
            const strategyKey = await getOrderStrategyKeyByOrderId(latestTrade.order);
            console.log(`  OrderID: ${latestTrade.order} の戦略キー: "${strategyKey}"`);

            // Step 3: 約定データオブジェクト構築
            console.log('⏰ Step 3: 約定データオブジェクト構築');
            console.log('----------------------------------');

            const now = Date.now();
            const _trade = {
              exchange: exchange.id,
              symbol,
              strategy: strategyKey,  // ここに戦略情報を設定
              side: latestTrade.side,
              amount: latestTrade.amount,
              price: latestTrade.price,
              value: latestTrade.cost || latestTrade.amount * latestTrade.price,
              orderId: latestTrade.order,
              orderType: latestTrade.type || 'market',
              fee: latestTrade.fee ? latestTrade.fee.cost : 0,
              tradeId: latestTrade.id,
              timestamp: now,
              filledAt: latestTrade.timestamp
            };

            console.log('  構築された_tradeオブジェクト:');
            Object.keys(_trade).forEach(key => {
              console.log(`    ${key}: ${_trade[key]}`);
            });
            console.log('');

            // Step 4: MongoDB保存前の最終確認
            console.log('⏰ Step 4: MongoDB保存前の最終確認');
            console.log('----------------------------------');
            console.log(`  strategy フィールド: "${_trade.strategy}"`);
            console.log(`  strategyKey フィールド: "${_trade.strategyKey}" (期待値: undefined)`);
            console.log('');

            // Step 5: 既存のMongoDB trades collectionで確認
            console.log('⏰ Step 5: 既存のMongoDB trades collectionで確認');
            console.log('-----------------------------------------------');

            const mongoModule = require('../src/database/mongoDatabase');
            const tradesCollection = mongoModule.tradesCollection;

            const existingTrade = await tradesCollection.findOne({ tradeId: latestTrade.id });
            if (existingTrade) {
              console.log('  既存の取引データ:');
              console.log(`    Strategy: ${existingTrade.strategy}`);
              console.log(`    StrategyKey: ${existingTrade.strategyKey}`);
              console.log(`    TradeId: ${existingTrade.tradeId}`);
              console.log(`    OrderId: ${existingTrade.orderId}`);
            } else {
              console.log('  該当する取引データが見つかりません');
            }

          } catch (strategyError) {
            console.error(`  ❌ 戦略キー取得エラー: ${strategyError.message}`);
          }
        } else {
          console.log('  ⚠️  OrderIDが見つかりません');
        }

      } else {
        console.log('  📝 取得された約定がありません');
      }

    } catch (tradeError) {
      console.error(`  ❌ 約定取得エラー: ${tradeError.message}`);
    }

    console.log('');
    console.log('================================================================================');
    console.log('🎉 約定更新処理デバッグ完了');

  } catch (error) {
    console.error('❌ デバッグ実行エラー:', error);
    throw error;
  }
}

// スクリプト実行
if (require.main === module) {
  debugTradeUpdate().then(() => {
    console.log('\\n📊 デバッグ完了');
    process.exit(0);
  }).catch((error) => {
    console.error('❌ デバッグ実行失敗:', error);
    process.exit(1);
  });
}

module.exports = { debugTradeUpdate };