/**
 * netPosition修正スクリプト
 * 
 * すべてのfilledSummaryを取得して、netPositionが0以下になっているものを
 * すべて0に更新するスクリプト
 */

// 必要なモジュールをインポート
const { client, initRedisClient, closeRedisClient } = require('../src/redisClient');

// 開始時間を記録
const startTime = Date.now();
console.log(`[${new Date(startTime).toISOString()}] netPosition修正処理を開始します`);

// 処理の統計情報
let processedExchanges = 0;
let processedSymbols = 0;
let processedStrategies = 0;
let processedSummaries = 0;
let updatedSummaries = 0;
let errorCount = 0;

/**
 * netPositionを修正する関数
 * @param {String} exchangeId - 取引所ID
 * @param {String} symbol - 通貨ペア
 * @param {String} strategyKey - 戦略キー
 * @returns {Promise<Object>} 更新結果
 */
async function fixNetPosition(exchangeId, symbol, strategyKey) {
  const summaryKey = `trade:filledSummary:${exchangeId}:${symbol}:${strategyKey}`;
  console.log(`[${exchangeId}][${symbol}][${strategyKey}] filledSummaryを確認中`);
  
  try {
    // 既存のfilledSummaryを取得
    const existingSummary = await client.hGetAll(summaryKey);
    
    if (!Object.keys(existingSummary).length) {
      console.log(`  filledSummaryが存在しません、スキップします`);
      return { updated: false };
    }
    
    // netPositionの値を取得
    const netPosition = parseFloat(existingSummary.netPosition || 0);
    console.log(`  現在のnetPosition: ${netPosition}`);
    
    // netPositionが0以下かチェック
    if (netPosition <= 0) {
      console.log(`  netPositionが0以下です。0に修正します。`);
      
      // 現在時刻（ミリ秒）
      const now = Date.now();
      
      // filledSummaryを更新
      await client.hSet(summaryKey, {
        netPosition: 0,
        updatedAt: now
      });
      
      // 時系列インデックスに追加
      await client.zAdd('trade:filledSummary:time', {
        score: now,
        value: `${exchangeId}:${symbol}:${strategyKey}`
      });
      
      // 約定サマリー更新時間テーブルを更新
      const timestampKey = `summary:filledSummaryTimestamp:${exchangeId}:${symbol}`;
      await client.set(timestampKey, now);
      
      return { updated: true, oldValue: netPosition, newValue: 0 };
    } else {
      console.log(`  netPositionは正常値（${netPosition}）です。修正不要。`);
      return { updated: false };
    }
  } catch (error) {
    console.error(`  エラー発生:`, error);
    throw error;
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
          processedSummaries++;
          
          try {
            // netPositionを修正
            const result = await fixNetPosition(exchangeId, symbol, strategyKey);
            
            if (result.updated) {
              console.log(`  netPositionを修正しました: ${result.oldValue} → 0`);
              updatedSummaries++;
            }
          } catch (err) {
            console.error(`  netPosition修正エラー:`, err);
            errorCount++;
          }
        }
      }
    }
    
    // 終了時間を記録
    const endTime = Date.now();
    const executionTime = (endTime - startTime) / 1000; // 秒単位
    
    console.log(`\n--- netPosition修正処理完了 ---`);
    console.log(`処理時間: ${executionTime.toFixed(2)}秒`);
    console.log(`処理した取引所数: ${processedExchanges}`);
    console.log(`処理した通貨ペア数: ${processedSymbols}`);
    console.log(`処理した戦略数: ${processedStrategies}`);
    console.log(`処理したfilledSummary数: ${processedSummaries}`);
    console.log(`修正したnetPosition数: ${updatedSummaries}`);
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