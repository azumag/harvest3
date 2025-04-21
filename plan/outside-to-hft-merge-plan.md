# OUTSIDEからHFTへのマージ実装計画

## 概要

このドキュメントでは、戦略キーが「OUTSIDE」として記録されているfilled summaryデータを「HFT」戦略にマージする実装計画について説明します。

## 背景

現在のシステムでは、一部の取引がシステム内で追跡されておらず、それらは「OUTSIDE」という戦略キーで記録されています。これらの取引データを「HFT」戦略のデータと統合することで、より正確な取引記録を維持することが目的です。

## データ構造

Redis内のデータは以下の形式で保存されています：

- `trade:filledSummary:[exchangeId]:[symbol]:[strategyKey]` - 約定サマリーデータ
- 各サマリーには以下のフィールドが含まれています：
  - `buyAmount` - 購入量
  - `sellAmount` - 売却量
  - `totalBuyCost` - 総購入コスト
  - `totalSellValue` - 総売却価値
  - `netPosition` - 現在のポジション
  - `totalFee` - 総手数料
  - `realizedPnL` - 実現済み損益
  - `createdAt` - 作成日時
  - `updatedAt` - 更新日時

## マージ要件

1. 同じ取引所と通貨ペアの組み合わせにおいて、戦略キーが「OUTSIDE」のデータを「HFT」にマージする
2. マージは数値データの単純な加算で行う
3. マージ後は元の「OUTSIDE」データを削除する

## 実装計画

### 1. スクリプトファイル作成

ファイル名：`scripts/mergeOutsideToHft.js`

### 2. 基本構造

```javascript
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

// メイン処理関数
async function main() {
  try {
    // Redisクライアントの初期化
    await initRedisClient();
    
    // 取引所一覧を取得
    // 各取引所ごとに通貨ペア一覧を取得
    // 各通貨ペアごとにOUTSIDEとHFTのサマリーを処理
    
  } catch (error) {
    // エラー処理
  } finally {
    // Redisクライアントの終了
  }
}

// スクリプト実行
main().catch(err => {
  console.error('スクリプト実行エラー:', err);
  process.exit(1);
});
```

### 3. マージ関数

```javascript
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
  let hftSummary = await client.hGetAll(hftKey);
  const now = Date.now();
  
  // HFTサマリーが存在しない場合は新規作成
  if (Object.keys(hftSummary).length === 0) {
    hftSummary = {
      buyAmount: 0,
      sellAmount: 0,
      totalBuyCost: 0,
      totalSellValue: 0,
      netPosition: 0,
      totalFee: 0,
      realizedPnL: 0,
      createdAt: now,
      updatedAt: now
    };
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
    createdAt: hftSummary.createdAt || outsideSummary.createdAt || now,
    updatedAt: now
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
  
  // 時系列インデックスに追加
  await client.zAdd('trade:filledSummary:time', {
    score: now,
    value: `${exchangeId}:${symbol}:HFT`
  });
  
  // 約定サマリー更新時間テーブルを更新
  const timestampKey = `summary:filledSummaryTimestamp:${exchangeId}:${symbol}`;
  await client.set(timestampKey, now);
  
  // OUTSIDEサマリーを削除
  await client.del(outsideKey);
  
  // 時系列インデックスからOUTSIDEエントリを削除
  await client.zRem('trade:filledSummary:time', `${exchangeId}:${symbol}:OUTSIDE`);
  
  console.log(`  → マージ完了、OUTSIDEデータを削除しました`);
  
  return { merged: true, mergedSummary };
}
```

### 4. メインロジック

```javascript
// メイン処理関数内部
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
```

## 実行方法

このスクリプトは以下のコマンドで実行します：

```bash
node scripts/mergeOutsideToHft.js
```

## エラーハンドリング

スクリプトは以下のエラーに対処します：

1. Redis接続エラー
2. データ不整合エラー
3. マージ処理中のエラー

エラーが発生した場合はログに記録し、可能な限り処理を継続します。

## 実装後のテスト計画

1. テスト環境でのスクリプト実行
2. マージ前後のデータ整合性の確認
3. HFTサマリーデータの妥当性確認
4. OUTSIDEデータが正しく削除されたことの確認

## 注意事項

- このスクリプトは一度実行すると元に戻せません（OUTSIDEデータが削除されるため）
- 実行前にデータのバックアップを取ることを推奨します
- 本番環境で実行する前に必ずテスト環境でテストしてください