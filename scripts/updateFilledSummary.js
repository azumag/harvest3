/**
 * FilledSummary更新スクリプト
 * 
 * すべてのfilledHistoryを取得して、それぞれの取引所、通貨ペア、戦略における
 * filledSummaryを最新化するスクリプト
 */

// 必要なモジュールをインポート
const { client, initRedisClient, closeRedisClient } = require('../src/redisClient');

// 開始時間を記録
const startTime = Date.now();
console.log(`[${new Date(startTime).toISOString()}] FilledSummary更新処理を開始します`);

// 処理の統計情報
let processedExchanges = 0;
let processedSymbols = 0;
let processedStrategies = 0;
let processedHistories = 0;
let updatedSummaries = 0;
let errorCount = 0;

/**
 * FilledSummaryを再計算する関数
 * @param {String} exchangeId - 取引所ID
 * @param {String} symbol - 通貨ペア
 * @param {String} strategyKey - 戦略キー
 * @param {Array} filledHistory - 約定履歴データ
 * @returns {Promise<Object>} 更新結果
 */
async function recalculateFilledSummary(exchangeId, symbol, strategyKey, filledHistory) {
  console.log(`[${exchangeId}][${symbol}][${strategyKey}] filledSummaryを再計算中 (${filledHistory.length}件の履歴データ)`);
  
  // 既存のfilledSummaryを取得（差分確認用）
  const summaryKey = `trade:filledSummary:${exchangeId}:${symbol}:${strategyKey}`;
  const existingSummary = await client.hGetAll(summaryKey);
  
  // 現在時刻（ミリ秒）
  const now = Date.now();
  
  // 新しいfilledSummaryの初期値
  const newSummary = {
    buyAmount: 0,
    sellAmount: 0,
    totalBuyCost: 0,
    totalSellValue: 0,
    netPosition: 0,
    totalFee: 0,
    realizedPnL: 0,
    createdAt: existingSummary.createdAt || now, // 既存値または現在時刻
    updatedAt: now
  };
  
  // filledHistoryをパースしてソート（古い順）
  const trades = filledHistory.map(item => JSON.parse(item));
  trades.sort((a, b) => a.filledAt - b.filledAt);
  
  // 各約定履歴を処理
  for (const trade of trades) {
    const { side, amount, price, fee } = trade;
    const value = amount * price;
    
    if (side === 'buy') {
      // 買い注文の場合
      newSummary.buyAmount += amount;
      newSummary.totalBuyCost += value;
      newSummary.netPosition += amount;
    } else if (side === 'sell') {
      // 売り注文の場合
      newSummary.sellAmount += amount;
      newSummary.totalSellValue += value;
      newSummary.netPosition -= amount;
      
      // 実現損益を計算（売りの場合のみ更新）
      // ロジックはsrc/redisDatabase.jsのaddFilledTrade関数と同様
      const currentBuyAmount = newSummary.buyAmount;
      const currentBuyCost = newSummary.totalBuyCost;
      
      if (currentBuyAmount > 0) {
        const avgBuyCost = currentBuyCost / currentBuyAmount;
        const soldCost = amount * avgBuyCost;
        const profit = value - soldCost;
        newSummary.realizedPnL += profit;
      }
    }
    
    // 手数料を加算
    newSummary.totalFee += fee || 0;
  }
  
  // 既存のサマリーと差分があるか確認
  let isDifferent = false;
  const comparisonFields = ['buyAmount', 'sellAmount', 'totalBuyCost', 'totalSellValue', 'netPosition', 'totalFee', 'realizedPnL'];
  
  comparisonFields.forEach(field => {
    const existingValue = parseFloat(existingSummary[field] || 0);
    const newValue = newSummary[field];
    
    // 小数点以下の丸め誤差を考慮して比較（0.00001以上の差がある場合に異なるとみなす）
    if (Math.abs(existingValue - newValue) > 0.00001) {
      console.log(`  - [${field}] ${existingValue} => ${newValue} (差分: ${newValue - existingValue})`);
      isDifferent = true;
    }
  });
  
  // 差分がある場合のみ更新
  if (isDifferent || !existingSummary.createdAt) {
    console.log(`  → filledSummaryを更新します`);
    
    // filledSummaryを更新
    await client.hSet(summaryKey, {
      buyAmount: newSummary.buyAmount,
      sellAmount: newSummary.sellAmount,
      totalBuyCost: newSummary.totalBuyCost,
      totalSellValue: newSummary.totalSellValue,
      netPosition: newSummary.netPosition,
      totalFee: newSummary.totalFee,
      realizedPnL: newSummary.realizedPnL,
      createdAt: newSummary.createdAt,
      updatedAt: newSummary.updatedAt
    });
    
    // 時系列インデックスに追加
    await client.zAdd('trade:filledSummary:time', {
      score: now,
      value: `${exchangeId}:${symbol}:${strategyKey}`
    });
    
    // 約定サマリー更新時間テーブルを更新
    const timestampKey = `summary:filledSummaryTimestamp:${exchangeId}:${symbol}`;
    await client.set(timestampKey, now);
    
    return { updated: true, newSummary };
  } else {
    console.log(`  → 差分なし、更新をスキップします`);
    return { updated: false, newSummary };
  }
}

