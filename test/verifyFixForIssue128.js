/**
 * バグ修正の検証スクリプト (Issue #128)
 * BNB/JPY シンボルでのビットバンクAPIの認証エラー修正を検証します
 */
const ccxt = require('ccxt');
require('dotenv').config();
const { clearPositionMarket } = require('../src/strategies/utils/common');

async function verifyFix() {
  console.log('='.repeat(60));
  console.log('Issue #128 修正検証: BNB/JPY シンボルでのビットバンクAPIの認証エラー');
  console.log('='.repeat(60));

  // Bitbankインスタンスの作成
  console.log('1. Bitbank APIクライアントを初期化中...');
  const apiKey = process.env.BB_API_KEY || 'dummy_key';
  const secret = process.env.BB_API_SECRET || 'dummy_secret';

  const exchange = new ccxt.bitbank({
    apiKey,
    secret,
    enableRateLimit: true,
    timeout: 30000
  });

  try {
    // サポートされているマーケットの取得
    console.log('\n2. サポートされているマーケット一覧を取得中...');
    await exchange.loadMarkets();

    const supportedMarkets = Object.keys(exchange.markets).sort();
    console.log(`サポートされているマーケット数: ${supportedMarkets.length}`);
    console.log(`例: ${supportedMarkets.slice(0, 5).join(', ')}...`);

    // テストケース: 有効なシンボル
    console.log('\n3. 有効なシンボル (BTC/JPY) でclearPositionMarketをテスト...');
    const validSymbol = 'BTC/JPY';
    console.log(`${validSymbol}は${exchange.markets[validSymbol] ? '有効' : '無効'}なシンボルです`);

    try {
      const validResult = await clearPositionMarket(exchange, validSymbol, 'TEST_STRATEGY');
      console.log(`有効なシンボルでの結果: ${JSON.stringify(validResult)}`);
      console.log('✅ 有効なシンボルに対するテストは正常に完了しました');
    } catch (error) {
      console.error('❌ 有効なシンボルに対するテストが失敗しました:', error.message);
    }

    // テストケース: 無効なシンボル
    console.log('\n4. 無効なシンボル (BNB/JPY) でclearPositionMarketをテスト...');
    const invalidSymbol = 'BNB/JPY';
    console.log(`${invalidSymbol}は${exchange.markets[invalidSymbol] ? '有効' : '無効'}なシンボルです`);

    try {
      const invalidResult = await clearPositionMarket(exchange, invalidSymbol, 'TEST_STRATEGY');
      console.log(`無効なシンボルでの結果: ${JSON.stringify(invalidResult)}`);

      if (invalidResult && invalidResult.success === false && invalidResult.reason === 'unsupported symbol') {
        console.log('✅ 無効なシンボルに対するテストは正常に完了しました (エラーは適切に処理されました)');
      } else {
        console.log('⚠️ 無効なシンボルに対するテストは完了しましたが、予期せぬ結果が返されました');
      }
    } catch (error) {
      console.error('❌ 無効なシンボルに対するテストが失敗しました (例外がキャッチされていません):', error.message);
    }

    console.log('\n5. 検証結果サマリー');
    console.log('-'.repeat(50));
    console.log('このスクリプトは、clearPositionMarket関数が無効なシンボル (BNB/JPY) を');
    console.log('適切に処理できるようになったことを検証します。');
    console.log('');
    console.log('以前のバージョンでは、無効なシンボルに対してAPI認証エラーが発生していました。');
    console.log('修正後は、関数が無効なシンボルを検出し、適切なエラーメッセージを返します。');

  } catch (error) {
    console.error('検証スクリプトの実行中にエラーが発生しました:', error.message);
  }
}

// 検証実行
verifyFix();