// メモリ内の取引記録をSQLiteに移行するスクリプト
const fs = require('fs');
const path = require('path');

// バックアップされたtradeRecords.jsからの取引記録を読み込む
// 注意: このスクリプトは一度だけ実行してください
console.log('メモリ内の取引記録をSQLiteに移行します...');

// 元のモジュールを読み込む前に、データベースモジュールを読み込まないようにする
// 既存のtradeRecords.js.bakを使用
const originalTradeRecordsPath = path.join(__dirname, '..', 'src', 'tradeRecords.js.bak');

if (!fs.existsSync(originalTradeRecordsPath)) {
  console.error('バックアップファイルが見つかりません:', originalTradeRecordsPath);
  process.exit(1);
}

// バックアップファイルの内容を読み込む
const content = fs.readFileSync(originalTradeRecordsPath, 'utf8');

// メモリ内のtradeRecordsオブジェクトを抽出
// 警告: このアプローチは脆弱なため、一時的な移行スクリプトとしてのみ使用
const tradeRecordsMatch = content.match(/const tradeRecords = ({[\s\S]*?});/);

if (!tradeRecordsMatch) {
  console.error('tradeRecordsオブジェクトを抽出できませんでした');
  process.exit(1);
}

let originalTradeRecords;
try {
  // 抽出したコードを評価してオブジェクトとして取得
  // 注意: evalの使用は通常は避けるべきですが、移行スクリプトでの一時的な使用のため許容
  originalTradeRecords = eval(`(${tradeRecordsMatch[1]})`);
} catch (error) {
  console.error('tradeRecordsオブジェクトの評価に失敗しました:', error);
  process.exit(1);
}

// SQLiteのaddTrade関数を使用してデータを移行
const { addTrade } = require('../src/database');

async function migrateToSqlite() {
  let tradeCount = 0;
  
  // 各取引所の記録を処理
  for (const exchangeId in originalTradeRecords) {
    console.log(`取引所 ${exchangeId} の記録を処理中...`);
    
    // 各シンボルの記録を処理
    for (const symbol in originalTradeRecords[exchangeId]) {
      console.log(`- シンボル ${symbol} の記録を処理中...`);
      
      // 各戦略の記録を処理
      for (const strategyKey in originalTradeRecords[exchangeId][symbol]) {
        console.log(`  - 戦略 ${strategyKey} の記録を処理中...`);
        
        const record = originalTradeRecords[exchangeId][symbol][strategyKey];
        
        // 取引履歴を処理
        if (record.trades && Array.isArray(record.trades)) {
          for (const trade of record.trades) {
            try {
              addTrade(
                exchangeId,
                symbol,
                strategyKey,
                trade.side,
                trade.amount,
                trade.price,
                trade.value
              );
              tradeCount++;
              
              if (tradeCount % 100 === 0) {
                console.log(`    ${tradeCount}件の取引を移行しました...`);
              }
            } catch (error) {
              console.error(`    取引の移行中にエラーが発生しました:`, error);
              console.error(`    取引データ:`, JSON.stringify(trade));
            }
          }
        } else {
          console.log(`    取引履歴が見つからないか、配列ではありません`);
        }
      }
    }
  }
  
  console.log(`移行完了: ${tradeCount}件の取引を移行しました。`);
}

migrateToSqlite()
  .then(() => {
    console.log('SQLiteへの移行が正常に完了しました。');
    process.exit(0);
  })
  .catch(err => {
    console.error('移行中にエラーが発生しました:', err);
    process.exit(1);
  });