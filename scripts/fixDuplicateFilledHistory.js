/**
 * 重複約定履歴修正スクリプト
 * 
 * 1. 既存の履歴データから重複エントリを特定し削除
 * 2. ハッシュ値が未設定の履歴レコードに対して適切なハッシュを生成・設定
 */

// 必要なモジュールをインポート
const { client, initRedisClient, closeRedisClient } = require('../src/redisClient');

// 開始時間を記録
const startTime = Date.now();
console.log(`[${new Date(startTime).toISOString()}] 重複約定履歴修正処理を開始します`);

// 処理の統計情報
let processedExchanges = 0;
let processedSymbols = 0;
let processedStrategies = 0;
let totalHistoryEntries = 0;
let totalDuplicatesFound = 0;
let totalHashesAdded = 0;
let errorCount = 0;

/**
 * トレードエントリからユニークキーを生成する関数
 * @param {Object} trade - 約定履歴エントリ
 * @param {String} exchangeId - 取引所ID
 * @param {String} symbol - 通貨ペア
 * @param {String} strategyKey - 戦略キー
 * @returns {String} ユニークキー
 */
function generateTradeUniqueKey(trade, exchangeId, symbol, strategyKey) {
  // 数値は固定小数点形式に変換して精度問題を回避
  const { orderId, side, amount, price, orderType, fee } = trade;
  const amountFixed = parseFloat(amount).toFixed(8);
  const priceFixed = parseFloat(price).toFixed(8);
  const feeFixed = parseFloat(fee || 0).toFixed(8);
  
  return `${exchangeId}:${symbol}:${strategyKey}:${orderId}:${side}:${amountFixed}:${priceFixed}:${orderType}:${feeFixed}`;
}

/**
 * 履歴データから重複を検出し、修正する関数
 * @param {String} exchangeId - 取引所ID
 * @param {String} symbol - 通貨ペア
 * @param {String} strategyKey - 戦略キー
 * @returns {Promise<Object>} 処理結果
 */
async function fixDuplicateHistory(exchangeId, symbol, strategyKey) {
  console.log(`[${exchangeId}][${symbol}][${strategyKey}] 約定履歴の重複チェックを開始`);
  
  // 約定履歴キー
  const historyKey = `trade:filledHistory:${exchangeId}:${symbol}:${strategyKey}`;
  
  // 重複チェック用のセットキー
  const uniqueTradeSetKey = `trade:uniqueTrades:${exchangeId}:${symbol}:${strategyKey}`;
  
  try {
    // 既存の約定履歴を取得
    const filledHistory = await client.lRange(historyKey, 0, -1);
    const historyLength = filledHistory.length;
    
    if (historyLength === 0) {
      console.log(`  約定履歴なし、スキップします`);
      return { processed: 0, duplicatesRemoved: 0, hashesAdded: 0 };
    }
    
    console.log(`  約定履歴を取得: ${historyLength}件`);
    
    // 既存のユニークトレードセットを取得
    const existingUniqueKeys = await client.sMembers(uniqueTradeSetKey);
    console.log(`  既存ユニークキー: ${existingUniqueKeys.length}件`);
    
    // 新しい約定履歴を構築（重複を除外）
    const newFilledHistory = [];
    const uniqueKeys = new Set(existingUniqueKeys);
    let duplicatesFound = 0;
    let hashesAdded = 0;
    
    for (const historyItem of filledHistory) {
      try {
        const trade = JSON.parse(historyItem);
        const uniqueKey = generateTradeUniqueKey(trade, exchangeId, symbol, strategyKey);
        
        // 既に処理済みかチェック
        if (uniqueKeys.has(uniqueKey)) {
          // 重複を検出
          console.log(`    重複を検出: ${uniqueKey}`);
          duplicatesFound++;
          continue;
        }
        
        // 重複でなければ新しいリストに追加
        newFilledHistory.push(historyItem);
        
        // ユニークキーをセットに追加
        uniqueKeys.add(uniqueKey);
        
        // 既存のセットになければRedisのセットにも追加
        if (!existingUniqueKeys.includes(uniqueKey)) {
          await client.sAdd(uniqueTradeSetKey, uniqueKey);
          hashesAdded++;
        }
      } catch (error) {
        console.error(`    レコード解析エラー:`, error);
        errorCount++;
        
        // エラーがあっても処理を継続（データを保持）
        newFilledHistory.push(historyItem);
      }
    }
    
    // 重複が見つかった場合のみリストを更新
    if (duplicatesFound > 0) {
      console.log(`  ${duplicatesFound}件の重複を検出しました。約定履歴を更新します。`);
      
      // 古いリストを削除して新しいリストで置き換え
      await client.del(historyKey);
      
      if (newFilledHistory.length > 0) {
        await client.rPush(historyKey, newFilledHistory);
      }
      
      console.log(`  約定履歴を更新しました: ${historyLength}件 → ${newFilledHistory.length}件`);
    } else if (hashesAdded > 0) {
      console.log(`  重複はありませんでしたが、${hashesAdded}件のハッシュキーを追加しました。`);
    } else {
      console.log(`  重複なし、ハッシュも最新です。更新不要。`);
    }
    
    return { 
      processed: historyLength,
      duplicatesRemoved: duplicatesFound,
      hashesAdded: hashesAdded
    };
  } catch (error) {
    console.error(`  処理エラー:`, error);
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
          
          try {
            // 重複履歴の修正
            const result = await fixDuplicateHistory(exchangeId, symbol, strategyKey);
            
            totalHistoryEntries += result.processed;
            totalDuplicatesFound += result.duplicatesRemoved;
            totalHashesAdded += result.hashesAdded;
          } catch (err) {
            console.error(`  約定履歴修正エラー:`, err);
            errorCount++;
          }
        }
      }
    }
    
    // 終了時間を記録
    const endTime = Date.now();
    const executionTime = (endTime - startTime) / 1000; // 秒単位
    
    console.log(`\n--- 重複約定履歴修正処理完了 ---`);
    console.log(`処理時間: ${executionTime.toFixed(2)}秒`);
    console.log(`処理した取引所数: ${processedExchanges}`);
    console.log(`処理した通貨ペア数: ${processedSymbols}`);
    console.log(`処理した戦略数: ${processedStrategies}`);
    console.log(`処理した約定履歴数: ${totalHistoryEntries}`);
    console.log(`検出・削除した重複数: ${totalDuplicatesFound}`);
    console.log(`追加したハッシュキー数: ${totalHashesAdded}`);
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