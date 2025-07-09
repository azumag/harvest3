/**
 * CCXTバージョン間の主要なAPI変更点を確認するスクリプト
 * このスクリプトは、v3.0.0 から v3.1.60 に更新する際の
 * 主要なAPI互換性に関する問題を特定するのに役立ちます
 */

const ccxt = require('ccxt');
require('dotenv').config();

async function checkCcxtVersionDifferences() {
  console.log('='.repeat(60));
  console.log(`CCXT バージョン情報: ${ccxt.version}`);
  console.log('='.repeat(60));

  // 利用可能な取引所一覧を表示
  console.log('\n1. 利用可能な取引所一覧:');
  const exchanges = ccxt.exchanges;
  console.log(`合計 ${exchanges.length} 取引所のサポート`);
  console.log(`(例) ${exchanges.slice(0, 10).join(', ')}...`);

  // Bitbankインスタンスを作成
  console.log('\n2. Bitbankインスタンスの作成とメソッド確認:');
  const exchange = new ccxt.bitbank({
    enableRateLimit: true
    // APIキー不要
  });

  // インスタンスの主要メソッドを確認
  console.log('\n3. 主要メソッドの存在確認:');

  const criticalMethods = [
    'loadMarkets',
    'fetchTicker',
    'fetchOHLCV',
    'fetchBalance',
    'fetchOpenOrders',
    'fetchClosedOrders',
    'createOrder',
    'cancelOrder',
    'fetchMyTrades',
    'fetchTrades'
  ];

  for (const method of criticalMethods) {
    if (typeof exchange[method] === 'function') {
      console.log(`✓ ${method}: 存在`);
    } else {
      console.log(`✗ ${method}: 存在しない (CCXT APIの変更の可能性)`);
    }
  }

  // 取引所メタデータの確認
  console.log('\n4. Bitbank取引所メタデータ:');
  console.log(`取引所ID: ${exchange.id}`);
  console.log(`名前: ${exchange.name}`);
  console.log(`国: ${exchange.countries}`);
  console.log(`CORS対応: ${exchange.has.cors}`);
  console.log(`ケース変換処理: ${JSON.stringify(exchange.camelcase)}`);

  // レート制限の設定を確認
  console.log('\n5. レート制限の設定:');
  console.log(`enableRateLimit: ${exchange.enableRateLimit}`);
  console.log(`rateLimit: ${exchange.rateLimit}`);

  // マーケットデータを読み込む
  try {
    console.log('\n6. マーケットデータ読み込みテスト:');
    await exchange.loadMarkets();
    console.log(`成功: ${Object.keys(exchange.markets).length} マーケットを読み込みました`);

    // 代表的なマーケットの構造を調査
    if ('BTC/JPY' in exchange.markets) {
      console.log('\n7. BTC/JPY マーケット構造:');
      const market = exchange.markets['BTC/JPY'];
      console.log(`ID: ${market.id}`);
      console.log(`ベース: ${market.base}`);
      console.log(`クオート: ${market.quote}`);
      console.log(`アクティブ: ${market.active}`);
      console.log(`プレシジョン: ${JSON.stringify(market.precision)}`);
      console.log(`リミット: ${JSON.stringify(market.limits)}`);
    }

    console.log('\n8. マーケットデータのプロパティ一覧:');
    const marketKeys = Object.keys(exchange.markets['BTC/JPY']).sort();
    console.log(marketKeys.join(', '));
  } catch (error) {
    console.error(`マーケットデータ読み込み中にエラー: ${error.message}`);
  }

  console.log('\n=== サマリー ===');
  console.log('上記の情報に基づいて、CCXTバージョン間の主要な変更点が判断できます。');
  console.log('マーケットオブジェクトの構造やメソッド名に変更がない場合は、');
  console.log('アプリケーションコードの互換性はおそらく保たれています。');
}

// 実行
checkCcxtVersionDifferences();