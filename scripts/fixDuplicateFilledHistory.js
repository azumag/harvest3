/**
 * 重複約定履歴修正スクリプト
 *
 * このスクリプトは以下の機能を提供します：
 * 1. 既存の約定履歴データから重複エントリを特定し削除
 * 2. ハッシュ値が未設定の履歴レコードに対して適切なハッシュを生成・設定
 * 3. tradeIDを使用した重複チェックを実装（redisDatabase.jsの実装に合わせる）
 * 4. 部分約定（同一内容で異なるtradeID）の適切な処理
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
let totalPartialFills = 0;
let totalFullHashesAdded = 0;
let totalContentHashesAdded = 0;
let totalTradeIdsFixed = 0;  // tradeIDを修正した回数
let errorCount = 0;

/**
 * トレードエントリからコンテンツハッシュとフルハッシュを生成する関数
 * @param {Object} trade - 約定履歴エントリ
 * @param {String} exchangeId - 取引所ID
 * @param {String} symbol - 通貨ペア
 * @param {String} strategyKey - 戦略キー
 * @returns {Object} コンテンツハッシュとフルハッシュを含むオブジェクト
 */
function generateTradeHashes(trade, exchangeId, symbol, strategyKey) {
  // 数値は固定小数点形式に変換して精度問題を回避
  const { orderId, side, amount, price, orderType, fee } = trade;
  const amountFixed = Number(amount).toFixed(8);
  const priceFixed = Number(price).toFixed(8);
  const feeFixed = Number(fee || 0).toFixed(8);

  // コンテンツハッシュ（トレードID以外の内容のみ）
  const contentHash = `${exchangeId}:${symbol}:${strategyKey}:${side}:${amountFixed}:${priceFixed}:${orderType}:${feeFixed}`;

  // フルハッシュ（トレードIDを含む）
  // tradeIdが存在する場合はそれを使用し、なければorderIdを使用
  const tradeId = trade.tradeId || orderId;
  const fullHash = `${contentHash}:${tradeId}`;

  return { contentHash, fullHash };
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
  const fullHashSetKey = `trade:uniqueTradeFullHashes:${exchangeId}:${symbol}:${strategyKey}`;
  const contentHashSetKey = `trade:uniqueTradeContentHashes:${exchangeId}:${symbol}:${strategyKey}`;

  try {
    // 既存の約定履歴を取得
    const filledHistory = await client.lRange(historyKey, 0, -1);
    const historyLength = filledHistory.length;

    if (historyLength === 0) {
      console.log('  約定履歴なし、スキップします');
      return { processed: 0, duplicatesRemoved: 0, partialFills: 0, hashesAdded: 0 };
    }

    console.log(`  約定履歴を取得: ${historyLength}件`);

    // 既存のハッシュセットを取得
    const existingFullHashes = await client.sMembers(fullHashSetKey);
    const existingContentHashes = await client.sMembers(contentHashSetKey);
    console.log(`  既存フルハッシュ: ${existingFullHashes.length}件, 既存コンテンツハッシュ: ${existingContentHashes.length}件`);

    // 新しい約定履歴を構築（重複を除外）
    const newFilledHistory = [];
    const fullHashes = new Set(existingFullHashes);
    const contentHashesMap = new Map(); // コンテンツハッシュとその関連オーダーIDを保持

    // 既存のコンテンツハッシュをマップに初期化
    for (const contentHash of existingContentHashes) {
      contentHashesMap.set(contentHash, true);
    }

    let duplicatesFound = 0;     // 完全重複（フルハッシュの重複）
    let partialFillsFound = 0;   // 部分約定（コンテンツハッシュは同じでもトレードIDが異なる）
    let fullHashesAdded = 0;
    let contentHashesAdded = 0;
    let tradeIdsFixed = 0;       // tradeID追加数

    for (const historyItem of filledHistory) {
      try {
        const trade = JSON.parse(historyItem);

        // tradeIdがない場合はorderIdを割り当てる（過去データとの互換性のため）
        let updatedHistoryItem = historyItem;
        if (!trade.tradeId) {
          trade.tradeId = trade.orderId;
          tradeIdsFixed++; // ローカル統計情報を更新
          totalTradeIdsFixed++; // グローバル統計情報を更新

          // tradeIdを追加したので、JSONを更新
          updatedHistoryItem = JSON.stringify(trade);
        }

        const { contentHash, fullHash } = generateTradeHashes(trade, exchangeId, symbol, strategyKey);

        // フルハッシュで重複チェック（完全な重複）
        if (fullHashes.has(fullHash)) {
          // 完全な重複（tradeId/orderId含めて全く同じ）を検出
          console.log(`    完全重複を検出: orderId=${trade.orderId}, tradeId=${trade.tradeId || '未設定'}`);
          duplicatesFound++;
          continue; // 重複なので追加しない
        }

        // コンテンツハッシュの処理（部分約定の検出）
        if (contentHashesMap.has(contentHash)) {
          // トレードIDが異なるが内容が同じ（部分約定の可能性）
          console.log(`    部分約定検出: orderId=${trade.orderId}, tradeId=${trade.tradeId || '未設定'}, 内容は既存レコードと同一`);
          partialFillsFound++;
          // 部分約定は保持する
        }

        // 重複でなければ新しいリストに追加
        newFilledHistory.push(updatedHistoryItem);

        // ハッシュをセットに追加
        fullHashes.add(fullHash);
        contentHashesMap.set(contentHash, true);

        // 既存のセットになければRedisのセットにも追加
        if (!existingFullHashes.includes(fullHash)) {
          await client.sAdd(fullHashSetKey, fullHash);
          fullHashesAdded++;
        }

        if (!existingContentHashes.includes(contentHash)) {
          await client.sAdd(contentHashSetKey, contentHash);
          contentHashesAdded++;
        }
      } catch (error) {
        console.error('    レコード解析エラー:', error);
        errorCount++;

        // エラーがあっても処理を継続（データを保持）
        newFilledHistory.push(historyItem);
      }
    }

    // 重複が見つかった場合や、tradeIDが修正された場合にリストを更新
    if (duplicatesFound > 0 || totalTradeIdsFixed > 0) {
      console.log(`  ${duplicatesFound}件の完全重複を検出、${totalTradeIdsFixed}件のtradeIDを追加しました。約定履歴を更新します。`);

      // 古いリストを削除して新しいリストで置き換え
      await client.del(historyKey);

      if (newFilledHistory.length > 0) {
        await client.rPush(historyKey, newFilledHistory);
      }

      console.log(`  約定履歴を更新しました: ${historyLength}件 → ${newFilledHistory.length}件`);
      console.log(`  部分約定の可能性がある同一コンテンツ: ${partialFillsFound}件（保持しました）`);
    } else if (fullHashesAdded > 0 || contentHashesAdded > 0) {
      console.log(`  重複はありませんでしたが、${fullHashesAdded}件のフルハッシュと${contentHashesAdded}件のコンテンツハッシュを追加しました。`);
      console.log(`  部分約定の可能性がある同一コンテンツ: ${partialFillsFound}件`);
    } else {
      console.log('  重複なし、ハッシュも最新です。更新不要。');
    }

    return {
      processed: historyLength,
      duplicatesRemoved: duplicatesFound,
      partialFills: partialFillsFound,
      fullHashesAdded: fullHashesAdded,
      contentHashesAdded: contentHashesAdded,
      tradeIdsFixed: tradeIdsFixed
    };
  } catch (error) {
    console.error('  処理エラー:', error);
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

            // 新しい統計情報
            if (result.partialFills) {
              totalPartialFills += result.partialFills;
            }
            if (result.fullHashesAdded) {
              totalFullHashesAdded += result.fullHashesAdded;
            }
            if (result.contentHashesAdded) {
              totalContentHashesAdded += result.contentHashesAdded;
            }
            if (result.tradeIdsFixed) {
              totalTradeIdsFixed += result.tradeIdsFixed;
            }
          } catch (err) {
            console.error('  約定履歴修正エラー:', err);
            errorCount++;
          }
        }
      }
    }

    // 終了時間を記録
    const endTime = Date.now();
    const executionTime = (endTime - startTime) / 1000; // 秒単位

    console.log('\n--- 重複約定履歴修正処理完了 ---');
    console.log(`処理時間: ${executionTime.toFixed(2)}秒`);
    console.log(`処理した取引所数: ${processedExchanges}`);
    console.log(`処理した通貨ペア数: ${processedSymbols}`);
    console.log(`処理した戦略数: ${processedStrategies}`);
    console.log(`処理した約定履歴数: ${totalHistoryEntries}`);
    console.log(`検出・削除した完全重複数: ${totalDuplicatesFound}`);
    console.log(`検出・保持した部分約定数: ${totalPartialFills}`);
    console.log(`追加したフルハッシュ数: ${totalFullHashesAdded}`);
    console.log(`追加したコンテンツハッシュ数: ${totalContentHashesAdded}`);
    console.log(`追加したtradeID数: ${totalTradeIdsFixed}`);
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