/**
 * メイン処理関数
 */
async function main() {
  try {
    // Redisクライアントの初期化
    await initRedisClient();
    console.log('Redisクライアントが初期化されました');
    
    // 取引所一覧を取得
    const exchanges = await client.sMembers('exchanges');
    console.log(`取引所一覧を取得: ${exchanges.length}件`);
    
    // 各取引所の処理
    for (const exchangeId of exchanges) {
      console.log(`\n--- 取引所: ${exchangeId} の処理開始 ---`);
      processedExchanges++;
      
      // 通貨ペア一覧を取得
      const symbols = await client.sMembers(`symbols:${exchangeId}`);
      console.log(`通貨ペア一覧を取得: ${symbols.length}件`);
      
      // 各通貨ペアの処理
      for (const symbol of symbols) {
        console.log(`\n>> 通貨ペア: ${symbol} の処理開始`);
        processedSymbols++;
        
        // 戦略一覧を取得
        const strategies = await client.sMembers(`strategies:${exchangeId}:${symbol}`);
        console.log(`戦略一覧を取得: ${strategies.length}件`);
        
        // 各戦略の処理
        for (const strategyKey of strategies) {
          console.log(`\n> 戦略: ${strategyKey} の処理開始`);
          processedStrategies++;
          
          // 約定履歴を取得
          const historyKey = `trade:filledHistory:${exchangeId}:${symbol}:${strategyKey}`;
          const filledHistory = await client.lRange(historyKey, 0, -1);
          processedHistories += filledHistory.length;
          
          if (filledHistory.length === 0) {
            console.log(`  約定履歴なし、スキップします`);
            continue;
          }
          
          console.log(`  約定履歴を取得: ${filledHistory.length}件`);
          
          try {
            // filledSummaryを再計算
            const result = await recalculateFilledSummary(exchangeId, symbol, strategyKey, filledHistory);
            
            if (result.updated) {
              updatedSummaries++;
            }
          } catch (err) {
            console.error(`  filledSummary更新エラー:`, err);
            errorCount++;
          }
        }
      }
    }
    
    // 終了時間を記録
    const endTime = Date.now();
    const executionTime = (endTime - startTime) / 1000; // 秒単位
    
    console.log(`\n--- FilledSummary更新処理完了 ---`);
    console.log(`処理時間: ${executionTime.toFixed(2)}秒`);
    console.log(`処理した取引所数: ${processedExchanges}`);
    console.log(`処理した通貨ペア数: ${processedSymbols}`);
    console.log(`処理した戦略数: ${processedStrategies}`);
    console.log(`処理した約定履歴数: ${processedHistories}`);
    console.log(`更新したfilledSummary数: ${updatedSummaries}`);
    console.log(`エラー数: ${errorCount}`);
    console.log(`[${new Date(endTime).toISOString()}] 処理が完了しました`);
    
  } catch (error) {
    console.error('処理エラー:', error);
  } finally {
    // Redisクライアントの終了
    await closeRedisClient();
    console.log('Redisクライアントを終了しました');
  }
}

// スクリプト実行
main().catch(err => {
  console.error('スクリプト実行エラー:', err);
  process.exit(1);
});