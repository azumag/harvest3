/**
 * OUTSIDEからHFTへのマージスクリプト
 * 
 * 戦略キーがOUTSIDEのfilled summaryデータをHFT戦略にマージします
 */

// 必要なモジュールをインポート
const { initializeDB } = require('../src/database/dbConfig');
const { getTradeSummaries } = require('../src/database/manager');
const { exchangeBB, exchangeBF } = require('../src/config');
const { client } = require('../src/database/redisClient');

// 開始時間を記録
const startTime = Date.now();
console.log(`[${new Date(startTime).toISOString()}] OUTSIDE→HFTマージ処理を開始します`);

// 処理の統計情報
let processedExchanges = 0;
let processedSymbols = 0;
let mergedSummaries = 0;
let skippedSummaries = 0;

/**
 * OUTSIDEデータをHFTにマージする関数
 * @returns {Promise<Object>} マージ結果
 */
async function mergeOutsideToHft(outsideSummary, hftSummary) {
  const exchangeId = outsideSummary.exchangeId;
  const symbol = outsideSummary.symbol;

  console.log(`[${exchangeId}][${symbol}] OUTSIDE→HFTマージを実行中`);
  
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

  const hftKey = `summary:trade:${hftSummary.exchangeId}:${hftSummary.symbol}:HFT`;
  const outsideKey = `summary:trade:${outsideSummary.exchangeId}:${outsideSummary.symbol}:OUTSIDE`;
  
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
  
  // OUTSIDEサマリーを削除
  await client.del(outsideKey);
  
  console.log(`  → マージ完了、OUTSIDEデータを削除しました`);
  
  return { merged: true, mergedSummary };
}

// メイン処理関数
async function main() {
  await initializeDB();
  try {
    const exchanges = [exchangeBB, exchangeBF];

    // 各取引所の処理
    for (const exchange of exchanges) {
      processedExchanges++;
      const summaries = await getTradeSummaries(exchange.id);
      
      // 各通貨ペアの処理
      for (const summary of summaries) {
        processedSymbols++;

        if (summary.strategyKey === 'OUTSIDE' && summary.netPosition !== 0) {
          for (const targSummary of summaries) {
            if (targSummary.strategyKey === 'HFT' && targSummary.symbol === summary.symbol) {
              // OUTSIDEからHFTにマージ
              const result = await mergeOutsideToHft(summary, targSummary);
              
              if (result.merged) {
                mergedSummaries++;
              } else {
                skippedSummaries++;
              }
            }
          }
        }
      }
    }
    console.log(`\n処理完了`);
    
  } catch (error) {
    console.error('処理エラー:', error);
  } finally {
    process.exit(0);
  }
}

// スクリプト実行
main().catch(err => {
  console.error('スクリプト実行エラー:', err);
  process.exit(1);
});