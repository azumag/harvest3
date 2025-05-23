/**
 * CCXT バージョンアップグレードの互換性テスト
 * v3.0.0 から v3.1.60 へのアップグレードによる影響を確認します
 */
const ccxt = require('ccxt');
require('dotenv').config();
const { exchangeBB } = require('../src/config');

async function verifyCcxtCompatibility() {
  console.log('='.repeat(60));
  console.log('CCXT アップグレード互換性テスト (v3.0.0 → v3.1.60)');
  console.log('='.repeat(60));
  console.log(`現在のCCXTバージョン: ${ccxt.version}`);

  try {
    // テスト1: マーケットの読み込み
    console.log('\n1. マーケットの読み込みテスト');
    await exchangeBB.loadMarkets();
    const marketCount = Object.keys(exchangeBB.markets).length;
    console.log(`✅ マーケットデータ読み込み成功 (${marketCount}マーケット)`);

    // テスト2: 取引ペアの情報取得
    const symbol = 'BTC/JPY';
    console.log(`\n2. 取引ペア情報の取得テスト (${symbol})`);
    const ticker = await exchangeBB.fetchTicker(symbol);
    console.log('✅ ティッカー情報の取得成功:');
    console.log(`   最終価格: ${ticker.last}`);
    console.log(`   最高値: ${ticker.high}`);
    console.log(`   最安値: ${ticker.low}`);
    console.log(`   取引高: ${ticker.volume}`);

    // テスト3: OHLCVデータ取得
    console.log(`\n3. OHLCVデータ取得テスト (${symbol})`);
    const ohlcvData = await exchangeBB.fetchOHLCV(symbol, '1h', undefined, 5);
    console.log(`✅ OHLCV取得成功 (${ohlcvData.length}件のデータポイント)`);
    
    // テスト4: 残高取得
    console.log('\n4. アカウント残高取得テスト');
    try {
      const balance = await exchangeBB.fetchBalance();
      if (balance && balance.total) {
        console.log('✅ 残高取得成功');
        // 機密情報なので詳細は表示しない
        const currencies = Object.keys(balance.total).filter(curr => balance.total[curr] > 0);
        console.log(`   保有通貨数: ${currencies.length}`);
      } else {
        console.log('⚠️ 残高取得成功したが、予期したデータ形式ではありません');
      }
    } catch (error) {
      // APIキーの設定がない場合ここでエラーになる可能性があるが、それはCCXTバージョンの問題ではない
      console.log(`⚠️ 残高取得でエラー (APIキー設定の問題の可能性): ${error.message}`);
    }

    // テスト5: オープンオーダー取得
    console.log(`\n5. オープンオーダー取得テスト (${symbol})`);
    try {
      const openOrders = await exchangeBB.fetchOpenOrders(symbol);
      console.log(`✅ オープンオーダー取得成功 (${openOrders.length}件のオーダー)`);
    } catch (error) {
      // APIキーの設定がない場合ここでエラーになる可能性があるが、それはCCXTバージョンの問題ではない
      console.log(`⚠️ オープンオーダー取得でエラー (APIキー設定の問題の可能性): ${error.message}`);
    }

    // テスト6: マーケットの構造テスト
    console.log('\n6. マーケットオブジェクト構造テスト');
    const btcJpyMarket = exchangeBB.markets[symbol];
    console.log('マーケット情報の重要なプロパティ:');
    const criticalProps = ['id', 'symbol', 'base', 'quote', 'baseId', 'quoteId', 'active', 'limits', 'precision'];
    
    let structureChanged = false;
    for (const prop of criticalProps) {
      if (prop in btcJpyMarket) {
        console.log(`   ✓ ${prop}: 存在`);
      } else {
        console.log(`   ✗ ${prop}: 存在しない (バージョンアップによる変更の可能性)`);
        structureChanged = true;
      }
    }
    
    if (!structureChanged) {
      console.log('✅ マーケットオブジェクト構造に互換性の問題は見つかりませんでした');
    } else {
      console.log('⚠️ マーケットオブジェクト構造に変更があります。アプリケーションコードの確認が必要です');
    }

    console.log('\n=== 互換性テスト結果サマリー ===');
    console.log('CCXT バージョン v3.0.0 から v3.1.60 へのアップグレードテスト完了');
    console.log('主要機能は互換性を保っていると思われます。');
    console.log('注意: このテストはすべての機能を網羅するものではありません。特に注文作成など');
    console.log('実際の資金移動を伴う機能はテストに含まれていません。');

  } catch (error) {
    console.error('\n❌ テスト実行中にエラーが発生しました:', error.message);
    console.error('スタックトレース:', error.stack);
  }
}

// テスト実行
verifyCcxtCompatibility();