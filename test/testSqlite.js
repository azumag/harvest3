// SQLite実装のテストスクリプト
const { updateTradeRecord, tradeRecords } = require('../src/tradeRecords');

// テスト関数
async function testSqliteImplementation() {
  console.log('SQLite実装のテスト開始...');
  
  try {
    // 1. 取引記録を追加
    console.log('1. テスト取引データの追加...');
    
    // テスト用のデータを作成
    const testData = [
      { exchange: 'bitbank', symbol: 'BTC/JPY', amount: 0.01, price: 5000000, side: 'buy', strategy: 'TEST' },
      { exchange: 'bitbank', symbol: 'BTC/JPY', amount: 0.005, price: 5100000, side: 'sell', strategy: 'TEST' },
      { exchange: 'bitflyer', symbol: 'ETH/JPY', amount: 0.1, price: 300000, side: 'buy', strategy: 'TEST' }
    ];
    
    // テストデータの追加
    for (const data of testData) {
      updateTradeRecord(
        data.exchange,
        data.symbol,
        data.amount,
        data.price,
        data.side,
        data.strategy
      );
    }
    
    // 少し待機してデータベースの処理が完了するのを待つ
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // 2. 取引記録の読み取り
    console.log('\n2. 取引記録の読み取りテスト...');
    
    console.log('取引記録:');
    console.log(JSON.stringify(tradeRecords, null, 2));
    
    // 3. 特定の記録の検証
    console.log('\n3. 特定の記録の検証...');
    
    // bitbankのBTC/JPYのTEST戦略の記録を取得
    const bbRecord = tradeRecords?.bitbank?.['BTC/JPY']?.TEST;
    if (bbRecord) {
      console.log('bitbank BTC/JPY TEST戦略の記録:');
      console.log(`- 買い量: ${bbRecord.buyAmount}`);
      console.log(`- 売り量: ${bbRecord.sellAmount}`);
      console.log(`- 買いコスト: ${bbRecord.totalBuyCost}`);
      console.log(`- 売り価値: ${bbRecord.totalSellValue}`);
      console.log(`- ネットポジション: ${bbRecord.netPosition}`);
      console.log(`- 取引履歴件数: ${bbRecord.trades.length}件`);
    } else {
      console.log('bitbank BTC/JPY TEST戦略の記録が見つかりません');
    }
    
    // bitflyerのETH/JPYのTEST戦略の記録を取得
    const bfRecord = tradeRecords?.bitflyer?.['ETH/JPY']?.TEST;
    if (bfRecord) {
      console.log('\nbitflyer ETH/JPY TEST戦略の記録:');
      console.log(`- 買い量: ${bfRecord.buyAmount}`);
      console.log(`- 買いコスト: ${bfRecord.totalBuyCost}`);
      console.log(`- ネットポジション: ${bfRecord.netPosition}`);
    } else {
      console.log('bitflyer ETH/JPY TEST戦略の記録が見つかりません');
    }
    
    console.log('\nテスト完了!');
  } catch (error) {
    console.error('テスト中にエラーが発生しました:', error);
  }
}

// テスト実行
testSqliteImplementation();