/**
 * OUTSIDEからHFTへのマージスクリプト
 * 
 * 戦略キーがOUTSIDEのfilled summaryデータをHFT戦略にマージします
 */

// 必要なモジュールをインポート
const { client, initRedisClient, closeRedisClient } = require('../src/redisClient');

// 開始時間を記録
const startTime = Date.now();
console.log(`[${new Date(startTime).toISOString()}] OUTSIDE→HFTマージ処理を開始します`);

// 処理の統計情報
let processedExchanges = 0;
let processedSymbols = 0;
let mergedSummaries = 0;
let skippedSummaries = 0;
let deletedSummaries = 0;
let errorCount = 0;

/**
 * OUTSIDEデータをHFTにマージする関数
 * @param {String} exchangeId - 取引所ID
 * @param {String} symbol - 通貨ペア
 * @returns {Promise<Object>} マージ結果
 */
async function mergeOutsideToHft(exchangeId, symbol) {
  console.log(`[${exchangeId}][${symbol}] OUTSIDE→HFTマージを実行中`);
  
  // OUTSIDEサマリーキーとHFTサマリーキー
  const outsideKey = `trade:filledSummary:${exchangeId}:${symbol}:OUTSIDE`;
  const hftKey = `trade:filledSummary:${exchangeId}:${symbol}:HFT`;
  
  // OUTSIDEサマリーを取得
  const outsideSummary = await client.hGetAll(outsideKey);
  
  // OUTSIDEデータがなければスキップ
  if (Object.keys(outsideSummary).length === 0) {
    console.log(`  → OUTSIDEデータなし、スキップします`);
    return { merged: false, reason: 'no_outside_data' };
  }
  
  // HFTサマリーを取得
  const hftSummary = await client.hGetAll(hftKey);
  const now = Date.now();
  
  // HFTサマリーが存在しない場合はスキップ
  if (Object.keys(hftSummary).length === 0) {
    console.log(`  → HFTデータなし、スキップします`);
    return { merged: false, reason: 'no_hft_data' };
  }
  
  // マージするデータを準備
  const mergedSummary = {
    buyAmount: parseFloat(hftSummary.buyAmount || 0) + parseFloat(outsideSummary.buyAmount || 0),
    sellAmount: parseFloat(hftSummary.sellAmount || 0) + parseFloat(outsideSummary.sellAmount || 0),
    totalBuyCost: parseFloat(hftSummary.totalBuyCost || 0) + parseFloat(outsideSummary.totalBuyCost || 0),
    totalSellValue: parseFloat(hftSummary.totalSellValue || 0) + parseFloat(outsideSummary.totalSellValue || 0),
    netPosition: parseFloat(hftSummary.netPosition || 0) + parseFloat(outsideSummary.netPosition || 0),
    totalFee: parseFloat(hftSummary.totalFee || 0) + parseFloat(outsideSummary.totalFee || 0),
    realizedPnL: parseFloat(hftSummary.realizedPnL || 0) + parseFloat(outsideSummary.realizedPnL || 0),
    createdAt: hftSummary.createdAt, // HFTの作成日時を維持
    updatedAt: hftSummary.updatedAt // HFTの更新日時を維持
  };
  
  // マージ結果をログ出力
  console.log(`  マージ内容:`);
  console.log(`  - buyAmount: ${hftSummary.buyAmount || 0} + ${outsideSummary.buyAmount || 0} = ${mergedSummary.buyAmount}`);
  console.log(`  - sellAmount: ${hftSummary.sellAmount || 0} + ${outsideSummary.sellAmount || 0} = ${mergedSummary.sellAmount}`);
  console.log(`  - netPosition: ${hftSummary.netPosition || 0} + ${outsideSummary.netPosition || 0} = ${mergedSummary.netPosition}`);
  
  // HFTサマリーを更新
  await client.hSet(hftKey, {
    buyAmount: mergedSummary.buyAmount,
    sellAmount: mergedSummary.sellAmount,
    totalBuyCost: mergedSummary.totalBuyCost,
    totalSellValue: mergedSummary.totalSellValue,
    netPosition: mergedSummary.netPosition,
    totalFee: mergedSummary.totalFee,
    realizedPnL: mergedSummary.realizedPnL,
    createdAt: mergedSummary.createdAt,
    updatedAt: mergedSummary.updatedAt
  });
  
  // 時系列インデックスに追加 (HFTのタイムスタンプを使用)
  if (hftSummary.updatedAt) {
     await client.zAdd('trade:filledSummary:time', {
       score: parseInt(hftSummary.updatedAt),
       value: `${exchangeId}:${symbol}:HFT`
     });
  } else {
     // HFTにupdatedAtがない場合は現在のタイムスタンプを使用
     await client.zAdd('trade:filledSummary:time', {
       score: now,
       value: `${exchangeId}:${symbol}:HFT`
     });
  }

  // 約定サマリー更新時間テーブルを更新 (HFTのタイムスタンプを使用)
  const timestampKey = `summary:filledSummaryTimestamp:${exchangeId}:${symbol}`;
   if (hftSummary.updatedAt) {
     await client.set(timestampKey, hftSummary.updatedAt);
   } else {
     // HFTにupdatedAtがない場合は現在のタイムスタンプを使用
     await client.set(timestampKey, now);
   }
  
  // OUTSIDEサマリーを削除
  await client.del(outsideKey);
  
  // 時系列インデックスからOUTSIDEエントリを削除
  await client.zRem('trade:filledSummary:time', `${exchangeId}:${symbol}:OUTSIDE`);
  
  console.log(`  → マージ完了、OUTSIDEデータを削除しました`);
  
  return { merged: true, mergedSummary };
}

// メイン処理関数
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
        
        try {
          // マージを実行
          const result = await mergeOutsideToHft(exchangeId, symbol);
          
          if (result.merged) {
            mergedSummaries++;
            deletedSummaries++;
          } else {
            skippedSummaries++;
          }
        } catch (err) {
          console.error(`  マージエラー:`, err);
          errorCount++;
        }
      }
    }

    // 終了時間を記録
    const endTime = Date.now();
    const executionTime = (endTime - startTime) / 1000; // 秒単位

    console.log(`\n--- OUTSIDE→HFTマージ処理完了 ---`);
    console.log(`処理時間: ${executionTime.toFixed(2)}秒`);
    console.log(`処理した取引所数: ${processedExchanges}`);
    console.log(`処理した通貨ペア数: ${processedSymbols}`);
    console.log(`マージしたサマリー数: ${mergedSummaries}`);
    console.log(`スキップしたサマリー数: ${skippedSummaries}`);
    console.log(`削除したOUTSIDEサマリー数: ${deletedSummaries}`);
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