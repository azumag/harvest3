const { exchangeBB } = require('./src/config');

/**
 * APE/JPYのmarketParameters取得をテストし、エラーハンドリングを検証する
 */
async function testAPEJPYMarketParameters() {
  console.log('=== APE/JPY marketParameters 取得テスト開始 ===\n');
  
  try {
    // Step 1: マーケットが読み込まれているか確認
    console.log('Step 1: マーケットデータの読み込み状況を確認');
    if (!exchangeBB.markets) {
      console.log('マーケットデータが未読み込み、読み込み中...');
      await exchangeBB.loadMarkets();
      console.log('マーケットデータの読み込み完了');
    } else {
      console.log('マーケットデータは既に読み込み済み');
    }
    
    // Step 2: APE/JPYマーケットの存在確認
    console.log('\nStep 2: APE/JPYマーケットの存在確認');
    const market = exchangeBB.markets['APE/JPY'];
    if (!market) {
      console.error('❌ APE/JPYマーケットが見つかりません');
      return;
    }
    console.log('✅ APE/JPYマーケットが見つかりました');
    console.log('マーケット詳細:', JSON.stringify(market, null, 2));
    
    // Step 3: 基本的なmarketParametersの抽出
    console.log('\nStep 3: marketParametersの抽出');
    const minTradeAmount = market.limits?.amount?.min || 0.0001;
    let pricePrecision = market.precision ? market.precision.price : undefined;
    let amountPrecision = market.precision ? market.precision.amount : undefined;
    
    console.log('初期値:');
    console.log(`  minTradeAmount: ${minTradeAmount}`);
    console.log(`  pricePrecision: ${pricePrecision}`);
    console.log(`  amountPrecision: ${amountPrecision}`);
    
    // Step 4: pricePrecisionが未定義の場合のティッカー取得による補完
    if (!pricePrecision) {
      console.log('\nStep 4: pricePrecision未定義のため、ティッカーから取得します');
      try {
        const ticker = await exchangeBB.fetchTicker('APE/JPY');
        console.log('ティッカー取得成功:', ticker);
        
        const lastPrice = ticker.last;
        if (lastPrice) {
          const priceDecimals = (lastPrice.toString().split('.')[1] || '').length;
          pricePrecision = priceDecimals;
          console.log(`✅ ティッカーから価格精度を算出: ${pricePrecision} (価格: ${lastPrice})`);
        } else {
          console.error('❌ ティッカーのlast価格が取得できませんでした');
        }
      } catch (tickerError) {
        console.error('❌ ティッカー取得エラー:', tickerError.message);
        console.error('エラータイプ:', tickerError.name);
        console.error('エラースタック:', tickerError.stack);
      }
    }
    
    // Step 5: amountPrecisionの補完
    if (!amountPrecision) {
      console.log('\nStep 5: amountPrecision未定義のため、minTradeAmountから算出します');
      const minTradeAmountDecimals = (minTradeAmount.toString().split('.')[1] || '').length;
      amountPrecision = minTradeAmountDecimals;
      console.log(`✅ minTradeAmountから数量精度を算出: ${amountPrecision}`);
    }
    
    // Step 6: 最終結果
    console.log('\n=== 最終結果 ===');
    const result = {
      minTradeAmount,
      pricePrecision,
      amountPrecision
    };
    console.log('marketParameters:', result);
    
    // Step 7: 検証
    if (result.minTradeAmount && result.pricePrecision !== undefined && result.amountPrecision !== undefined) {
      console.log('✅ 全てのparametersの取得に成功しました');
      return result;
    } else {
      console.error('❌ 一部のparametersの取得に失敗しました');
      return null;
    }
    
  } catch (error) {
    console.error('=== 予期しないエラーが発生しました ===');
    console.error('エラーメッセージ:', error.message);
    console.error('エラータイプ:', error.name);
    console.error('エラースタック:', error.stack);
    return null;
  }
}

// 未対応ペアのテスト
async function testUnsupportedPair() {
  console.log('\n=== 未対応ペア (TEST/JPY) のテスト開始 ===\n');
  
  try {
    // 存在しない通貨ペアでテスト
    const market = exchangeBB.markets['TEST/JPY'];
    if (!market) {
      console.log('✅ 期待通り、TEST/JPYマーケットは見つかりませんでした');
      
      // マーケット再読み込みテスト
      console.log('マーケット再読み込みを試行...');
      await exchangeBB.loadMarkets();
      const marketAfterReload = exchangeBB.markets['TEST/JPY'];
      
      if (!marketAfterReload) {
        console.log('✅ 再読み込み後も期待通り、TEST/JPYマーケットは見つかりませんでした');
        return null;
      } else {
        console.error('❌ 予期しない結果: 再読み込み後にTEST/JPYマーケットが見つかりました');
        return marketAfterReload;
      }
    } else {
      console.error('❌ 予期しない結果: TEST/JPYマーケットが見つかりました');
      return market;
    }
  } catch (error) {
    console.error('未対応ペアテスト中にエラーが発生:', error.message);
    return null;
  }
}

// テスト実行
async function runTests() {
  console.log('APE/JPY marketParameters 検証テスト\n');
  
  const apeResult = await testAPEJPYMarketParameters();
  const unsupportedResult = await testUnsupportedPair();
  
  console.log('\n=== テスト概要 ===');
  console.log(`APE/JPY テスト: ${apeResult ? '成功' : '失敗'}`);
  console.log(`未対応ペアテスト: ${unsupportedResult === null ? '成功' : '失敗'}`);
}

if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = {
  testAPEJPYMarketParameters,
  testUnsupportedPair
};