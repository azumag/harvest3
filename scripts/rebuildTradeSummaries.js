/**
 * MongoDBの取引データからRedisの取引サマリーを再構築するスクリプト
 *
 * 現在のRedisデータは以下の問題があるため再構築が必要：
 * - exchangeId が "trade" になっている（正しくは "bitbank" など）
 * - symbol が "bitbank" になっている（正しくは "BTC/JPY" など）
 * - strategyKey が通貨ペアになっている（正しくは戦略名）
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');
const { createClient } = require('redis');

// MongoDB設定
const MONGO_URL = process.env.MONGO_URL || 'mongodb://harvest3-mongodb:27017';
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || 'harvest3';

// Redis設定
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

async function rebuildTradeSummaries() {
  // MongoDB接続
  const mongoClient = new MongoClient(MONGO_URL);
  await mongoClient.connect();
  console.log('MongoDBに接続しました');

  const db = mongoClient.db(MONGO_DB_NAME);
  const tradesCollection = db.collection('trades');

  // Redis接続
  const redisClient = createClient({ url: REDIS_URL });
  await redisClient.connect();
  console.log('Redisに接続しました');

  try {
    // 既存のサマリーキーを削除
    console.log('既存のサマリーキーを削除中...');
    const existingKeys = await redisClient.keys('summary:trade:*');
    if (existingKeys.length > 0) {
      await redisClient.del(existingKeys);
      console.log(`${existingKeys.length}個のサマリーキーを削除しました`);
    }

    // MongoDBから全ての取引データを取得
    console.log('MongoDBから取引データを取得中...');
    const trades = await tradesCollection.find({}).toArray();
    console.log(`${trades.length}件の取引データを取得しました`);

    // 取引データをグループ化（exchange, symbol, strategy別）
    const summaryMap = new Map();

    for (const trade of trades) {
      const key = `${trade.exchange}:${trade.symbol}:${trade.strategy}`;

      if (!summaryMap.has(key)) {
        summaryMap.set(key, {
          exchange: trade.exchange,
          symbol: trade.symbol,
          strategy: trade.strategy,
          buyAmount: 0,
          sellAmount: 0,
          totalBuyCost: 0,
          totalSellValue: 0,
          netPosition: 0,
          totalFee: 0,
          realizedPnL: 0,
          trades: []
        });
      }

      const summary = summaryMap.get(key);
      summary.trades.push(trade);

      // 集計を更新
      if (trade.side === 'buy') {
        summary.buyAmount += trade.amount || 0;
        summary.totalBuyCost += trade.value || (trade.amount * trade.price) || 0;
        summary.netPosition += trade.amount || 0;
      } else if (trade.side === 'sell') {
        summary.sellAmount += trade.amount || 0;
        summary.totalSellValue += trade.value || (trade.amount * trade.price) || 0;
        summary.netPosition -= trade.amount || 0;
      }

      summary.totalFee += trade.fee || 0;
    }

    // 実現損益を計算
    for (const [key, summary] of summaryMap) {
      // 取引を時系列でソート
      summary.trades.sort((a, b) => a.timestamp - b.timestamp);

      let buyAmount = 0;
      let totalBuyCost = 0;
      let realizedPnL = 0;

      for (const trade of summary.trades) {
        if (trade.side === 'buy') {
          buyAmount += trade.amount;
          totalBuyCost += trade.value || (trade.amount * trade.price);
        } else if (trade.side === 'sell' && buyAmount > 0) {
          // 平均購入価格を計算
          const avgBuyPrice = totalBuyCost / buyAmount;
          const sellValue = trade.value || (trade.amount * trade.price);
          const sellCost = trade.amount * avgBuyPrice;
          const profit = sellValue - sellCost;

          realizedPnL += profit;

          // 売却分を買いから減算
          const sellRatio = Math.min(trade.amount / buyAmount, 1);
          buyAmount -= trade.amount;
          totalBuyCost -= totalBuyCost * sellRatio;
        }
      }

      summary.realizedPnL = realizedPnL;
    }

    // Redisに保存
    console.log('Redisにサマリーデータを保存中...');
    let savedCount = 0;

    for (const [key, summary] of summaryMap) {
      const redisKey = `summary:trade:${summary.exchange}:${summary.symbol}:${summary.strategy}`;

      await redisClient.hSet(redisKey, {
        buyAmount: summary.buyAmount,
        sellAmount: summary.sellAmount,
        totalBuyCost: summary.totalBuyCost,
        totalSellValue: summary.totalSellValue,
        netPosition: summary.netPosition,
        totalFee: summary.totalFee,
        realizedPnL: summary.realizedPnL,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });

      savedCount++;

      // 進捗を表示
      if (savedCount % 10 === 0) {
        console.log(`${savedCount}/${summaryMap.size}件のサマリーを保存しました`);
      }
    }

    console.log('\n✅ 再構築完了！');
    console.log(`合計 ${savedCount} 件のサマリーを作成しました`);

    // サンプルデータを表示
    console.log('\nサンプルデータ（最初の5件）:');
    let sampleCount = 0;
    for (const [key, summary] of summaryMap) {
      if (sampleCount >= 5) {
        break;
      }
      console.log(`\n${key}:`);
      console.log(`  買い数量: ${summary.buyAmount.toFixed(4)}`);
      console.log(`  売り数量: ${summary.sellAmount.toFixed(4)}`);
      console.log(`  実現損益: ${summary.realizedPnL.toFixed(2)} 円`);
      sampleCount++;
    }

  } catch (error) {
    console.error('エラーが発生しました:', error);
  } finally {
    // 接続を閉じる
    await mongoClient.close();
    await redisClient.quit();
    console.log('\n接続を閉じました');
  }
}

// スクリプトを実行
rebuildTradeSummaries()
  .then(() => console.log('\nスクリプトが完了しました'))
  .catch(console.error);