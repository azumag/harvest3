/**
 * CCXT APIのシンボルチェック機能テスト
 */
const ccxt = require('ccxt');
require('dotenv').config();

async function testSymbolHandling() {
  console.log('CCXTのシンボル処理テスト開始');

  // BitbankのAPIインスタンスを作成
  const exchange = new ccxt.bitbank({
    enableRateLimit: true
  });

  // サポートされていないシンボルに対するfetchOpenOrdersの挙動をテスト
  try {
    console.log('無効なシンボル "BNB/JPY" に対してfetchOpenOrdersを呼び出します...');
    const invalidSymbol = 'BNB/JPY';
    await exchange.fetchOpenOrders(invalidSymbol);
  } catch (error) {
    console.log(`エラー発生 (期待通り): ${error.message}`);
    console.log(`エラータイプ: ${error.constructor.name}`);
    
    // エラーのプロパティを表示
    console.log('\nエラーの詳細情報:');
    for (const key in error) {
      if (typeof error[key] !== 'function') {
        console.log(`  ${key}: ${error[key]}`);
      }
    }
    
    // エラー処理方法の提案
    console.log('\n推奨される解決方法:');
    console.log('1. fetchOpenOrders等を呼び出す前に、そのシンボルがサポートされているか確認する');
    console.log('例: if (symbol in exchange.markets) { ... }');
    console.log('2. または、try-catchで例外をキャッチし、特定のエラータイプで処理を変更する');
  }
}

// 実行
testSymbolHandling();